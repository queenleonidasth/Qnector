import path from "node:path";

interface ResourceLease {
  owner: string;
  resources: string[];
}

export class ResourceCoordinator {
  private readonly leases: ResourceLease[] = [];
  private readonly waiters = new Set<() => void>();

  public async withResources<T>(
    workspace: string,
    resources: string[],
    owner: string,
    work: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const normalized = [
      ...new Set(
        resources.map((resource) => normalizeResource(workspace, resource)),
      ),
    ];
    if (normalized.length === 0) return work();
    const lease = await this.acquire(normalized, owner, signal);
    try {
      return await work();
    } finally {
      this.release(lease);
    }
  }

  private async acquire(
    resources: string[],
    owner: string,
    signal?: AbortSignal,
  ): Promise<ResourceLease> {
    while (this.conflicts(resources, owner)) {
      if (signal?.aborted)
        throw new Error("RESOURCE_WAIT_CANCELED: resource wait was canceled");
      await new Promise<void>((resolve, reject) => {
        const wake = (): void => {
          cleanup();
          resolve();
        };
        const abort = (): void => {
          cleanup();
          reject(
            new Error("RESOURCE_WAIT_CANCELED: resource wait was canceled"),
          );
        };
        const cleanup = (): void => {
          this.waiters.delete(wake);
          signal?.removeEventListener("abort", abort);
        };
        this.waiters.add(wake);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
    const lease = { owner, resources };
    this.leases.push(lease);
    return lease;
  }

  private conflicts(resources: string[], owner: string): boolean {
    return this.leases.some(
      (lease) =>
        lease.owner !== owner &&
        lease.resources.some((left) =>
          resources.some((right) => resourcesOverlap(left, right)),
        ),
    );
  }

  private release(lease: ResourceLease): void {
    const index = this.leases.indexOf(lease);
    if (index >= 0) this.leases.splice(index, 1);
    for (const wake of [...this.waiters]) wake();
  }
}

export function normalizeResource(workspace: string, resource: string): string {
  const trimmed = resource.trim();
  if (/^[a-z][a-z0-9_-]*:/i.test(trimmed) && !/^[a-z]:[\\/]/i.test(trimmed))
    return `key:${trimmed.toLowerCase()}`;
  const resolved = path.resolve(workspace, trimmed);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function resourcesOverlap(left: string, right: string): boolean {
  if (left.startsWith("key:") || right.startsWith("key:"))
    return left === right;
  if (left === right) return true;
  const separator = path.sep;
  return (
    left.startsWith(`${right}${separator}`) ||
    right.startsWith(`${left}${separator}`)
  );
}

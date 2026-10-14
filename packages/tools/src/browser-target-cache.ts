/** Caches target identity only; callers must still validate liveness before use. */
export class BrowserTargetCache<T> {
  private generation = 0;
  private readonly values = new Map<string, T>();
  private readonly pending = new Map<string, Promise<T | undefined>>();

  public currentGeneration(): number { return this.generation; }

  public async resolveTarget(
    targetId: string,
    generation: number,
    resolver: () => Promise<T>,
    isLive: (value: T) => boolean,
  ): Promise<T | undefined> {
    if (generation !== this.generation) return undefined;
    const cached = this.values.get(targetId);
    if (cached !== undefined) {
      if (isLive(cached)) return cached;
      this.values.delete(targetId);
    }
    const active = this.pending.get(targetId);
    if (active) return active;
    const work = resolver().then((value) => {
      if (generation !== this.generation || !isLive(value)) return undefined;
      this.values.set(targetId, value);
      return value;
    }).finally(() => {
      if (this.pending.get(targetId) === work) this.pending.delete(targetId);
    });
    this.pending.set(targetId, work);
    return work;
  }

  public invalidateTargets(_reason: string): number {
    this.generation += 1;
    this.values.clear();
    this.pending.clear();
    return this.generation;
  }

  public delete(targetId: string): void { this.values.delete(targetId); }
}

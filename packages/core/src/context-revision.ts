import { createHash } from "node:crypto";

export interface TaskContextRef { workspaceId: string; taskId: string; revision: string }

/** Hashes the complete canonical state and its task scope; callers must pass
 * unabridged source state, never a rendered/byte-limited brief. */
export function computeContextRevision(context: TaskContextRef, canonicalState: unknown): string {
  const payload = stable({context, canonicalState});
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

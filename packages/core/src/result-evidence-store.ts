import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { rm } from "node:fs/promises";

export interface EvidenceOwner { workspaceId: string; taskId: string }
export interface EvidenceRef {
  id: string;
  sha256: string;
  bytes: number;
  complete: boolean;
  nextCursor: string | null;
}
export interface EvidencePage extends EvidenceRef { dataBase64: string }
interface EvidenceMetadata extends EvidenceOwner {
  id: string; sha256: string; bytes: number; createdAt: string;
  idempotencyKey?: string;
}

/** Persisted exact-byte evidence. Paging is transport-friendly and never rewrites the source. */
export class ResultEvidenceStore {
  public constructor(
    private readonly root: string,
    private readonly maxEntryBytes = 32 * 1024 * 1024,
    private readonly maxOwnerBytes = 128 * 1024 * 1024,
  ) {}

  public async put(owner: EvidenceOwner, value: string | Uint8Array, idempotencyKey?: string): Promise<EvidenceRef> {
    validateOwner(owner);
    const bytes = Buffer.from(value);
    if (bytes.byteLength > this.maxEntryBytes)
      throw new Error("RESULT_EVIDENCE_ENTRY_LIMIT: raw evidence was not stored");
    const directory = this.ownerDirectory(owner);
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory);
    if (idempotencyKey) {
      for (const entry of entries.filter((name) => name.endsWith(".json"))) {
        const previous = JSON.parse(await readFile(path.join(directory, entry), "utf8")) as EvidenceMetadata;
        if (previous.idempotencyKey === idempotencyKey) {
          if (previous.sha256 !== createHash("sha256").update(bytes).digest("hex"))
            throw new Error("RESULT_EVIDENCE_IDEMPOTENCY_CONFLICT");
          return { id: previous.id, sha256: previous.sha256, bytes: previous.bytes, complete: true, nextCursor: null };
        }
      }
    }
    if (entries.filter((name) => name.endsWith(".bin")).length >= 1_024)
      throw new Error("RESULT_EVIDENCE_ENTRY_COUNT_LIMIT: raw evidence was not stored");
    let used = 0;
    for (const entry of entries) if (entry.endsWith(".bin")) used += (await stat(path.join(directory, entry))).size;
    if (used + bytes.byteLength > this.maxOwnerBytes)
      throw new Error("RESULT_EVIDENCE_OWNER_LIMIT: raw evidence was not stored");
    const id = `evidence_${randomUUID()}`;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const metadata: EvidenceMetadata = { ...owner, id, sha256, bytes: bytes.byteLength, createdAt: new Date().toISOString(), ...(idempotencyKey ? { idempotencyKey } : {}) };
    const dataPath = path.join(directory, `${id}.bin`);
    const metaPath = path.join(directory, `${id}.json`);
    await writeAtomic(dataPath, bytes);
    try { await writeAtomic(metaPath, Buffer.from(JSON.stringify(metadata), "utf8")); }
    catch (error) { await rm(dataPath, { force: true }); throw error; }
    return { id, sha256, bytes: bytes.byteLength, complete: true, nextCursor: null };
  }

  public async read(owner: EvidenceOwner, id: string, cursor: string | null, budgetBytes: number): Promise<EvidencePage> {
    validateOwner(owner);
    if (!/^evidence_[0-9a-f-]{36}$/.test(id)) throw new Error("RESULT_EVIDENCE_ID_INVALID");
    if (!Number.isFinite(budgetBytes) || budgetBytes < 1) throw new Error("RESULT_EVIDENCE_BUDGET_INVALID");
    const offset = cursor === null ? 0 : decodeCursor(cursor, id);
    const budget = Math.max(1, Math.min(Math.floor(budgetBytes), 1_000_000));
    const directory = this.ownerDirectory(owner);
    const metadata = JSON.parse(await readFile(path.join(directory, `${id}.json`), "utf8")) as EvidenceMetadata;
    if (metadata.workspaceId !== owner.workspaceId || metadata.taskId !== owner.taskId)
      throw new Error("RESULT_EVIDENCE_FORBIDDEN");
    const data = await readFile(path.join(directory, `${id}.bin`));
    if (data.byteLength !== metadata.bytes || createHash("sha256").update(data).digest("hex") !== metadata.sha256)
      throw new Error("RESULT_EVIDENCE_CORRUPT");
    if (offset > data.byteLength) throw new Error("RESULT_EVIDENCE_CURSOR_INVALID");
    const end = Math.min(offset + budget, data.byteLength);
    const complete = end === data.byteLength;
    return {
      id, sha256: metadata.sha256, bytes: metadata.bytes, complete,
      nextCursor: complete ? null : encodeCursor(id, end),
      dataBase64: data.subarray(offset, end).toString("base64"),
    };
  }

  private ownerDirectory(owner: EvidenceOwner): string {
    const key = createHash("sha256").update(`${owner.workspaceId}\0${owner.taskId}`).digest("hex");
    return path.join(this.root, key);
  }
}

function validateOwner(owner: EvidenceOwner): void {
  if (!owner.workspaceId.trim() || !owner.taskId.trim()) throw new Error("RESULT_EVIDENCE_OWNER_REQUIRED");
}
function encodeCursor(id: string, offset: number): string {
  return Buffer.from(JSON.stringify({ id, offset }), "utf8").toString("base64url");
}
function decodeCursor(cursor: string, id: string): number {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { id?: unknown; offset?: unknown };
    if (value.id !== id || !Number.isSafeInteger(value.offset) || (value.offset as number) < 0)
      throw new Error();
    return value.offset as number;
  } catch { throw new Error("RESULT_EVIDENCE_CURSOR_INVALID"); }
}
async function writeAtomic(file: string, data: Uint8Array): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, data, { flag: "wx" });
  await rename(temp, file);
}

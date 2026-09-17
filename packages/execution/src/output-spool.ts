import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync,
  readFileSync, readSync, renameSync, statSync, writeFileSync,
} from "node:fs";
import path from "node:path";

export type OutputStream = "stdout" | "stderr";
export interface OutputPage {
  attemptId: string;
  stream: OutputStream;
  text: string;
  cursor: number;
  nextCursor: number;
  complete: boolean;
  truncated: boolean;
}
export interface CompletionManifest {
  attemptId: string;
  exitCode: number | null;
  signal: string | null;
  stdoutBytes: number;
  stderrBytes: number;
  droppedBytes: number;
  outputState: "complete" | "partial";
  stdoutSha256: string;
  stderrSha256: string;
  completedAt: string;
}

/** File-backed output with bounded writes; caller MUST continue draining child pipes on overflow. */
export class OutputSpool {
  private readonly root: string;
  private readonly attemptId: string;
  private readonly maxBytes: number;
  private readonly bytes: Record<OutputStream,number> = {stdout:0,stderr:0};
  private droppedBytes = 0;
  private finalized = false;

  public constructor(root: string, attemptId: string, maxBytes = 256 * 1024 * 1024) {
    if (!/^attempt_[a-f0-9-]{36}$/.test(attemptId))
      throw new Error("INVALID_INPUT: attemptId must be a generated UUID attempt identifier");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw new Error("INVALID_INPUT: maxBytes must be a nonnegative integer");
    this.root = path.resolve(root, attemptId);
    this.attemptId = attemptId;
    this.maxBytes = maxBytes;
    mkdirSync(this.root, {recursive:true});
    for (const stream of ["stdout","stderr"] as const) {
      const file = this.file(stream);
      this.bytes[stream] = existsSync(file) ? statSync(file).size : 0;
    }
    const manifest = path.join(this.root,"completion.json");
    if (existsSync(manifest)) {
      this.droppedBytes = (JSON.parse(readFileSync(manifest,"utf8")) as CompletionManifest).droppedBytes;
      this.finalized = true;
    }
  }

  private file(stream: OutputStream): string { return path.join(this.root, `${stream}.spool`); }

  public append(stream: OutputStream, chunk: Buffer): void {
    if (this.finalized) throw new Error("OUTPUT_FINALIZED: cannot append after completion");
    const available = Math.max(0,this.maxBytes - this.bytes.stdout - this.bytes.stderr);
    const written = Math.min(chunk.length,available);
    if (written > 0) {
      appendFileSync(this.file(stream),chunk.subarray(0,written));
      this.bytes[stream] += written;
    }
    this.droppedBytes += chunk.length - written;
  }

  /** A byte cursor is scoped to one attempt and stream. Pages do not reread the whole spool. */
  public page(stream: OutputStream, cursor = 0, maxBytes = 32 * 1024): OutputPage {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.bytes[stream])
      throw new Error("OUTPUT_CURSOR_INVALID: cursor is outside retained spool");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 4)
      throw new Error("INVALID_INPUT: maxBytes must be at least 4");
    const length = Math.min(maxBytes,this.bytes[stream] - cursor);
    const buffer = Buffer.alloc(length);
    if (length > 0) {
      const fd = openSync(this.file(stream),"r");
      try {
        let done = 0;
        while (done < length) {
          const count = readSync(fd,buffer,done,length-done,cursor+done);
          if (count === 0) throw new Error("OUTPUT_TRUNCATED: spool changed during read");
          done += count;
        }
      } finally { closeSync(fd); }
    }
    // Do not split a multi-byte UTF-8 character between pages. A malformed byte is
    // decoded with replacement but does not prevent forward progress.
    let safeLength = buffer.length;
    if (cursor + safeLength < this.bytes[stream] && safeLength > 0) {
      let lead = safeLength - 1;
      while (lead >= 0 && lead >= safeLength - 4 && (buffer[lead]! & 0xc0) === 0x80) lead--;
      if (lead >= 0) {
        const byte = buffer[lead]!;
        const width = byte < 0x80 ? 1 : byte >= 0xc2 && byte < 0xe0 ? 2 : byte < 0xf0 && byte >= 0xe0 ? 3 : byte < 0xf5 && byte >= 0xf0 ? 4 : 1;
        if (lead + width > safeLength) safeLength = lead;
      }
    }
    const nextCursor = cursor + safeLength;
    return {
      attemptId:this.attemptId,stream,text:buffer.subarray(0,safeLength).toString("utf8"),
      cursor,nextCursor,complete:this.finalized && nextCursor === this.bytes[stream],
      truncated:this.droppedBytes > 0,
    };
  }

  /** Call only after process exit AND stdout/stderr EOF. Never infer completion from exit alone. */
  public finalize(exitCode: number | null, signal: string | null): {path:string;manifest:CompletionManifest} {
    if (this.finalized) throw new Error("OUTPUT_FINALIZED: completion manifest already exists");
    for (const stream of ["stdout","stderr"] as const) {
      const file = this.file(stream);
      if (!existsSync(file)) continue;
      const fd = openSync(file,"r+");
      try { fsyncSync(fd); } finally { closeSync(fd); }
    }
    const hashFile = (stream:OutputStream): string => {
      const hash = createHash("sha256");
      const file = this.file(stream);
      if (!existsSync(file)) return hash.digest("hex");
      const fd = openSync(file,"r");
      const buffer = Buffer.alloc(64 * 1024);
      try {
        let count: number;
        while ((count = readSync(fd,buffer,0,buffer.length,null)) > 0)
          hash.update(buffer.subarray(0,count));
      } finally { closeSync(fd); }
      return hash.digest("hex");
    };
    const manifest:CompletionManifest = {
      attemptId:this.attemptId,exitCode,signal,stdoutBytes:this.bytes.stdout,
      stderrBytes:this.bytes.stderr,droppedBytes:this.droppedBytes,
      outputState:this.droppedBytes > 0 ? "partial" : "complete",
      stdoutSha256:hashFile("stdout"),stderrSha256:hashFile("stderr"),
      completedAt:new Date().toISOString(),
    };
    const destination = path.join(this.root,"completion.json");
    const temporary = path.join(this.root,`completion-${randomUUID()}.tmp`);
    // wx ensures another worker cannot silently replace an already committed manifest.
    writeFileSync(temporary,JSON.stringify(manifest),{flag:"wx"});
    const fd = openSync(temporary,"r+");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    if (existsSync(destination)) throw new Error("OUTPUT_FINALIZED: manifest already exists");
    renameSync(temporary,destination);
    // Some platforms cannot fsync a directory; file fsync + atomic rename is best-effort
    // until Windows filesystem guarantees are validated in P2 fault injection.
    try { const dir = openSync(this.root,"r"); try { fsyncSync(dir); } finally {closeSync(dir);} } catch { /* platform dependent */ }
    this.finalized = true;
    return {path:destination,manifest};
  }

  public manifest(): CompletionManifest | null {
    const file = path.join(this.root,"completion.json");
    return existsSync(file) ? JSON.parse(readFileSync(file,"utf8")) as CompletionManifest : null;
  }
}

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import type { DispatchAttempt } from "./execution-store.js";

/** OS creation identity, NOT PID alone. Read-only inspection never sends signals. */
export type ProcessIdentity = { state: "alive"; started: string } | { state: "exited" } | { state: "unverified" };

export interface WorkerIdentity {
  version: 1;
  attemptId: string;
  generation: number;
  tokenSha256: string;
  pid: number;
  started: string;
  recordedAt: string;
  signature: string;
}

function signIdentity(identity: Omit<WorkerIdentity, "signature">, token: string): string {
  return createHmac("sha256", token)
    .update(JSON.stringify([identity.version, identity.attemptId, identity.generation,
      identity.tokenSha256, identity.pid, identity.started, identity.recordedAt]))
    .digest("hex");
}

export interface WorkerInspection {
  status: "alive" | "exited" | "missing" | "unverified";
  pid: number | null;
  reason: string;
}

export function inspectProcess(pid: number): ProcessIdentity {
  if (!Number.isSafeInteger(pid) || pid <= 0) return {state: "unverified"};
  if (process.platform === "win32") {
    // Get-Process.StartTime is supplied by the OS. A reused PID has a different
    // start-time identity; an inaccessible process is never treated as dead.
    const command = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -eq $p) { 'NOT_FOUND' } else { try { $p.StartTime.ToUniversalTime().Ticks.ToString() } catch { 'UNKNOWN' } }`;
    try {
      const result = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
        encoding: "utf8", timeout: 5_000, maxBuffer: 4_096, windowsHide: true,
      }).trim();
      if (result === "NOT_FOUND") return {state: "exited"};
      if (/^[1-9][0-9]{10,}$/.test(result)) return {state: "alive", started: `win:${result}`};
    } catch { /* access denial or inspection failure is not evidence of death */ }
    return {state: "unverified"};
  }
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const suffix = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
      const startTicks = suffix[19]; // proc stat field 22, suffix begins at field 3
      return startTicks && /^[0-9]+$/.test(startTicks)
        ? {state: "alive", started: `linux:${startTicks}`}
        : {state: "unverified"};
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {state: "exited"};
    }
  }
  return {state: "unverified"};
}

export function identityPath(spoolRoot: string, attemptId: string): string {
  if (!/^attempt_[a-f0-9-]{36}$/.test(attemptId)) throw new Error("WORKER_IDENTITY_INVALID_ATTEMPT");
  return path.join(path.resolve(spoolRoot), attemptId, "worker-identity.json");
}

/** Worker alone writes this before launching the command; never overwrite it. */
export function writeWorkerIdentity(spoolRoot: string, attempt: Pick<DispatchAttempt, "attemptId" | "generation" | "token">): WorkerIdentity {
  if (!Number.isSafeInteger(attempt.generation) || attempt.generation < 1 ||
      typeof attempt.token !== "string" || !attempt.token)
    throw new Error("WORKER_IDENTITY_INVALID");
  const observed = inspectProcess(process.pid);
  if (observed.state !== "alive") throw new Error("WORKER_IDENTITY_UNAVAILABLE: cannot verify own OS creation time");
  const unsigned = {
    version: 1 as const, attemptId: attempt.attemptId, generation: attempt.generation,
    tokenSha256: createHash("sha256").update(attempt.token).digest("hex"),
    pid: process.pid, started: observed.started, recordedAt: new Date().toISOString(),
  };
  const identity: WorkerIdentity = {...unsigned, signature: signIdentity(unsigned, attempt.token)};
  const destination = identityPath(spoolRoot, attempt.attemptId);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(identity), {flag: "wx", mode: 0o600});
    const fd = openSync(temporary, "r+");
    try {fsyncSync(fd);} finally {closeSync(fd);}
    if (existsSync(destination)) throw new Error("WORKER_IDENTITY_ALREADY_EXISTS");
    renameSync(temporary, destination);
  } catch (error) {
    // Deliberately leave a failed temporary write for forensic inspection.
    throw error;
  }
  return identity;
}

/** Validate attempt fencing before consulting the OS. Never kill on this evidence. */
export function inspectWorker(spoolRoot: string, attempt: DispatchAttempt): WorkerInspection {
  const file = identityPath(spoolRoot, attempt.attemptId);
  if (!existsSync(file)) return {status: "missing", pid: null, reason: "worker has not committed an identity record"};
  let identity: WorkerIdentity;
  try {
    if (statSync(file).size > 4_096) throw new Error("IDENTITY_TOO_LARGE");
    identity = JSON.parse(readFileSync(file, "utf8")) as WorkerIdentity;
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) throw new Error("IDENTITY_NOT_OBJECT");
  } catch { return {status: "unverified", pid: null, reason: "identity record unreadable or malformed"}; }
  const fingerprint = createHash("sha256").update(attempt.token).digest("hex");
  if (identity.version !== 1 || identity.attemptId !== attempt.attemptId ||
      identity.generation !== attempt.generation || identity.tokenSha256 !== fingerprint ||
      !Number.isSafeInteger(identity.pid) || identity.pid <= 0 ||
      typeof identity.started !== "string" || !/^(win|linux):[0-9]+$/.test(identity.started)) {
    return {status: "unverified", pid: null, reason: "attempt fencing or identity record mismatch"};
  }
  const signature = identity.signature;
  const unsigned = {version: identity.version, attemptId: identity.attemptId,
    generation: identity.generation, tokenSha256: identity.tokenSha256,
    pid: identity.pid, started: identity.started, recordedAt: identity.recordedAt};
  const expectedSignature = signIdentity(unsigned, attempt.token);
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expectedSignature, "hex")))
    return {status: "unverified", pid: null, reason: "worker identity signature mismatch"};
  const observed = inspectProcess(identity.pid);
  if (observed.state === "unverified")
    return {status: "unverified", pid: identity.pid, reason: "OS process inspection unavailable"};
  if (observed.state === "exited" || observed.started !== identity.started)
    return {status: "exited", pid: identity.pid, reason: "original OS process identity no longer exists"};
  return {status: "alive", pid: identity.pid, reason: "attempt and OS creation time verified"};
}

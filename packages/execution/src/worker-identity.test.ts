import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { DispatchAttempt } from "./execution-store.js";
import { identityPath, inspectProcess, inspectWorker, writeWorkerIdentity } from "./worker-identity.js";

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.kill();
      await exited;
    }
  }
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});
function fixture(): {root: string; attempt: DispatchAttempt} {
  const root = mkdtempSync(path.join(tmpdir(), "qnector-identity-"));
  roots.push(root);
  const attempt: DispatchAttempt = {
    taskId: `task_${randomUUID()}`, attemptId: `attempt_${randomUUID()}`,
    token: randomUUID(), generation: 1,
  };
  mkdirSync(path.dirname(identityPath(root, attempt.attemptId)), {recursive: true});
  return {root, attempt};
}

describe("OS-fenced worker identity (P2)", () => {
  it("persists its own OS creation time and rejects tampered attempt/signature without signals", () => {
    const {root, attempt} = fixture();
    const written = writeWorkerIdentity(root, attempt);
    expect(written.pid).toBe(process.pid);
    expect(inspectWorker(root, attempt)).toMatchObject({status: "alive", pid: process.pid});
    expect(inspectWorker(root, {...attempt, generation: 2}).status).toBe("unverified");
    expect(inspectWorker(root, {...attempt, token: "forged"}).status).toBe("unverified");
    const file = identityPath(root, attempt.attemptId);
    writeFileSync(file, JSON.stringify({...written, started: "win:1"}));
    expect(inspectWorker(root, attempt).status).toBe("unverified");
    expect(() => writeWorkerIdentity(root, attempt)).toThrow("WORKER_IDENTITY_ALREADY_EXISTS");
  }, 30_000);

  it("recognizes a verified original worker process exiting, without confusing another PID", async () => {
    const {root, attempt} = fixture();
    const moduleUrl = pathToFileURL(path.resolve(process.cwd(), "packages/execution/dist/worker-identity.js")).href;
    const source = "const {writeWorkerIdentity}=await import(process.argv[1]);" +
      "writeWorkerIdentity(process.argv[2], JSON.parse(process.argv[3]));" +
      "process.stdout.write('READY\\n');setInterval(()=>{},1000)";
    const child = spawn(process.execPath, ["--input-type=module", "-e", source, moduleUrl, root,
      JSON.stringify(attempt)], {windowsHide: true, stdio: ["ignore", "pipe", "pipe"]});
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      let output = "";
      let errors = "";
      const timer = setTimeout(() => reject(new Error(`IDENTITY_WORKER_TIMEOUT: ${errors}`)), 9_000);
      child.stdout?.on("data", (part: Buffer) => {
        output += part.toString();
        if (output.includes("READY")) {clearTimeout(timer); resolve();}
      });
      child.stderr?.on("data", (part: Buffer) => {errors += part.toString();});
      child.once("error", reject);
      child.once("exit", code => reject(new Error(`IDENTITY_WORKER_EXITED: ${code}: ${errors}`)));
    });
    expect(inspectWorker(root, attempt).status).toBe("alive");
    const file = identityPath(root, attempt.attemptId);
    const original = readFileSync(file, "utf8");
    writeFileSync(file, JSON.stringify({...JSON.parse(original) as object, pid: process.pid}));
    expect(inspectWorker(root, attempt).status).toBe("unverified");
    writeFileSync(file, original);
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
    expect(child.kill()).toBe(true);
    await exited;
    expect(inspectWorker(root, attempt).status).toBe("exited");
    expect(inspectWorker(root, {...attempt, token: "wrong"}).status).toBe("unverified");
  }, 30_000);

  it("does not guess when identity is missing, malformed or OS PID invalid", () => {
    const {root, attempt} = fixture();
    expect(inspectWorker(root, attempt).status).toBe("missing");
    writeFileSync(identityPath(root, attempt.attemptId), "{corrupt", {flag: "wx"});
    expect(inspectWorker(root, attempt).status).toBe("unverified");
    writeFileSync(identityPath(root, attempt.attemptId), "null");
    expect(inspectWorker(root, attempt).status).toBe("unverified");
    writeFileSync(identityPath(root, attempt.attemptId), "x".repeat(5_000));
    expect(inspectWorker(root, attempt).status).toBe("unverified");
    expect(inspectProcess(-1).state).toBe("unverified");
  });
});

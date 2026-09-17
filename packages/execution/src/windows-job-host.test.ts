import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkerBootstrap } from "./worker-main.js";

const roots: string[] = [];
const children: ChildProcess[] = [];
const workerScript = path.resolve(process.cwd(), "packages/execution/dist/worker-main.js");
const jobHost = path.resolve(process.cwd(), "packages/execution/job-host/dist/qnector-job-host.exe");

async function waitFor(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("TIMED_OUT");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

// A missing Windows host must fail the release gate, never silently skip it.
const windowsIt = process.platform === "win32" ? it : it.skip;

describe("P2 Windows Job Object host", () => {
  windowsIt("kills the command tree when the durable worker itself is terminated", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qnector-job-host-worker-"));
    roots.push(root);
    const marker = path.join(root, "grandchild-marker.txt");
    const attemptId = `attempt_${randomUUID()}`;
    const bootstrap: WorkerBootstrap = {
      attemptId, generation: 1, token: randomUUID(), spoolRoot: path.join(root, "output"), cwd: root,
      timeoutMs: 15_000, maxOutputBytes: 4 * 1024 * 1024, jobHostPath: jobHost,
      command: {kind: "direct", file: process.execPath, args: ["-e",
        "const{spawn}=require('child_process');spawn(process.execPath,['-e',\"setTimeout(()=>require('fs').writeFileSync(process.argv[1],'SURVIVED'),2500)\",process.argv[1]],{stdio:'ignore'});setTimeout(()=>{},10000)", marker]},
    };
    const bootstrapPath = path.join(root, "bootstrap.json");
    const fs = await import("node:fs");
    fs.writeFileSync(bootstrapPath, JSON.stringify(bootstrap));
    const worker = spawn(process.execPath, [workerScript, bootstrapPath], {cwd: process.cwd(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"]});
    children.push(worker);
    let stdout = "";
    worker.stdout?.on("data", chunk => {stdout += String(chunk);});
    await waitFor(() => stdout.includes(`READY ${attemptId}\n`));
    worker.stdin?.end(`GO ${attemptId}\n`);
    const identity = path.join(bootstrap.spoolRoot, attemptId, "worker-identity.json");
    await waitFor(() => existsSync(identity));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(worker.kill()).toBe(true);
    await waitFor(() => worker.exitCode !== null || worker.signalCode !== null);
    const statusFile = path.join(bootstrap.spoolRoot, attemptId, "job-host-status.json");
    await waitFor(() => existsSync(statusFile));
    const status = JSON.parse(readFileSync(statusFile, "utf8")) as {Reason: string};
    expect(status.Reason).toBe("worker_lost");
    await new Promise(resolve => setTimeout(resolve, 3_000));
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(path.join(bootstrap.spoolRoot, attemptId, "completion.json"))).toBe(false);
  }, 15_000);

  windowsIt("uses Job Object termination for explicit cancellation before attesting canceled", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "qnector-job-host-cancel-"));
    roots.push(root);
    const marker = path.join(root, "cancel-marker.txt");
    const attemptId = `attempt_${randomUUID()}`;
    const bootstrap: WorkerBootstrap = {
      attemptId, generation: 1, token: randomUUID(), spoolRoot: path.join(root, "output"), cwd: root,
      timeoutMs: 15_000, maxOutputBytes: 4 * 1024 * 1024, jobHostPath: jobHost,
      command: {kind: "direct", file: process.execPath, args: ["-e",
        "const{spawn}=require('child_process');spawn(process.execPath,['-e',\"setTimeout(()=>require('fs').writeFileSync(process.argv[1],'SURVIVED'),3000)\",process.argv[1]],{stdio:'ignore'});setTimeout(()=>{},10000)", marker]},
    };
    const bootstrapPath = path.join(root, "bootstrap-cancel.json");
    const fs = await import("node:fs");
    fs.writeFileSync(bootstrapPath, JSON.stringify(bootstrap));
    const worker = spawn(process.execPath, [workerScript, bootstrapPath], {cwd: process.cwd(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"]});
    children.push(worker);
    let stdout = "";
    worker.stdout?.on("data", chunk => {stdout += String(chunk);});
    await waitFor(() => stdout.includes(`READY ${attemptId}\n`));
    worker.stdin?.end(`GO ${attemptId}\n`);
    const attemptRoot = path.join(bootstrap.spoolRoot, attemptId);
    await waitFor(() => existsSync(path.join(attemptRoot, "worker-identity.json")));
    await new Promise(resolve => setTimeout(resolve, 500));
    fs.writeFileSync(path.join(attemptRoot, "cancel.request"), "cancel\n", {flag: "wx"});
    await waitFor(() => worker.exitCode !== null || worker.signalCode !== null);
    const status = JSON.parse(readFileSync(path.join(attemptRoot, "job-host-status.json"), "utf8")) as {Reason: string};
    const manifest = JSON.parse(readFileSync(path.join(attemptRoot, "completion.json"), "utf8")) as {canceled?: boolean};
    expect(status.Reason).toBe("canceled");
    expect(manifest.canceled).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 3_300));
    expect(existsSync(marker)).toBe(false);
  }, 15_000);
});

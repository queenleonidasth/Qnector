import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiTunnelAdapter } from "./openai-tunnel.js";

const cleanup: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const target of cleanup.splice(0))
    await rm(target, { recursive: true, force: true });
});

function fakeChild(pid: number): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid,
    exitCode: null,
    signalCode: null,
    stdin: null,
    stdout: null,
    stderr: new PassThrough(),
    killed: false,
    kill: () => true,
  });
  return child;
}

describe("OpenAiTunnelAdapter integration boundaries", () => {
  it("persists profile validation and uses the warm cache on the next adapter", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "qnector-openai-transport-"),
    );
    cleanup.push(root);
    const executable = path.join(root, "tunnel-client.exe");
    const cacheFile = path.join(root, "validation.json");
    await writeFile(executable, "fixture", "utf8");
    const calls: string[][] = [];
    let pid = 10_000;
    const spawnImpl = ((_: string, args: readonly string[]) => {
      calls.push([...args]);
      const child = fakeChild(pid++);
      if (args[0] === "init" || args[0] === "doctor")
        queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    }) as typeof nodeSpawn;

    const make = () =>
      new OpenAiTunnelAdapter("http://127.0.0.1:8787/mcp", {
        executable,
        profile: "qnector-test",
        tunnelId: "tun_test",
        runtimeApiKey: "runtime_test",
        validationCacheFile: cacheFile,
        spawnImpl,
        warmStabilityMs: 10,
        coldStabilityMs: 10,
      });

    const cold = await make().start();
    expect(cold.state).toBe("connected");
    expect(calls.map((entry) => entry[0])).toEqual(["init", "doctor", "run"]);
    expect(
      JSON.parse(await readFile(cacheFile, "utf8")).fingerprint,
    ).toBeTruthy();

    calls.length = 0;
    const warm = await make().start();
    expect(warm.state).toBe("connected");
    expect(warm.message).toContain("validated profile cache");
    expect(calls.map((entry) => entry[0])).toEqual(["run"]);
  });

  it("invalidates a stale warm cache and performs full validation before retrying", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qnector-openai-stale-"));
    cleanup.push(root);
    const executable = path.join(root, "tunnel-client.exe");
    const cacheFile = path.join(root, "validation.json");
    await writeFile(executable, "fixture", "utf8");
    let runCalls = 0;
    let pid = 20_000;
    const calls: string[] = [];
    const spawnImpl = ((_: string, args: readonly string[]) => {
      calls.push(String(args[0]));
      const child = fakeChild(pid++);
      if (args[0] === "init" || args[0] === "doctor")
        queueMicrotask(() => child.emit("exit", 0, null));
      if (args[0] === "run") {
        runCalls += 1;
        if (runCalls === 2) {
          // The second run is the stable recovery process.
        } else if (runCalls > 2) {
          throw new Error("unexpected extra run");
        }
      }
      return child;
    }) as typeof nodeSpawn;

    // Populate a valid cache first.
    const initial = new OpenAiTunnelAdapter("http://127.0.0.1:8787/mcp", {
      executable,
      profile: "qnector-test",
      tunnelId: "tun_test",
      runtimeApiKey: "runtime_test",
      validationCacheFile: cacheFile,
      spawnImpl,
      warmStabilityMs: 10,
      coldStabilityMs: 10,
    });
    await initial.start();

    calls.length = 0;
    runCalls = 0;
    const failingSpawn = ((_: string, args: readonly string[]) => {
      calls.push(String(args[0]));
      const child = fakeChild(pid++);
      if (args[0] === "init" || args[0] === "doctor")
        queueMicrotask(() => child.emit("exit", 0, null));
      if (args[0] === "run") {
        runCalls += 1;
        if (runCalls === 1) queueMicrotask(() => child.emit("exit", 1, null));
      }
      return child;
    }) as typeof nodeSpawn;

    const recovered = new OpenAiTunnelAdapter("http://127.0.0.1:8787/mcp", {
      executable,
      profile: "qnector-test",
      tunnelId: "tun_test",
      runtimeApiKey: "runtime_test",
      validationCacheFile: cacheFile,
      spawnImpl: failingSpawn,
      warmStabilityMs: 10,
      coldStabilityMs: 10,
    });
    const snapshot = await recovered.start();
    expect(snapshot.state).toBe("connected");
    expect(calls).toEqual(["run", "init", "doctor", "run"]);
  });
});

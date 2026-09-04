import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TransportSnapshot } from "@qnector/shared";
import { BaseTransportAdapter } from "./base.js";

export class OpenAiTunnelAdapter extends BaseTransportAdapter {
  public readonly mode = "openai-tunnel" as const;
  public constructor(
    localUrl: string,
    private readonly options: {
      executable: string;
      profile?: string;
      tunnelId?: string;
      runtimeApiKey?: string;
      publicUrl?: string;
      validationCacheFile?: string;
      spawnImpl?: typeof spawn;
      warmStabilityMs?: number;
      coldStabilityMs?: number;
    },
  ) {
    super(localUrl);
  }

  public async start(): Promise<TransportSnapshot> {
    this.setSnapshot({
      state: "connecting",
      mode: this.mode,
      message: "Starting official OpenAI tunnel-client",
    });
    const profile = this.options.profile ?? "qnector";
    if (this.options.tunnelId && !this.options.runtimeApiKey)
      throw new Error(
        "OPENAI_RUNTIME_API_KEY_REQUIRED: enter a Runtime API key in Qnector Settings",
      );

    const fingerprint = await this.validationFingerprint(profile);
    let warmValidated = await cacheMatches(
      this.options.validationCacheFile,
      fingerprint,
    );
    if (!warmValidated) await this.validateProfile(profile);

    try {
      this.child = this.spawnRun(profile);
      this.watchExit(this.child);
      await waitForStableChild(
        this.child,
        warmValidated
          ? (this.options.warmStabilityMs ?? 220)
          : (this.options.coldStabilityMs ?? 1_500),
      );
    } catch (error) {
      if (!warmValidated) throw error;
      // A stale profile cache must never trade reliability for speed. If the
      // warm launch fails immediately, invalidate it and retry through the
      // original init + doctor path before surfacing the error.
      warmValidated = false;
      await clearValidationCache(this.options.validationCacheFile);
      await this.validateProfile(profile);
      this.child = this.spawnRun(profile);
      this.watchExit(this.child);
      await waitForStableChild(
        this.child,
        this.options.coldStabilityMs ?? 1_500,
      );
    }

    if (!warmValidated)
      await writeValidationCache(
        this.options.validationCacheFile,
        fingerprint,
      ).catch(() => undefined);
    const snapshot: TransportSnapshot = {
      state: "connected",
      mode: this.mode,
      ...(this.options.publicUrl
        ? { publicUrl: this.options.publicUrl.replace(/\/$/, "") + "/mcp" }
        : {}),
      message: warmValidated
        ? "OpenAI tunnel-client running (validated profile cache)"
        : "OpenAI tunnel-client running",
    };
    this.setSnapshot(snapshot);
    return snapshot;
  }

  private async validateProfile(profile: string): Promise<void> {
    if (this.options.tunnelId && this.options.runtimeApiKey) {
      await runClientCommand(
        this.options.executable,
        [
          "init",
          "--sample",
          "sample_mcp_remote_no_auth",
          "--force",
          "--profile",
          profile,
          "--tunnel-id",
          this.options.tunnelId,
          "--mcp-server-url",
          this.localUrl,
        ],
        this.options.runtimeApiKey,
        "OPENAI_TUNNEL_INIT_FAILED",
        this.options.spawnImpl,
      );
    }
    if (this.options.runtimeApiKey) {
      await runClientCommand(
        this.options.executable,
        ["doctor", "--profile", profile, "--explain"],
        this.options.runtimeApiKey,
        "OPENAI_TUNNEL_DOCTOR_FAILED",
        this.options.spawnImpl,
      );
    }
  }

  private spawnRun(profile: string): ChildProcess {
    return (this.options.spawnImpl ?? spawn)(
      this.options.executable,
      ["run", "--profile", profile],
      {
        windowsHide: true,
        env: {
          ...process.env,
          ...(this.options.runtimeApiKey
            ? { CONTROL_PLANE_API_KEY: this.options.runtimeApiKey }
            : {}),
        },
        stdio: "ignore",
      },
    );
  }

  private async validationFingerprint(profile: string): Promise<string> {
    const executable = await stat(this.options.executable).catch(() => null);
    return createHash("sha256")
      .update(
        JSON.stringify({
          executable: path.resolve(this.options.executable),
          executableSize: executable?.size ?? null,
          executableMtime: executable?.mtimeMs ?? null,
          profile,
          tunnelId: this.options.tunnelId ?? null,
          localUrl: this.localUrl,
          runtimeKeyHash: this.options.runtimeApiKey
            ? createHash("sha256")
                .update(this.options.runtimeApiKey)
                .digest("hex")
            : null,
        }),
      )
      .digest("hex");
  }
}

async function cacheMatches(
  file: string | undefined,
  fingerprint: string,
): Promise<boolean> {
  if (!file) return false;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as {
      fingerprint?: string;
    };
    return parsed.fingerprint === fingerprint;
  } catch {
    return false;
  }
}

async function writeValidationCache(
  file: string | undefined,
  fingerprint: string,
): Promise<void> {
  if (!file) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ fingerprint, validatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

async function clearValidationCache(file: string | undefined): Promise<void> {
  if (!file) return;
  await rm(file, { force: true }).catch(() => undefined);
}

async function waitForStableChild(
  child: ChildProcess,
  delayMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    const onError = (error: Error): void => finish(error);
    const onExit = (): void => finish(new Error("OPENAI_TUNNEL_CLIENT_EXITED"));
    const timer = setTimeout(() => finish(), delayMs);
    child.once("error", onError);
    child.once("exit", onExit);
  });
  if (child.exitCode !== null) throw new Error("OPENAI_TUNNEL_CLIENT_EXITED");
}

function runClientCommand(
  executable: string,
  args: string[],
  runtimeApiKey: string,
  errorCode: string,
  spawnImpl: typeof spawn = spawn,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(executable, args, {
      windowsHide: true,
      env: { ...process.env, CONTROL_PLANE_API_KEY: runtimeApiKey },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${errorCode}: ${stderr.trim() || code}`));
    });
  });
}

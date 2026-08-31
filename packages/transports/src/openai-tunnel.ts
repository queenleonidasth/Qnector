import { spawn } from "node:child_process";
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
      );
    }
    if (this.options.runtimeApiKey) {
      await runClientCommand(
        this.options.executable,
        ["doctor", "--profile", profile, "--explain"],
        this.options.runtimeApiKey,
        "OPENAI_TUNNEL_DOCTOR_FAILED",
      );
    }
    this.child = spawn(this.options.executable, ["run", "--profile", profile], {
      windowsHide: true,
      env: {
        ...process.env,
        ...(this.options.runtimeApiKey
          ? { CONTROL_PLANE_API_KEY: this.options.runtimeApiKey }
          : {}),
      },
      stdio: "ignore",
    });
    this.watchExit(this.child);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    if (this.child.exitCode !== null)
      throw new Error("OPENAI_TUNNEL_CLIENT_EXITED");
    const snapshot: TransportSnapshot = {
      state: "connected",
      mode: this.mode,
      ...(this.options.publicUrl
        ? { publicUrl: this.options.publicUrl.replace(/\/$/, "") + "/mcp" }
        : {}),
      message: "OpenAI tunnel-client running",
    };
    this.setSnapshot(snapshot);
    return snapshot;
  }
}

function runClientCommand(
  executable: string,
  args: string[],
  runtimeApiKey: string,
  errorCode: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
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

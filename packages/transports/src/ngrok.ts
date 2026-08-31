import { spawn } from "node:child_process";
import { publicMcpUrl } from "@qnector/shared";
import type { TransportSnapshot } from "@qnector/shared";
import { BaseTransportAdapter, waitForOrigin } from "./base.js";

export class NgrokAdapter extends BaseTransportAdapter {
  public readonly mode = "ngrok" as const;
  public constructor(
    localUrl: string,
    private readonly options: {
      executable?: string;
      domain?: string;
      authtoken?: string;
    },
  ) {
    super(localUrl);
  }

  public async start(): Promise<TransportSnapshot> {
    this.setSnapshot({
      state: "connecting",
      mode: this.mode,
      message: "Starting ngrok tunnel",
    });
    const executable = this.options.executable ?? "ngrok";
    const args = ["http", new URL(this.localUrl).origin, "--log", "stdout"];
    if (this.options.domain)
      args.push("--url", `https://${this.options.domain}`);
    this.child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(this.options.authtoken
          ? { NGROK_AUTHTOKEN: this.options.authtoken }
          : {}),
      },
    });
    this.watchExit(this.child);
    const origin = this.options.domain
      ? `https://${this.options.domain}`
      : await waitForOrigin(
          this.child,
          /https:\/\/[a-z0-9.-]+\.ngrok[a-z0-9.-]*/i,
        );
    const snapshot = {
      state: "connected" as const,
      mode: this.mode,
      publicUrl: publicMcpUrl(origin),
      message: "ngrok tunnel connected",
    };
    this.setSnapshot(snapshot);
    return snapshot;
  }
}

import { spawn } from "node:child_process";
import { publicMcpUrl } from "@qnector/shared";
import type { TransportSnapshot } from "@qnector/shared";
import { BaseTransportAdapter, waitForOrigin } from "./base.js";

export class CloudflareQuickAdapter extends BaseTransportAdapter {
  public readonly mode = "cloudflare-quick" as const;
  public constructor(
    localUrl: string,
    private readonly executable = "cloudflared",
  ) {
    super(localUrl);
  }

  public async start(): Promise<TransportSnapshot> {
    this.setSnapshot({
      state: "connecting",
      mode: this.mode,
      message: "Starting cloudflared quick tunnel",
    });
    const localOrigin = new URL(this.localUrl).origin;
    this.child = spawn(
      this.executable,
      ["tunnel", "--url", localOrigin, "--no-autoupdate"],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.watchExit(this.child);
    const tunnelOrigin = await waitForOrigin(
      this.child,
      /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i,
    );
    this.setSnapshot({
      state: "connected",
      mode: this.mode,
      publicUrl: publicMcpUrl(tunnelOrigin),
      message: "Cloudflare quick tunnel connected",
    });
    return this.getSnapshot();
  }
}

export class CloudflareNamedAdapter extends BaseTransportAdapter {
  public readonly mode = "cloudflare-named" as const;
  public constructor(
    localUrl: string,
    private readonly options: {
      executable?: string;
      hostname: string;
      token?: string;
      tunnelName?: string;
    },
  ) {
    super(localUrl);
  }

  public async start(): Promise<TransportSnapshot> {
    this.setSnapshot({
      state: "connecting",
      mode: this.mode,
      message: "Starting named Cloudflare tunnel",
    });
    const executable = this.options.executable ?? "cloudflared";
    const args = [
      "tunnel",
      "--url",
      new URL(this.localUrl).origin,
      "--no-autoupdate",
      "--hostname",
      this.options.hostname,
    ];
    if (this.options.token) args.push("run", "--token", this.options.token);
    else if (this.options.tunnelName) args.push("run", this.options.tunnelName);
    this.child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.watchExit(this.child);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const snapshot = {
      state: "connected" as const,
      mode: this.mode,
      publicUrl: publicMcpUrl(`https://${this.options.hostname}`),
      message: "Named Cloudflare tunnel connected",
    };
    this.setSnapshot(snapshot);
    return snapshot;
  }
}

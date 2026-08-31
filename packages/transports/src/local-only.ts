import type { TransportSnapshot } from "@qnector/shared";
import { BaseTransportAdapter } from "./base.js";

export class LocalOnlyAdapter extends BaseTransportAdapter {
  public readonly mode = "local-only" as const;
  public async start(): Promise<TransportSnapshot> {
    const snapshot = {
      state: "connected" as const,
      mode: this.mode,
      publicUrl: this.localUrl,
      message: "Local MCP endpoint ready",
    };
    this.setSnapshot(snapshot);
    return snapshot;
  }
}

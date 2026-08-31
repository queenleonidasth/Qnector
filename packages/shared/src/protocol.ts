import type { RelayMessage } from "./types.js";
import { relayMessageSchema } from "./schemas.js";

export function encodeRelayMessage(message: RelayMessage): string {
  return JSON.stringify(message);
}

export function decodeRelayMessage(input: string | Buffer): RelayMessage {
  const raw = typeof input === "string" ? input : input.toString("utf8");
  return relayMessageSchema.parse(JSON.parse(raw)) as RelayMessage;
}

export function toBase64(input: Buffer | Uint8Array | string): string {
  return Buffer.from(input).toString("base64");
}

export function fromBase64(input: string): Buffer {
  return Buffer.from(input, "base64");
}

export function localMcpUrl(host: string, port: number): string {
  const displayHost =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${displayHost}:${port}/mcp`;
}

export function publicMcpUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/mcp`;
}

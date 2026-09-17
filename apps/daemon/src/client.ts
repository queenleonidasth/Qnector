import net from "node:net";
import { daemonAuthToken, daemonSocketPath } from "./server.js";

/** One request per connection; a lost response is retried with the SAME client key. */
export async function daemonRequest(
  root: string,
  request: Record<string, unknown>,
  timeoutMs = 5_000,
  signal?: AbortSignal,
): Promise<{ok: boolean; data?: unknown; error?: string}> {
  if (signal?.aborted) throw new Error("IPC_WAIT_CANCELED");
  const payload = JSON.stringify({...request, token: daemonAuthToken(root)}) + "\n";
  if (Buffer.byteLength(payload, "utf8") > 64 * 1024) throw new Error("IPC_REQUEST_TOO_LARGE");
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(daemonSocketPath(root));
    let response = "";
    let settled = false;
    const cleanup = (): void => { signal?.removeEventListener("abort", onAbort); };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const onAbort = (): void => fail(new Error("IPC_WAIT_CANCELED"));
    signal?.addEventListener("abort", onAbort, {once: true});
    if (signal?.aborted) {onAbort(); return;}
    socket.setTimeout(timeoutMs, () => fail(new Error("IPC_WAIT_TIMED_OUT")));
    socket.on("connect", () => {if (!settled) socket.write(payload);});
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      response += chunk;
      if (Buffer.byteLength(response, "utf8") > 256 * 1024) { fail(new Error("IPC_RESPONSE_TOO_LARGE")); return; }
      if (!response.includes("\n") || settled) return;
      try {
        const result = JSON.parse(response.slice(0, response.indexOf("\n"))) as {ok: boolean; data?: unknown; error?: string};
        settled = true;
        cleanup();
        socket.end();
        resolve(result);
      } catch (error) { fail(error); }
    });
    socket.on("error", fail);
    socket.on("end", () => { if (!settled) fail(new Error("IPC_RESPONSE_INTERRUPTED")); });
  });
}

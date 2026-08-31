# Qnector Relay deployment

The relay is a thin HTTP-over-WebSocket forwarder. It does not parse MCP semantics or store payloads beyond an in-flight request.

```powershell
$env:PORT = "8790"
npx pnpm@10.15.0 --filter @qnector/relay build
npx pnpm@10.15.0 --filter @qnector/relay start
```

Expose the service on a host that supports WebSocket upgrades and long-lived requests (a VM, Fly.io, Railway, or Render). Configure Qnector with `relayUrl` pointing at the WebSocket base, for example `wss://relay.example/agent`; the desktop app appends `/agent/<deviceId>`.

Public MCP routes are `POST|GET|DELETE /mcp/<deviceId>`, the agent route is `GET /agent/<deviceId>`, and health is `/healthz`. When the desktop is offline, the MCP route returns HTTP 503 with `DEVICE_OFFLINE`.

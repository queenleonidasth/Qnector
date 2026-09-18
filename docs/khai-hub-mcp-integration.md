# Khai-Hub upstream integration (opt-in)

Status: source-level QNECTOR integration; no live Khai-Hub connection verified, no app update/restart/release. Khai-Hub Next 3.4.2 is installed locally, but its connector returned `mcp_network_error: Connection failed` during inspection. The desktop executable has **not** been verified to implement an MCP stdio server. Do not run it as an MCP command on assumption.

QNECTOR already provides `system.mcp_servers`, `system.mcp_tools` and `system.mcp_call`. This change extends **the existing external MCP client** to Streamable HTTP without registering ~95 upstream tools as top-level QNECTOR tools or introducing a second gateway. This keeps the eight grouped tool schemas stable and only sends selected schemas to the model when explicitly requested. No Khai source code is copied.

## Configuration

Edit `%APPDATA%\Qnector\external-mcp.json` while preserving the existing `servers` entries. The following is an opt-in **example**, NOT an authenticated, tested Khai-Hub endpoint. Obtain a stable MCP URL and authorization for QNECTOR separately from Khai-Hub; a connection established inside ChatGPT is not automatically transferable to another client.

```json
{
  "version": 1,
  "servers": {
    "khai-hub": {
      "enabled": false,
      "url": "https://YOUR-KHAI-HUB-MCP-ENDPOINT/mcp"
    }
  }
}
```

Replace the URL with an endpoint supplied for your installation. For a server that explicitly accepts owner-provided bearer tokens, save the token as a *Windows DPAPI-encrypted ConvertFrom-SecureString file* (per-user), point `bearerTokenFile` at that file, and explicitly enable the server. Do **not** paste raw bearer tokens, copy another application's credentials, or assume bearer authentication is interchangeable with Khai-Hub's OAuth flow. QNECTOR currently supports the explicit bearer-file variant, not a new interactive OAuth login flow. A URL must be HTTPS (or local loopback HTTP); embedded URL credentials, query, fragment and HTTP redirects are blocked.

Once the endpoint and authentication are ready, use `system.mcp_servers`, `system.mcp_tools` with `name:"khai-hub",query:"...",maxResults:10`, then `system.mcp_call` for a chosen tool. The existing call permission model remains in force. Tool discovery and invocation currently connect anew each time, so avoid a bulk list of every upstream schema or frequent polling; no claimed end-to-end token/latency savings without measurement.

## Test gates

- Automated: local HTTP MCP initialize, discover and call; disabled/invalid URL rejection; existing stdio tests; concise TypeScript `workspace.document_outline` regression; full tests, typecheck and lint.
- Still required: actual authenticated Khai-Hub `mcp_tools` and a safe read-only call, tool inventory/dedup by capability, OAuth compatibility if needed, secrets/log review and packaged Windows build test before enabling by default.
- No automatic exposure of Khai's shell/UI/AI actions: they can be powerful and depend on Khai-Hub's permissions; explicit choice and separate authorization must be preserved.

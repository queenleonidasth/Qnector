# Windows-MCP integration

Qnector can use [CursorTouch/Windows-MCP](https://github.com/cursortouch/windows-mcp) as an optional external MCP upstream without expanding Qnector beyond its eight grouped MCP tools. Discovery and invocation stay behind `system.mcp_servers`, `system.mcp_tools`, and `system.mcp_call`.

## Recommended local profile

Run Windows-MCP as a long-lived Streamable HTTP server bound only to loopback:

```text
http://127.0.0.1:8000/mcp
```

Do not add a trailing slash. Windows-MCP redirects `/mcp/` to `/mcp`, while Qnector intentionally rejects HTTP redirects for configured upstream MCP endpoints.

The recommended Windows-MCP configuration is:

```toml
[server]
transport = "streamable-http"
host = "127.0.0.1"
port = 8000

[tools]
exclude = ["PowerShell", "Registry"]
```

Qnector already has direct process/files/system capabilities, so excluding the duplicate PowerShell and Registry tools keeps the optional upstream focused on UI/computer-use. This is capability de-duplication, not a Qnector permission system; an owner can configure a different upstream tool set.

For the current Windows-MCP source release, follow the Python requirement in `pyproject.toml` rather than the README badge/text if they disagree. Qnector's validated development setup for Windows-MCP 0.8.6 uses Python 3.14 through `uv`.

## Qnector external MCP config

Configure `%APPDATA%\Qnector\external-mcp.json`:

```json
{
  "version": 1,
  "servers": {
    "windows-mcp": {
      "enabled": true,
      "url": "http://127.0.0.1:8000/mcp"
    }
  }
}
```

Qnector reads this file on demand; restarting Qnector is not required just to refresh the external server list.

## Background startup

Windows-MCP can install its own per-user Scheduled Task:

```powershell
windows-mcp install --transport streamable-http --host 127.0.0.1 --port 8000
```

The task is named `windows-mcp-server`. Keep the executable/source environment that created the task available, because its generated wrapper points at that Python installation. Verify the task after login instead of treating config presence as proof that the server is alive.

For a quiet local profile, the generated `~/.windows-mcp/start-server.cmd` can set these environment variables before starting the server:

```cmd
set "ANONYMIZED_TELEMETRY=false"
set "WINDOWS_MCP_DISABLE_FLASH=1"
```

## Validation

Use Qnector itself to verify the whole path:

1. `system.mcp_servers` must report the `windows-mcp` upstream.
2. `system.mcp_tools` with `server: "windows-mcp"` must complete the real handshake.
3. `system.mcp_call` of the read-only `DisplayInventory` tool must return active display metadata.
4. Kill the current Windows-MCP server process, start the Scheduled Task again, and repeat steps 2–3. This verifies the login-task path instead of an already-running development process.

The Runtime drawer performs a real `mcp_tools` handshake before it reports Windows-MCP as **Connected**. A configured URL alone is not shown as a successful connection.

## Scope

Qnector's native `computer` tool remains semantic Windows UI Automation. Raw coordinate mouse/drag and synthetic keyboard actions are available only when the owner explicitly configures an external upstream such as Windows-MCP. This does not permit automation of the ChatGPT browser/session, extraction of ChatGPT cookies/tokens, or an unauthenticated non-loopback computer-control endpoint.

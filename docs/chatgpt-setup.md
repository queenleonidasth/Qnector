# Connect Qnector to ChatGPT Web

Qnector exposes a Streamable HTTP MCP endpoint. The exact ChatGPT labels can change; look for **Apps**, **Plugins**, **Connectors**, **Developer Mode**, or **Create app** in the current UI.

For the official deployment flow, see [OpenAI's ChatGPT app connection documentation](https://developers.openai.com/plugins/deploy/connect-chatgpt).

1. Start Qnector and select the workspace. Qnector creates a Cloudflare Quick Tunnel MCP link automatically.
2. Wait for **Your MCP link is ready**, then click **Copy MCP Link**.
3. Click **Copy & Create Plugin** to open the ChatGPT Plugins page.
4. In ChatGPT Web, enable Developer Mode if it is available for the account, then create a custom app/plugin/connector named `Qnector`.
5. Paste the copied HTTPS MCP URL (it ends in `/mcp`) and select the connection/auth option required by the transport.
6. Scan the server and confirm the eight grouped tools: `system`, `workspace`, `files`, `process`, `git`, `memory`, `browser`, and `computer`.
7. Open a new chat and select Qnector from the tools menu.

Start with a read-only inspection prompt:

```text
Use Qnector. Call system info, inspect the active workspace, summarize the project,
then report the current Git status. Do not change files yet.
```

Then test a write path:

```text
Use Qnector to create qnector-test.txt in the active workspace with the current
date and a short success message. Read it back and show the Git diff.
```

For coding tasks:

```text
Use Qnector as your local coding environment. Inspect the repository, implement
the requested change directly, run relevant tests, review git diff, and summarize
what changed. Use background processes for commands that do not exit quickly.
```

Qnector does not automate the ChatGPT browser, retrieve ChatGPT cookies, or press product confirmations. ChatGPT may show its own confirmation for a write or destructive action.

## Continue work in a new chat

At the end of a task, ask the model to call `memory.save_checkpoint` with the current task, completed steps, pending steps and critical context. In the next chat, ask it to call `workspace.summary` or `memory.recall`. Qnector cannot force ChatGPT to call a tool automatically when a new chat opens.

## Optional local browser diagnostics

Prefer `browser.launch` to let Qnector start a disposable dedicated Chrome/Edge debug profile automatically; `browser.close` terminates that managed browser and removes its temporary profile. Manual `--remote-debugging-port` attachment remains supported when needed. Use the `browser` tool only for local development pages. Qnector rejects external and ChatGPT targets and does not read cookies/storage or automate mouse/keyboard input.

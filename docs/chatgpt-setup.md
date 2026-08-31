# Connect Qnector to ChatGPT Web

Qnector exposes a Streamable HTTP MCP endpoint. The exact ChatGPT labels can change; look for **Apps**, **Plugins**, **Connectors**, **Developer Mode**, or **Create app** in the current UI.

For the official deployment flow, see [OpenAI's ChatGPT app connection documentation](https://developers.openai.com/plugins/deploy/connect-chatgpt).

1. Start Qnector. On a fresh install, **OpenAI Tunnel Setup** opens automatically; it is also available later from **Settings → Connection Setup**.
2. Confirm that **Bundled tunnel-client** shows ready. Windows packages include both `tunnel-client.exe` and its `cloudflared.exe` companion, so no executable path is required.
3. Open **Tunnels** from the wizard and create or copy a Tunnel ID (`tunnel_...`).
4. Open **Runtime API Keys** from the wizard and create a separate Runtime API key. The runtime-key principal needs **Tunnels Read + Use** permission; do not use an Admin API key for the long-lived daemon.
5. Paste the Tunnel ID and Runtime API key into Qnector, keep the default `qnector` profile unless a different profile is intentional, then click **Save & Connect**.
6. Qnector creates the `sample_mcp_remote_no_auth` profile for its local MCP endpoint, runs `tunnel-client doctor --explain`, and starts the tunnel daemon. Once the bridge reaches `connected`, the wizard continues to the ChatGPT-side setup instead of marking first-run setup complete immediately.
7. Open **ChatGPT Connector Settings** from the wizard. Create a Qnector connector and choose **Connection: Tunnel**, then select the tunnel or paste the same `tunnel_...` ID. Depending on the ChatGPT UI version, custom connectors/apps may instead appear under **Settings → Apps → Create** or Developer mode.
8. Scan or refresh tools, then save the connector. Confirm the eight grouped tools: `system`, `workspace`, `files`, `process`, `git`, `memory`, `browser`, and `computer`.
9. Open a new chat and enable/select Qnector from Apps/tools, or @mention Qnector when you want ChatGPT to use this PC.
10. Return to the Qnector wizard and click **I've added Qnector**. Only then is first-run setup marked complete.

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

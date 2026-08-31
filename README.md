# Qnector

Qnector connects ChatGPT to your Windows computer through MCP. It gives ChatGPT a
controlled interface for working with local projects, files, terminals, Git,
browsers, documents, and Windows applications while you keep using ChatGPT as the
AI interface.

Qnector runs locally and does **not** call the OpenAI model API. Tools run with the
Windows permissions of the user who launches Qnector.

[Download the latest Windows release](https://github.com/queenleonidasth/Qnector/releases/latest)
· [Connect to ChatGPT](docs/chatgpt-setup.md) · [Tool reference](docs/tool-reference.md)

## What Qnector can do

### Work on real projects

- Read, create, edit, patch, copy, move, and hash local files.
- Inspect project trees and search file contents or filenames.
- Run PowerShell, command-line programs, background services, and interactive
  ConPTY terminal sessions.
- Wait for processes, ports, output, or filesystem changes without constant
  polling.
- Inspect Git status, diffs, history, branches, and other repository state.

### Understand code

- Report TypeScript diagnostics, symbols, definitions, references, and hover
  information.
- Connect to supported external language servers such as Pyright,
  rust-analyzer, gopls, and clangd.
- Perform deterministic semantic search locally without an embedding API or
  vector database.
- Find files across Windows using Everything when available, with a bounded
  native fallback.

### Test web applications

- Launch and control an isolated Chrome or Edge development profile.
- Navigate pages and tabs; find elements by role, text, label, placeholder,
  test ID, or CSS.
- Click, type, fill forms, select options, upload files, and capture
  screenshots.
- Observe console errors, HTTP responses, failed requests, DOM state, styles,
  and performance data.
- Keep login state in an optional named Qnector browser profile.

### Inspect documents and Windows applications

- Extract or query text and metadata from PDF, DOCX, XLSX, CSV, JSON, ZIP, and
  SQLite files.
- Render PDF pages for visual inspection.
- Capture screens and inspect visible windows, processes, ports, and executable
  metadata.
- Find and operate standard Windows controls through UI Automation: focus,
  invoke, set values, select, toggle, expand, collapse, scroll, and wait.

### Continue work across chats

- Save project checkpoints, facts, decisions, and pending work locally.
- Restore a bounded workspace summary during the MCP session handshake.
- Review recent files, commands, processes, workflows, and errors in the working
  set.
- Persist reusable multi-step workflows and inspect their run state.

Qnector exposes these capabilities through eight grouped MCP tools:
`system`, `workspace`, `files`, `process`, `git`, `memory`, `browser`, and
`computer`.

## Install on Windows

### Requirements

- Windows 10 or Windows 11, x64.
- A ChatGPT account/workspace that can add a custom MCP app, plugin, or
  connector.
- [`cloudflared`](https://developers.cloudflare.com/tunnel/downloads/) installed
  for the default **Cloudflare Quick** connection. Qnector searches PATH and
  common Windows install locations. A Cloudflare account is not required for a
  Quick Tunnel.

Chrome or Edge is needed only for browser automation. Git, Everything, and
external language servers are optional and enable their corresponding features.
The release already contains the UI Automation helper, Everything CLI client,
and TypeScript runtime libraries.

### Option A: Setup installer (recommended)

1. Open the [latest release](https://github.com/queenleonidasth/Qnector/releases/latest).
2. Download the file ending in `win-x64-setup.exe`.
3. Run the installer and choose an installation folder.
4. Start **Qnector** from the Start menu.

### Option B: Portable application

1. Open the [latest release](https://github.com/queenleonidasth/Qnector/releases/latest).
2. Download the file ending in `win-x64-portable.exe`.
3. Move it to a permanent folder before enabling **Auto Start**.
4. Run the executable directly; no installation is required.

The current Windows binaries are not code-signed, so SmartScreen may display an
**Unknown publisher** warning. Verify the SHA-256 value against the release notes
before running the file:

```powershell
Get-FileHash .\Qnector-*-win-x64-setup.exe -Algorithm SHA256
```

## First-time setup

1. Open Qnector and select **Workspace → Choose Folder**.
2. Keep **Settings → Tunnel Mode** on **Cloudflare Quick (Auto)** unless you
   already use another supported transport.
3. Click the orb or **Connect to Bridge**.
4. Wait until the status changes to **BRIDGE: ACTIVE** and an HTTPS MCP URL
   appears.
5. Click **COPY** to copy the URL, or select **Open in ChatGPT**.
6. In ChatGPT, enable Developer Mode if required, create a custom MCP
   app/plugin/connector named `Qnector`, and paste the URL ending in `/mcp`.
7. Confirm that ChatGPT discovers all eight Qnector tools, then enable Qnector
   in a new chat.

ChatGPT changes its connector labels periodically. See the detailed
[ChatGPT connection guide](docs/chatgpt-setup.md) if the menu names differ.

Try a read-only request first:

```text
Use Qnector to inspect the active workspace, summarize the project, and report
the current Git status. Do not change any files.
```

Then test a write workflow:

```text
Use Qnector to create qnector-test.txt in the active workspace, read it back,
and show the Git diff.
```

## Everyday use

- **Show or hide Qnector:** press `Ctrl+Shift+Q`.
- **Run in the background:** enable **Settings → Minimize to Tray**.
- **Launch with Windows:** enable **Settings → Auto Start**.
- **Change projects:** open **Workspace → Choose Folder**.
- **Review health:** open the **Runtime** drawer for build, capability, process,
  and workflow status.
- **Disconnect:** hold the orb for three seconds.

Qnector listens locally at `http://127.0.0.1:8787/mcp`. Health and readiness are
available at `/healthz` and `/readyz`.

## Build from source

Source development requires Node.js 22+, Git, and pnpm 10. The Windows packaging
step also requires .NET SDK 8 to build the self-contained UI Automation helper.

```powershell
git clone https://github.com/queenleonidasth/Qnector.git
cd Qnector
npx pnpm@10.15.0 install
npx pnpm@10.15.0 build
npx pnpm@10.15.0 dev:desktop
```

Run the MCP server without the desktop UI:

```powershell
npx pnpm@10.15.0 dev:mcp
```

Build the Setup and Portable Windows packages:

```powershell
npx pnpm@10.15.0 package:windows
```

Artifacts are written to `apps/desktop/release`. If a running portable build
locks that directory, the packaging script uses a timestamped `retry-*` folder.

## Validate a source checkout

```powershell
npx pnpm@10.15.0 typecheck
npx pnpm@10.15.0 test
npx pnpm@10.15.0 lint
npx pnpm@10.15.0 format:check
npx pnpm@10.15.0 build
npx pnpm@10.15.0 smoke:mcp
npx pnpm@10.15.0 accept:p1-p10
npx pnpm@10.15.0 accept:p11-p18
npx pnpm@10.15.0 accept:p23
npx pnpm@10.15.0 accept:browser
```

The acceptance suites exercise real local processes, ConPTY, filesystem events,
Chrome/Edge, TypeScript intelligence, UI Automation, Everything, documents,
workflows, memory, release comparison, and MCP compatibility.

## Security and scope

Qnector is a personal full-access bridge, not a sandbox. Its tools inherit your
Windows account permissions, and the selected workspace is the default working
context rather than an access boundary. Only run it on a computer and workspace
you trust, review ChatGPT confirmations, and disconnect the bridge when it is not
needed.

Qnector does not automate ChatGPT itself, retrieve ChatGPT cookies, or bypass
product confirmations. Managed browser profiles are intended for web application
development and testing.

For implementation details, see the [complete tool reference](docs/tool-reference.md),
[relay deployment guide](docs/relay-deployment.md), and
[ChatGPT compatibility checklist](docs/plus-compatibility.md).

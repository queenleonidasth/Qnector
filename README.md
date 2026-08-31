# Qnector

Qnector is a Windows-first personal desktop bridge that exposes the current computer to ChatGPT through MCP. ChatGPT remains the reasoning/model UI; Qnector supplies the local execution, perception, search, code-intelligence and desktop-interaction layer. Qnector does **not** call an OpenAI model API.

The product source of truth is `../devq.md`. `recommend.md` is the capability/release handoff and `update.md` records implementation decisions.

## Current capability surface

Qnector intentionally keeps **8 grouped MCP tools**:

- `system` — runtime/build identity, local release comparison, bounded context snapshot, native process/port intelligence, `doctor`, machine info, Everything-backed filename search, clipboard/toast, screenshots and native window operations.
- `workspace` — filesystem/project context, TypeScript diagnostics/symbol intelligence, workspace-wide symbols, filesystem watch/wait, generic external LSP adapters, and deterministic local semantic search.
- `files` — bounded reads, image preview attachments, document inspection/text extraction/PDF rendering/SQLite queries, writes/replaces/patches/copy/move/delete/hash.
- `process` — foreground/background commands, incremental output, wait-for-port/output/exit, Qnector durable task facade and persistent multi-step workflows.
- `git` — structured Git operations.
- `memory` — local persistent workspace checkpoints/facts/export, deterministic recent working set and automatic first-use continuity bootstrap during MCP initialization.
- `browser` — Chrome/Edge web-app automation + CDP diagnostics, including persistent named dev profiles, semantic Playwright locators, interaction, tab/navigation control, screenshots, console/network observation and performance inspection.
- `computer` — semantic Windows UI Automation through a bundled C# helper with PowerShell fallback.

Qnector uses the modular MCP TypeScript SDK v2 (`@modelcontextprotocol/server` and `@modelcontextprotocol/node`). `/mcp` supports the modern MCP 2026-07-28 era and legacy 2025-era stateless clients on the same endpoint. Integration tests pin 2026-07-28 with the v2 client package.

At each MCP session-opening handshake — legacy/compatibility `initialize` or modern 2026-07-28 `server/discover` — Qnector reads the active workspace memory and returns a bounded **QNECTOR SESSION BOOTSTRAP** through server instructions. The AI receives the latest checkpoint/current task/pending context without needing a preliminary `memory.recall` call. Normal tool results do not repeat this block. The protocol handshake is the boundary available to Qnector; clients that reuse one MCP connection across several chats do not expose a per-chat ID for Qnector to distinguish.

## Requirements

- Node.js 22 or newer
- pnpm 10 (`npx pnpm@10.15.0` is fine)
- Git on PATH for Git workflows
- Windows packaging of the C# UIA helper requires .NET SDK 8; the generated helper itself is self-contained
- Everything GUI/service is optional but required for the fast indexed provider. Windows releases bundle `es.exe`; Qnector retains a bounded native fallback if Everything is unavailable.
- Generic LSP servers are optional external dependencies. Adapters currently recognize Pyright/BasedPyright, rust-analyzer, gopls and clangd.
- Optional public transports include Cloudflare, ngrok, OpenAI tunnel-client and Qnector Relay.

## Quick start

```powershell
npx pnpm@10.15.0 install
npx pnpm@10.15.0 build
npx pnpm@10.15.0 dev:mcp
```

Local MCP endpoint: `http://127.0.0.1:8787/mcp`  
Health endpoint: `http://127.0.0.1:8787/healthz`

Run the Electron desktop shell after building:

```powershell
npx pnpm@10.15.0 --filter @qnector/desktop start
```

Build installer + portable Windows artifacts:

```powershell
npx pnpm@10.15.0 package:windows
```

If an already-running portable locks `apps/desktop/release`, the packaging script writes to `apps/desktop/release/retry-YYYYMMDD-HHMMSS/`.

## P1–P10 upgrade highlights

### Runtime identity / doctor

`system.build_info` identifies the actual executable with build time/path/SHA-256. `system.doctor` provides one bounded health report for the main runtime capabilities. `system.everything_status` reports the indexed-search provider state.

### Event-driven process and filesystem waits

`process.wait_for_port`, `wait_for_output`, and `wait_for_exit` avoid repeated client polling. `workspace.watch`, `watch_events`, `unwatch`, `wait_for_file`, and `wait_for_change` cover build/export/file workflows. `process.task_start/get/list/cancel` is Qnector's durable process facade, not the deprecated legacy MCP Tasks wire protocol.

### Code intelligence, LSP and local semantic search

TypeScript projects support `diagnostics`, `document_symbols`, `workspace_symbols`, `definition`, `references`, `hover`, and read-only `rename_locations`. Generic LSP actions (`lsp_*`) can use supported external language servers. `workspace.semantic_search` uses the deterministic local `local-hashed-vector-v1` engine; it uses no network embedding service or model API.

### Everything indexed search

`system.search_files` supports `provider: auto | everything | fallback`. Packaged Windows builds bundle Voidtools `es.exe` as the CLI client, while an installed/running Everything database/service supplies the index. Native fallback is bounded and remains available.

### Windows UI Automation

`computer` supports `windows`, `inspect`, `find`, `invoke`, `set_value`, `focus`, `select`, `toggle`, `expand`, `collapse`, `scroll_into_view`, `range_value`, and bounded `wait`. Windows builds prefer the bundled self-contained C# helper `resources/uia-helper/qnector-uia.exe`; PowerShell/.NET UI Automation remains a compatibility fallback. Raw coordinate mouse control, general-purpose synthetic keyboard input, remote desktop and ChatGPT-session automation remain out of scope.

### Managed browser automation + diagnostics

`browser` can now drive normal HTTP/HTTPS web apps through Chrome/Edge while the CDP endpoint remains local to Qnector. It uses `playwright-core` over the existing managed browser, so no second Chromium binary is bundled. Semantic locators support CSS, text, role/name, label, placeholder and test ID; actions cover navigation/history/tabs, click/double-click/hover/focus, fill/type/press/select/check, scrolling, state reads/waits and file upload. `observeMs` can capture bounded console errors plus HTTP responses/request failures around an interaction for web-app debugging.

`browser.launch` still defaults to a disposable dedicated profile, but `profile` + `persistentProfile: true` creates a named Qnector development profile that keeps web-app login state across close/restart. `open_url` opens normal web URLs, `open_local` remains compatible, and `profile_reset` removes a named persistent profile. Existing screenshot, DOM, styles, read-only evaluate, request summary and performance diagnostics remain available.

## P11–P18 expansion (P13 intentionally skipped)

The second capability expansion keeps the same 8-tool contract. `system.context_snapshot` supplies a one-call machine/workspace picture; native process actions expose PID/path/version/resource/port context; `process.workflow_*` persists reusable multi-step workflows and run state; `files.inspect/extract_text/render/document_query` adds local document intelligence; `memory.working_set` and session bootstrap surface recent activity automatically; `system.release_status` compares running/package/source state; and the desktop app includes a Runtime drawer for release health, capability checks, active processes and workflow runs. P13 legacy UI/OCR expansion was intentionally not implemented.

## Validation

Run the full source gates:

```powershell
npx pnpm@10.15.0 typecheck
npx pnpm@10.15.0 test
npx pnpm@10.15.0 lint
npx pnpm@10.15.0 format:check
npx pnpm@10.15.0 build
npx pnpm@10.15.0 smoke:mcp
npx pnpm@10.15.0 accept:p1-p10
npx pnpm@10.15.0 accept:p11-p18
npx pnpm@10.15.0 accept:browser
```

`accept:p1-p10` is a real local acceptance harness. It exercises event waits/tasks, managed Chrome against a localhost fixture, TypeScript workspace symbols, the C# UIA helper, Everything indexed search, a real Pyright language server when installed, and local semantic search. `accept:p11-p18` verifies context/native process intelligence, local release comparison, persistent workflows, JSON/CSV/DOCX/XLSX/ZIP/SQLite document handling, real PDF text/render output, automatic working-set capture and the observability health checks. `accept:browser` launches a real Chrome/Edge instance and verifies persistent profiles plus Playwright find/fill/type/select/check/upload/press/click, API+console observation, waits/reads, navigation history, tab control and normal external web targets. MCP server integration tests separately verify legacy stateless traffic and a client pinned to modern protocol `2026-07-28`.

For the ChatGPT account compatibility gate, see `docs/plus-compatibility.md` and run `npx pnpm@10.15.0 test:plus`.

## Design boundaries

Qnector intentionally has no local permission profiles, approval queue, sandbox, RBAC or command allowlist. Tools execute with the OS rights of the user who launched Qnector. Active workspace is default context/cwd, not an access boundary. Tool annotations remain truthful so the ChatGPT product can apply its own controls.

Browser automation uses dedicated Qnector development profiles and may target normal HTTP/HTTPS web apps. It is intended for application development/testing workflows rather than automating the ChatGPT session itself.

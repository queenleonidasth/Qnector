# Qnector MCP tool reference

Qnector advertises **eight grouped MCP tools**. Each call uses an object with an `action` field. Relative filesystem paths resolve from the active workspace; absolute paths are supported.

## Tool/action overview

| Tool        | Actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system`    | `info`, `status`, `build_info`, `release_status`, `context_snapshot`, `processes`, `process_info`, `find_process`, `ports`, `doctor`, `everything_status`, `which`, `search_files`, `env`, `open_path`, `open_url`, `clipboard_read`, `clipboard_write`, `toast`, `screen_capture`, `window_list`, `window_focus`                                                                                                                                                                                                                 |
| `workspace` | `get`, `set`, `list_recent`, `tree`, `list`, `glob`, `grep`, `stat`, `summary`, `diagnostics`, `document_symbols`, `workspace_symbols`, `definition`, `references`, `hover`, `rename_locations`, `semantic_search`, `lsp_status`, `lsp_document_symbols`, `lsp_workspace_symbols`, `lsp_definition`, `lsp_references`, `lsp_hover`, `watch`, `watch_events`, `unwatch`, `wait_for_file`, `wait_for_change`                                                                                                                        |
| `files`     | `read`, `read_many`, `preview`, `inspect`, `extract_text`, `render`, `document_query`, `write`, `append`, `replace`, `multi_edit`, `apply_patch`, `mkdir`, `move`, `copy`, `delete`, `hash`                                                                                                                                                                                                                                                                                                                                       |
| `process`   | `run`, `start`, `output`, `stdin`, `stop`, `list`, `kill_tree`, `wait_for_exit`, `wait_for_output`, `wait_for_port`, `task_start`, `task_get`, `task_list`, `task_cancel`, `workflow_save`, `workflow_list`, `workflow_get`, `workflow_start`, `workflow_status`, `workflow_runs`, `workflow_cancel`, `workflow_resume`                                                                                                                                                                                                           |
| `git`       | `status`, `diff`, `log`, `show`, `branch`, `checkout`, `add`, `commit`, `pull`, `push`, `fetch`, `stash`, `reset`, `clean`, `rev_parse`                                                                                                                                                                                                                                                                                                                                                                                           |
| `memory`    | `recall`, `working_set`, `save_checkpoint`, `note`, `list`, `get`, `set`, `delete`, `compact`, `clear`, `export`                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `browser`   | `status`, `targets`, `tabs`, `console`, `network_errors`, `reload`, `navigate`, `back`, `forward`, `new_tab`, `close_tab`, `activate_tab`, `find`, `click`, `dblclick`, `hover`, `focus`, `fill`, `type`, `press`, `select`, `check`, `uncheck`, `scroll`, `get_text`, `get_value`, `get_attributes`, `wait`, `upload_file`, `screenshot`, `dom_snapshot`, `query`, `inspect`, `computed_style`, `evaluate`, `requests`, `performance`, `launch`, `close`, `restart`, `open_local`, `open_url`, `profile_status`, `profile_reset` |
| `computer`  | `windows`, `inspect`, `find`, `invoke`, `set_value`, `focus`, `select`, `toggle`, `expand`, `collapse`, `scroll_into_view`, `range_value`, `wait`                                                                                                                                                                                                                                                                                                                                                                                 |

Large outputs use line ranges, result caps, cursors and truncation metadata. Image actions return MCP image attachments and keep base64 out of structured/text results.

## MCP protocol

The production server uses modular MCP TypeScript SDK v2 (`@modelcontextprotocol/server` + `@modelcontextprotocol/node`). `/mcp` is served through `createMcpHandler`: integration tests verify legacy 2025-era stateless requests and a v2 client explicitly pinned to modern protocol `2026-07-28` on the same endpoint.

## Runtime identity and doctor

`system.build_info` returns the Qnector version, build ID/time, channel, actual executable path, executable SHA-256 and optional source revision. Portable builds use `PORTABLE_EXECUTABLE_FILE` when available so the reported identity refers to the outer portable executable rather than Electron's temporary child process.

`system.doctor` is a bounded health snapshot covering the build, 8-tool registration, workspace, PowerShell, Git, Everything, memory, UI Automation, managed browser runtime, generic LSP adapters, semantic search, filesystem watch service, native process intelligence, release comparison, document intelligence and the workflow engine. Warnings are capability state, not automatically failures.

## Context, native processes and release state

`system.context_snapshot` returns one bounded machine/workspace snapshot: build/release identity, active memory state, recent activity, managed processes, Qnector-related native processes, visible windows and capability flags. It is intended to reduce repeated discovery calls at the beginning of a task.

`system.processes` lists native OS processes; `find_process` filters by name/path/command line; `process_info` combines process metadata with TCP endpoints; and `ports` returns bounded TCP listener/connection summaries. Windows results include executable path, command line, parent PID, start time, CPU, working-set memory and file/product version when available.

`system.release_status` compares the currently running executable with the newest local Qnector package under `apps/desktop/release` and also checks whether source files are newer than that package. It reports `latest`, `outdated`, `source-newer`, `development` or `unknown` with an actionable recommendation.

## File and indexed search

`system.search_files` supports `provider: "auto" | "everything" | "fallback"`. Windows packages bundle Voidtools `es.exe` as the Everything CLI client. The fast provider still requires a usable Everything database/service; if unavailable, Qnector can fall back to a bounded native filesystem scan. `system.everything_status` reports provider availability.

Visible desktop actions are presentation-gated. `system.open_path`, `system.open_url`, `system.toast`, and `system.window_focus` require `presentToUser: true`; intermediate inspection/QC should remain headless and use file reads, browser/CDP inspection, or screenshots without opening viewers.

Workspace `grep`/`glob` remain separate: Everything locates filenames across Windows, workspace search inspects the active project, and Code Intelligence understands program semantics.

## TypeScript Code Intelligence

`workspace.diagnostics` follows `tsconfig.json` projects/references and returns structured diagnostics with 1-based locations. `document_symbols`, `workspace_symbols`, `definition`, `references`, `hover`, and `rename_locations` use the TypeScript Language Service. `workspace_symbols` accepts a query and searches symbols across the selected project graph. Rename discovery is read-only; actual edits still go through `files`.

## Generic LSP adapters

Generic LSP actions support external stdio language servers without creating another MCP tool group. Built-in adapter detection recognizes:

- Python: BasedPyright / Pyright
- Rust: rust-analyzer
- Go: gopls
- C/C++: clangd

Servers are not bundled. `lsp_status` reports which are currently resolvable. Calls may also supply an explicit `serverCommand`/`serverArgs`. Results are bounded; source positions are 1-based at the Qnector boundary and translated to LSP positions internally.

## Deterministic local semantic search

`workspace.semantic_search` uses Qnector's `local-hashed-vector-v1` engine. It indexes bounded text chunks locally using deterministic hashed lexical/trigram features, caches by file metadata fingerprint, and returns ranked file/line previews. It does **not** call a model/embedding API and does not require a vector database.

## Process waits and durable tasks

Long-running commands can still use `process.start` + cursor-based `output`, but event-oriented actions reduce client polling:

- `wait_for_port` waits for a TCP listener.
- `wait_for_output` waits until managed-process output contains a requested pattern.
- `wait_for_exit` waits for a managed process to leave the running state.

`task_start`, `task_get`, `task_list`, and `task_cancel` expose a Qnector-local durable task facade backed by `ProcessManager` (`taskProtocol: qnector-process-v1`). This is intentionally separate from deprecated legacy MCP Tasks wire methods.

`process.run` uses smart output reduction by default; pass `outputMode: "raw"` for exact output. Background output preserves cursor semantics.

## Filesystem events and waits

`workspace.watch` starts a bounded filesystem watcher and returns a `watchId`; `watch_events` reads buffered events after a cursor and `unwatch` closes it. `wait_for_file` and `wait_for_change` provide bounded waits for export/build workflows without repeated MCP polling. Runtime shutdown closes all managed watches.

## Persistent workflows

`process.workflow_save/list/get/start/status/runs/cancel/resume` adds a persistent multi-step workflow layer without creating a ninth MCP tool. Definitions live under `.qnector/workflows`; run state lives under `.qnector/workflow-runs`. Supported steps are commands, wait-for-port, wait-for-file, wait-for-change and bounded delays. Completed step state is persisted so a failed/canceled historical run can resume from the first unfinished step.

## Document intelligence

`files.inspect`, `extract_text`, `render` and `document_query` provide structured local document handling. Current support includes PDF text/page rendering, DOCX text/properties, XLS/XLSX sheets, CSV/text, JSON structure, ZIP listings and SQLite schema/read queries. PDF render results use the normal MCP image-attachment path so ChatGPT can visually inspect a selected page.

## Memory

Memory remains local to Qnector under `%APPDATA%\Qnector\memory`, keyed by active workspace. `memory.save_checkpoint` stores active task/completed/pending/critical context; facts/notes and deterministic compaction/export are available through the other memory actions. `memory.working_set` deterministically summarizes recent file reads/writes, commands, errors, managed processes and workflow runs from persisted Qnector activity plus workspace memory. `workspace.summary` includes a bounded memory block for the active workspace.

Qnector also performs **Automatic First-Use Memory Bootstrap** during the MCP session-opening handshake: legacy/compatibility `initialize` and modern 2026-07-28 `server/discover`. The handshake result's server `instructions` contains a bounded continuity summary (workspace, latest checkpoint, current task, completed/pending steps, critical context, core facts, recent changes and the newest non-memory activity from the automatic working set). This avoids requiring the AI to remember to call `memory.recall` before continuing work. The bootstrap is not duplicated in normal tool results. MCP does not expose a ChatGPT chat ID, so if a client reuses one MCP connection/handshake across multiple chat conversations Qnector cannot distinguish those chats as separate boundaries.

Secret sanitization is best-effort; memory is not a secret store.

## Windows UI Automation

Windows releases prefer the bundled self-contained C# helper `resources/uia-helper/qnector-uia.exe`; source/headless runs discover the helper when available and otherwise retain the PowerShell/.NET UI Automation implementation as a fallback.

Start with `computer.windows`, then `find` or bounded `inspect` to obtain session-scoped element IDs. Supported semantic patterns include Invoke, Value, SelectionItem, Toggle, ExpandCollapse, ScrollItem and RangeValue. `wait` supports bounded state waits such as exists/not_exists/enabled/disabled/value_equals. Non-finite native bounds are normalized before JSON serialization. Stale elements return `ELEMENT_STALE` and should be re-found.

Qnector intentionally does not expose raw coordinate mouse control, general-purpose synthetic keyboard input, remote desktop or ChatGPT browser/session automation.

## Managed browser automation and diagnostics

The browser group keeps the Chrome/Edge DevTools endpoint on loopback, but page navigation now supports normal `http://` and `https://` web applications. Managed browser launches are **headless by default** so intermediate development/QC does not open visible windows. A visible launch (`headless: false`) is presentation-only and requires `presentToUser: true`. `launch` can use a disposable profile (default) or a named persistent development profile via `profile` + `persistentProfile: true`; persistent profiles survive `close`/`restart` so dev/staging login state can be reused. `profile_reset` deletes a named persistent profile when it is no longer needed. `open_url` opens any normal web URL, while `open_local` remains as a backward-compatible alias.

Playwright Core connects to the managed browser over CDP; Qnector does not bundle another Chromium binary. Browser interaction actions include:

- `find`: semantic locator discovery by CSS selector, text, ARIA role/name, label, placeholder or test ID.
- `click`, `dblclick`, `hover`, `focus`, `fill`, `type`, `press`, `select`, `check`, `uncheck`, `scroll`.
- `get_text`, `get_value`, `get_attributes` for bounded state inspection.
- `wait` for attached/detached/visible/hidden/text/value/URL conditions.
- `upload_file` using paths resolved from the active Qnector workspace.
- `navigate`, `back`, `forward`, `tabs`, `new_tab`, `activate_tab`, `close_tab`.
- Interaction actions accept `observeMs`; when non-zero, Qnector returns bounded console/page errors plus HTTP response/request-failure summaries that occurred during the action. This is intended for submit/save/debug loops.

Existing CDP diagnostics remain:

- `screenshot`: MCP image attachment.
- `dom_snapshot`: bounded structural view, not full raw HTML.
- `query` / `inspect`: CSS query and CDP backend-node inspection.
- `computed_style`: selected properties only.
- `evaluate`: bounded read-only diagnostic expression with Chrome side-effect detection.
- `requests`: URL/method/type/status/mime/protocol/size/duration summaries.
- `performance`: selected/default CDP metrics plus bounded navigation/paint timing.

Use a dedicated Qnector profile for automated web-app development rather than a normal day-to-day browser profile.

## Image attachments

`files.preview` supports PNG/JPEG/WEBP. `system.screen_capture` and `browser.screenshot` use the same `ToolAttachment` path. Structured results contain metadata only; the MCP server maps the attachment to MCP image content. Oversized images are bounded/re-encoded by the applicable platform implementation.

## Validation

The release gates are:

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

Windows release changes additionally run `package:windows` and inspect packaged `app.asar` plus the bundled UIA/Everything extra resources.

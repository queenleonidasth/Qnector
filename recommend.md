# Qnector — Next Capability Upgrade Handoff

> Updated: 30 August 2026
> Target: handoff document for the next ChatGPT / AI development session
> Project: `C:\Users\QUEEN\qnector`
> Product source of truth: `C:\Users\QUEEN\devq.md`
> Current stable backup: `C:\Users\QUEEN\stable`
> Latest tested portable build before this roadmap: `C:\Users\QUEEN\qnector\apps\desktop\release\retry-20260829-154114\Qnector-0.1.0-win-x64-portable.exe`
> Latest tested portable after the original four-capability roadmap: `C:\Users\QUEEN\qnector\apps\desktop\release\retry-20260829-174330\Qnector-0.1.0-win-x64-portable.exe`
> P1–P10 expansion: implementation and real acceptance complete.
> P11/P12/P14/P15/P16/P17/P18 expansion: implementation and real acceptance complete; P13 intentionally skipped by owner.
> P19 Browser Web-App Automation: source implementation + real Chrome/Edge acceptance complete; Windows packaging pending final release gates.
> Latest tested release after Automatic First-Use Memory Bootstrap: `C:\Users\QUEEN\qnector\apps\desktop\release\retry-20260829-224101\Qnector-0.1.0-win-x64-portable.exe`

## CURRENT P1–P10 + SESSION BOOTSTRAP COMPLETION STATUS — 29 AUGUST 2026

The owner explicitly requested all optional follow-ups as one new roadmap. **Do not rebuild these items in a future session.** Source implementation and real acceptance are complete for:

1. P1 Build Identity + `system.doctor`
2. P2 process wait primitives + filesystem watcher/waits
3. P3 managed disposable Chrome/Edge debug-profile runtime
4. P4 modular MCP SDK v2 with modern `2026-07-28` + legacy 2025 stateless compatibility
5. P5 TypeScript `workspace_symbols`
6. P6 self-contained C# Windows UI Automation helper + richer semantic patterns, with PowerShell fallback
7. P7 bundled Everything CLI indexed provider + bounded fallback
8. P8 Qnector durable process-task facade
9. P9 generic external LSP adapters; real Pyright acceptance passed
10. P10 deterministic local `local-hashed-vector-v1` semantic search with no model API

The permanent real acceptance command is:

```powershell
npx pnpm@10.15.0 accept:p1-p10
```

It exercises P1–P3/P5–P10 against real local components. P4 is covered by MCP integration tests that verify a legacy 2025 stateless request path and a v2 client pinned to modern protocol `2026-07-28`.

The grouped MCP surface remains **8 tools**; P1–P10 are actions/services inside those coherent groups.

---

# 0. NEXT SESSION BOOTSTRAP — READ THIS FIRST

The project owner is intentionally switching to a new ChatGPT session to test Qnector persistent memory and cross-session continuity.

Qnector now implements **Automatic First-Use Memory Bootstrap**. On each MCP session-opening handshake — legacy/compatibility `initialize` or modern 2026-07-28 `server/discover` — it reads the active workspace memory and returns a bounded `QNECTOR SESSION BOOTSTRAP` through server instructions. The AI should receive the latest checkpoint/current task/pending context without needing to remember to call `memory.recall` first. Normal tool results do not duplicate the bootstrap. MCP does not expose a ChatGPT chat ID, so the MCP connection handshake is the boundary Qnector can reliably observe.

Before changing code, the next AI should do this in order:

1. Use Qnector and inspect the automatic session bootstrap plus active workspace.
2. Call `workspace.summary` to verify current project state and its memory block.
3. Call `memory.recall` only when more history/detail is needed and the client exposes that grouped tool.
4. Read `C:\Users\QUEEN\devq.md` completely. It remains the product source of truth.
5. Read `C:\Users\QUEEN\qnector\AGENTS.md`.
6. Read this `recommend.md`.
7. Read only the implementation files relevant to the first task before editing.
8. Do not redo features marked IMPLEMENTED below.
9. Preserve the current working implementation and backups.
10. After every implementation phase run typecheck, tests, lint, format check, build, and Windows packaging when release-affecting code changes.

If automatic bootstrap works correctly, the new session should be able to discover at least this context without the user explaining it again:

- Qnector is a Windows-first local MCP bridge for ChatGPT.
- Current source project is `C:\Users\QUEEN\qnector`.
- `files.preview` has already been implemented and validated end-to-end.
- A real 11496×4926 JPEG around 29 MB was automatically resized and returned to ChatGPT as an MCP image attachment.
- The original `files.preview` milestone portable was `retry-20260829-154114`; the completed-roadmap portable is `retry-20260829-174330`.
- The next major capability roadmap is now:
  1. LSP / Code Intelligence
  2. Everything Search
  3. Windows UI Automation
  4. Browser DOM + Screenshot

If the automatic bootstrap is missing from a fresh MCP initialization, continue using this document as the explicit handoff and treat it as memory/bootstrap compatibility evidence. A missing direct `memory` grouped tool in the client surface no longer prevents first-use continuity because initialization instructions are the primary bootstrap path.

---

# 1. CURRENT IMPLEMENTATION STATUS

## Already implemented — do not rebuild these from scratch

Qnector currently has eight grouped MCP tools in source:

- `system`
- `workspace`
- `files`
- `process`
- `git`
- `memory`
- `browser`
- `computer`

Important existing capabilities include:

- full local filesystem operations
- active workspace context
- PowerShell / cmd / direct CLI execution
- background processes with incremental output
- smart process-output reduction
- Git operations
- persistent workspace memory
- memory checkpoints / facts / notes / export
- `.qnector/MEMORY.md` optional mirror
- clipboard read/write
- toast notifications
- screen capture as MCP image attachments
- native window list/focus
- semantic Windows UI Automation through the `computer` tool
- localhost-only browser CDP diagnostics
- `files.preview` for direct image vision

## `files.preview` — IMPLEMENTED AND VERIFIED

Current implementation supports:

- PNG
- JPEG
- WEBP
- absolute and relative paths
- Unicode / Thai paths
- MCP image attachments
- source and output dimensions
- automatic resize / re-encode for large images through `PlatformServices`
- Electron image processing through `nativeImage`
- Windows headless image processing through PowerShell / `System.Drawing`

Real-world validation already completed:

```text
Source: 11496×4926 JPEG
Source size: ~28.96 MB
Output example: 2048×878 ~510 KB
Direct MCP attachment: success
ChatGPT Vision: success
```

Do not reimplement this feature. Reuse its attachment path for browser screenshots and future visual tools.

## Code Intelligence — IMPLEMENTED IN SOURCE (29 Aug 2026)

Priority 1 is implemented through the TypeScript compiler / Language Service APIs:

- `workspace.diagnostics`
- `workspace.document_symbols`
- `workspace.definition`
- `workspace.references`
- `workspace.hover`
- `workspace.rename_locations`
- bounded `maxResults` / `offset` results
- 1-based source locations and short previews
- project-reference traversal for diagnostics
- source/config fingerprint invalidation
- deliberate-error, pagination, missing-tsconfig, symbols, definition, references, hover, rename, and invalid-position tests

Editing remains in the `files` tool; rename locations are discovery only.

## Everything Search — IMPLEMENTED IN SOURCE (29 Aug 2026)

Priority 2 is implemented as `system.search_files`:

- `provider: auto | everything | fallback`
- `auto` prefers Voidtools `es.exe`
- structured filename/path results with optional size/modified metadata
- pagination and bounded result counts
- no silent third-party installation
- bounded native fallback (50,000 filesystem-entry budget) when Everything is unavailable
- real-machine validation: this PC currently has no `es.exe`; fallback successfully located Qnector source files and reported truncation/budget status

## Windows UI Automation — IMPLEMENTED IN SOURCE (29 Aug 2026)

Priority 3 source-of-truth reconciliation is complete and `computer` is intentionally the eighth grouped MCP tool. The MVP uses PowerShell + .NET Windows UI Automation without importing Electron into core:

- `computer.windows`
- `computer.inspect`
- `computer.find`
- `computer.invoke` via `InvokePattern`
- `computer.set_value` via `ValuePattern`
- `computer.focus`
- `computer.select` via `SelectionItemPattern`
- `computer.wait` with bounded internal polling
- session-scoped window/element IDs backed by UIA RuntimeId re-resolution
- `ELEMENT_STALE`, `UIA_WINDOW_NOT_FOUND`, `UIA_ACTION_UNSUPPORTED`, and bounded timeout errors
- compatibility with `system.window_list` IDs shaped as `window_<pid>`
- no raw coordinate mouse control, general-purpose synthetic keyboard input, remote desktop, or ChatGPT browser/session automation

Real Windows WPF smoke validation completed for window enumeration, inspect/find, text `set_value`, focus, enabled wait, button invoke, list-item select, and disabled-control error handling.

## Browser DOM + Screenshot + Advanced Diagnostics — IMPLEMENTED IN SOURCE (29 Aug 2026)

Priority 4A/4B/4C is implemented by extending the existing localhost-only `browser` grouped tool:

- `browser.screenshot` through `Page.captureScreenshot` with MCP image attachments and no base64 duplication in structured text
- bounded `browser.dom_snapshot` returning tag/id/classes/text/role/visibility/bounds instead of raw HTML
- `browser.query` with CSS selectors and stable CDP backend node IDs
- `browser.inspect` for bounded node metadata/text/visibility/bounds
- `browser.computed_style` returning only requested/default CSS properties
- `browser.evaluate` as bounded read-only JavaScript diagnostics; direct cookie/credential/storage APIs are rejected and CDP `throwOnSideEffect` is enabled
- `browser.requests` returning bounded URL/method/type/status/mime/protocol/size/duration summaries without request/response headers, bodies, cookies, or credentials; optional `reloadPage` captures a fresh load
- `browser.performance` returning selected/default CDP metrics plus bounded navigation and paint timing
- multi-command `CdpClient` so DOM/performance commands in one action share a WebSocket session
- existing `console`, `network_errors`, `reload`, `targets`, and localhost target filtering preserved

Real Chrome acceptance used temporary dedicated debug profiles and localhost fixtures. Phase 4A/4B admitted exactly one localhost page target while excluding browser/background targets; screenshot returned 800×790 PNG (9,243 bytes) with no base64 in structured data; DOM snapshot/query/inspect/computed-style and reload all succeeded. Phase 4C then verified a real object evaluate result, rejection of `localStorage`, Chrome rejection of a DOM-mutating expression, a 3-request network trace containing the fixture `/api/data` request with no header/cookie leakage, and real Frames/Nodes/JS heap plus navigation timing. Temporary profiles/fixtures were deleted after testing.

## Current final QC — P1–P10 + Automatic Memory Bootstrap + Desktop UI hardening

```text
typecheck          PASS
tests              PASS — 44/44
eslint             PASS
prettier           PASS
production build   PASS
UI overflow audit  PASS — 0 visible overflows at minimum-width equivalent with long dynamic data
MCP smoke          PASS — 8 grouped tools
P1–P10 acceptance  PASS — real managed Chrome + C# UIA + Everything + Pyright
MCP v2 integration PASS — automatic bootstrap verified on legacy initialize + modern 2026-07-28 server/discover/getInstructions()
Windows package    PASS — retry-20260829-224101
app.asar verify    PASS — UI overflow hardening + taskbar identity + session bootstrap present
extra resources    PASS — qnector-uia.exe + es.exe
```

Final portable:

`C:\Users\QUEEN\qnector\apps\desktop\release\retry-20260829-224101\Qnector-0.1.0-win-x64-portable.exe`

Portable SHA-256:

`C63D4024B4E5BA432965EF8B8DB9B70EA262A591EE12FFB0CE631E4F12F9FD51`

Portable size: `167,179,834 bytes`.

Setup SHA-256: `F3D5A214A9C41FF8C5BC331CC91844664B8858C5B1187C24B543012F5B10C4C2`.

---

# 2. NEW PRIMARY ROADMAP

The owner wants the next development effort focused on four high-value capability upgrades:

```text
P1  LSP / Code Intelligence
P2  Everything Search
P3  Windows UI Automation
P4  Browser DOM + Screenshot
```

The objective is to move Qnector from:

> ChatGPT with strong filesystem + terminal access

into:

> ChatGPT that understands code structure, instantly finds files across Windows, understands desktop application controls, and can visually inspect and structurally debug web UIs.

The four capabilities should compose with existing tools rather than creating a large number of disconnected MCP tools.

---

# 3. PRIORITY 1 — LSP / CODE INTELLIGENCE

## 3.1 Why this should be first

Today ChatGPT can use Qnector to:

```text
grep
→ read files
→ infer relationships
→ edit
→ run TypeScript/tests
```

This works, but the model must repeatedly rediscover program structure from text.

Code Intelligence should allow Qnector to answer structured questions such as:

```text
Where is this symbol defined?
What references this interface?
What TypeScript errors exist right now?
What symbols are in this file?
What type does this expression resolve to?
What files would be affected by renaming this symbol?
```

This significantly reduces repeated repository scans and makes code modifications more precise.

## 3.2 Architecture recommendation

Do NOT create a new top-level MCP tool immediately.

Preserve the “few coherent grouped tools” design by extending `workspace` with read-oriented code intelligence actions.

Recommended first actions:

```text
workspace.diagnostics
workspace.document_symbols
workspace.workspace_symbols
workspace.definition
workspace.references
workspace.hover
workspace.rename_locations
```

The actual MCP action values may use snake_case:

```text
diagnostics
document_symbols
workspace_symbols
definition
references
hover
rename_locations
```

Editing should continue to use `files.replace`, `files.multi_edit`, or `files.apply_patch`. The first Code Intelligence phase should mainly supply structured understanding, not introduce another mutation engine.

## 3.3 TypeScript-first implementation

Qnector itself is TypeScript and already depends on TypeScript.

Start with the TypeScript compiler / Language Service API rather than spawning a full external LSP server.

Advantages:

- dependency already installed
- no new background language-server process required for MVP
- can read `tsconfig.json`
- can provide semantic diagnostics
- can resolve definitions and references
- headless compatible
- easier to test deterministically

Recommended new core service:

```text
packages/core/src/code-intelligence.ts
```

Conceptual interface:

```ts
interface CodeIntelligenceService {
  diagnostics(input: DiagnosticsInput): Promise<DiagnosticResult[]>;
  documentSymbols(file: string): Promise<CodeSymbol[]>;
  workspaceSymbols(query: string, limit?: number): Promise<CodeSymbol[]>;
  definition(file: string, line: number, column: number): Promise<Location[]>;
  references(file: string, line: number, column: number): Promise<Location[]>;
  hover(
    file: string,
    line: number,
    column: number,
  ): Promise<HoverResult | null>;
  renameLocations(
    file: string,
    line: number,
    column: number,
  ): Promise<Location[]>;
}
```

Inject it into `ToolContext` rather than importing project-specific TypeScript logic directly inside the MCP server.

## 3.4 Diagnostics result contract

Return diagnostics structurally instead of raw `tsc` output:

```json
{
  "file": "packages/tools/src/files-tool.ts",
  "line": 120,
  "column": 18,
  "endLine": 120,
  "endColumn": 32,
  "severity": "error",
  "source": "typescript",
  "code": "TS2322",
  "message": "Type ... is not assignable to type ..."
}
```

Input example:

```json
{
  "action": "diagnostics",
  "path": ".",
  "maxResults": 200
}
```

Allow optional:

```text
path
tsconfig
severity
maxResults
offset
```

Results must be bounded and paginated.

## 3.5 Symbol result

Recommended representation:

```json
{
  "name": "PlatformServices",
  "kind": "interface",
  "file": "packages/core/src/platform-services.ts",
  "line": 51,
  "column": 18,
  "container": null
}
```

## 3.6 Definition / references input

Prefer file + 1-based line/column because ChatGPT already sees numbered source lines from `files.read`.

```json
{
  "action": "references",
  "path": "packages/core/src/platform-services.ts",
  "line": 51,
  "column": 18,
  "maxResults": 100
}
```

Return exact file locations and short line previews.

## 3.7 Project lifecycle / caching

Do not recreate the TypeScript program for every tiny call if avoidable.

Recommended:

- cache project state by normalized `tsconfig` path
- invalidate when relevant source / config mtimes change
- keep the first version simple and deterministic
- measure memory usage on Qnector itself and at least one larger fixture

A later phase may use a persistent TypeScript Language Service with incremental snapshots.

## 3.8 Generic LSP later

After TypeScript-first MVP is stable, add an adapter interface for external language servers:

```text
Pyright / basedpyright
rust-analyzer
gopls
clangd
```

Do NOT implement all languages in the first phase.

Recommended future layout:

```text
packages/core/src/code-intelligence/
  types.ts
  typescript-service.ts
  lsp-client.ts
  project-manager.ts
```

## 3.9 Files likely to change

```text
packages/core/src/code-intelligence.ts               NEW
packages/core/src/index.ts
packages/tools/src/workspace-tool.ts
packages/tools/src/tool-result.ts                    only if result helper needed
packages/tools/src/tools.test.ts
packages/mcp-server/src/server.ts                    schema additions
packages/shared/src/types.ts                         shared result types if useful
docs/tool-reference.md
README.md
recommend.md
```

## 3.10 Tests

At minimum:

- detect a deliberate TypeScript type error
- diagnostics return file/line/column/code
- document symbols include class/function/interface fixtures
- definition resolves imported symbol
- references finds multiple files
- hover returns useful type/signature text
- rename locations are read-only and complete enough for a fixture
- malformed file position returns clear error
- project without `tsconfig` returns actionable result
- maxResults / pagination respected
- changing a source file invalidates stale project data

## 3.11 Acceptance criteria

The following conversation must work efficiently:

```text
User: Find every place PlatformServices is used and tell me what would break if we change previewImage.

ChatGPT
→ workspace.references
→ targeted files.read on only the important locations
→ explain impact
```

And:

```text
User: Fix the TypeScript errors in this project.

ChatGPT
→ workspace.diagnostics
→ edit only affected files
→ workspace.diagnostics again
→ tests
```

The AI should not need to start by grepping the entire repository for every symbol question.

---

# 4. PRIORITY 2 — EVERYTHING SEARCH

## 4.1 Goal

Give ChatGPT near-instant file discovery across the whole Windows machine, not only the active workspace.

Example user requests:

```text
Find every invoice xlsx on my PC.
Find the portable Qnector exe I built this afternoon.
Where is this filename anywhere on C: and D:?
Find files modified today containing "stock" in their name.
```

Scanning disks recursively from Node/PowerShell is too slow for this workflow.

Use Voidtools Everything as the preferred Windows filename index when available.

## 4.2 Recommended tool surface

Extend `system` rather than adding another top-level grouped MCP tool:

```text
system.search_files
```

Suggested input:

```json
{
  "action": "search_files",
  "query": "invoice ext:xlsx",
  "maxResults": 100,
  "offset": 0
}
```

Optional fields:

```text
query
maxResults
offset
provider
details
```

Provider values could be:

```text
auto
everything
fallback
```

Default `auto`.

## 4.3 Everything integration

Preferred integration order:

1. detect Everything CLI (`es.exe`) if installed
2. optionally detect Everything service / HTTP / SDK support if a future richer adapter is needed
3. use CLI output in MVP because it keeps packaging simple
4. fallback to a bounded native search only when Everything is unavailable

Do not silently download or install third-party software. Detect it and return an actionable hint if the user wants the fast provider but it is missing.

Recommended abstraction:

```ts
interface FileSearchProvider {
  name: string;
  available(): Promise<boolean>;
  search(input: FileSearchInput): Promise<FileSearchResult>;
}
```

Implement:

```text
EverythingSearchProvider
FallbackFileSearchProvider
```

## 4.4 Structured results

Do not return one giant command-output string.

Return:

```json
{
  "provider": "everything",
  "query": "invoice ext:xlsx",
  "matches": [
    {
      "path": "D:\\Sales\\invoice-2026-08.xlsx",
      "name": "invoice-2026-08.xlsx",
      "extension": ".xlsx",
      "size": 123456,
      "modifiedAt": "2026-08-29T08:00:00Z"
    }
  ],
  "totalReturned": 1,
  "truncated": false
}
```

Metadata can be optional if retrieving it for hundreds of files becomes expensive.

## 4.5 Keep workspace search too

Everything Search must NOT replace:

```text
workspace.grep
workspace.glob
workspace.tree
```

Use cases differ:

```text
Everything = locate files across Windows
workspace.grep = search contents in the active project
LSP = understand program semantics
```

These three layers should coexist.

## 4.6 Potential follow-up

After filename search is reliable, optional additions:

```text
system.search_recent_files
system.search_large_files
system.search_duplicates
```

But keep MVP centered on one powerful `search_files` action.

## 4.7 Files likely to change

```text
packages/core/src/file-search.ts                 NEW
packages/core/src/index.ts
packages/tools/src/system-tool.ts
packages/tools/src/tools.test.ts
packages/mcp-server/src/server.ts
docs/tool-reference.md
README.md
```

## 4.8 Tests

- provider detection
- mock Everything CLI results
- spaces / Unicode / Thai paths
- empty results
- max result cap
- pagination / offset behavior
- provider unavailable error
- fallback provider bounded behavior
- malformed Everything output does not crash server

## 4.9 Acceptance criteria

This should be practical:

```text
User: หาไฟล์ Qnector portable ล่าสุดในเครื่องให้หน่อย

ChatGPT
→ system.search_files query="Qnector-*-portable.exe"
→ sort/inspect metadata
→ return the newest path
```

The AI should not recursively traverse `C:\Users` first.

---

# 5. PRIORITY 3 — WINDOWS UI AUTOMATION

## 5.1 Important source-of-truth conflict

This is a deliberate scope expansion requested by the project owner on 29 Aug 2026.

Current `C:\Users\QUEEN\devq.md` still lists remote desktop / computer-use mouse and keyboard as a v1 non-goal, and `update.md` also says not to add click/type automation under the earlier roadmap.

Therefore the implementing AI MUST NOT quietly add Windows UI Automation while leaving the source-of-truth contradictory.

Before implementing this phase:

1. show the owner the specific scope change
2. update `devq.md` to explicitly permit Windows UI Automation for local desktop applications
3. distinguish semantic UI Automation from raw coordinate mouse control
4. update non-goals/final decisions/test plan accordingly

The owner has now explicitly requested this capability, so the recommended new product direction is to allow it after documentation reconciliation.

## 5.2 Why UI Automation instead of coordinate clicking first

Raw computer use:

```text
click x=813 y=521
```

is fragile because windows move, DPI changes, controls resize, and layouts vary.

Windows UI Automation can expose semantic controls:

```text
Window: iTEC stock
Control: Export
ControlType: Button
AutomationId: btnExport
Enabled: true
```

Then ChatGPT can request:

```text
click the Export button
```

without guessing coordinates.

## 5.3 Recommended grouped tool design

This capability is large enough to justify either:

A. adding actions under `system`, or
B. introducing one coherent `computer` grouped tool after intentionally updating the tool-count decision.

Recommended direction: **new `computer` grouped tool**, because mixing desktop interaction into `system` will make `system` too broad.

Proposed actions:

```text
computer.windows
computer.inspect
computer.find
computer.invoke
computer.set_value
computer.focus
computer.select
computer.key
computer.type_text
computer.scroll
computer.wait
```

MVP should start with semantic UIA actions only:

```text
windows
inspect
find
invoke
set_value
focus
select
wait
```

Raw mouse coordinates can remain a later fallback, not the primary interface.

## 5.4 Recommended Windows technology

Evaluate these approaches in a spike before committing:

### Option A — PowerShell + .NET UIAutomation

Pros:

- headless-compatible with existing architecture
- no Electron coupling
- fast to prototype

Cons:

- PowerShell serialization overhead
- framework coverage can be inconsistent
- difficult long-lived automation state

### Option B — small C# helper process

Recommended for production if the prototype proves useful.

Create a reviewed local helper using .NET Windows UI Automation APIs and communicate via JSON lines over stdin/stdout.

Concept:

```text
Qnector Node
   │ JSONL
   ▼
qnector-uia.exe
   │
   ▼
Windows UI Automation API
```

Benefits:

- semantic control tree
- stable native Windows APIs
- event waiting
- element invocation/value patterns
- no need to import Electron into core

### Option C — third-party Node UIA/native binding

Only choose this after evaluating packaging reliability and maintenance. Avoid introducing a fragile native dependency solely for convenience.

## 5.5 Element identity

Do not rely on visible text alone.

Return element descriptors such as:

```json
{
  "elementId": "uia_4b0f...",
  "name": "Export",
  "automationId": "btnExport",
  "controlType": "Button",
  "className": "Button",
  "enabled": true,
  "offscreen": false,
  "bounds": {
    "x": 1200,
    "y": 680,
    "width": 120,
    "height": 36
  }
}
```

`elementId` should be call/session scoped. UI elements can become stale after navigation; return `ELEMENT_STALE` and let ChatGPT re-inspect.

## 5.6 Inspect action

Example:

```json
{
  "action": "inspect",
  "windowId": "window_1234",
  "depth": 4,
  "maxResults": 300
}
```

Return a compact UI tree, not thousands of raw accessibility nodes.

Support filters:

```text
name
controlType
automationId
className
```

## 5.7 Find + invoke workflow

```text
computer.windows
→ computer.find { window, name: "Export", controlType: "Button" }
→ computer.invoke { elementId }
```

For text input:

```text
computer.find Product Code textbox
→ computer.set_value elementId="..." value="ABC123"
```

Prefer ValuePattern / InvokePattern / SelectionPattern rather than synthetic keyboard input when supported.

## 5.8 Visual verification integration

UI Automation should compose with existing screen capture:

```text
computer.invoke
→ system.screen_capture(window)
→ ChatGPT Vision verifies result
```

Later:

```text
computer action
→ screenshot
→ UIA inspect
→ verify state
```

This combination is much more reliable than either vision-only clicking or UIA-only interaction.

## 5.9 Waiting for UI state

Add a bounded wait primitive:

```json
{
  "action": "wait",
  "windowId": "window_1234",
  "name": "Export complete",
  "timeoutMs": 30000
}
```

Possible conditions:

```text
exists
not_exists
enabled
disabled
value_equals
```

Avoid ChatGPT polling every second.

## 5.10 Files likely to change

Exact architecture depends on spike result, but likely:

```text
packages/shared/src/types.ts
packages/shared/src/schemas.ts
packages/core/src/ui-automation.ts                 NEW
packages/tools/src/computer-tool.ts                NEW
packages/tools/src/index.ts
packages/tools/src/tools.test.ts
packages/mcp-server/src/server.ts
apps/desktop/src/main/main.ts                      if helper lifecycle lives there
tools/uia-helper/                                  possible C# helper project
README.md
docs/tool-reference.md
devq.md                                            REQUIRED scope reconciliation
update.md                                          update old no-input statement
recommend.md
```

## 5.11 Tests

Automated fixture application should expose stable Windows controls.

Test:

- enumerate fixture window
- inspect control tree
- find button by automation ID
- invoke button
- find textbox
- set value
- select item
- disabled control error
- stale element behavior
- Unicode/Thai control names
- wait exists / timeout
- process/window closes while operation runs
- bounds/DPI does not affect semantic invocation

Manual acceptance should include at least:

- Win32 app
- standard Windows dialog
- Electron app
- one real business desktop app used by the owner if available

## 5.12 Acceptance scenario

Target workflow:

```text
User: เปิดโปรแกรม stock แล้วค้น SKU นี้ จากนั้น export ข้อมูลออกมาให้ฉัน

ChatGPT
→ system.window_list / computer.windows
→ computer.inspect/find
→ computer.set_value SKU
→ computer.invoke Search
→ computer.wait results
→ computer.invoke Export
→ workspace/file watcher later detects export
→ read/analyze output
```

That is a major step toward a genuine Windows agent.

---

# 6. PRIORITY 4 — BROWSER DOM + SCREENSHOT

## 6.1 Existing browser baseline

Qnector already has a `browser` grouped tool using Chrome DevTools Protocol for a dedicated localhost development browser profile.

Existing source actions:

```text
status
targets
console
network_errors
reload
```

Keep and extend this tool. Do not create another browser tool.

## 6.2 First addition — `browser.screenshot`

Use CDP:

```text
Page.enable
Page.captureScreenshot
```

Suggested input:

```json
{
  "action": "screenshot",
  "targetId": "...",
  "format": "png",
  "maxWidth": 2048,
  "fullPage": false
}
```

Return the image through the existing `ToolAttachment` pipeline used by:

```text
system.screen_capture
files.preview
```

Do NOT include image base64 in text / structured JSON.

Metadata:

```json
{
  "targetId": "...",
  "url": "http://localhost:5173/",
  "mimeType": "image/png",
  "width": 1440,
  "height": 900,
  "sizeBytes": 245000
}
```

If CDP screenshot dimensions are too large, resize through the same image-processing abstraction already built for `files.preview`, or use CDP capture/viewport parameters where appropriate.

## 6.3 DOM snapshot

Recommended action:

```text
dom_snapshot
```

Do not dump raw HTML for the entire page by default.

Return a compact structural tree oriented toward AI debugging:

```json
{
  "tag": "button",
  "id": "save",
  "classes": ["primary"],
  "text": "Save",
  "role": "button",
  "visible": true,
  "bounds": { "x": 900, "y": 80, "width": 90, "height": 36 },
  "nodeId": 123
}
```

Prefer Accessibility / DOMSnapshot CDP domains when they produce more compact useful information than serializing `document.documentElement.outerHTML`.

Potential CDP APIs to evaluate:

```text
DOM.enable
DOM.getDocument
DOM.querySelector
DOM.describeNode
DOMSnapshot.captureSnapshot
Accessibility.getFullAXTree
Runtime.evaluate
CSS.getComputedStyleForNode
Page.getLayoutMetrics
```

## 6.4 Recommended actions

After screenshot:

```text
screenshot
dom_snapshot
query
inspect
computed_style
evaluate
requests
performance
```

Implement incrementally.

### `query`

```json
{
  "action": "query",
  "targetId": "...",
  "selector": "#save"
}
```

Return matching elements and node IDs.

### `inspect`

Given `nodeId` return:

```text
tag/id/classes
attributes
text
role
bounds
visibility
selected relevant computed styles
```

### `computed_style`

Allow a selected set of properties rather than dumping hundreds by default:

```json
{
  "action": "computed_style",
  "nodeId": 123,
  "properties": [
    "display",
    "position",
    "width",
    "height",
    "margin",
    "padding",
    "font-size",
    "color",
    "background-color"
  ]
}
```

### `evaluate`

Useful for localhost development diagnostics, but keep scope aligned with the dedicated localhost debug profile.

Return JSON-serializable bounded results only.

## 6.5 Browser scope

Current product source-of-truth allows browser diagnostics only for localhost/loopback targets and forbids ChatGPT/session automation.

This phase should keep that boundary unless the owner explicitly changes it later.

Browser DOM inspection + screenshot of localhost development pages is compatible with the current diagnostic direction.

Do not automatically expand this phase into arbitrary internet browser automation.

## 6.6 Visual web development loop

Target workflow:

```text
process.start Vite
→ process wait_for_port later
→ browser.targets
→ browser.screenshot
→ ChatGPT Vision notices UI problem
→ browser.query / inspect / computed_style
→ files.apply_patch CSS/React
→ browser.reload
→ browser.screenshot
→ compare visually
```

This is one of the highest-value workflows for Qnector development itself.

## 6.7 CDP command helper refactor

Current `browser-tool.ts` has command/event logic centered around `sendCdpCommand` and event collection.

Before adding many browser actions, refactor the command helper so it can return the CDP command result payload rather than only `Promise<void>`.

Concept:

```ts
async function sendCdpCommand<T>(
  target: BrowserTarget,
  method: string,
  params?: Record<string, unknown>,
): Promise<T>;
```

This will make screenshot / DOM / CSS APIs much cleaner.

Consider a small reusable `CdpClient` class only if it reduces duplication; do not over-engineer before screenshot/query are working.

## 6.8 Files likely to change

```text
packages/tools/src/browser-tool.ts
packages/tools/src/tools.test.ts
packages/mcp-server/src/server.ts
packages/shared/src/types.ts             only if attachment/result type additions are needed
packages/core/src/platform-services.ts  only if image resizing reuse requires it
docs/tool-reference.md
README.md
```

## 6.9 Tests

Use mocked CDP WebSocket responses plus a local fixture page.

At minimum:

- screenshot returns a valid MCP image attachment
- screenshot base64 is absent from structured text result
- target selection still rejects external page targets
- DOM snapshot result is bounded
- query returns expected fixture button
- inspect returns attributes/text/bounds
- computed style returns requested properties
- missing node returns clear error
- target disappears during call
- CDP command error is surfaced cleanly
- max payload limits respected

Manual acceptance:

- start local fixture / Vite page
- screenshot visible in ChatGPT
- ChatGPT can identify visible UI
- query the same UI element structurally
- change CSS
- reload
- screenshot confirms change

---

# 7. HOW THE FOUR CAPABILITIES WORK TOGETHER

The real value is not each feature alone. They form complementary perception layers.

```text
                      ChatGPT
                         │
                         ▼
                      Qnector
                         │
        ┌────────────────┼─────────────────┐
        │                │                 │
        ▼                ▼                 ▼
  Code Intelligence  Windows Search   Visual / UI State
        │                │             /             \
        │                │            /               \
        ▼                ▼           ▼                 ▼
  TypeScript/LSP      Everything   Windows UIA       Browser CDP
```

### Code question

```text
workspace.references
→ files.read
→ files.apply_patch
→ workspace.diagnostics
→ tests
```

### Find something on the PC

```text
system.search_files (Everything)
→ files.read / files.preview
```

### Desktop app workflow

```text
computer.find
→ computer.invoke/set_value
→ system.screen_capture
→ ChatGPT Vision verify
```

### Web UI workflow

```text
browser.screenshot
→ browser.query/inspect
→ code intelligence
→ files edit
→ browser.reload
→ screenshot verify
```

Together these features let ChatGPT answer four different questions reliably:

```text
WHERE is it?       → Everything Search
WHAT code is it?   → LSP / Code Intelligence
WHAT is on screen? → Screenshot / Vision
WHAT control is it?→ UI Automation / DOM
```

---

# 8. IMPLEMENTATION ORDER

Do not implement all four in one giant change.

Recommended sequence:

## Phase 1A — TypeScript diagnostics

Implement only:

```text
workspace.diagnostics
```

Validate and package if necessary.

## Phase 1B — Symbol intelligence

Add:

```text
document_symbols
definition
references
hover
rename_locations
```

## Phase 2 — Everything Search

Implement provider abstraction + `system.search_files`.

Use Everything CLI if available and bounded fallback otherwise.

## Phase 3A — Windows UIA read path

After reconciling `devq.md`, implement:

```text
computer.windows
computer.inspect
computer.find
```

Do not write/click yet.

## Phase 3B — Windows UIA actions

Add:

```text
invoke
set_value
focus
select
wait
```

Validate against real desktop applications.

## Phase 4A — Browser screenshot

Implement `browser.screenshot` first because the MCP image pipeline is already proven.

## Phase 4B — Browser structural inspection

Add:

```text
dom_snapshot
query
inspect
computed_style
```

## Phase 4C — Advanced browser diagnostics

Only after the previous phases are reliable:

```text
evaluate
requests
performance
```

---

# 9. DO NOT LOSE THESE ENGINEERING RULES

1. Read `devq.md` before code changes.
2. Preserve headless MCP usage; core/tools must not depend directly on Electron.
3. Keep grouped MCP tools coherent and few.
4. Prefer structured results over raw command text.
5. All large output must be bounded / paginated.
6. Reuse the existing `ToolAttachment` image path.
7. Keep source path / line / column 1-based when presenting code locations to ChatGPT.
8. Do not rebuild existing features just because an older roadmap says they are missing.
9. Every feature needs real tests, not only mocked success paths.
10. Validate at least one real-world workflow manually when OS/UI behavior is involved.
11. Update docs and implementation status when a phase finishes.
12. The repository snapshot currently may not have a usable Git history; do not assume Git can restore changes. Read before edit and keep the existing `stable` backup intact.
13. Do not silently violate current source-of-truth. Windows UI Automation specifically requires an explicit `devq.md` scope update first.
14. Browser work remains localhost/dedicated development diagnostics unless the owner explicitly expands that scope later.
15. Do not depend on an OpenAI model API inside Qnector. ChatGPT remains the reasoning layer.

---

# 10. VALIDATION COMMANDS

After each source change:

```powershell
npx pnpm@10.15.0 typecheck
npx pnpm@10.15.0 test
npx pnpm@10.15.0 lint
npx pnpm@10.15.0 format:check
npx pnpm@10.15.0 build
```

When MCP behavior changes, also run relevant smoke/integration tests.

When Electron/native/package code changes:

```powershell
npx pnpm@10.15.0 package:windows
```

Because an already-running portable build may lock `apps\desktop\release`, the packaging script can create a timestamped:

```text
apps\desktop\release\retry-YYYYMMDD-HHMMSS\
```

Always report the exact new portable path and verify that the packaged `app.asar` contains the new implementation before asking the owner to restart Qnector.

---

# 11. MEMORY HANDOFF CHECKPOINT FOR THE NEXT SESSION

The original capability roadmap, P1–P10 expansion, and **Automatic First-Use Memory Bootstrap** are now implemented. A fresh Qnector MCP connection should receive `QNECTOR SESSION BOOTSTRAP` automatically from the active workspace memory during legacy/compatibility `initialize` or modern 2026-07-28 `server/discover`, before normal tool work begins.

Suggested bootstrap behavior:

```text
Connect to Qnector.
→ Read QNECTOR SESSION BOOTSTRAP from server instructions automatically.
→ Verify active workspace with workspace.summary.
→ Read recommend.md/devq.md when continuing development.
→ Call memory.recall only when more history is needed.
→ Continue unfinished work; never rebuild completed roadmap items without a new reason.
```

Expected recovered development state:

```text
Project:
C:\Users\QUEEN\qnector

Stable baseline backup:
C:\Users\QUEEN\stable

Pre-change rollback backup:
C:\Users\QUEEN\qnector-backups\auto-memory-bootstrap-20260829-213343

Latest tested portable:
apps\desktop\release\retry-20260829-224101\Qnector-0.1.0-win-x64-portable.exe

Completed:
1. TypeScript Code Intelligence / generic LSP
2. Everything indexed search + bounded fallback
3. Semantic Windows UI Automation (`computer` grouped tool)
4. Browser screenshot + DOM/CSS/advanced diagnostics
5. P1–P10 capability expansion
6. Automatic First-Use Memory Bootstrap through MCP server instructions

Validation:
41/41 automated tests
full typecheck/lint/format/build PASS
MCP smoke PASS with 8 grouped tools
P1–P10 real acceptance PASS
legacy initialize bootstrap PASS
modern 2026-07-28 server/discover + client.getInstructions() bootstrap PASS
packaged app.asar contains session-bootstrap.js and integration markers
MCP server/node 2.0.0 present; legacy SDK absent
```

If a future fresh MCP connection does not receive the automatic bootstrap, treat it as compatibility evidence and identify whether the client reused an existing MCP connection, the active workspace differs, the workspace memory is empty, or the connected portable is older than `retry-20260829-224101`. MCP currently exposes no ChatGPT chat ID, so Qnector cannot distinguish multiple chats that deliberately reuse the same underlying MCP connection.

---

# 12. P11–P18 SECOND CAPABILITY EXPANSION — IMPLEMENTED 30 AUGUST 2026

The owner requested every proposed second-wave capability except P13. **P13 legacy UI/OCR expansion is intentionally skipped.** The grouped MCP contract remains exactly 8 tools.

Implemented in source and covered by the permanent real acceptance harness `npx pnpm@10.15.0 accept:p11-p18`:

1. **P11 Context Snapshot** — `system.context_snapshot` returns bounded build/release/workspace/memory/process/window/recent-activity state in one call.
2. **P12 Native Process Intelligence** — `system.processes`, `find_process`, `process_info`, and `ports` expose structured native process/executable/version/resource/TCP context.
3. **P14 Persistent Workflow Engine** — `process.workflow_*` persists definitions under `.qnector/workflows` and run state under `.qnector/workflow-runs`, with command/wait/delay steps and resume from the first unfinished step.
4. **P15 Document Intelligence** — `files.inspect`, `extract_text`, `render`, and `document_query` support PDF, DOCX, XLS/XLSX, CSV/text, JSON, ZIP and SQLite; real PDF page rendering returns MCP image attachments.
5. **P16 Automatic Working Memory** — `memory.working_set` deterministically composes recent files/commands/errors/processes/workflows from activity + memory, and MCP session bootstrap now includes bounded recent non-memory activity.
6. **P17 Release / Build Manager** — `system.release_status` compares the running executable, newest local package and source mtimes and reports `latest`, `outdated`, `source-newer`, `development`, or `unknown`.
7. **P18 Desktop Runtime Observability** — the Electron UI has a Runtime drawer showing release identity, doctor checks, active process context and recent workflow runs via typed generic tool IPC.

Real acceptance completed during implementation against the local machine and generated fixtures: native Node process discovery succeeded, 6 matching Node processes were searchable, all document formats passed, SQLite returned 2 fixture rows, PDF text extraction succeeded and rendered a real 900×1273 image attachment, the two-step workflow completed/persisted as `succeeded`, working-set capture surfaced recent files/commands/workflow history, and all four new doctor capability checks passed.

Release packaging/QC results and the final artifact identity are recorded below after the full release gate is complete.

---

# 13. P19 BROWSER WEB-APP AUTOMATION — IMPLEMENTED 30 AUGUST 2026

The owner explicitly expanded Qnector Browser from localhost diagnostics into browser control for web-application development. This supersedes older roadmap wording that said arbitrary web page targets were not allowed. The **8 grouped MCP tools remain unchanged**; P19 is entirely inside `browser`.

Implemented and covered by `npx pnpm@10.15.0 accept:browser`:

1. **Normal web navigation** — page targets may use normal HTTP/HTTPS URLs while the Chrome/Edge CDP endpoint stays loopback-only.
2. **Playwright Core over existing CDP** — `playwright-core` connects to the Qnector-managed Chrome/Edge process; no second Chromium binary is bundled.
3. **Semantic locators** — CSS selector, text, role + accessible name, label, placeholder and test ID, with index/exact selection.
4. **Interaction actions** — `click`, `dblclick`, `hover`, `focus`, `fill`, `type`, `press`, `select`, `check`, `uncheck`, `scroll`, `get_text`, `get_value`, `get_attributes`, `wait`, `upload_file`.
5. **Navigation/tab actions** — `tabs`, `navigate`, `back`, `forward`, `new_tab`, `activate_tab`, `close_tab`, plus `open_url` and backward-compatible `open_local`.
6. **Interaction observability** — bounded `observeMs` captures console/page errors and HTTP response/request-failure summaries that occur during submit/click/navigation actions.
7. **Persistent development profiles** — `profile` + `persistentProfile: true` keeps web-app login state across `close`/`restart`; `profile_reset` removes the named profile with Windows file-lock retry handling.
8. **Diagnostics preserved** — screenshot, bounded DOM/CSS inspection, read-only evaluate, requests, console/network errors and performance remain available.

Real Chrome acceptance passed the full web fixture flow: find → fill/type/select/check/upload/press → click → observed HTTP 200 + console event → wait/read state → navigate/back/forward → new/activate/close tab → normal external HTTPS target. Persistent profile survival and reset also passed.

A fresh ChatGPT MCP handshake is required after installing the P19 portable so the client re-discovers the enlarged `browser` action schema. An existing chat may continue showing an older cached schema until the Qnector connection is re-established.

---

# 14. NEXT OPTIONAL FOLLOW-UP WORK

P1–P12, P14–P19 and Automatic First-Use Memory Bootstrap are complete in source and real local acceptance (P13 intentionally skipped). Do **not** reopen them as missing features. Remaining product-level follow-ups are:

1. validate `computer` against the owner's real iTEC stock/business desktop application and document framework-specific UIA gaps
2. complete the real ChatGPT Plus Phase 0 compatibility record if it has not yet been verified through the current ChatGPT product UI
3. benchmark the deterministic semantic engine on larger real workspaces before considering any optional embedding/vector-database replacement
4. add more generic LSP adapters only when the owner actually needs another language/server
5. evolve the desktop UI/observability around the new capabilities without changing the 8-tool grouped contract unnecessarily

For every future follow-up, preserve stable/final backups and run full QC plus real acceptance/package verification after release-affecting changes.

---

# 15. FINAL TARGET

The intended Qnector experience after these upgrades is:

```text
User asks a natural-language task
            │
            ▼
         ChatGPT
  reasoning / planning
            │
            ▼
         Qnector
            │
  ┌─────────┼───────────────┬─────────────────┐
  │         │               │                 │
  ▼         ▼               ▼                 ▼
 Files   Code/LSP       Windows Search      UI State
  │         │               │              /      \
  │         │               │             /        \
  ▼         ▼               ▼            ▼          ▼
Edit/run Understand      Everything      UIA      Browser DOM
                                         │          │
                                         └────┬─────┘
                                              ▼
                                      Screenshot/Vision
                                              │
                                              ▼
                                           Verify
```

Qnector should become the execution + perception + interaction layer for ChatGPT on Windows, while ChatGPT remains the reasoning layer.

---

# 16. MEMORY CONTINUITY QUALITY UPGRADE — IMPLEMENTED 1 SEPTEMBER 2026

The active Qnector source now includes a deterministic Memory quality upgrade without changing the 8 grouped MCP tools or the persisted MemoryState v1 schema:

1. `memory.recall` accepts optional `query` and ranks matching facts by key/tag/value relevance with rule/decision priority.
2. Fact identity is normalized case-insensitively with collapsed whitespace; repeated keys update the existing fact instead of creating near-duplicates, and tags are deduplicated.
3. Active checkpoint steps are trimmed/deduplicated; a step already completed is removed from pending, and an unlabeled checkpoint identical to the latest checkpoint is not stored again.
4. `memory.working_set` accepts optional `query` and now returns `relevantFacts`, `latestCheckpoint`, and a deterministic `resumeHint` in addition to recent files/commands/errors/process/workflow context.
5. Automatic MCP session bootstrap budget is 6 KB, emits `Resume next`, gives Critical Context more room, and preserves a balanced set of rule/decision facts plus recent facts.
6. Memory desktop UI shows total fact count, latest update time, and pending steps before completed history.
7. Desktop default/minimum window size is locked to `451×978`, measured from the owner's known-good current window at 96 DPI, to prevent drawer/menu layout from entering the previously problematic compressed state.

Validation after this upgrade: full TypeScript/lint/Prettier/build QC passes, all automated tests pass, P11–P18 real acceptance passes, and an Electron Windows sizing harness confirms a requested `300×500` resize is clamped to `451×978`.

---

# 17. P24/P25/P26/P28 RELIABILITY + PERFORMANCE UPGRADE — IMPLEMENTED 4 SEPTEMBER 2026

Target release: `v0.4.6`.

1. **P24 Auto Reconnect + Transport Watchdog** — non-local transports are wrapped by `ResilientTransportAdapter`. Unexpected bridge exits and transient startup failures reconnect with bounded backoff (`1s → 2s → 5s → 10s → 30s`), while explicit Disconnect cancels retries. Permanent configuration failures such as missing API keys, missing executables, or permission errors remain actionable errors instead of reconnect loops.
2. **P25 Persistent PowerShell + Smart Command Router** — synchronous PowerShell `process.run` calls reuse a persistent worker on Windows, reset automatically after timeout/protocol failure, and fall back to isolated one-shot PowerShell for unsafe/unsupported cases. Common native executables and npm/pnpm/corepack command shims bypass PowerShell startup. Latest local performance acceptance measured warm PowerShell at single-digit milliseconds after the cold host startup.
3. **P26 Updater/Release Pipeline v2** — `DesktopUpdater` has injectable release/fetch/user-data dependencies for integration testing. A real local HTTP E2E test covers `check → Range resume → exact byte count → SHA-256 verify → promote .part to final`. GitHub publishing now uses resilient `curl.exe` uploads with retry/timeout behavior and exact remote asset size/state verification. `pnpm release:verify` verifies both Windows assets without modifying a release.
4. **P28 Transport Integration Tests** — direct OpenAI tunnel tests cover cold profile validation, validation-cache reuse, stale-cache invalidation and full recovery; resilient transport tests cover crash reconnect, escalating backoff, explicit disconnect, and permanent-error suppression.

Release-affecting validation must keep `test`, `typecheck`, `lint`, `format:check`, `build`, capability acceptance, performance acceptance, Windows packaging, and `release:verify` green.

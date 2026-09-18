# QNECTOR next-release hardening — implementation and release gate

Scope: preserve the existing shared Workspace model; do not restart a running QNECTOR, install a build, publish a release, or modify unrelated user files as part of development.

## Implemented in source

- Existing workflow engine now accepts an optional caller-owned `idempotencyKey` through `process.workflow_start`, `process.workflow_run`, and `process.workflow_document_batch`. The same workspace/key/definition returns the same `runId`, including after a completed run is reloaded. A different definition with the same key is rejected. Concurrent calls in one runtime share a startup promise. Callers must use a stable key for retries and inspect `workflow_status` / `workflow_result` before attempting `workflow_resume`. This is *not* a guarantee that legacy workflows continue when the desktop process exits; only daemon-owned `tasks` have that property. Do not replay interrupted side effects without explicit confirmation.
- Activity records carry an explicitly correlated memory `taskId` and workflow `runId` where available, alongside existing Skill routing evidence. UI shows Task → Tool → Skill. Unrelated task calls are not merged. Missing routing evidence remains `ROUTE UNVERIFIED`, not proof of a missing routing call.
- Durable Jobs now requests the daemon `doctor` response alongside its read-only list, exposing local daemon health and Job Host availability in the existing panel. Reading diagnostics never starts/cancels work. Daemon health does not establish ChatGPT Web or tunnel health.
- `system.context_snapshot` supports `profile=minimal|coding|full`. Minimal omits process and recent activity lists, caps recall; coding preserves existing compact behavior; full enables expanded information. Historical `details=true` still works. Profiles do NOT hide actual MCP tools, change permissions, or claim that the model received fewer tool schemas; tool-list filtering requires explicit compatibility testing and stable task visibility.

## Computer Use feasibility / safe experiment (not enabled)

- Current `computer` tool uses Windows UI Automation against the user's interactive desktop. `windows`, `find`, `inspect` and `wait` are observational; `focus` explicitly changes focus, while `invoke`/`set_value` may indirectly focus or activate another window. There is no separate desktop/window-station isolation and no safe guarantee that actions won't interrupt gameplay.
- Do not turn on a headless/isolated desktop mode without proving UI Automation helper and managed browser handle the alternate desktop and Window Station, credential/session separation, DPI and accelerator support, cancellation, and an emergency exit in a disposable VM. The existing browser CDP route may provide background DOM operations for cooperative pages, but is not desktop isolation or a general replacement for Nexus downloads.
- Proposed future acceptance test: dedicated VM user session, controlled target application, assert the foreground window PID and cursor position on the *primary* desktop never change before/during/after read actions and mutations, verify clean rollback on timeouts. Do not run that test against the user's current desktop without explicit agreement.

## Icon verification

- Prior v0.4.41 EXE icon extracted by Windows differs from the repository's gold `icon.ico` (confirmed by pixel hashes). A source-only config test was insufficient. The next candidate must verify the icon inside the packaged executable and the physical `resources/qnector-icon.ico` against the intended artwork; no further claim that the installed Taskbar is fixed until a new build is installed and visually verified. Do not restart Explorer to mask embedded-icon defects.

## Release gate

Run typecheck, lint, the workflow idempotency/concurrency and Activity tests, the Windows daemon Cancel/Recovery suite, Windows packaging with its packaged runtime smoke tests, and inspect the unpacked EXE's icon and physical Resources. Re-test on a disposable candidate before any release; user is currently running v0.4.41. Release version is not bumped and no GitHub release is created by this document.

## Verification result (2026-09-19)

- Source ICO changed to the verified BMP-backed candidate. A disposable portable build succeeded; extracted EXE and packaged physical ICO had identical 32px pixel hashes. Installed Taskbar remains unverified until a future install/restart approved by user.
- Full typecheck and lint succeeded. Full Vitest run: 317 passed, 1 failed in apps/daemon/src/cancel.test.ts (canceling after coordinator shutdown, missing manifest). Four isolated repeats: three passed and one failed with same timeout. This proves a reproducible intermittent blocking defect; do NOT release or claim full regression pass until fixed and rerun.
- Isolated Windows desktop/headless computer experiment not enabled; no workspace-per-session added.

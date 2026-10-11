# Plan/Act Live Panel — UX QC (2026-10-10)

## User problem / expected experience
Observed: ChatGPT rendered the Qnector LIVE MCP panel above a lengthy assistant explanation. The plan continued changing after the panel was displayed. Desired: complete reasoning and research first; then present one self-contained, concise, interactive plan without a second essay.

## Root cause and host boundary
- The previous Qnector instructions told the assistant to call `plan_panel` immediately after `mode.begin`, before inspecting and refining the plan. This encouraged early widget rendering.
- ChatGPT controls inline app placement. According to OpenAI's UI guidance, inline apps appear above the generated model response by design. Qnector cannot move a widget below the response: https://developers.openai.com/plugins/concepts/ui-guidelines
- The new Qnector instructions therefore require an early read-only `mode.begin`, complete inspection and `mode.update` / `mode.get`, then `plan_panel` exactly once as the **last presentation tool**. The short text after a widget should never duplicate its plan.
- Model compliance with the call-order instructions is guidance, **not a transport-level guarantee**; the live ChatGPT app must be retested after installation and connector tool refresh.

## Implemented UX changes
- Plan panel resource v3: `ui://qnector/plan-act-v3.html`, with compatibility resource for v2.
- A compact inline card by default: 280-character summary preview; next 3 unfinished steps; expand/collapse summary and entire checklist only when requested.
- Explicit revision number and `mode_approve(expectedRevision)` primary call to action, real state refresh, progress indicator, and real `mode.step` updates.
- Persisted expand/collapse widget state; resetting when the revision changes.
- Accessible mode-switch button group with `aria-pressed` (not misclassified as content tabs), focus outlines, explicit labels, live status region, and reduced-motion compatibility.
- The MCP `plan_panel` description and tool result text designate the panel as a final, self-contained presentation surface; data tools do not attach a duplicate iframe.
- Qnector session bootstrap and `mode` descriptions reinforce final-only rendering, without exceeding the 3 KB bootstrap budget.
- New `accept:plan-ux` Electron acceptance harness; added to `package:windows` release gating.

## Verified automated UX acceptance
- Tested at 435px and 700px width in Electron with simulated ChatGPT MCP host methods.
- 435px: collapsed card 686px high; 700px: 580px high; neither overflows horizontally.
- Default shows 3 of 10 pending steps and 281 characters including an ellipsis.
- Expanding shows the full summary and all 10 steps; `aria-expanded` and widget state persist.
- Clicking approval performs a real `mode_approve` call containing the expected revision and memoryTaskId; new tool response drives Act Mode.
- In Act Mode, completing a step updates progress from 0/10 to 1/10 and displays the next 3 pending steps.
- Continue sends a correctly scoped follow-up message.
- Screenshots: `apps/desktop/release/qc-plan-panel-ux/plan-panel-435.png`, `plan-panel-700.png`, `plan-panel-act-435.png`, `plan-panel-act-700.png`.

## Verified release checks
- `pnpm typecheck`, `pnpm lint`, `pnpm security:audit` and `pnpm smoke:mcp` pass.
- Full suite: **365 of 365 tests passed across 78 test files**.
- `pnpm accept:plan-ux` passed in real Electron at 435px and 700px, including simulated host approval, Act checklist updates, accessibility controls and screenshots.
- `pnpm package:windows` succeeded, including the new Plan Panel UX release gate, durable recovery and packaged stdio checks.
- Additional **packaged** MCP runtime smoke passed both `PACKAGED_PLAN_PANEL_UX_PASSED` (resource `ui://qnector/plan-act-v3.html` read from app.asar) and `PACKAGED_STDIO_PARITY_PASSED`.
- Candidate: `apps/desktop/release/durable-candidate-20261010-183454`.
- Setup: `Qnector-0.4.52-win-x64-setup.exe`, SHA256 `9149E23B861F1B362674776DEBFFC8303E5869F7BCA25ED921A6F57C965699A6`.
- Portable: `Qnector-0.4.52-win-x64-portable.exe`, SHA256 `A4644A3877DEDB032FB1D785DFEB89D9084530E122D1916F64D2EFD7F507CE1E`.

## Remaining live-host validation
- Must verify the v3 panel **in real ChatGPT**, including tool rescan, host styling, mode approval confirmation and response length after the widget.
- Cannot guarantee that ChatGPT will obey the suggested presentation order or move inline UI below the assistant message. The host owns positioning; enforce the UX through short response guidance and panel-contained detail.
- No changes were installed over the running Qnector bridge. No GitHub release, automatic upgrade, commit, or push was performed. The candidate was built from an uncommitted working tree (`dirtyTree=true`).

## QC priority
Treat UX as a release-blocking concern, not optional visual polish. Never mark this issue fully complete from unit tests alone while real ChatGPT widget placement and model behavior remain unverified.


## Local deployment verification — 2026-10-10 22:11 ICT

- Candidate installed in C:\Program Files\Qnector using an independent Windows Scheduled Task with a preflight-verified signed installer and a self-rollback script. Scheduled Task removed after success; local backups retained.
- Running packaged identity: QNECTOR 0.4.52, buildId 20261010-220848-1FE2AE8E8E. Installed Qnector.exe SHA256: 1FE2AE8E8E652F5569D8A9B6D02E7524F45975595A819BEA445A38DD6B04777F.
- Final installer: apps/desktop/release/durable-candidate-20261010-220739/Qnector-0.4.52-win-x64-setup.exe, SHA256 1E5260A3D3392CB2405F60383330CBF06F13F1A919C137C07C133DC3D17E17F4.
- Final portable: same directory/Qnector-0.4.52-win-x64-portable.exe, SHA256 5CD65D7297279A71ED41D8035483C2D97A424F932812CA0FFEDD9430A1DFC18D.
- New packaged TypeScript release gate **PACKAGED_TYPESCRIPT_DIAGNOSTICS_PASSED**; this gate correctly failed against the previous installed build before the fix. Root cause was a missing TypeScript CompilerHost.getDefaultLibLocation override in Electron's app.asar runtime.
- Through the reconnected QNECTOR ChatGPT connector, workspace.diagnostics returns 0 problems across the entire repo (10 project tsconfig entries), compared with 6,224 false built-in type errors before the fix. Specific packages/core/src/plan-act-store.ts returns 0, compared with 53 before.
- The structured QNECTOR Git tool works without a system-wide PATH change.
- The live MCP localhost endpoint advertises plan_panel with resourceUri and openai/outputTemplate both ui://qnector/plan-act-v3.html. resources/read returns the compact v3 HTML with summaryToggle, stepsToggle and approve controls.
- Existing QNECTOR config SHA256 matched its protected backup. localPort 8787, openai-tunnel mode, startAtLogin=true, setupCompleted=true. Reconnected bridge is responding; 5 Qnector processes observed.
- Full regression 365/365 passed; production dependency security audit: 0 known vulnerabilities.
- Current Plan revision 2 remains approved, and the Code Intelligence phase has been checked off after verified runtime results.

### Scope boundaries still open
- ChatGPT controls how it places inline MCP Apps in the message. The backend and connector were verified, but automated inspection of the actual rendered ChatGPT application UI or resetting the ChatGPT tool snapshot is not available through the QNECTOR connector.
- The existing 378-file Prettier drift remains out of scope. User session continuity/reconnect 8-case matrix, prolonged p95 runtime profiling and any public GitHub release remain separate pending work. No commits/pushes/releases were performed.
- Source worktree is intentionally uncommitted; the packaged provenance marks dirtyTree=true. Build hashes above identify the exact installed artifacts.

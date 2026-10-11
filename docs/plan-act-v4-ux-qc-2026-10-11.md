# QNECTOR Plan/Act v4 — Safe Mode Transition Fix (2026-10-11)

## User-visible defects verified in v3
1. The Plan tab in Act Mode directly invoked `mode.back_to_plan`, revoking plan approval with a single tab click. The separate Back to Plan button was redundant.
2. Plan editing reset `done=false` on every checklist item even when changing only the summary, and could attach stale completion status to the wrong step on list reordering.
3. UI step updates sent only an index and checkbox value. A stale iframe could update a different step after plan revision/reorder.
4. Back-to-Plan tool calls did not supply the revision and approval instance to guard against stale state.

## Changes implemented in source
- New versioned MCP Apps URI `ui://qnector/plan-act-v4.html` with v2 + v3 aliases serving the latest HTML to cached ChatGPT tool snapshots.
- The Plan tab, like the Act tab, is navigation only: Plan focuses the Back to Plan button; Act focuses the revision approval CTA.
- Explicit revocation confirmation group with warning, Confirm/Cancel buttons and Escape handling. Existing background tasks continue according to normal Plan Mode policy.
- Plan checklist updates now match previous items by exact text (FIFO for duplicates) and preserve stable step IDs and `done` state through summary edits, insertions and reordering. Newly modified steps start unchecked. A new revision always invalidates approval.
- The server accepts optional `expectedRevision`, `expectedStepId`, and `expectedApprovedAt` for `mode.step`/`mode.back_to_plan`. The v4 widget always provides them and stale edits/revocation reject with a mismatch instead of mutating current state. Optional fields retain compatibility for existing non-widget automation.
- `mode_approve` remains a separate revision-checked, host-reviewable action.

## Tests before Windows packaging
- `pnpm typecheck`: pass
- `pnpm lint`: pass
- `pnpm test`: 78 test files, **367 tests passed** (previous build 365)
- `pnpm security:audit`: no known vulnerabilities
- `pnpm smoke:mcp`: pass
- Focused Plan/Act suite: 4 test files, 14 tests passed before the additional progress-preservation test
- Electron `pnpm accept:plan-ux`: passed at 435x900, 451x978 and 700x900, including tab click without approval/revocation, explicit approval, cancel and Escape in revocation confirmation, confirmed revocation, stable checklist, no horizontal overflow.
- UX confirmation screenshot: `apps/desktop/release/qc-plan-panel-ux/plan-revoke-confirm-451.png`.

## Deployment / End-to-End Status
Update this section with exact final signed installer and installed build hashes after deployment. Do not claim real ChatGPT host / tunnel 8-case matrix has passed until tested across the entire transport.

## Verified Windows deployment — 2026-10-11 09:28 ICT
- Installed QNECTOR v0.4.52 buildId `20261011-092632-B349168D66`.
- Signed installer candidate (packaged and gated): `apps/desktop/release/durable-candidate-20261011-092526/Qnector-0.4.52-win-x64-setup.exe`; SHA256 `BF0ECCDC566744CF33376CB8283EE468AC726D5DA46F9A3C04F5323C8931815A`.
- Portable candidate SHA256 `2485FF10FE5D819106F44A0892BB5F9D35CBE3838F6D77F80570EDEA2A4F701C`.
- Installed `C:\Program Files\Qnector\Qnector.exe` SHA256 `B349168D66F7A87B5F9BCF50CD90E4A40CF80E6852716EEA7328E356DA8FD531`.
- Installed `resources\app.asar` SHA256 `872F138D45471071F2091AB3D7738A18219516307B9334C46AE954938C58999E`.
- Installer ran from independent elevated Scheduled Task with auto-rollback. Task confirmed exit 0 and unregistered after success.
- Preserved rollback snapshot at `C:\Users\QUEEN\AppData\Local\Qnector-QC-Backups\20261011-plan-act-v4\installed-previous`; EXE and app.asar backed up with verified identical hashes. Recovery PowerShell script remains beside backup.
- User config exact hash unchanged after install; OpenAI tunnel connected successfully and previous Task Plan Revision 2 remained Act Mode with approval and 7/10 checklist completed.
- Qnector hosted MCP `plan_panel` advertised `ui://qnector/plan-act-v4.html`. Legacy resources v2/v3 and new v4 all served the identical v4 HTML SHA256 `b37ed350b2ba48d1020f0c0d5fb4360f71080355d6d39e3da973fdb90119911d`; each includes explicit safe mode confirmation and optimistic revision/step/approval guards.
- Installed `mode` schema advertises expectedRevision, expectedStepId and expectedApprovedAt.
- Installed workspace diagnostics 0 issues across 10 tsconfig entries; system doctor healthy, durable daemon ready, SQLite integrity ok.
- Startup milestones: renderer ready 318.85 ms; MCP runtime ready 1,122.17 ms; OpenAI tunnel connected 2,733.60 ms.
- Full `pnpm package:windows` gates passed: Durable Bundle Smoke, Durable Packaged Recovery, Packaged Plan Panel UX, Packaged Stdio Parity, and Packaged TypeScript Diagnostics.
- Worktree remains dirty/uncommitted by prior safety constraint. No release/tag/push or destructive Git command.
- **Scope limitation:** Completed UX bug fix and verified its installed code and simulated MCP host. The full live 8-case ChatGPT-through-tunnel timeout matrix, host CSS/keyboard in the real ChatGPT iframe and all native QNECTOR pages remain separate open QC plan stages. Do not mark Phase 4/8/9 complete without those acceptance records.

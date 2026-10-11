# QNECTOR Revision 2 — Native UX & Internal Release QC

Date: 2026-10-11 (Asia/Bangkok)
Task: task_ab388fa7-a981-4d6b-887b-68811e42d5a9
Approved plan revision: 2
QC state after verified updates: **Act Mode, 9 of 10 complete**

## Scope and corrective checklist bookkeeping

- Phase 8 **VERIFIED COMPLETE:** Native Qnector renderer UX, compiled and rendered inside an isolated Electron process with synthetic fixture API (no duplicate Qnector.exe and no live tunnel restart).
- Phase 9 **VERIFIED COMPLETE FOR LOCAL/INTERNAL CANDIDATE:** Full source and packaging gates, hash/provenance, installed app checks, packaged daemon recovery and offline rollback rehearsal; no GitHub release performed.
- Phase 4 **PENDING:** The previously checked box was reverted because the original acceptance criteria include the eight-case real ChatGPT-through-Tunnel matrix, which is not evidenced in the Qnector timeline/docs. Earlier 30/55s wait_for_file calls are **not** equivalent to opt-in system.timeout_probe. Do not present tunnel timeout reliability as fully verified.

## UX changes

- App-wide error toast now uses `role="alert" aria-live="assertive"`.
- Dismiss error button has `type="button" aria-label="Dismiss error"`.
- Added `apps/desktop/src/renderer/error-toast-accessibility.test.ts`.
- Added repeatable, isolated and non-destructive acceptance driver `scripts/accept-native-renderer-qc.cjs` and fixture `scripts/native-renderer-qc-preload.cjs`.
- Added package script `pnpm accept:native-ui` and integrated it into `scripts/package-windows.ps1` alongside the existing Plan/Act widget UX gate.
- Previously installed Plan/Act v4 remains unchanged: explicit approval, explicit revocation confirmation, optimistic revision and step ID checks, preserved checklist on plan edits, and v2/v3 compatibility resources.

## Native renderer acceptance

Compiled Qnector renderer loaded from `apps/desktop/index.html` in actual Electron with synthetic preload. Four viewport configurations:

| Viewport | Workspace | Memory | Skills | Settings | Runtime | Tab trap | Escape | No horizontal overflow | Error state and dismissal |
|---|---|---|---|---|---|---|---|---|---|
| 420x620 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| 435x900 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| 451x978 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| 700x900 | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS | PASS |

- Valid modal labels and aria-modal semantics in all tested sections.
- Settings scrollTop changed to reach the bottom of its scrollable container, including at minimum dimensions.
- Qnector motion disabled with UI setting; Chromium media reduced-motion emulation confirmed at 451x978.
- Synthetic error injected into Runtime doctor refresh, surfaced as assertive alert, dismissed with the named control; renderer remained functional.
- 0 unexpected JavaScript console errors in the isolated renderer.
- Existing Plan/Act Electron acceptance succeeded at 435px, 451px and 700px for explicit mode approval/revocation and checkbox updates.
- Screenshots from hidden/offscreen Qnector native renderer did not reliably depict visual layers; structure and interaction were validated through DOM/renderer execution. This is not an unverified claim about the user’s current visible Windows screen, the ChatGPT host’s actual iframe painting, or a full third-party screen-reader run.
- Machine / user credentials, user files, real app configuration and active tunnel were not touched by this UI harness.

## Source and Windows package gates

- `pnpm typecheck`: PASS
- `pnpm lint`: PASS
- `pnpm test`: **368 of 368 tests across 79 files PASS**
- `pnpm security:audit`: No known vulnerabilities
- `git diff --check`: PASS
- `pnpm build`: PASS
- `pnpm accept:startup`: PASS, renderer first ready ~434 ms vs 3-second gate in an isolated run.
- `pnpm accept:plan-ux`: PASS
- `pnpm accept:native-ui`: PASS
- `pnpm package:windows`: PASS. Packaged smoke gates: durable bundle, packaged restart recovery, Plan Panel UX, stdio parity and bundled TypeScript diagnostics all passed.
- No GitHub tag, push, commit or release performed.

## Final installed Windows build

- Qnector version: `0.4.52`
- Build ID: `20261011-095440-E42392475C`
- Candidate folder: `C:\Users\QUEEN\Projects\Qnector\apps\desktop\release\durable-candidate-20261011-095333`
- Installer: `Qnector-0.4.52-win-x64-setup.exe`, SHA256 `2C2E57277A282B6D8954A04061BD8957CF778031014473832FFBFAAA50A5C698`.
- Portable: `Qnector-0.4.52-win-x64-portable.exe`, SHA256 `A29A6D99FCC8078E6CD55E9E94A271817713887C6DAF4DDA7891390E456CF546`.
- Installed `C:\Program Files\Qnector\Qnector.exe`: SHA256 `E42392475C5BE2A31A5A522365D7C8010BB08FF530610860061868E877BCA26A`.
- Installed `resources\app.asar`: SHA256 `558A521F6542A44B5129528BCC34F18EDCA123F8CAA39219CE41589ECB7A56FA`.
- Authenticode status of both setup/portable and prior installed Qnector: `NotSigned`. Although electron-builder emitted signing steps, no verifiable Authenticode signature was present. **Local/internal candidate only. Do not describe this as signed or publicly releasable.**
- Deployed via independent elevated Windows Scheduled Task with auto-rollback. Task exit code 0, task removed after successful postinstall hash verification.
- User config SHA unchanged; Qnector Plan/Act state persisted; rollback root `C:\Users\QUEEN\AppData\Local\Qnector-QC-Backups\20261011-native-ui-final`. Backup includes installed-before-native-ui, config-original/config.json and config-original/plan-act-state.json.
- Offline rollback dress rehearsal copied the prior installed bundle into a disposable test destination, verified EXE and ASAR SHA, and removed the disposable copy. Production Qnector was not rolled back.
- Installed v4 MCP verified: 13 tools, v4 Plan/Act resource and equivalent compatibility HTML at v2 and v3 URIs, revision/approval stale guards and trace IDs.
- Installed `workspace.diagnostics`: 0 TypeScript issues across 10 tsconfig files.
- Qnector system doctor: healthy (19 checks, three optional warnings: managed browser inactive, no external generic LSP, optional MarkItDown missing).
- Daemon doctor: ready, SQLite integrity ok.
- Actual installed startup milestones: renderer ready 327.28 ms; MCP runtime ready 1,130.06 ms; bridge connected 2,721.13 ms.
- Real ChatGPT host interaction: user’s Continue action reached this conversation and resumed the correct scoped task. This is evidence of the host follow-up action, **not** a substitute for unperformed eight-case timeout measurement.

## Remaining blocker (Phase 4)

Full controlled real tunnel matrix using `system.timeout_probe` in isolated opt-in test route, with timestamps, 30/55/70/95/130/130/130/300-second modes, progress token handling, actual response content types, trace IDs and verified UI outcomes. Preserve live user bridge and do not retry ambiguous side effects. Public signed release remains separate from approved local QA.

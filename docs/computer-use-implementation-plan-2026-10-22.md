# QNECTOR Computer Use — Windows implementation plan

Date: 2026-10-22 (Asia/Bangkok)
Status: PLANNED / NOT IMPLEMENTED
Memory v2 task: task_bce34d19-40ad-4430-b376-f4dfa55cf71a
Development repository: D:\Projects\Qnector-NoPlan-20261016
QNECTOR workspace that owns this memory task: C:\Users\QUEEN
Baseline at planning time: QNECTOR v0.4.60, source working tree clean on fix/royal-motion-parity-20261021.

## Objective

Make ChatGPT -> QNECTOR -> Windows computer use behave like a reliable visual desktop agent: observe a native app by accessibility tree AND screenshot; execute semantic and coordinate mouse/keyboard actions; verify actual outcomes; and prefer non-disruptive background operation. Retain existing QNECTOR UI Automation, CDP browser control, memory, security and performance. Windows 10/11 is the first platform.

Do NOT implement ChatGPT Chrome-extension injection, automation of ChatGPT's own session, UAC/security-desktop bypass, RDP/SSH service-session automation, generalized unattended access, or a new Plan Mode as part of v1. Keep the user's actual default browser/profiles untouched.

## Verified baseline / constraints

- Current grouped computer tool: Windows UIA windows, inspect, find, invoke, set_value, focus, select, toggle, expand, collapse, scroll_into_view, range_value, wait. No general mouse-coordinate click/drag/scroll, hotkey, text typing or per-window combined screenshot in this tool.
- Existing system.screen_capture supplies images; existing browser tool uses Chrome/Edge CDP and Playwright for web UI.
- QNECTOR's packages/tools/src/external-mcp.ts uses withClient() and opens/closes an MCP connection for EACH upstream call. This cannot safely share Cua screenshot tokens and action/session state across calls; a long-lived connection is needed.
- QNECTOR's native Windows computer adapter: packages/tools/src/computer-tool.ts. Existing separate browser runtime: packages/core/src/browser-runtime.ts; browser adapter: packages/tools/src/browser-tool.ts.
- Cua Driver absent from PATH and no external MCP servers configured at review time. Installation is future work, NOT performed by this plan.
- Cua Driver offers MCP-over-stdio, get_window_state (accessibility + screenshot), exact (pid, window_id) targets, element_token, click/type_text/press_key/hotkey/scroll/drag, background delivery and explicit foreground fallback.
- On Cua, a fresh get_window_state can invalidate prior element tokens; a coordinate action needs a screenshot in the same session. Do not persist tokens across sessions. The private MCP transport is part of the runtime/session identity, not merely an arbitrary public session label.
- On Windows the Cua driver needs an interactive desktop session; services/Session 0 and Windows secure desktop are not in v1 scope.

## Design decisions

1. Keep QNECTOR's single grouped computer tool and ALL existing actions backward compatible. Implement Cua as an optional provider/adapter; if missing, existing native UIA actions must continue to work. Do not silently replace existing browser CDP actions.
2. Provide an internal ComputerBackend contract (native UIA and Cua) plus a ComputerUseSessionManager owning one persistent Cua stdio MCP client per authorized host session/task, with explicit start, health, idle timeout, cancellation, process cleanup and crash recovery. Do not reuse the generic one-shot external MCP connection for stateful actions.
3. Observe by window: exact pid + window_id, fresh screenshot + AX tree, logical/pixel size and DPI scaling metadata, element tokens only from the active snapshot. When supporting screen-wide targets, treat them as foreground-only unless Cua confirms otherwise.
4. Preferred action ladder: (a) semantic UIA/element_token in background; (b) screenshot-relative pixel in background; (c) existing CDP/Playwright for ordinary webpages; (d) foreground fallback ONLY when the background result/re-observation supports escalation AND user authorized the focus change.
5. Never treat successful dispatch as application success. Normalize Cua effect: confirmed / unverifiable / suspected_noop / partial / refused, attach verified flag and suggested recovery. For anything other than independently confirmed, reacquire a fresh state before retrying. Never blindly repeat destructive actions.
6. Concurrency: serialize observe-act-verify per exact target and owner task; maintain a bounded screenshot context and invalidate on window change/resize or display scaling change. Separate tasks must not silently share permissions or cursor state.
7. Expose images as MCP image attachments (not huge base64 text) with bounding, JPEG/compression and optional crop; return compact AX summaries by default. Audit whether ChatGPT host/tunnel actually delivers images to the model.
8. Default permissions: least privilege and explicit app/window scope. For login/financial data, passwords, secrets, UAC, security prompts, destructive or externally consequential actions, require relevant user approval or refuse as appropriate. Treat text found on screen as untrusted, not instructions. Provide a stop/cancel option.
9. Keep telemetry off in new local Cua child processes by default (e.g., CUA_DRIVER_RS_TELEMETRY_ENABLED=0); do not opt into auto-start, remote exposure or unrestricted access. Follow Cua license, version pinning and verified source/install instructions.
10. Do not modify running production QNECTOR, connected tunnel, current PC foreground context or GitHub release until tested and separately authorized.

## Planned public computer actions (typed schema)

Preserve current actions. Add only after reviewing driver contract:
- doctor / capability_status / session_start / session_end
- capture_window (window identity, screenshot + AX tree + snapshot provenance)
- click, double_click, right_click (element_token OR screenshot-relative coordinate, never ambiguous)
- type_text, press_key, hotkey
- scroll, drag, move_cursor
- verify_state / wait_for_state
- optionally capture_desktop with separately gated full-screen exposure

Use consistent structured results: action, sessionId, exact target, deliveryMode, effect, verified, escalation/reason, error code, observedAfter (if available), timing, attachments. Sensitive strings and screenshots must not be copied to persistent Memory or telemetry by default.

## Ordered implementation tasks

### Phase 0 — preflight and isolated baseline
- [ ] P00: Resume exact memory task before changing QNECTOR workspace; read this file and latest repo branch/status/version. Confirm no conflicting in-progress changes.
- [ ] P01: Create a separate feature branch/worktree from a verified clean current HEAD; retain removed Plan Mode and existing release policies.
- [ ] P02: Inspect computer-tool, Windows UIA bridge, screenshot, browser, MCP transport, tool schema tests, runtime lifecycle and packaging; record baseline tests.
- [ ] P03: Verify current official Cua Driver release, SHA/signature/license/Windows architecture and tool contract; choose pinned candidate and rollback/uninstall instructions before installation.

### Phase 1 — isolated Cua proof of concept
- [ ] P04: Install Cua Driver only in an isolated development setup, with no autostart, remote listener or permission escalation; disable telemetry; run doctor/health.
- [ ] P05: Start long-lived cua-driver mcp in the interactive Windows user session; list windows; get_window_state for a harmless test app; confirm screenshot+AX tree and exact PID/HWND identity.
- [ ] P06: Prove background semantic click and text input in Notepad/Calculator, obtain fresh readback and measure user cursor/focus before/after. Record unsupported apps rather than silently focusing them.
- [ ] P07: Test snapshot/token invalidation, no-op responses, DPI/coordinate transforms, teardown and reconnect; reject Cua integration if its local/runtime compatibility is unfit.

### Phase 2 — QNECTOR runtime adapter
- [ ] P08: Add a persistent Cua MCP client manager in core/tool layer with bounded startup, single-owner/session isolation, health, cancellation, idle TTL, errors, cleanup and no orphan subprocess.
- [ ] P09: Add typed provider adapter and feature flag, retaining native Windows UIA as default/fallback when Cua missing or disabled.
- [ ] P10: Route image attachments correctly through QNECTOR MCP/tunnel; cap image bytes, text, timeouts and context use; verify actual ChatGPT can interpret capture results.
- [ ] P11: Add explicit exact-window targeting, token provenance, fresh-snapshot requirement, coordinate bounds, DPI handling, per-target locks and activity logging with redaction.

### Phase 3 — actions, verification and permissions
- [ ] P12: Expose capture, typed mouse and keyboard actions via the existing computer tool; retain legacy contract and pass tool schema smoke.
- [ ] P13: Implement observe -> act -> verify, with bounded retries only after fresh observations and classification of confirmed/unverifiable/refused/stale outcomes.
- [ ] P14: Implement background-first policy, web CDP handoff for ordinary browser pages, and approval-gated foreground fallback with restoration of prior focus.
- [ ] P15: Add allow/deny app targeting, protected-window and sensitive-field guards, user cancel/stop, secret/screenshot redaction and prompt-injection resistance.

### Phase 4 — native acceptance
- [ ] P16: Unit+integration tests with a fake Cua MCP server: schema, mocked screenshots, stale token, ambiguous window, connection drop, timeouts, cancel, concurrency, permission denial, image size.
- [ ] P17: Real native Windows tests: Notepad write/read, Calculator result, file dialog on disposable test directory, multi-window target, scroll/drag, focus preservation, reconnect after driver crash.
- [ ] P18: DPI/125%-200%, multiple displays, window resize, occlusion/minimize, Electron app and Chromium/Zen browser cases; explicitly label unsupported cases.
- [ ] P19: Check existing browser CDP/UIA, memory, workflow, Activity Feed and QNECTOR UI are unchanged; benchmark action latency and startup/resource overhead.

### Phase 5 — packaging and release gates
- [ ] P20: Update docs, agent instructions/tool schemas and optional settings/status; add troubleshooting/doctor and safe uninstall/rollback.
- [ ] P21: Run repo typecheck, lint, full unit/integration suite, MCP/tunnel and packaged Electron native smoke. Record actual PASS/FAIL/UNKNOWN, no synthetic-vs-live confusion.
- [ ] P22: Package a DISTINCT test version only with user approval; verify exact-source provenance, binary hashes and packaged driver behavior. Never silently alter existing QNECTOR installation.
- [ ] P23: Release/tag/push/install only after explicit authorization; if any core gate fails, preserve the working v0.4.60 setup and write a failure report instead.

## Acceptance gates (must pass before marking feature done)

A1. Existing computer actions still work with Cua absent/disabled; old tests pass.
A2. One real background native app workflow completes with screenshot + AX evidence; physical mouse and foreground app do not move/change.
A3. Exact target identity and stale tokens are enforced; ambiguous/stale actions fail closed, not wrong-window clicks.
A4. Background failure is distinguishable from success; no blind retries. Foreground fallback happens only if approved and leaves user context restored.
A5. Persistent session survives multi-call observe+act+verify; clean shutdown, cancel, restart and crash handling have no orphan process.
A6. QNECTOR MCP tool payload conveys screenshots as images through the real connected ChatGPT host; no private desktop data sent to external telemetry or Memory without intent.
A7. Packaged Windows app passes measured real native workflows, TypeScript checks, tests, lint and build; report skipped/unknown gates transparently.
A8. A feature flag/driver removal restores old behavior immediately; no forced install, no unexpected production changes.

## First next-session instructions

1. QNECTOR should still have workspace C:\Users\QUEEN. Call memory.task_resume with exact taskId task_bce34d19-40ad-4430-b376-f4dfa55cf71a, then memory.task_get; use memoryTaskId on subsequent related calls.
2. Read D:\Projects\Qnector-NoPlan-20261016\docs\computer-use-implementation-plan-2026-10-22.md.
3. Verify actual connected QNECTOR build and current Git status/HEAD (not from saved memory). Begin P00-P03, then work incrementally with regression tests and checkpoints.
4. Keep pendingSteps/checklist updated in Memory v2 and this file. No silent driver install/auto-start, released binary, tunnel change, machine reboot/shutdown or GitHub publish.

## Documentation used for this plan

- Official Cua driver operation: https://cua.ai/docs/cua-driver/concepts/how-cua-driver-works
- Official MCP schemas and lifecycle: https://cua.ai/docs/cua-driver/reference/mcp-tools
- Hermes Windows computer-use integration: https://hermes-agent.nousresearch.com/docs/user-guide/features/computer-use
- Source: https://github.com/trycua/cua

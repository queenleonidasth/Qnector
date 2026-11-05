# QNECTOR Overseer — Architecture & Implementation Plan
Date: 2026-11-02 (Asia/Bangkok)
Status: DESIGN ONLY / NO IMPLEMENTATION / FEASIBILITY GATED
Target: QNECTOR v0.4.60 on QUEEN-PC (i5-13400F, RTX 4070 12GB, RAM 32GB)
Repository: D:\Projects\Qnector-NoPlan-20261016

## 1. Product goal and role boundary
User sends one instruction to ChatGPT Instant. Instant is the ONLY AI worker that reasons about, modifies, or tests the actual task through QNECTOR MCP. A separate, small AI ("Overseer") does NOT execute QNECTOR tools, edit code, or solve the task; it ONLY receives the result summary/evidence, classifies CONTINUE / DONE / BLOCKED / ROLLOVER / PAUSED, and prepares the next small instruction for Instant. Repeat until acceptance criteria are proven, then notify the user.

Crucial: The intended unattended automation of normal ChatGPT Instant conversations is NOT an officially verified capability. Do not promise it, or add private endpoints, cookie harvesting, hidden ChatGPT APIs, or circumvention of usage limits. ChatGPT subscriptions and API are different execution/billing surfaces.

Context window exhausted != account usage quota exhausted. Session rollover is for genuine context capacity, NEVER quota reset/circumvention.

## 2. Verified baseline and sources
- QNECTOR v0.4.60 and local durable daemon tasks.doctor: ready, journal integrity ok, jobHostEnabled true on 2026-11-02.
- QNECTOR has Memory v2 task_start/task_resume/task_get, stable taskId, durable tasks start/get/wait/result/output/cancel, and SQLite journal. Daemon persistence does NOT extend ChatGPT's reasoning.
- QNECTOR docs/chatgpt-setup.md and AGENTS.md explicitly prohibit automating the ChatGPT session, cookies, or confirmation prompts.
- QNECTOR desktop currently uses Electron; the planned Slint-native QNECTOR rebuild is a separate HOLD effort. Do not silently modify that project.
- Official ChatGPT MCP Apps UI can read its OWN toolOutput and offer ui/message / window.openai.sendFollowUpMessage. It does NOT by itself expose all ChatGPT final assistant messages or guarantee automatic posting without user action. Capability and policy must be verified with the live host.
- Official ChatGPT Workspace Agents API supports programmatic agent triggers but those agents are NOT ordinary ChatGPT Instant chat, and run status is not full response text. Not a replacement for the user's requirement.
- OpenAI terms prohibit automated extraction of Output and circumvention of platform restrictions. Evaluate any integration for authorization first.

Sources:
https://developers.openai.com/plugins/build/chatgpt-ui
https://developers.openai.com/plugins/reference
https://developers.openai.com/workspace-agents/trigger-runs
https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt
https://help.openai.com/en/articles/9275245-chatgpt-free-tier-faq
https://openai.com/policies/terms-of-use/
https://help.openai.com/en/articles/12003714-chatgpt-business-models-and-limits
https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging

## 3. Architecture decision
Deliver QNECTOR Overseer as a SEPARATE, lightweight Windows tray companion, not a fifth QNECTOR bottom navigation tab. It should function even when the Electron QNECTOR window is hidden. Keep QNECTOR's existing bridge, MCP tools, job daemon, memory, and installation untouched until integration tests pass.

Layers:
A. ChatGPT Instant in supported web/desktop client (worker)
B. QNECTOR MCP tool calls made ONLY by Instant (executor)
C. Checkpoint Relay: a small opt-in structured status writer surfaced as a QNECTOR/MCP app capability, writing to a local status queue or existing Memory v2 task checkpoint. Model-generated checkpoint contains state/evidence, but never asserts that a final ChatGPT message was read.
D. Local Event Store: SQLite or existing durable readonly projection; correlation is by Overseer job ID + QNECTOR memoryTaskId + explicit ChatGPT session link/metadata when permitted.
E. Overseer State Machine: deterministic workflow and bounded retries.
F. Supervisor API: OpenAI Responses API, model gpt-6-luna, reasoning.effort=xhigh, strict Structured Outputs. API key provided locally by user (never committed or logged).
G. Chat Transport Adapter: support only documented host-sanctioned UI follow-ups and user-initiated actions. No private endpoint, credential extraction, or chat DOM scraping in the stable product.
H. Notification: Windows toast + tray status, optionally QNECTOR Live Activity integration.

***Gate P0: a documented, authorized ChatGPT Instant follow-up AND ordinary-new-chat mechanism must be demonstrated before promising a fully unattended product.*** Otherwise release a transparent assisted mode and mark Full Auto unavailable.

## 4. Technology stack
- Core scheduler/runtime: Rust, Tokio, robust task state machine; serial single-flight per job; idempotency keys; bounded retries/circuit breaker.
- Local state: SQLite (rusqlite/sqlx) with WAL; event-sourced audit log; encrypted secrets if any (Windows DPAPI); default local-only binding.
- GUI: Slint + Rust (native), dark/gold minimal Cupertino-like, Overpass font if licensing/packaging permits; compact 420x640 window + Windows tray icon. No Electron/WebView in Overseer.
- Supervisor inference: OpenAI Responses API, exact model ID `gpt-6-luna`, `reasoning.effort=xhigh`, `store=false`, strict `text.format=json_schema` (CONTINUE/DONE/BLOCKED/ROLLOVER/PAUSED). No Ollama, llama.cpp or local LLM. API use requires a user-provided OpenAI API key; initial MVP reads only `OPENAI_API_KEY` from local process environment, never source/config/repo. Future DPAPI/Windows Credential Manager UI required before persistent key storage. No API calls without explicit configuration.
- ChatGPT integration: QNECTOR MCP Apps UI bridge; ui/notifications/tool-result, ui/message / sendFollowUpMessage only when supported and authorized. Candidate browser extension for Zen/Firefox must remain OPTIONAL feasibility research, not production default; no hidden cookie/session scraping or automated extraction.
- Native messaging: WebExtension <-> localhost native host only for allowed, user-initiated actions, once privacy/policy gates pass.
- Status report: structured JSON schema; tool evidence pointers, minimal excerpts, no long full chat transcript by default.
- Notifications: native Windows notification API; signed app/tray; allow quiet mode and pause.

Do NOT install Hermes Agent initially. A model-in-the-loop classifier plus a deterministic Rust controller is smaller and more reliable for the narrow role.

## 5. Conversation and execution workflow
1. User specifies task goal, acceptance criteria, max cycles, risk boundaries, workspace.
2. Overseer creates jobId and QNECTOR memoryTaskId (through a user-authorized initialization flow); stores requirements.
3. Instant receives user task and @QNECTOR, implements work, runs checks, writes structured checkpoint with evidence, and replies.
4. Overseer receives a sanctioned checkpoint/tool result (NOT arbitrary ChatGPT final message), validates provenance and removes prompt-injection instructions from logs.
5. Supervisor returns one of: CONTINUE, DONE, BLOCKED, ROLLOVER, PAUSED. A deterministic rules engine overrides invalid AI decisions.
6. If CONTINUE, prepare a short targeted follow-up to Instant; deliver only by an approved ChatGPT host mechanism. If no approved automatic send exists, show the user a one-click Continue button.
7. If DONE, require acceptance criteria/evidence; notify and stop. If BLOCKED, ask for permission or report a true blocker, never retry blind.
8. If ROLLOVER, checkpoint, prepare context handoff, and initiate authorized new-chat flow. If there is no API, provide "Open New Chat" and "Copy Resume Prompt" user actions; never claim automatic new-session creation.
9. If rate-limited, PAUSE and respect platform timing; never create new chats/accounts as a workaround.

Example decision contract:
~~~
{
  "jobId": "job_uuid",
  "taskId": "task_uuid",
  "decision": "CONTINUE",
  "reason": "integration tests still failing",
  "verified": false,
  "missingCriteria": ["tests passing"],
  "nextInstruction": "Continue exact task. Fix failing integration tests and report test evidence.",
  "confidence": 0.84
}
~~~
Output is JSON Schema validated. Missing evidence or ambiguous response => BLOCKED/REVIEW, never auto-DONE.

## 6. Rollover and memory protocol
- One Overseer jobId spans many ChatGPT chat sessions. Maintain sessions[] with order and status. Never rely on ChatGPT chat ID alone; QNECTOR does not reliably provide one in all clients.
- At every meaningful turn, store: goal, acceptance checks, taskId, last verified checkpoint, files/commits changed, failed tests, blockers, next command, policy approvals, idempotency key.
- ChatGPT cannot guarantee exact remaining context capacity. Detect visible host context-full notice where authorized; also let Instant explicitly request ROLLOVER; use proactive estimated budget as heuristic only.
- Handoff prompt stays short (target < 4k characters): explicit @QNECTOR, memory.task_resume using SAME taskId, workspace path, goal, completed/remaining steps, evidence paths, latest checkpoint, instruction NOT to repeat irreversible steps.
- New chat must reselect/mention QNECTOR; ChatGPT plugin selection and confirmation permissions cannot be assumed to carry over.
- Require a fresh readback of latest task state in new chat before modifying files. If context differs, stop for user review.
- Never migrate session because an account-level rate limit has been reached.

## 7. State machine
IDLE -> READY -> WAITING_INSTANT -> EVALUATING -> (CONTINUE_READY -> WAITING_INSTANT)
EVALUATING -> (ROLLOVER_PREPARED -> NEW_CHAT_USER_ACTION -> RESUMING -> WAITING_INSTANT)
EVALUATING -> (DONE_VERIFICATION -> COMPLETED)
Any stage -> BLOCKED, PAUSED, FAILED, CANCELLED.
Single active turn per job, no duplicate dispatch. Max cycles configured (default 30), cooldown on repeated no-progress and network failures. Never retry destructive tool actions. Persist before/after every transition. Distinguish model finished a turn from executor task finished.

## 8. UI specification (Overseer native companion)
Compact primary window ~420x640:
- Header: Overseer glyph, connection state (QNECTOR/ChatGPT host), model status, window controls.
- Current job card: goal, project, criteria progress, current chat/session index, turns, elapsed, "waiting for Instant" vs "reviewing".
- Timeline: ChatGPT turn N -> checkpoint -> Supervisor decision -> next expected step; short expandable logs, timestamp, evidence link.
- Session ribbon: Chat 1 / Chat 2 / Chat 3, active highlighted; rollover provenance and reason.
- Footer fixed controls: Start / Pause / Resume / Stop; "Continue" or "Open New Chat" when user action is necessary.
- Settings drawer: OpenAI API key configured/not configured (never reveal value), GPT-6 Luna xhigh fixed policy, browser/host capability status, API spend caps, retry budget, maximum cycles, approvals, notifications, privacy.
- Visual design: dark graphite and restrained gold accents, Overpass, macOS-like spacing and smooth transitions; no aura, distracting progress effects, or oversized menu.
- App lives in the Windows system tray when window closes; background worker is separate from Slint window. Display honest status "ASSISTED" vs "FULL AUTO VERIFIED" and never masquerade one as the other.

## 9. Safety/privacy/reliability
- QNECTOR remains Instant's tool; Overseer never calls QNECTOR mutating actions.
- Only permitted read-only checkpoint/evidence access from Overseer. No browser cookies, ChatGPT bearer tokens, hidden endpoints, automatic transcript extraction, captcha/MFA/confirmation bypass, or silent prompt injection.
- OS-scoped local secrets/IPC, enforce origin and app-window isolation, audit log redaction, consent controls, remove secret-bearing excerpts before local/cloud model inference.
- Approval-gate external publishing, purchases, deletion, account access, installs, service changes, and other material actions.
- Watchdog handles malformed model JSON, missing checkpoint, stale chat, disconnect, no-progress loops, duplicated events, overnight sleep/reboot; no blind replay.
- A valid DONE requires linked independent evidence and a stable final checkpoint; one optimistic natural-language "done" is insufficient.
- No local model/VRAM allocation. Measure idle RAM/CPU and per-request HTTPS latency; meter OpenAI input/output tokens and enforce user-defined API spending limits before production.

## 10. Implementation phases and acceptance
P0. Feasibility & compliance (HARD BLOCKING):
 [ ] P0.01 Verify official ChatGPT plugin UI: toolOutput received for correct task, UI bridge available in Instant.
 [ ] P0.02 Verify whether user-initiated follow-up via ui/message works in same chat; prove real end-to-end session.
 [ ] P0.03 Determine if host permits *automatic* post-turn follow-up; require clear documented authorization. If not, mark Full Auto unavailable.
 [ ] P0.04 Determine ordinary Instant new-chat creation/selection path; if no official supported auto API, implement handoff via user-initiated New Chat.
 [ ] P0.05 Verify session metadata/ChatGPT app @mention behavior, confirmation prompts and QNECTOR Memory v2 across new chat.
 [ ] P0.06 Document policy, scope, no quota bypass, desktop app limitations, clear user acceptance. Stop feature if unsupported.
Gate: produce supported/unsupported matrix with links and live captures; no full-auto claims without authorized capability.

P1. Core prototype (mock transport only):
 [ ] P1.01 Create isolated Overseer crate/project, mock Chat adapter, typed event/decision schemas, SQLite events and replay.
 [ ] P1.02 Implement controller deterministic rules, idempotency, timeouts/cooldown, stop conditions.
 [ ] P1.03 Unit tests: CONTINUE -> CONTINUE -> DONE; ambiguous -> BLOCKED; retry dedup; no-progress; risk approval.

P2. Read-only QNECTOR handoff:
 [ ] P2.01 Design opt-in QNECTOR checkpoint protocol without changing existing 8 grouped tool behavior.
 [ ] P2.02 Bind jobId, memoryTaskId and readable status/result pointer; privacy-safe metadata.
 [ ] P2.03 Test memory.task_resume from a fresh manual ChatGPT chat; verify no repeated side effects.

P3. OpenAI API Supervisor (GPT-6 Luna xhigh):
 [ ] P3.01 Implement OpenAI Responses API (`gpt-6-luna`, `reasoning.effort=xhigh`, `store=false`) with strict Structured Outputs, explicit `max_output_tokens`, HTTPS timeout and error categorization.
 [ ] P3.02 Enforce strict decision validation, deterministic safety override, redaction, prompt-injection tests and usage metering.
 [ ] P3.03 Add Windows Credential Manager or DPAPI key intake, rotate/remove controls, no plaintext or repo storage; test with user-provided key only with opt-in.

P4. ChatGPT sanctioned adapter:
 [ ] P4.01 MVP user-driven supported UI Continue; do not read unauthorized chat output.
 [ ] P4.02 If P0 authorizes automatic send, test opt-in 3-turn autonomous loop; otherwise do NOT ship auto.
 [ ] P4.03 Test actual ChatGPT desktop vs web separately; unsupported host -> assisted mode.

P5. Session rollover:
 [ ] P5.01 Persist complete handoff capsule and session history with SAME memoryTaskId.
 [ ] P5.02 New-chat user action, reselect QNECTOR, resume, readback; do not assume plugin persists.
 [ ] P5.03 If a documented auto new-chat API becomes available later, add separately after policy review.
 [ ] P5.04 Rate-limit -> pause, not rollover; context-full -> rollover.

P6. Native GUI and notifications:
 [ ] P6.01 Slint compact dashboard + tray + responsive state/timeline and settings.
 [ ] P6.02 Native notifications, quiet mode, pause/stop and crash recovery.
 [ ] P6.03 UX and memory/CPU/GPU benchmarks on real hardware.

P7. Release gates:
 [ ] Packaged Windows native app, signed/reproducible build and rollback.
 [ ] Demonstrate at least 10 supervised checkpoints with no false DONE or duplicated action.
 [ ] Demonstrate rollover from first chat to second without losing task/evidence and without account-limit evasion.
 [ ] Respect app security prompts and interruptions, fail closed.
 [ ] No modifications to live QNECTOR v0.4.60 or held native rebuild until explicit approval.
 [ ] Clear label: ASSISTED / FULL AUTO VERIFIED / UNSUPPORTED.
 [ ] No claims of unattended completion unless P0/P4 verified on the live, authorized host.

## 11. Immediate next action for a future implementation session
Continue from the isolated API-based Assisted prototype in Section 12, while retaining P0 as a hard gate for any automatic ChatGPT follow-up or new-chat feature. Review this plan and verify live QNECTOR build, prototype tests, host bridge/permissions, and actual task state before edits. Do not install drivers, browsers, native agents, publish releases, or alter live QNECTOR without further user instruction. If fully automatic ChatGPT Instant control is unavailable under current host and terms, report the exact blocker and deliver a user-initiated assisted design instead of pretending to solve it.


## 12. Implementation update — 2026-11-02 (API edition)

Requested change: REMOVE local AI. Supervisor uses OpenAI GPT-6 Luna with reasoning.effort="xhigh" through official Responses API. Instant remains the sole actor that calls QNECTOR; Overseer only analyzes explicit checkpoints, chooses a state and stages next message.

Isolated application: D:\Projects\Qnector-Overseer (own Git repository; does not replace running QNECTOR 0.4.60).
- Implemented Rust + Slint native GUI with graphite/gold design, manual Evaluate, opt-in checkpoint file monitor, Copy Follow-up and user-click Open ChatGPT actions.
- Implemented GPT-6 Luna xhigh API request (store=false, strict JSON Schema, bounded output tokens), parsing and refusal/incomplete response guards. Key not yet supplied so NO LIVE API CALL.
- Implemented Windows DPAPI encryption for key entered in local GUI (fallback OPENAI_API_KEY env) without source/SQLite plaintext.
- Implemented SQLite event journal, dedup by job_id and round, safety policies (context ROLLOVER, account rate-limit PAUSE, approvals BLOCKED, evidence required for DONE, limit 30 rounds), compact session handoff.
- Passed cargo test 16/16 on initial API/DPAPI build; cargo build --release succeeded; real EXE produced CONTINUE from mock checkpoint, stored outbox and rejected second invocation as duplicate. Final cargo fmt, cargo clippy --all-targets -- -D warnings and cargo test (16/16) PASSED; updated cargo build --release PASSED. The unsigned native exe is a development candidate only, not a finished Full Auto release.
- Added README, example checkpoint, Instant worker instructions and docs/P0-FEASIBILITY-MATRIX.md.
- STILL NOT IMPLEMENTED: authorized unattended ChatGPT Instant post-turn follow-up, ordinary new-chat creation and session auto-selection, direct reading of final ChatGPT replies, app tray background service, real-key API call, live ChatGPT end-to-end verification, installer. This is ASSISTED MODE, not Full Auto.
- No change to live QNECTOR binaries, plugins, tunnels, or currently active tasks. No local LLM installation; no API key stored without the user's direct local input.

Next: finish post-UX checks and commit local source checkpoint; user enters API key in Overseer GUI; run an explicitly authorized minimal API smoke; investigate host-sanctioned ChatGPT UI handoff on a test plugin. Maintain the P0 hard gate and do not implement private ChatGPT endpoints or session scraping.


## 13. Conversation bridge implementation - 2026-11-02

Overseer source is now at local commit 9555612 in D:\Projects\Qnector-Overseer. Version 0.2.0 native GUI and separate transport daemon are installed. The original QNECTOR v0.4.60 binary remains unchanged; its existing tunnel profile now targets a loopback HTTP overlay at 8790, forwarding original calls to 8787 and adding overseer_open_chat / overseer_chat_control.

Verified: Rust 18/18 tests, JavaScript 20/20 tests, formatting, clippy -D warnings, release build, native GUI visual inspection, actual original QNECTOR calls through the HTTP overlay with host session metadata. The real bundled controller sent one message only to a simulated MCP Apps host; this is NOT a real ChatGPT follow-up proof. A prior stdio candidate failed the live-call gate and was automatically rolled back before the successful HTTP deployment.

Chat dispatch now has host conversation binding, user enable, Instant-selection confirmation, persistent delivery reservations, no blind retries, acknowledgement states, bounded authorization, native Pause all and stale-panel diagnostics. New-chat extension support is capability-gated and stops awaiting rebind; fully unattended multi-session rollover is not complete.

BLOCKER: this conversation still exposes the old approved QNECTOR tool list. User/admin must Refresh the existing connection and review the two new actions, then open the real controller in an Instant chat and enable it once. Actual chat message submission and subsequent worker execution are NOT verified yet. Do not claim Full Auto ready before that acceptance test.

Current executable: D:\Projects\Qnector-Overseer\dist\Qnector-Overseer-0.2.0-win-x64.exe
SHA256: 9F34F273BB3E736FB55C7F7A8476EA8AD463CBDE173349101AE4568BA74A7DA2
Thai setup: D:\Projects\Qnector-Overseer\START-HERE-TH.md
Verification report: D:\Projects\Qnector-Overseer\docs\RELEASE-0.2.0-VERIFICATION.md
Checkpoint updated to round 2, same job/task identity, worker_claims_complete=false.

User Startup shortcut QNECTOR Overseer Transport.lnk runs only the transport daemon, not model calls. Before removing/stopping this installed bridge, restore the original tunnel profile using `node D:\Projects\Qnector-Overseer\bridge\configure-tunnel.cjs rollback` and verify QNECTOR connected. Backups are in APPDATA\Qnector\Overseer. A QNECTOR cold profile regeneration may restore the original target; reverify before assuming the bridge survived an upgrade.

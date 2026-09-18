# Qnector Activity / ChatGPT timeout incident — 2026-09-18

Status: diagnostics only; **no production fix deployed, no release, no desktop restart**. All times below Asia/Bangkok unless marked UTC. Source: `%APPDATA%/Qnector/logs/{activity.jsonl,tunnel-client.jsonl,timeline-20260918.ndjson}`, read on 2026-09-18 at about 10:06–10:10 ICT. This is a sampled local log, not browser performance telemetry.

## Measured evidence

- 9,672 Activity entries total; 3,768 completed, non-MCP tool entries. `process.run` 859 completed calls: average 3,482 ms, p95 12,553 ms, max 119,571 ms; 61 calls >=10s. `process.wait_for_exit` 12 calls: average 48,932 ms, max 120,003 ms; 9 >=10s. `files.read` 305 calls: average 6 ms, max 112 ms. `git.status` 32 calls: average 44 ms, max 126 ms. These are local execution durations, not browser round-trip latency.
- 2,134 completed MCP-exchange entries: median 5 ms, p95 2,579 ms, p99 12,553 ms, max 119,497 ms; 30 >=10s and 12 >=30s. The 3 longest *aborted* MCP exchanges lasted 119,497, 119,494 and 119,495 ms.
- 10:02:27, 10:04:29, 10:06:30: tunnel log reports `command response deadline reached; dropping without posting a response` on three different command IDs. At the same timestamps MCP activity records `MCP exchange disconnected before response finished` and `aborted=true`, with durations ~119.5 s. This is direct evidence of a roughly 120-second dispatcher response deadline for these calls. It does **not** establish browser-SSE failure source independently.
- Commands overlapping these failures were `npx.cmd pnpm@10.15.0 exec vitest run --maxWorkers=1` launched as blocking `process.run` with `timeoutMs=300000`; each completed with exit code 1 and local duration ~119.55 s, **after** the tunnel had already dropped its response. Two preceding blocking `npx.cmd pnpm@10.15.0 test` calls ran ~114.7 and ~111.4 s; local MCP activity calls them successful exchanges, but that does not prove browser receipt. There is no evidence that `timeoutMs=300000` can extend upstream deadline.
- Source `packages/tools/src/process-tool.ts` action `run` awaits `context.processManager.run` to completion (approx. lines 518–548); existing `start`/`output`/`task_start`/`task_get` actions return quickly and support subsequent polling. `wait_for_exit` accepts a caller-controlled bounded timeout and can also block a single MCP request for 120 seconds.
- Source `apps/desktop/src/renderer/renderer.tsx` limits Activity UI to 50 items, applies batched queue and virtual rows; there is no evidence from the available logs that this Electron panel freezes ChatGPT's *separate browser tab*. Reproduce browser main-thread freeze with browser performance trace before asserting that cause.

## Instrumentation gaps

1. The live `timeline-20260918.ndjson` sample contained 60 `request_received`, 60 `rpc_parsed`, 60 `response_written`, 60 `response_flushed`, 60 `stream_closed`, and **zero** `tool_start`/`tool_end` despite source instrumentation intended to record those phases. Correlation needs deployment/build-path/AsyncLocal verification; do not mark Phase 0 complete.
2. `response_flushed.detail.bytesWritten` appeared as zero on sampled entries. `mcp.exchange.argsSummary.socketBytesWritten` reads `reply.raw.socket?.bytesWritten`, which is a cumulative per-socket counter and may grow across separate keep-alive requests; it is NOT verified per-request payload size. Record delta between request start/end and instrument the response stream, without logging command contents.
3. Activity status `success` means the tool handler returned, **even when the executed CLI exited with code 1**. For diagnostic dashboards, display exit code as a separate signal; avoid treating Activity status as test pass.
4. The user reports ChatGPT Web visually hanging. Server/tunnel logs establish the response drop for several calls, not a browser main-thread measurement. Distinguish these two phenomena.

## Immediate, non-disruptive operating mitigation

- For tests, builds, release pipelines, installs, downloads and commands expected to exceed ~20 s, call `process.start` or a supported durable `task_start` and return its process/task ID promptly. Poll `process.output` / `task_get` or bounded short waits (<=10–15 s per call). Do not launch another duplicate side-effecting command merely because a response was dropped. Cap output per poll (e.g. `maxChars=4000..12000`) and use cursor pagination.
- Do NOT simply raise `process.run.timeoutMs` to 5–10 minutes: that controls the local command, not the upstream dispatcher deadline.
- Before a permanent change to existing tool signatures, follow the referenced `Markdown.md` Phase 0 eight-case test matrix using an isolated runtime; keep work already in progress safe, do not interrupt desktop/game, record exact errors and trace IDs. Treat progress-token behavior as unknown until tested. Follow with tests of background-job persistence/cancel/reconnect.

## Candidate source fixes (not yet implemented)

- Add compatible, bounded auto-escalation for long `process.run`, never auto-replay a command with unknown outcome; return ID and explicit `running` state, retain result/output safely and support cancel/reconnect. Prefer the existing durable daemon where verified; don't silently substitute in-memory process tracking for restart durability.
- Enforce a short per-MCP-call waiting budget independent of command execution lifetime, including `wait_for_exit`, with explicit `running` or `not finished` responses instead of a 120 s block; distinguish a timeout waiting for a process from aborting the process.
- Trace tool phase and request-local response byte counts correctly, add per-stage timing and output byte counts to diagnostics, and surface exit code, elapsed running time and progress in Activity.
- Benchmark browser CPU/rendering and total response payload only after the trace counters are corrected; a raw socket cumulative byte counter cannot justify a claim that one tool reply was several hundred kilobytes.

## Implemented source mitigation (10:19 ICT; NOT deployed to installed app)

- `process.run`: dispatches exactly once, waits at most five seconds, then returns an explicit `processId`/`taskId` and polling instructions. Short commands preserve separate stdout/stderr, exit code, reduction metadata and output SHA-256; long commands continue after the HTTP request is no longer being awaited. Do **not** retry a returned background command as if it had failed.
- `process.wait_for_exit`, `process.wait_for_output`, `process.wait_for_port`, `workflow_wait`: default wait three seconds and cap at ten seconds; `wait_for_exit` returns running state instead of a blocking 120-second error. The auto-escalated `process.run` execution deadline is independent, capped at 10 minutes and terminates the child tree on expiry. Explicit `process.start` / `task_start` retain their prior unlimited service-lifetime semantics; they can be stopped explicitly. An auto-escalated process does not survive Qnector app restart; the existing daemon is a separate feature.
- `withToolProgressHeartbeat` emits monotonically increasing MCP `notifications/progress` every ten seconds **only if** a client sends a progress token; `tool_start` records only `progressTokenProvided` for diagnostics. Notification failures are isolated and timers are cleaned up. Existing SSE comment keepalive remains at 15 seconds **only for negotiated SSE**; it is intentionally absent on JSON and cannot refresh the ChatGPT browser-to-backend model stream.
- Verification: targeted Windows tests 49/49 passed (including a real ~5.7s auto-escalation and output retrieval); full suite rerun 302/302 passed across 63 test files (after adding the regression that explicit `process.start` services remain alive); TypeScript typecheck, ESLint and source build returned exit code 0. The controlled eight-case ChatGPT-through-tunnel matrix and installed-app acceptance remain separate, incomplete gates.
- Known gaps: this in-memory process handle does not survive app restart; output uses the existing bounded ring buffer and may omit old output if it exceeds capacity. Full Phase 0 eight-case matrix and client progress-token behavior remain unverified. No release or desktop restart performed.

## Acceptance gate

Controlled ChatGPT-through-tunnel reproduction; each synchronous tool response <=20–25 s, 10-minute test continues in a durable job, completion and output recoverable via ID, no duplicate executions on retry, cancellation kills descendants, connection drop/restart recovery verified, full tests/typecheck/lint pass, and no claim of a browser-freeze fix without a browser trace. The original Phase 0 test matrix remains incomplete as of this report.

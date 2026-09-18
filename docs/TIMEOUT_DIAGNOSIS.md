# Timeout / Connection Interrupt — diagnosis log

Date: 2026-09-18 (Asia/Bangkok). Branch: `feat/durable-runtime-foundation`.
Input: `C:\Users\QUEEN\Downloads\Markdown.md` (650 lines). **Status: Phase 0 instrumentation implemented; Phase 0 acceptance NOT complete.** Do not claim that the installed desktop/ChatGPT browser has been fixed or that the failing layer is known.

## Existing evidence, before code changes

- Read the latest 2,500 entries of `%APPDATA%\Qnector\logs\activity.jsonl`: 1,206 `mcp/exchange` entries, all marked `success`, maximum recorded duration 51,497 ms, p95 ~2,624 ms, 8 over 30,000 ms. This is a *sample of completed server-side exchanges*, not the entire incident population; missing/aborted requests may be underrepresented.
- Existing MCP exchange activity records only one terminal summary. A server-side success does **not** prove ChatGPT Web received/painted the answer; these data cannot identify layers 0–5 or establish a timeout threshold.
- There was no `timeline-YYYYMMDD.ndjson` output from the installed application at the time of inspection. New source changes do not affect the installed process until deployed; we deliberately did not restart it.
- Existing `mcp-reliability.ts` already guards 15-second SSE comments against JSON framing, and the source has a separate **opt-in** durable daemon/task facade. Neither can guarantee ChatGPT browser SSE continuity. Existing request context cancellation and in-memory process behavior need their own acceptance tests before automatic escalation.

## Source changes in this milestone

- `timeline-logger.ts`: ordered, metadata-only NDJSON events; request duration uses a monotonic clock; production path `%APPDATA%\Qnector\logs\timeline-YYYYMMDD.ndjson`, daily rotation; diagnostic write failure does not break tools. No args, file bodies, stdout or image data in events.
- HTTP MCP route: `request_received`, `rpc_parsed` (bounded RPC ID and method), `response_written`, `response_flushed`, `stream_closed`, `client_aborted`, `error`, plus `keepalive_sent` only when actually written. The existing trace header links entries by UUID; request `close` is deliberately NOT interpreted as a disconnect because the request body can close normally before the response finishes.
- Shared tool registration: `tool_start`, `tool_end` and error type, under the same async-local trace. A dedicated local integration test confirms correlation for `system.status` and the probe.
- Diagnostic `system.timeout_probe` accepts `{durationSec: 0..300, mode: silent|progress|keepalive|both}`. It is **not listed by default**; enable explicitly with `QNECTOR_TIMEOUT_PROBE=1` before starting an isolated runtime. `silent`/`progress` suppress only Qnector's own SSE-comment heartbeat for that call; an SDK, proxy or client may still transmit other frames. Progress mode requires a real client-supplied progress token, sends monotonically increasing values via the actual SDK request notification API, and reports an error when missing. SSE comments are possible only if the transport has committed a `text/event-stream` response. The probe is not a fix and never secretly starts a daemon.
- No default transport timeouts were globally raised, no frontend was restarted, and the existing tool signatures remain unchanged.

## Tests completed

- TypeScript typecheck passed after integration (rerun after any further changes).
- Dedicated local unit/integration checks: NDJSON clock/order, HTTP trace correlation, payload omission, 0-second probe, progress-token requirement and monotonic progress; passed 3/3.
- MCP server + reliability checks: 9/9 passed before the probe; to be rerun in the final verification.
- Full test run initially: 293/294 passed. `apps/daemon/src/wait.test.ts` exceeded Vitest's default 5-second test limit on Windows (5.1–5.3 seconds) and sometimes failed temporary-directory cleanup after the timeout. Increased **test timeout only** to 15 seconds; isolated rerun passed (5.28 seconds). This does not alter production tool or transport timeouts. Re-run the full suite before accepting.

## Real ChatGPT-through-tunnel test matrix — NOT RUN

Do not mark a row as passed without collecting the ChatGPT tool response or exact error, timestamps, local trace ID and timeline. Run this in a controlled session with an isolated Qnector build/probe enabled; do not interrupt an active desktop or game. Use `tools/call` for `system.timeout_probe` with each row's arguments. Record the **negotiated response content type** before interpreting keepalive mode.

| Case | durationSec | mode | Result | Trace ID | Observed cutoff |
| --- | ---: | --- | --- | --- | --- |
| 1 | 30 | silent | Not run | — | — |
| 2 | 55 | silent | Not run | — | — |
| 3 | 70 | silent | Not run | — | — |
| 4 | 95 | silent | Not run | — | — |
| 5 | 130 | silent | Not run | — | — |
| 6 | 130 | progress | Not run | — | — |
| 7 | 130 | keepalive | Not run | — | — |
| 8 | 300 | both | Not run | — | — |

For each case: record start/end local wall-clock time, HTTP `X-Qnector-Trace-Id`, JSON-RPC ID, actual content type, `request_received → tool_start → keepalive/progress → tool_end → response_flushed/aborted` phases, the ChatGPT UI symptom, and whether the result remains recoverable after a browser reconnect. A missing `response_flushed` with `client_aborted` indicates local socket abort, **not** which upstream actor closed it. Absent local abort is **not proof** of proxy buffering. Repeat candidate cutoffs to avoid confusing coincidental delays with a fixed timeout.

## 10:06 ICT incident update — real dispatcher drop observed

See `docs/ACTIVITY_LATENCY_DIAGNOSIS_2026-09-18.md` for full counters, commands, limitations and mitigation. At 10:02:27, 10:04:29 and 10:06:30 ICT, blocking Vitest `process.run` calls reached ~119.55 seconds while the tunnel separately logged `command response deadline reached; dropping without posting a response` and MCP activity recorded disconnected/aborted requests at ~119.5 seconds. This identifies a concrete upstream dispatcher response deadline in these incidents, not the source of every historical browser interruption. `process.run timeoutMs=300000` cannot override it. The live timeline sample has no tool_start/tool_end despite the source instrumentation, and `socketBytesWritten` is a cumulative socket counter, not per-request response size. The eight controlled probe-matrix cases remain **not run** and this is **not a verified production fix**. Prefer short `start` + `output` / durable task polling for long commands without re-running a command whose outcome is uncertain.

## 10:29 ICT source mitigation update (not deployed)

`process.run` now auto-escalates after a five-second response budget and returns a tracked process ID instead of holding the MCP call; original short-command output/exit-code fields are preserved. Explicit `process.start` services retain their previous long-lived behavior. Run-command execution deadlines cap at 10 minutes, and tool-level wait actions cap at 10 seconds (default three). A token-aware MCP progress heartbeat emits every ten seconds; `tool_start` logs token presence only, and first notification failures are logged without failing the underlying tool. SSE comments still require an actual SSE response and cannot guarantee ChatGPT browser stream continuity. Verification: full 302/302 tests, targeted 49/49 after final heartbeat edits, typecheck/lint/build and isolated MCP smoke passed. Not released, installed Qnector not restarted, and the eight ChatGPT-through-tunnel cases remain unverified. Details: `docs/ACTIVITY_LATENCY_DIAGNOSIS_2026-09-18.md`.

## 12:25 ICT — lightweight response-byte instrumentation fix (source only)

- `packages/mcp-server/src/server.ts` now retains the response socket and its initial `bytesWritten` counter, then records `socketBytesDelta` at response finish and in the MCP exchange activity. This fixes the misleading cumulative-socket measurement and lost socket reference after finish. The delta includes HTTP framing and is **not** exact body/payload bytes; never infer payload size from it.
- The HTTP timeline integration test now asserts the flushed response has a positive delta. Focused MCP tests 12/12 passed, TypeScript typecheck and lint passed. No installed application restart, no release, and no eight-case ChatGPT-through-tunnel matrix has been performed. This does not by itself prevent interruptions.

## Exit gate and next phase

Phase 0 requires all eight live cases, an observed failure boundary with corroborating timings, and an explicit decision on whether the client honors progress notifications. Until then Phase 2 is conditional. Phase 1 already has a partial implementation but needs real SSE `curl -N` and header checks; Phase 3 must not auto-abort non-idempotent operations; Phase 4 opt-in durable jobs need installed-build reconnection/cancellation/soak gates. Do not release or enable these as a claimed permanent fix on the basis of local unit tests.

# Qnector MCP timeout architecture (source state, 2026-09-18)

This describes the current code and the remaining gates, not a claim that ChatGPT Web disconnection is cured.

## Where a request can stop

1. Browser ⇄ OpenAI's conversation stream: outside Qnector's control; local SSE comments do not keep the model/browser stream alive.
2. OpenAI connector and MCP client: tool execution budget and `resetTimeoutOnProgress` behavior must be measured, not assumed. A server-side timeout increase does not override the client.
3. Cloudflared/reverse proxy: idle buffering/connection termination must be measured on the deployed route. A proposed 100-second limit is a hypothesis, not confirmed for this account or route.
4. Qnector Fastify ⇄ MCP SDK v2 Streamable HTTP: `server.ts` owns `/mcp`; `mcp-reliability.ts` sends SSE comments every 15 seconds *only after valid SSE headers and complete frames*, never into JSON or stdio. SDK controls its own response headers and framing. No blanket response-content-type override or opaque stream rewriting.
5. Tool/daemon/OS work: tools may block, run children or browser operations; `apps/daemon` and `packages/execution` include an opt-in durable execution path. In-memory process calls and an independent daemon have different lifetime and cancellation semantics.

## Event interpretation

`X-Qnector-Trace-Id` from the HTTP response matches `requestId` in `%APPDATA%\Qnector\logs\timeline-YYYYMMDD.ndjson`. Events: receive, parse, tool start/end, actual keepalive/progress, response header/write, finish, close/abort, error. Durations are monotonic from receive; data are metadata-only. If a request is aborted, absence of `response_flushed` is expected. `response_flushed` means Node finished its response, **not** that the model or UI consumed it. Tool execution may finish after the HTTP response disconnects; do not retry side-effecting calls blindly.

## Tuning and operational safety

- Current SSE comment interval is `MCP_SSE_HEARTBEAT_MS = 15000` in `packages/mcp-server/src/mcp-reliability.ts`; heartbeat timer stops at response close/finish. Do not send comments on JSON responses or inside incomplete SSE events.
- `QNECTOR_TIMEOUT_PROBE=1` exposes diagnostic `system.timeout_probe` only on a newly started isolated instance. Disable the flag after measurement. Modes selectively suppress Qnector-origin SSE comments; an SDK may choose JSON responses, in which case the keepalive mode cannot validate SSE behavior.
- Progress notifications are currently implemented only for the diagnostic probe. A real `progressToken` from the client is required; sending progress does not prove the client resets its clock. Do not enable a blanket progress heartbeat until the real test matrix demonstrates it works.
- Do not impose 25/45-second aborts universally on side-effecting calls. For durable operations use an idempotency key, persist acceptance, return a short task handle and explicitly poll/inspect. Lost replies may mean a command already ran; treat unknown outcomes as unknown rather than retrying.
- Durable `tasks` registration is opt-in via `durableDaemonRoot`; production activation, queue/child-tree ownership, installer lifecycle, recovery and 30-minute end-to-end acceptance have separate gates in `docs/durable-runtime-*.md`. `tasks.wait` caps individual waits at 20 seconds; execution timeout is separate.
- SSE replay requires the MCP SDK's supported event-store/session integration and verified client reconnection; adding an `id:` line to an opaque transport or manually replaying a request risks corruption and duplicate side effects. It is not implemented or claimed here.

## Milestones

Phase 0: timeline and opt-in probe implemented; real 8-case matrix incomplete (see `TIMEOUT_DIAGNOSIS.md`). Phase 1: existing SSE heartbeat partially implemented; live intermediary test pending. Phase 2: conditional progress, probe only. Phase 3: per-tool cooperative deadlines, partial result and continuation need design against existing paged tools and durable tasks. Phase 4: opt-in daemon exists, auto-escalation and production wiring not verified. Phase 5: resumable stream not verified. Phase 6: production UI/config/diagnostics export not built. Do not describe the entire plan as complete or ship a stable timeout fix until all required acceptance criteria pass.

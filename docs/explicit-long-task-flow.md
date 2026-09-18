# Explicit long-task / short-task flow (2026-09-18)

## Rule

Short task is the default. Only an explicit user instruction containing `long task` opts into background execution. This is an agent-facing session-bootstrap rule, **not** a deterministic server-side classifier of chat messages. Do not infer long task from duration alone. The installed desktop must be rebuilt/released to receive this new bootstrap instruction.

For suitable shell/CLI work, prefer the opt-in `tasks` MCP tool when actually advertised and an independent daemon is running. Submit once with `action: start`, a stable caller-generated `idempotencyKey`, and a command; default `waitTimeoutMs: 0`. Return the acknowledged `taskId` as *accepted*, never *completed*. Later query `tasks.get`, `tasks.output` and `tasks.result` before reporting verified completion. A lost response is recovered with the SAME idempotency key, never a new submission. A command cannot encompass work that requires further model reasoning, consent, user GUI interaction, or unreviewed release/deletion: pause for review instead. User instructions and permissions still apply.

When the `tasks` tool/daemon preview is not available, `process.start` gives an in-memory process ID and `process.task_get`/`process.output` can track it only while its owning runtime remains alive. Explicitly label this **non-durable fallback**, not equivalent to the independent daemon. Do not start speculative work merely because a user asks for a long-task explanation.

## Verification

- `session-bootstrap.test.ts`: 4/4 passed, including trigger wording and 3 KB memory context budget. Typecheck and lint passed.
- `durable-task-mcp.test.ts` and `stdio-parity.test.ts`: 3/3 passed, including daemon acceptance/idempotency, result recovery over reconnect, HTTP/stdio parity, and cancellation.
- Live `process.start` simulation: success `proc_83185a40-d90f-4995-be5f-6378ba682927` accepted in `running`, then `task_get` observed `exited`/exit code 0 and `output` returned `LONG_TASK_DEMO_OK`. Expected failure `proc_6e0760ba-f87e-45eb-aae1-4b32651953f1` returned `failed`/exit code 7. This simulation exercises the non-durable fallback, **not** a production long-running chat disconnected from the application.

## Not implemented or claimed

No UI task classifier, automatic multi-step Job Orchestrator, daemon enablement, app restart, installed-app update, actual browser disconnection experiment, or release in this change. Existing durable daemon remains an opt-in preview. The session bootstrap expresses the explicit trigger as agent guidance; automatic enforcement requires a separate end-to-end entry point that receives the user instruction reliably. A future change can enforce mode selection at that entry point without duplicating the execution engine.

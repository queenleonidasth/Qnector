# Memory checkpoint and interrupted-task recovery

## Contract

- `success` on a Qnector tool means **the invocation succeeded**, not that the user's task or step was verified complete. Failed or interrupted commands are never converted into completed steps.
- `completedSteps` changes only through explicit `memory.task_update` / `memory.save_checkpoint` state supplied after verifying an outcome. Historical entries are retained rather than silently deleted; previously generated completion entries should be rechecked before trusting them.
- v2 records meaningful tool events atomically in SQLite WAL before returning the tool result. Auto recovery checkpoints persist the existing task state unchanged; they do not promote tool events to completion. New auto checkpoints are labeled `Auto recovery - unverified tool activity`.
- The first meaningful event creates a recovery point, subsequent auto checkpoints appear at six new events, after a Git milestone, or after at least two events and ten minutes. At most 12 _new-format automatic_ checkpoints per task are retained; manual and legacy checkpoints are not deleted. Recent events remain available independently of checkpoints.
- `memory.task_resume` and `memory.task_get` return a compact `recovery` with the last checkpoint pointer and three latest events; it works after a process restart. Verify live file contents, Git state or durable process task state before retrying any operation whose outcome is uncertain. **Never automatically replay an interrupted mutation.**
- `task_resume` with no query chooses automatically only when exactly one non-default unfinished task exists; ambiguous or weak matches return no selection and instruct the agent to use `task_list`.
- The desktop Memory drawer marks identifiable legacy auto-generated completion entries as unverified rather than green-checked. Session bootstrap omits them from the completed-step summary and warns that the live outcome must be checked; no historical data is silently deleted.
- `memory.recall`, `v2_snapshot` and `working_set` use bounded default responses; callers can explicitly increase limits for deeper inspection. SQLite structure remains backward compatible. No migration or deletion of existing task history is performed.

## Testing

`pnpm vitest run packages/core/src/memory-v2-store.test.ts packages/core/src/core.test.ts packages/mcp-server/src/session-bootstrap.test.ts packages/tools/src/tools.test.ts --maxWorkers=1`

`pnpm typecheck` and `pnpm lint`.

## Limits

This prevents false **automatic** completion and improves the saved recovery context, but it cannot prove that an AI-provided manual completion is correct, recover an operation that never reached persistent storage, or prevent all ChatGPT Web/tunnel interruptions. Packaged desktop behavior requires a new build and update; changing source files does not update a running application.

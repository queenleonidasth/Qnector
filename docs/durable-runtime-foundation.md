# Durable runtime: P0 baseline and P1 foundation

Status: **foundation implemented on `feat/durable-runtime-foundation`, not activated**. Do not claim that an installed QNECTOR survives UI/daemon crashes as a result of this change.

Reference plan: `C:\Users\QUEEN\Documents\QNECTOR-Durable-Runtime-Implementation-Plan-2026-09-17.md`. Baseline: v0.4.36, `b613a9c` on 2026-09-17. `../devq.md` was absent; three pre-existing uncommitted files (`packages/mcp-server/src/session-bootstrap.ts`, its test, and `packages/tools/src/process-tool.ts`) are intentionally untouched.

## Baseline and invariants

- Current `ProcessManager` has in-memory process ownership/output. Existing `WorkflowManager` already persists definitions/runs. This P1 library does not migrate or replace either.
- Existing MCP HTTP requests can be disconnected; request wait cancellation **must not** implicitly cancel durable execution. Only explicit `requestCancel` changes execution state.
- Task ownership is distinct from an MCP request ID, ChatGPT chat, memory task ID, attempt ID, workflow run ID and step ID.
- Exactly-once shell/network/GUI effects are impossible to guarantee generally. The contract is durable acceptance, retry deduplication, and unknown-outcome reconciliation without blind replay.

## P1 interfaces (available in `@qnector/execution`)

- `ExecutionStore.accept`: one SQLite IMMEDIATE transaction writes task, idempotency scope, accepted event and dispatch intent. The acceptance response is returned only after COMMIT. Scope is owner + resolved workspace + operation + client key. Same key with changed input digest **or definition snapshot** produces `IDEMPOTENCY_CONFLICT`. An intentional new execution must have a new key.
- `pending`/`claim`: one-shot compare-and-swap queued to starting. Subsequent attempts cannot spawn the same task again. `markStarted` accepts the correct attempt token and generation only. Future worker protocol must retain this identity and validate OS process start time, not PID alone.
- `finish`: requires a readable completion manifest matching attempt ID/output state; successful tasks require exit code 0 and no signal. Output manifest is created only after both streams reach EOF (responsibility of future P2 worker). Outcome-unknown tasks cannot be marked succeeded or silently requeued.
- `requestCancel` on queued tasks cancels before dispatch. Running tasks become `canceling`; `confirmCanceled` MUST be called only after worker and descendant processes have demonstrably stopped. This is an executor responsibility, not something SQLite can prove.
- `interruptUnverified` is a deliberate **post-inspection** operation. NEVER invoke it solely because a lease expired or a frontend/daemon restarted; verify worker identity/manifest first. It records interrupted + unknown and prevents replay.
- `OutputSpool`: separate stdout/stderr byte cursors, bounded disk allocation, UTF-8 page boundaries and completion manifest written through fsync + rename. Consumers must keep draining both OS pipes even after quota is reached. The spool does not own pipes in P1.
- `MemoryV2Store` remains a context projection; `execution.sqlite` must live separately. Never persist plaintext secrets in `definitionSnapshot`, logs or telemetry. Callers must sanitize snapshots before acceptance.

## What is explicitly NOT implemented yet

P2 OS-level singleton daemon, authenticated Windows named-pipe IPC, worker process tree ownership, handshakes, child survival across daemon/UI restart, output EOF wiring and recovery importer; P3 new MCP task APIs / auto-yield and legacy adapter; P4 stdio + HTTP parity; P5 workflow/store convergence; P6–P8 tooling, UI, migration and soak. No production routing, schema migration of legacy tasks, installer change or release default switch has been made.

## Validation and next acceptance gates

Run `npx.cmd pnpm@10.15.0 typecheck`, `npx.cmd pnpm@10.15.0 test`, and `npx.cmd pnpm@10.15.0 lint` from repository root (PowerShell on this machine blocks `npx.ps1`). Dedicated P1 tests cover reopen/retry, 20 duplicate submissions, key scoping and payload conflicts, CAS claims, forged attempts, manifest validation, unknown outcomes, two-stage cancel, UTF-8 byte cursors, quota and recovery. These are **unit tests**, not proof of worker or ChatGPT Web survival.

Next engineering gate: integrate the store behind a daemon-only single writer with bounded storage work queue; persist worker identity and verify survival on packaged Windows builds; only then expose v2 tools/capabilities opt-in and implement request/job separation. Preserve existing in-memory jobs during upgrade by draining them. Do not copy an active SQLite database as bare files; use SQLite backup API or quiesce. Keep v1 frontend/store usable for rollback, never allow old binaries to write v2 schema.

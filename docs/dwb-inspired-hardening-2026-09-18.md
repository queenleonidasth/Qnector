# DWB-inspired QNECTOR hardening — implementation record

Scope requested: durable Task ID/idempotency, timeout safety, file concurrency, passive diagnostics, Activity Feed route evidence. Explicitly excluded: per-session Workspace binding. No third-party DWB runtime or dependency is installed. No release, auto-update, installed-app restart, or GitHub push as part of this change.

## Reuse before invention (ponytail)

- `packages/execution/src/execution-store.ts` already accepts task + idempotency key transactionally, checks definition conflict and exposes attempts; the daemon and worker produce independently verifiable completion manifests. `packages/mcp-server/src/durable-task-tool.ts` exposes `tasks.start/get/list/wait/output/result/cancel/inspect/doctor`. We reuse these, **not** invent another task store or make `process.run` falsely durable.
- `packages/core/src/resource-coordinator.ts` already serializes conflicting mutations, and `packages/tools/src/files-tool.ts` locks mutation paths and accepts `expectedSha256`; added a deterministic contention/nested-path regression. This is an in-process coordinator, not an OS-wide lock or a defense against arbitrary shell writes, symlinks or edits by unrelated programs.
- `packages/mcp-server/src/mcp-reliability.ts` already has bounded response payloads, SSE heartbeat and progress notifications; it does NOT bypass a ChatGPT transport/model deadline.
- `apps/desktop/src/renderer/runtime-diagnostics.tsx` already has passive diagnostics and a workspace-filtered durable jobs panel. It does not run/cancel jobs when merely opened. Existing durable task / cancellation tests remain the gate.

## Source changes

- Windows Desktop attempts to start the existing independent daemon by default and advertises the experimental `tasks` MCP API **only if its Job Host bundle and readiness checks succeed**; existing legacy tools remain available on failure. `QNECTOR_DURABLE_PREVIEW=0` is a reversible, non-destructive opt-out. Other OSs do not start Windows Job Host. This does not silently migrate existing `process` or `workflow` jobs.
- Activity Feed formerly asserted `ROUTING MISSING` for any mutation without a correlated route, even when `system.skills_route` had run but selected no skill applicable to that tool. It now suppresses this false positive when a route ID and activation timestamp exist; lack of correlation is labeled `ROUTE UNVERIFIED` with a diagnostic explaining `skillRouteId`/`memoryTaskId`. No global fallback to the last route is introduced because that would mix unrelated chats.
- New unit tests cover Windows daemon startup/opt-out, route-no-matching-tool, and existing ResourceCoordinator contention.

## Constraints and acceptance gates

- Do not promise that a whole multi-step ChatGPT reasoning session survives disconnect. Only individually accepted daemon command jobs can survive a lost MCP waiter. Caller must use a stable idempotency key for retries and verify completion via taskId; changing the key may execute side effects again.
- Store may persist command text: never put credentials into command strings. Confirm `tasks` availability in actual installed app and compare startup, daemon, output and cancellation after an actual HTTP disconnect. A preview path is not a fully certified production service.
- Files locked through QNECTOR are coordinated in-process only; no per-chat Workspace changes are included. No additional Worker Pool was added because the durable daemon already limits concurrent attempts; do not duplicate this scheduler.
- First full regression run failed **one** cancel/recovery test with `canceling` timeout (310/311 passed). The same test passed in isolation (2/2), and the second full single-worker regression passed **311/311 across 65 files**, followed by typecheck, lint and source build (all exit 0). The intermittent cancellation failure remains a known risk; require packaged cancellation/recovery and sustained soak before a release. Do not extend timeouts or claim this test is deterministically fixed.
- Before shipping default-on, require packaged Windows daemon start/stop/reconnect/crash/cancel tests, no duplicate effects, full lint/typecheck, source compatibility, rollback flag test and 24-hour soak. Do not restart an existing user app to test.

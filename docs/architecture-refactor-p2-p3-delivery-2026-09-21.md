# QNECTOR Architecture P2/P3 delivery — 2026-09-21

## Source and safety

- Worktree: `C:\Users\QUEEN\Projects\qnector-architecture-integrated`; branch: `feat/architecture-integrated-20260921`.
- Baseline for integration: committed 0.4.44 `58f1e6b` (manual Agent Skills opt-in). This branch already includes earlier P1 commits and the first HTTP extraction.
- Main development checkout `C:\Users\QUEEN\Projects\qnector` has unrelated, uncommitted durable/social/UI work. No reset, stash, checkout, merge, or edit there. Installed 0.4.44 is not updated or restarted.
- Follow `AGENTS.md`; its referenced `C:\Users\QUEEN\Projects\devq.md` was not present in this checkout. No instruction was invented to replace it.

## P2 — completed isolated source refactor

- `runtime-services.ts` is the service composition root for 20 services. It accepts injectable existing service overrides and lazy callbacks for scoped workflow tool calls. `QnectorRuntime` assigns returned services explicitly; only the runtime owns their start/stop lifecycle. Dynamic workspace config remains callback-driven.
- `http-mcp-host.ts` contains HTTP-only origin checks, protocol handling, heartbeat, and delivery timeline (from the earlier commit). `stdio-mcp-host.ts` isolates stdio wiring and error forwarding, keeping JSON-RPC stdout uncontaminated.
- Existing HTTP and stdio expose the same tool schema. No extra daemon, IPC hop, new network calls, or duplicate ActivityLogger was added by the refactor.

## P3 — completed isolated execution read-model facade

- `execution-facade.ts` delegates all existing durable actions to the existing daemon adapter, preserving SQLite ownership, stable idempotency keys, explicit cancel, spool cursors, and no-replay-on-unknown semantics.
- Adds two opt-in `tasks` actions when the durable daemon is enabled: `overview` (bounded per-source, current-workspace filtered list of persistent and session jobs) and `lookup` (resolve `task_` vs `proc_` handles with owner and lifetime labels). The daemon list is authoritative; IPC failure fails the overview rather than showing a false empty list.
- Session snapshots are available only while ProcessManager is alive; the workspace read-model filters them by command working directory because legacy snapshots contain no separate owner-workspace field. A command launched with an external CWD cannot be reliably attributed to its original workspace and may be omitted by this view. This is a known compatibility limitation, NOT an access-control guarantee.
- Existing `process.task_*` inputs, protocol and behavior remain unchanged; session labeling is now consistent for task start/get/list/cancel. Legacy process calls are NOT automatically migrated to daemon jobs, and no active process is transferred.
- Increment opt-in tasks schema revision to `durable-tasks-preview-v2` due to additive actions. Existing non-opt-in eight-tool public contract is preserved.

## Validation and measurements

- Targeted P2/P3 after composition and facade: typecheck, lint, four test files / 9 tests passed. The final HTTP/stdio and facade regression checks passed after adding cross-transport assertions.
- Final exact source: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm smoke:mcp`, and `git diff --check` passed. Complete regression: 70 suites / 337 tests, including extended HTTP/stdio parity and native Windows Job Host lifecycle tests. Native Job Host was already built in this isolated worktree.
- Reproducible local microbenchmark: `C:\Users\QUEEN\AppData\Local\Temp\qnector_arch_benchmark.mts`. Benchmarks an isolated HTTP `system.status` in four new runtimes and 32 requests per run, identical script on baseline and candidate, repeated twice sequentially. These are NOT measurements of ChatGPT tunnel/network latency, UI frame rate, or installed cold boot.

| Metric | Baseline 0.4.44 run A / B | Refactor run A / B |
| --- | --- | --- |
| Start p50 ms | 18.11 / 15.46 | 14.96 / 20.47 |
| Start p95 ms (4 samples; unstable) | 81.72 / 38.70 | 69.40 / 47.08 |
| MCP status p50 ms | 3.05 / 3.18 | 2.84 / 3.25 |
| MCP status p95 ms | 5.45 / 13.51 | 10.64 / 5.66 |
| Median MCP response bytes | 616 / 616 | 616 / 616 |
| Maximum RSS after stop MB | 326.38 / 338.64 | 300.71 / 338.27 |
| Process CPU used ms | 655 / 531 | 656 / 673 |

No stable speedup or slowdown is proven by this short sample. Payload size stayed unchanged. A packaged live comparison with p50/p95, cold boot, CPU/RAM, reconnect and actual tunnel latencies remains a release gate.

## Release and migration blockers

1. Reconcile with uncommitted main-tree durable runtime, social integration, memory center and UI changes without overwriting any of them. Repeat checks on the resulting exact source.
2. Validate packaged HTTP, stdio, tunnel disconnect/reconnect, independent worker recovery, updater rollback, and stable latency in a controlled acceptance run; do not interrupt a live gaming/user session.
3. The new read model does not guarantee attribution of session jobs launched with a CWD outside the active workspace, and the daemon remains preview. Keep legacy submission behavior unless a separately tested, explicit migration is requested.

**Delivery scope:** P2 structural separation and P3 additive unified read facade implemented in an isolated branch; full production migration or release is not claimed.

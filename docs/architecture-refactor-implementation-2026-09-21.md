# QNECTOR architecture refactor — implementation record (2026-09-21)

Source review: `C:\Users\QUEEN\AppData\Local\Temp\architecture-review-20260921-110225.html`.

## P0 — isolation and constraints

- Baseline source: `4f6365546ee1c1029cc659b9a75a9f257cc96ae8` on `feat/durable-runtime-foundation` (committed HEAD only).
- Implementation worktree: `C:\Users\QUEEN\Projects\qnector-architecture-p1`, branch `feat/architecture-p1-domain-adapters-20260921`.
- The original working tree contains unrelated uncommitted durable-runtime, social integration, UI and asset work. Do not reset, stash, overwrite, merge or cherry-pick into it without reconciling those changes.
- Manual Skills opt-in commit `58f1e6b` lives in separate checkout `qnector-release-v043` and is NOT part of this worktree's baseline; integrate through a conflict-aware change review, never by copying the entire old checkout.
- Keep the public `system` MCP tool name, action names, input schema, output envelopes and error semantics stable. Keep `runWithActivity` at dispatcher entry; adapters must not duplicate activity events.
- Never introduce network/IPC hops simply to split code. Preserve the daemon as the sole owner of durable jobs; never silently change in-memory `process.task_start` into a claim of true persistence.
- Before production integration, gather before/after p50/p95 latency, payload size, CPU/memory, transport reconnect and durable crash-recovery observations. Source-level refactor by itself does not prove improved performance or resolve ChatGPT-side timeouts.

## P1 — progressive system domain extraction

- First patch: extract `info`, `status`, `build_info`, `performance`, `release_status` into `system-diagnostics-adapter.ts`. The `system` dispatcher routes only those actions in-process. Existing tool and MCP tests exercise the public interface.
- Next: extract remaining diagnostics (`processes`, `process_info`, `ports`, `context_snapshot`, `doctor`, `which`, `search_files`, `env`) where shared helper boundaries permit it; extract Skills; external MCP; desktop UI. Keep action-specific input validation and error behavior. Add adapter unit tests, schema snapshots, and compare pre/post outputs.
- Avoid a monolithic dependency container and a parallel action registry until the adapters offer a measurable reduction in coupling. Do not remove branches or switch public schemas in one bulk rewrite.

## P2 — transport/lifecycle separation

- Introduce a small composition root with injectable services while retaining test overrides; extract HTTP/SSE-specific origin validation, header/flush timeline, and heartbeat without touching stdio JSON-RPC framing. Add HTTP/stdio parity, disconnect, heartbeat and timeout diagnostic tests.
- A server-side SSE comment is not proof that ChatGPT's conversation stream stays alive. Test relevant intermediary/client behavior before claims about timeout cures.

## P3 — execution facade

- Define explicit ephemeral versus durable job kind and stable IDs. Route durable submission through existing daemon using caller-stable idempotency keys; keep SQLite/worker ownership within daemon. Preserve no-replay-on-unknown semantics, explicit cancellation, workspace isolation, spool cursors and reconnection recovery.
- First unify task read/visibility and truthful labels; only then consider command submission migration. Test cancel races, daemon crash, desktop close, installer update, duplicate submission and unknown outcomes in isolation.

## Release gates

1. Full TypeScript build, lint, format and regression suite pass after each extraction.
2. Byte-/schema-compatible public MCP actions and HTTP/stdio parity.
3. No live user installation/restart or release until entire merged source is tested and performance/recovery acceptance passes.
4. Record reproducible before/after measurements and a rollback revision.

Validation completed for isolated initial P1: `pnpm typecheck` passed; `pnpm lint` passed; `pnpm build` passed; focused MCP/tools tests 42/42 passed. An initial complete test run reported 4 failures because the fresh worktree did not yet contain its native Windows Job Host executable; after `dotnet publish packages/execution/job-host/Qnector.JobHost.csproj -c Release -r win-x64 --self-contained true -o packages/execution/job-host/dist`, the complete `pnpm test` run passed 68 suites / 330 tests. The first failures were not suppressed or modified. Native output is generated, not part of the source commit.

Status update 2026-09-21: P0 isolation complete. P1 four domain adapters now extracted: system-diagnostics-adapter.ts (five base actions); system-skills-adapter.ts (skill catalog and activation); system-mcp-adapter.ts (external MCP discovery/call); system-desktop-adapter.ts (window/clipboard/screen/presentation). Remaining extended diagnostics are intentionally still in system-tool.ts until their shared helpers and authorization boundaries can be extracted safely. `runWithActivity` and the public schema remain in the original dispatcher. The structural-test assertion of the skill capability guard was moved to inspect its new adapter location, without disabling behavioral assertions.

Post-extraction checks: `pnpm typecheck`, `pnpm lint`, `pnpm build`, and the full `pnpm test` pass (68 suites, 330 tests) with Windows native Job Host built in the isolated worktree. P1 domain split delivered, but full diagnostics decomposition and performance benchmarking remain pending. P2 transport/lifecycle separation and P3 unified execution facade remain unimplemented and production acceptance is not complete. This worktree's source baseline is version 0.4.42 rather than the installed 0.4.44; reconcile the newer manual-skills release and original uncommitted work before merging/releasing. Do not treat standalone green tests as clearance for production deployment.

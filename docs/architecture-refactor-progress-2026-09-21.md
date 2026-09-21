# Architecture refactor progress — 2026-09-21

## Delivered in isolated worktree

- P0 isolation and baseline: clean dedicated worktree from committed `4f63655`; original dirty checkout and manual-Skills release branch untouched.
- P1: in-process Diagnostics (five core actions), Skills, External MCP, and Desktop UI adapters behind unchanged `system` tool dispatcher and `runWithActivity`. Remaining extended diagnostics (doctor, process introspection, file search, etc.) remain in dispatcher pending independent helper decomposition.
- P2 incremental: HTTP-specific Origin validation, delivery timeline, MCP handler plumbing and SSE heartbeats extracted to `packages/mcp-server/src/http-mcp-host.ts`. `QnectorRuntime` delegates HTTP requests with injectable HTTP host dependencies; stdio unchanged. Composition root and service ownership separation not yet implemented.
- P3 incremental: stop claiming in-memory `process.task_start/task_list/task_get` are durable; describe them as session-scoped and add `taskLifetime: "session"` to list/get envelopes. Preserve `taskProtocol: "qnector-process-v1"`, command behavior and daemon-owned durable task interface. A true unified Execution Facade and read model are still not implemented.

## Validation

- After P1 adapter extraction: 68 suites / 330 tests passed, `pnpm typecheck`, `pnpm lint`, `pnpm build` passed.
- P2 HTTP-focused tests: 4 suites / 13 tests passed including stdio parity.
- After P2 HTTP extraction and P3 labels: 68 suites / 330 tests passed; lint, build and TypeScript pretest check passed. Native Windows Job Host was built in this worktree before the full tests; executable intentionally excluded from commits.

## Remaining release blockers

1. Reconcile this 0.4.42-base branch with the newer 0.4.44 manual-Skills work and all original uncommitted durable/social/UI changes. Do not reset, stash, or overwrite original worktree.
2. Finish P2 composition root with injectable services; test HTTP/stdio reconnect, partial responses, and live tunnel behavior.
3. Finish P3 unified task read model and execution facade, preserving daemon sole ownership, idempotency, no replay on unknown, cancellation and workspace isolation. Decide explicit opt-in migration of legacy process calls only after characterization tests.
4. Record baseline vs revised p50/p95 latency, CPU/RAM, payload and cold start; execute packaged live acceptance and installer rollback. No production release until gates pass.

Status update: P2 structural refactor and P3 unified task read facade were subsequently implemented in this integrated worktree. See `architecture-refactor-p2-p3-delivery-2026-09-21.md` for current implementation, regression results, measured latency and remaining production release blockers. Not merged into dirty main checkout, installed or released; no claim of a fix for ChatGPT-side timeouts.

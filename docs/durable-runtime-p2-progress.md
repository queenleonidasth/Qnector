# Durable runtime implementation: P2 preview and bounded-wait slice

Date: 2026-09-17. Branch: `feat/durable-runtime-foundation` (based on `feade3f`). **Opt-in development preview only; not activated in the installed QNECTOR, Electron, HTTP MCP or tunnel.**

## Implemented

- New `apps/daemon` Node-only executable and `packages/execution` detached-worker runner. Daemon binds an OS named pipe before opening SQLite so two daemon instances cannot both become live schedulers for the same data root. IPC accepts one bounded JSON-line request per connection; calls require a locally persisted random token. Node's `readableAll:false`/`writableAll:false` are set. A Windows cross-account ACL inspection remains a release gate.
- Dispatch uses P1 atomic accept and claim. Worker receives a one-time bootstrap, sends READY, daemon commits `markStarted`, then sends GO. The daemon never owns the command's process lifetime. Child stdout/stderr drain into separate disk spools; the independent worker writes completion manifest only after child close/pipe EOF.
- A new daemon imports existing completion manifests after a crash/restart. Manifest byte sizes and hashes are checked before database success; unknown executions never auto-replay. Real isolated Windows test terminates the daemon PID mid-command, starts a fresh daemon and proves one mutation and readable output.
- `ping`, `submit`, `get`, `list`, `output`, `wait`, and `result` are available on local IPC. `wait` is bounded to 20 seconds and returns a task handle on expiry; disconnecting the waiter does not cancel execution. Polling and a 1-second recovery sweep are temporary scaffolding, not the eventual event-driven P3 design.
- Schema/lockfile entries for the new workspace packages are added; no existing tool contracts or live runtime are changed. Previous unrelated modifications in three files remain untouched.

## Manual, opt-in local verification

From repository root, run `npx.cmd pnpm@10.15.0 typecheck`, then `node apps/daemon/dist/cli.js` in an isolated test environment. Set `QNECTOR_DURABLE_ROOT` to a fresh test folder before launch. This executable is **not** installed as a Windows service or launched from Desktop. The IPC client is in `apps/daemon/src/client.ts`; no public network listener is opened by this daemon. Stop the test daemon independently; do not confuse daemon closure with explicit task cancellation.

## Unmet gates / risks (do not advertise P2 or P3 as complete)

- Windows Job Object-based process-tree ownership, verified worker PID plus OS creation time/generation, verified ACLs and safe active-worker reattachment are NOT implemented. Workers without a valid manifest after losing the daemon may remain `starting`/`running` for manual inspection, intentionally never blindly replayed. Worker crash may leave a spawned child; no automatic safe cancel/retry is exposed.
- P2 `task.cancel` and child/grandchild kill confirmation, IPC storage worker/queue (SQLite calls remain synchronous), complete error/diagnostics/quotas/secret protection, safe full-output streaming performance and packaging/updater compatibility remain outstanding.
- No MCP `tasks.*` registry wiring, HTTP/stdio conformance, Desktop Jobs UI, workflow migration, older in-memory process import, or release/rollback rollout has been implemented. The preview currently persists command text in owner-local task metadata and bootstrap file; do not submit secrets in command strings or collect task definitions in diagnostics until credential-reference storage is implemented.
- No 24-hour soak, Windows reboot/forced power-loss validation, cross-account ACL verification, or packaged Windows smoke test. Current crash test covers daemon termination with a detached worker, not arbitrary worker crash or power loss.

Next gates: finish P2 worker identity/Job Object/cancel and schema-safe rollout, then wire P3 tools behind explicit capability flag and instrument end-to-end ChatGPT response-time budgets. HTTP-vs-stdio default must be decided from measured conformance/latency, not assumed.

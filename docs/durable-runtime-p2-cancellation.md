# Durable runtime P2: cancellation hardening (development preview)

Date: 2026-09-17. Branch: `feat/durable-runtime-foundation`. This change is **opt-in source-only** and is not installed, activated in Desktop, or registered in HTTP/MCP/tunnel.

## Implemented

- `cancel` is a separate authenticated IPC action that requires an explicit task ID. Disconnecting a waiter still cancels only its wait subscription; no implicit task cancellation occurs.
- Queued jobs transition to `canceled` inside the execution transaction and their dispatch intents are canceled. They are not launched, including after repeated cancel or daemon recovery.
- For running jobs, SQLite first records `canceling`; the daemon writes an attempt-scoped cancellation request. The detached worker checks it, requests termination of its own child process tree, waits for `close` (stdout/stderr EOF) and only then writes an attested cancellation completion manifest if the OS tree-termination command succeeded.
- The new daemon imports the worker's manifest, verifies attempt identity and retained output hashes, and commits `canceled` together with the manifest path. A valid natural completion racing with a cancel request retains the actual completion result instead of a false canceled state. Requests can survive daemon shutdown/reconnect.
- Cancel confirmation at the store layer now **requires a readable worker cancellation manifest** and its attempt ID. The user-facing `result` includes the persisted cancellation evidence, and output remains separately readable. No new job is spawned for the same task ID.

## Windows-specific behavior and remaining release blockers

- Current Windows termination is `taskkill.exe /PID ... /T /F` issued by the worker, with a successful exit status and Node child `close` required for confirmation. One integration test spawns a grandchild scheduled to create a file after cancellation and verifies that the file never appears. This is **not equivalent to Windows Job Object ownership** or a general guarantee about adversarial process trees and spawn races. Do not declare P2 production ready on this evidence alone.
- Worker PID + OS process creation-time verification, OS Job Object containment, comprehensive crash/timeout cancellation, stale leases, secure Windows ACL validation, queued storage worker, packaged Windows lifecycle checks, reboot tests and 24h soak remain unimplemented. An unverified death is `interrupted/unknown`; no automatic replay or fake success.
- The daemon still does not integrate with the installed Desktop or MCP. HTTP-vs-stdio and P3 task tool/API integration remain pending. Command snapshots may contain plaintext secret values; use isolated non-sensitive commands for preview testing. Avoid starting a default daemon on the production data root.

## Verification

Run `npx.cmd pnpm@10.15.0 typecheck`, `npx.cmd pnpm@10.15.0 test` and `npx.cmd pnpm@10.15.0 lint`. New tests cover: canceling an active command and grandchild, verifying no delayed write, importing cancellation after daemon restart, canceling a queued task without dispatch, and requiring a correctly matched cancellation manifest before committing `canceled`.

Rollback: this change is isolated to the opt-in daemon/execution packages and their tests. The installed v0.4.36 remains unchanged. To revert this source change without affecting existing unrelated dirty files, revert only its own commit or switch back to main after preserving the three pre-existing edits; do not reset the workspace indiscriminately.

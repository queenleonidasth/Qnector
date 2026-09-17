# Durable Runtime P2 — OS-fenced worker identity (development preview)

Date: 2026-09-17. Branch: `feat/durable-runtime-foundation`. Based on `865e95f`. This commit is **source-only, opt-in**: no installed QNECTOR, Electron, MCP, tunnel, service, or startup setting changes.

## Delivered

- A worker persists `worker-identity.json` after the daemon's GO handshake and **before launching any external command**. Identity includes attempt ID, generation, token fingerprint, worker PID, OS-observed process creation time and timestamp. The record is authenticated with an HMAC keyed by the attempt token, flushed and atomically renamed. The raw token is never included in the identity record, output or diagnostic IPC response; the ephemeral bootstrap contains the token and must remain protected by the local Windows account ACL.
- Read-only identity inspection checks the attempt ID/generation, fingerprint and HMAC **before** querying the OS process. Windows reads `Get-Process.StartTime` (UTC ticks); Linux uses `/proc/<pid>/stat` field 22. Unsupported/inaccessible OS observations return `unverified`, never `exited`.
- New authenticated local IPC `inspect` returns `alive`, `missing`, `unverified` or `exited` plus a reason. A verified exited original worker **without** a valid completion manifest transitions to `interrupted` with `outcome=unknown`, keeping the idempotency key and prohibiting automatic replay. Missing, invalid or tampered identity does not trigger termination, replay or false completion.
- Existing completion-manifest recovery takes precedence over identity inspection. Terminal tasks return a null worker status. Inspection does not send process signals and **does not** cancel a task.

## Validation and limitations

- New tests use real Windows processes to validate live/dead identities, tampered HMAC/OS start time, the IPC inspection path, and disappearance without manifest -> `interrupted/unknown` without a second dispatch. Existing daemon crash, cancellation and output tests are retained.
- Worker identity is a **diagnostic and reconciliation fence, not a Windows Job Object**. It does not implement safe process-tree reattachment or prove every grandchild has stopped. A worker crash can still leave a command child alive; an `interrupted` task requires human reconciliation before any new attempt. PID+creation time inspection must not be used to call `taskkill` because of the time-of-check/time-of-use race.
- `Get-Process` via a new PowerShell host increases worker startup and `inspect` latency; the operation is deliberately opt-in and is **not** called for every `get`, heartbeat or recovery sweep. Benchmark/replace with a native Windows process-handle query before switching this on by default.
- The daemon currently handles SQLite synchronously, Windows pipe/storage ACLs are not independently validated, and plaintext command snapshots can contain secrets. Packaged Windows smoke, Job Object containment, worker-crash child cleanup, power-loss tests, MCP task API, migration/rollback, and 24-hour soak remain release blockers.

## Rollback

Revert **only this commit** if necessary; do not hard reset the worktree or touch three pre-existing unrelated modifications to session-bootstrap and process-tool. No schema migration and no live installation changes were made. Old task records with no identity must be reported `missing`/needs inspection, not guessed dead or replayed.

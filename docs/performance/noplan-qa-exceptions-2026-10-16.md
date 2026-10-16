# QNECTOR NoPlan — QA exceptions, failed checks and deferred coverage

Recorded: 2026-10-16 (Asia/Bangkok)
Source: D:\Projects\Qnector-NoPlan-20261016
Verified source revision: b87140150e9abff9066b2d0e3d2ed76bb7eaa068 (clean Git tree)
Package: apps/desktop/release/durable-candidate-20261016-142915
Overall: 11 PASS, 0 FAIL, 2 SKIPPED, 1 UNKNOWN. Release not eligible.

## Operating policy

Record failures and unverified evidence, then continue independent engineering tasks instead of retesting a blocked step without new evidence. SKIPPED, UNKNOWN and FAIL are not PASS. The user explicitly waived tests involving concurrently running external companion applications. This report does not authorize production installation, publication or tag creation.

| ID | Finding | Status and evidence | Follow-up when viable |
|---|---|---|---|
| QA-001 | Controlled performance suite lacks nine-workload genuine process cold-start and comparable CPU/RAM/payload evidence at current exact revision | UNKNOWN, not PASS. fixtures/performance/task12-acceptance-report.json. Earlier audit in apps/desktop/release/durable-candidate-20261016-125851/qc-evidence/controlled-suite-audit.json is for old revision 76f8bcc, not current b871401 | Continue native startup profiling and safe local measurement instrumentation. Do not count fresh services or warm reads as true cold starts |
| QA-002 | Candidate Tunnel and ChatGPT Host need authorized external companion apps | Both SKIPPED by user request, not tested. Formal acceptance gate names tunnel and chatgpt-host | Continue HTTP/stdio/local and source regression; do not switch live credentials or expose a public endpoint |
| QA-003 | Windows Installer setup executable is NotSigned, and version v0.4.56 collides with existing release tag | RELEASE BLOCKER. Current setup SHA256 fda33c9ebe3cefe13688ca5e9fd84040dce733456e9cc2fbc88b0458c901600f. Package apps/desktop/release/durable-candidate-20261016-142915 | Preserve deployment guards; signing/version policy before public release. No unrequested production replacement |
| QA-004 | Attempted parallel native .NET build took about 9.3s versus 6.2s sequential in one local run | NO CLEAR WIN, NOT A CORRECTNESS FAIL. Both variants generated valid UIA and Job Host binaries; experiment reverted; Git clean | Move on to independent performance work; do not enable slower speculative optimization |
| QA-005 | Historical p95 >5% flags in read_many, fallback file search, semantic search and scanned PDF | INCONCLUSIVE, old revision 76f8bcc. apps/desktop/release/durable-candidate-20261016-125851/qc-evidence/p95-regression-audit.json. Some repeat runs reversed the sign of the apparent regression | Need robust same-load repeated distributions and comparable resource/payload sampling; do not extrapolate to current revision |
| QA-006 | Earlier Package Evidence test failed when parallel test workers temporarily dirtied Git tree | RESOLVED on b871401 by serializing acceptance test files. Latest formal test gate PASS, 449/449 tests across 98 test files | Preserve test:acceptance --no-file-parallelism, while standard developer tests may run in parallel |
| QA-007 | Foreground-game frame timing and genuine Windows low-memory canary unavailable without companion workload | NOT VERIFIED / user-scoped skip. Simulated resource-budget tests PASS but do not prove FPS or frametime behavior | Leave speculative prewarm disabled by default; continue safe native-only tests; never change game/Windows settings |

## Verified on the current revision

- Eight surviving grouped MCP tools; retired Plan Mode tools are not advertised.
- Packaged SHA256 provenance, native UIA/Job Host binaries, durable recovery, HTTP/stdio smoke.
- Real isolated packaged Electron GUI navigation across Workspace, Memory, Skills, Settings, no page errors. Evidence in apps/desktop/release/durable-candidate-20261016-142915/qc-evidence/electron-gui-gate.json.
- Acceptance test, typecheck and lint PASS; 11 PASS, 0 FAIL, 2 SKIPPED, 1 UNKNOWN.
- No change to current production connector, user data, game settings or installed application.

## Work continuation

For each new failure, add QA-### with exact source commit, command/fixture, observed output, root cause if known, and a revisit trigger. Continue the next independent task. Only rerun a failed or blocked check when its underlying reason has changed. Do not publish, tag, install, or declare release-ready while signing and mandatory local acceptance evidence are missing.

## Additional exception — QA-008 (15:15 Asia/Bangkok)

Attempted a local cached-fixture ABBA benchmark for proposed bounded-memory SHA-256 package hashing. The execution request was **blocked by safety checks before the benchmark ran**, so there is no CPU/RSS/p95 result. The proposed implementation had passed isolated hash-oracle unit tests, but that does **not** prove a performance improvement. Disposition: **NOT RUN / NOT VERIFIED**, not FAIL or PASS. Revert the speculative hash implementation and its standalone tests; retain the original verified release hashing behavior. Resume unrelated acceptance-reporting and startup profiling tasks. Only revisit with an explicitly permitted benchmark mechanism, not by circumventing the refusal.

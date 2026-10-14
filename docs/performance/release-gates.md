# Task12 release gates

Release is permitted only after every required gate has passing evidence on the exact clean commit to be released. Unknown evidence blocks release.

## Required gates

1. Read the approved implementation plan and current Git state; verify the intended release branch and target. `../devq.md` is absent in this checkout and must be recorded as unavailable.
2. Pass the golden API/permission/required-input contract and negative tests for Plan/Act, exact revision approval, guard bypass attempts, stale workflow revisions, unknown mutation outcomes, context freshness, migration rollback, feature flags and current-job recovery.
3. Pass `npx.cmd pnpm@10.15.0 typecheck`, `test`, `lint`, `git diff --check`, HTTP and stdio smoke, tunnel smoke where configured, native Job Host/UIA build and packaged Electron acceptance.
4. Run controlled same-load baseline/candidate ABBA or randomized comparisons for each workload: at least five warmups and 30 measured samples per variant, at least 10 cold starts, p50/p95 with confidence/noise, output correctness hash, actual payload bytes, CPU/RAM, and regression review. Token estimates are separate. Full host/model/client latency remains `UNKNOWN` unless observed at the client. No unexplained p95 regression over 5% is acceptable.
5. Build Windows assets from the exact clean commit with provenance; verify credentials availability without exposing secrets, signing provenance, disk space, checksums, package smoke and release target.
6. Verify remote release assets by exact name, size, uploaded state and SHA-256 digest. An uncertain publish response requires remote inspection; never blindly retry. Safe installed upgrade and post-upgrade checks are required.

## Current run status

Run `npx.cmd tsx scripts/accept-end-to-end-performance.mts` to produce `fixtures/performance/task12-acceptance-report.json`. The report marks unsupported gates `UNKNOWN`; only an all-`PASS` report is release-eligible. Never treat an unavailable ChatGPT host measurement as zero latency or as a pass.

The existing checked-in telemetry and `read_many` fixtures are local component measurements, not end-to-end acceptance. They do not establish the full workload suite, host timing, tunnel availability, signed packaged build, remote upload, or installed upgrade.

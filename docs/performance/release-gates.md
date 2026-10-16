# Task12 release gates

Release is permitted only after every required gate has passing evidence on the exact clean commit to be released. Unknown evidence blocks release.

## Required gates

1. Read the approved implementation plan and current Git state; verify the intended release branch and target. `../devq.md` is absent in this checkout and must be recorded as unavailable.
2. Pass the updated golden API/permission/required-input contract for the eight surviving grouped tools and opt-in tasks. Confirm retired planning tools/resources/prompts are absent; retain tests for stale workflow revisions, unknown mutation outcomes, context freshness, migration rollback, feature flags and current-job recovery. ChatGPT's own host permissions are unaffected by removal.
3. Pass `npx.cmd pnpm@10.15.0 typecheck`, `test`, `lint`, `git diff --check`, HTTP and stdio smoke, tunnel smoke where configured, native Job Host/UIA build and packaged Electron acceptance.
4. Run controlled same-load baseline/candidate ABBA or randomized comparisons for each workload: at least five warmups and 30 measured samples per variant, at least 10 cold starts, p50/p95 with confidence/noise, output correctness hash, actual payload bytes, CPU/RAM, and regression review. Token estimates are separate. Full host/model/client latency remains `UNKNOWN` unless observed at the client. No unexplained p95 regression over 5% is acceptable.
5. Build Windows assets from the exact clean commit with provenance; verify credentials availability without exposing secrets, signing provenance, disk space, checksums, package smoke and release target.
6. Verify remote release assets by exact name, size, uploaded state and SHA-256 digest. An uncertain publish response requires remote inspection; never blindly retry. Safe installed upgrade and post-upgrade checks are required.

## Current run status

Run `npx.cmd tsx scripts/accept-end-to-end-performance.mts` to produce `fixtures/performance/task12-acceptance-report.json`. The report marks unsupported gates `UNKNOWN`; only an all-`PASS` report is release-eligible. Never treat an unavailable ChatGPT host measurement as zero latency or as a pass.

## User-scoped local validation (16 October 2026)

The user explicitly opted out of tests that require simultaneously operating another app (such as the external ChatGPT host or separate tunnel client). Set `QNECTOR_SKIP_CONCURRENT_APP_TESTS=1` to report the `tunnel` and `chatgpt-host` gates as **SKIPPED**, never PASS. The report provides `localValidationEligible` separately; `releaseEligible` remains **false** whenever a gate is SKIPPED, UNKNOWN or FAIL. Real FAILs are never waived.

This scope does not exempt product-native correctness, packaging, checksums, versioning, trusted signing, local benchmark regressions, or in-place upgrade/rollback checks. Foreground-game and real ChatGPT latency remain unverified, not zero, even if the user waives running those companion applications.

The existing checked-in telemetry and `read_many` fixtures are local component measurements, not end-to-end acceptance. They do not establish the full workload suite, host timing, tunnel availability, signed packaged build, remote upload, or installed upgrade.

## Automatically recorded test exceptions

The acceptance runner writes its detailed JSON report and a second **redacted, human-readable QA exception report** for the same source revision. By default the latter is located under:

    apps/desktop/release/qa-reports/acceptance-exceptions-<12-character-Git-revision>.md

An operator may set QNECTOR_QA_REPORT_DIR to select another output directory. The sidecar records PASS/FAIL/SKIPPED/UNKNOWN counts, only unresolved gates, and an actionable revisit condition for each gate. It **never copies raw stdout/stderr or secret-bearing tool evidence** from the detailed JSON report. A golden public API mismatch is recorded as FAIL and does not prevent other independent checks from running.

The sidecar intentionally lives under the ignored build/release directory; acceptance evidence generation must **not dirty Git**, since that would invalidate the exact-commit package preflight. The tracked historical exception audit is in docs/performance/noplan-qa-exceptions-2026-10-16.md. A failed or missing local gate remains a release blocker even when the user instructs to continue unrelated work.

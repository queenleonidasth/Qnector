# QNECTOR End-to-End Performance — acceptance progress (15 October 2026)

Task: `task_4e4b23ce-169c-437a-8b60-122147a79517`; approved Act Mode Rev 4.

## Source, isolation, and feature policy

- Production / original source stays at v0.4.56 commit `e809591d9cceca0140c9cc66fdcf7b4dc62be0f6` and remains installed and unchanged.
- Candidate source commit at packaged verification: `3ed229ab23dcf289bc4d3dd50ca69f6eca31fd17` in `D:\Projects\Qnector-Performance-20261014-r4`, clean at packaging. Any later benchmark code commit requires a NEW clean package before eligibility.
- Workspace Scope, approvals, features and existing public actions were not intentionally changed by this acceptance work.
- Speculative prewarm requires `QNECTOR_SPECULATIVE_PREWARM=1`, defaults OFF, cache hard cap 128 MiB and aborts speculative work for detected game process or pressure; the user-requested work is not aborted.
- No update to installed production, main, tags, GitHub releases, Windows, GPU/driver settings or games.

## Proven acceptance runs

- Core `typecheck` PASS; `pnpm test` PASS **437 tests in 95 files**; `pnpm lint` PASS; HTTP MCP smoke PASS; semantic search acceptance PASS; public tool manifest PASS.
- `pnpm accept:performance` PASS after building `qnector-uia.exe`: PowerShell cold 1674 ms/warm 6 ms, UIA cold 315.62 ms/warm 6.46 ms with same persistent worker and clean shutdown. These are single-run observations, not controlled confidence intervals.
- Acceptance-runner issue `spawn EINVAL` on Node 24 Windows solved by fixed trusted `cmd.exe` invocation (never user-interpolated); release-preflight `pnpm.cmd` spawn fixed. Test report after repair: 14 declared gates, **8 PASS / 0 FAIL / 6 UNKNOWN** and `releaseEligible=false`.
- Package pipeline at clean source commit `3ed229a`: full 169 focused regression tests, 8 external MCP, Plan Panel UI at 435/451/700 px, Native Renderer UI at 420/435/451/700, clean Build, two compiled stdio parity tests, Durable Bundle and Recovery, packaged stdio, Plan Panel, diagnostics, all PASS. Pipeline exited 0.
- Candidate path `apps/desktop/release/durable-candidate-20261015-013300`. Setup 243651787 bytes SHA-256 `6A7F244C61B984502E9B082A90ECFD9E735D02F6BF4E378FF6DADEE2F4CF78B5`; portable 243322335 bytes SHA-256 `A5C2276CD194A028E38E940656DC61940F55638D046702B43B38522A7866A7F6`. Packaged build-provenance: source commit above, `dirtyTree=false`, pinned lock SHA `e7854df2517908d23957dac9229de627f8b9a98bcc25e013175baa977a26cd67`.
- Windows Authenticode independently returned `NotSigned` on BOTH candidate EXEs. Do not imply electron-builder's printed signtool attempts produced a signed package.

## Controlled samples (local, not ChatGPT-host timings)

- `scripts/bench-process-pool.mts`, process.run PowerShell fixture, warm 30 samples each: baseline median **1191 ms**, p95 **1206 ms**; opt-in pooled median **2 ms**, p95 **3 ms**; stdout marker and exit code matched. Cold 10 samples each: median 1190 ms baseline and 1191 ms pooled. This proves benefit for eligible warmed shell calls only.
- `scripts/bench-search-abba.mts`: original `e809591` vs R4 candidate, actual read-only LocalSemanticSearchService on equal synthetic Thai/English files, ABBA 5 warmup rounds/30 samples per variant, 10 fresh-service cold-index samples per variant, equality by stable output SHA-256, CPU/RSS, p50/p95 with bootstrap confidence. Reports retained in `fixtures/performance/controlled-search-abba-20261015.json`. Warm search improvements were small and run-to-run p95 noise was evident; no unconditional speedup claim.
- `fixtures/performance/controlled-process-pool-20261015.json` stores the corresponding process-pool fixture summary.
- `scripts/bench-e2e.mts` is a telemetry-only microbenchmark; this is NOT a full user-to-verified-workload comparison.

## Release blockers — do not bypass

1. **Unsigned executables**: an authentic release signing identity/certificate is unavailable. Both generated binaries are NotSigned. Treat any package signing requirements as unfulfilled.
2. **True end-to-end benchmarks incomplete**: ChatGPT host/model time, browsers/GUI target cache, document OCR/render/export, memory/Plan/context, build/release/recovery, full client-observed latency, and 10 cold-process boot samples remain unmeasured at the required ABBA sample depth. Unknown is not zero or PASS.
3. **Runtime acceptance incomplete**: authenticate and verify the real tunnel, actual packaged interactive app and installed upgrade continuity, user confirmation behavior, game foreground/resource budget canary, and rollback with preserved running task receipts.
4. **Additional Task 05-11 checklist conditions** are implemented partly but lack exact requirements/negative test and feature parity evidence. Do not mark them complete without independent validation.
5. **Version provenance**: built artifacts are still named 0.4.56 despite a different commit. A future eligible release requires version sync/bump, rebuilding clean exact commit, new tag, remote checksum verification and safe install. Never replace the existing v0.4.56 tag.
6. A copy of dev guidance `D:\Projects\devq.md` could not be found during inspection; do not invent guidance.

## Decision

**NO RELEASE, NO PRODUCTION UPDATE**. Preserve the tested candidate, the installed stable version and all task evidence. Report unverified gates as unresolved. Resume ONLY by satisfying all gates, then publish and verify remote assets and installed version. This document is a checkpoint, not certification that Tasks 01–12 are finished.

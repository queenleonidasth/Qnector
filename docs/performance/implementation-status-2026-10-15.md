# QNECTOR End-to-End Performance — implementation checkpoint (15 October 2026)

> Historical record: on 16 October 2026, the user separately authorized removal of Plan Mode, its approval guard and public aliases in isolated branch `refactor/remove-plan-mode-20261016`. The 15 October preservation rules below describe the prior scope, not the revised feature set.

Task: `task_4e4b23ce-169c-437a-8b60-122147a79517`; approved **Act Mode Revision 4**. User's latest instruction: **continue work; do not shut down the PC**.

## Isolation and production

- Stable QNECTOR stays installed at v0.4.56 commit `e809591d9cceca0140c9cc66fdcf7b4dc62be0f6`. Work is on isolated branch `feat/end-to-end-performance-20261014-r4` at `D:\Projects\Qnector-Performance-20261014-r4`.
- Do not change Workspace Scope, Plan/Act approvals, tool aliases, existing public actions, system/game settings, or running tasks.
- Speculative prewarming is opt-in (env `QNECTOR_SPECULATIVE_PREWARM=1`), disabled by default. Hard cache cap: 128 MiB; cancel only speculative work for RAM pressure or detected game activity. Not yet canary-verified while a real game is running.
- No merge, release, tag overwrite, upgrade or shutdown has been performed.

## Verified local code and regression acceptance

- Full `typecheck`, `lint` and `pnpm test`: **446/446 tests across 96 test files PASS** on `2728833`. Later `46e4ec3` cache-clear fix passed targeted typecheck, lint and ContentCache tests, but full suite has not yet been rerun on that exact latest commit.
- `read_many` streaming SHA-256: legacy string calls remain byte-compatible; added tests for ordered budgets, range reads, Thai Unicode, BOM, symlinks, empty and out-of-range files, and changed source between stat/read. Added stat identity matching (`ino` and `dev`) on large files, tested deterministic stale-source rejection. Commits `b3469c0`, `3340886`.
- Workflow recipes: new integration tests compare actual standalone git status/diff results against the persisted recipe step results; errors propagate, dependent steps remain skipped, invalid revisions are rejected before effects, and lost submission responses can be retried with the same idempotency key without duplicate runs. Generic WorkflowManager suites cover cancellation and unknown outcomes. Commits `f9f72fb`, `2728833`.
- ContentCache stale-result correction: `clear()` now invalidates in-flight reads even if no previous generation existed for the path; new negative regression test proves old results cannot repopulate cache. Commit `46e4ec3`. This correctness fix does **not** by itself prove LSP cache integration.
- Public API golden contracts, HTTP MCP smoke, semantic search, typed recipes, result hydration, GPU/UI tests and Plan/Act tests previously passed in full-suite acceptance.

## Built and attested artifact — NOTE: older exact commit

Last independently verified clean-build artifact is **9d1d94e** (before later code changes), at
`apps/desktop/release/durable-candidate-20261015-094030`.

- `package-acceptance.json` includes verified exact source revision, lockfile, SHA-256 of both EXEs and all key native resources, compiled stdio smoke, recovery smoke, Plan Panel UX and native TypeScript diagnostics.
- Setup SHA-256: `22A6F1556DC12746258625E2D813BF0AEE1522B4ADAFD5A999A94FF7C03DE662`.
- Portable SHA-256: `92C15957F97913A176445998D5E4DD3C24A3720EE79CCA26F1A7760735F83ABF`.
- Both EXEs were `NotSigned` (same unsigned state as installed v0.4.56); do not assert signing provenance from builder output.
- **This artifact is NOT equivalent to the latest code**. A fresh clean package from the intended final HEAD is required before installation/release eligibility.

## Controlled performance evidence (local, synthetic)

- ABBA `read_many` comparison to original `e809591`: fixtures with 1 large, 20 small and 100 small files; 5 warmup rounds, 30 measured samples/variant and 10 fresh-registry samples/variant; equality via SHA-256 and CPU/RSS/p50/p95/CI in `fixtures/performance/controlled-read-many-abba-20261015.json`, refreshed on candidate `46e4ec3`.
- 1 large file warm p50 baseline **3.472ms**, candidate **2.444ms**; p95 **6.433ms** vs **3.034ms**.
- 20 small files warm p50 **1.847ms** vs **1.461ms**, p95 **2.988ms** vs **2.553ms**.
- 100 small files warm p50 **7.949ms** vs **5.508ms**, p95 **9.052ms** vs **6.166ms**.
- Semantic Search ABBA on 20/100 Thai and English test files: stable output hashes with 30 warm/10 cold-index service samples and 95% bootstrap CI, in `fixtures/performance/controlled-search-abba-20261015.json`. 20-file p95 sometimes regressed by ~0.18ms (~sub-ms noise/overlapping CI), so no unconditional speedup claim.
- Opt-in warm PowerShell pool previously measured baseline median **1191ms**, pooled median **2ms** for safe reusable commands; cold ~1190ms in both conditions. This is a narrow fixture, not all commands.
- The above does **not** measure a user's ChatGPT wall-clock/model/network time, fresh process cold boot, document OCR/render/export, real CDP/UIA interactions, resource consumption while gaming or full cross-provider fallback.

## Release blockers and mandatory next gates

1. Latest Acceptance Runner on packaged `9d1d94e`: **10 PASS / 0 FAIL / 4 UNKNOWN**, releaseEligible=false. The UNKNOWN gates are **tunnel, electron-gui, chatgpt-host and controlled-performance-suite**. Newer source commits require a new package and rerun.
2. Act Checklist after verification of Task07 edge cases and Task05 failure/equivalence: **24 of 43 complete**; 19 remain. Unverified steps must stay unchecked.
3. A controlled full-workload ABBA suite still needs browser/UIA, documents, recipes, memory/context, process/waits, startup/build/release, flags/canary; 10 truly cold process starts and observed host timing remain missing. No regression claims based on overlapping sub-ms noise.
4. Real candidate tunnel and ChatGPT host tools-list exposure, interactive Electron GUI acceptance, game foreground/RAM pressure, migration/old-task recovery and rollback need verified evidence. Never bypass user approvals.
5. For any eligible release: choose new version (do not replace tag `v0.4.56`), clean exact source build and provenance, signing policy, GitHub remote asset size/digest verification, installed upgrade continuity and rollback readiness. Do not deploy with UNKNOWN gates.

**Decision: NO RELEASE / NO INSTALLED UPDATE / NO SHUTDOWN** until all required gates and all approved checklist steps are verified. The working branch and baseline evidence are preserved.


## Additional verified work after the earlier checkpoint (2026-10-15)

- Commit `e210bfe`: bounded snapshot-based PDF, XLSX, DOCX and ZIP extraction caches, with SHA-256 revisions for archives/workbooks and input sheet selectors. DocumentSession invalidation cannot resurrect completed stale in-flight results; PDF renderer always destroys its parser even on exception. New Thai, corrupt ZIP, missing XLSX sheet and cancellation/invalidation regressions PASS.
- Commit `ce28872`: real pdfjs-dist three-page blank scanned PDF rendering QC verifies actual PNG header, width and page count; corrupt PDF errors are propagated instead of OCR success. ABBA document parser benchmark in `fixtures/performance/controlled-documents-abba-20261015.json`, original e809591 versus candidate e210bfe, 5 warmup rounds, 30 samples per variant, 10 cold-session (not process) samples, p50/p95, 95% bootstrap intervals, CPU/RSS, stable full output and metadata SHA equality across PDF/XLSX/DOCX/ZIP. All four scenarios PASS, but scanned PDF OCR remains unavailable and no genuine process-cold boots were tested.
- Full suite on `ce28872` after document improvements: 454/454 tests in 98 files, typecheck and lint PASS. Later targeted TypeScript cache and release guard tests passed; full suite/latest clean package remains pending after the latest commits.
- Commit `bf67056`: TypeScript LSP project cache is bounded at six entries with LRU eviction and disposal of replaced language service objects; regression verifies seven concurrent-project fixtures, eviction, reacquire, and updated source revision. This is built-in TS intelligence, NOT evidence that every external generic LSP server supports safe caching.
- Commit `a12a090`: release publisher rejects an existing tag which does not point to HEAD; mandatory exact-commit SHA-256, lockfile, native and packaged smoke evidence checks execute before any remote publish. Negative source tests PASS. No publish attempted. Existing `v0.4.56` tag points to production e809591, not the feature branch, and MUST NOT be overwritten.
- Actual read-only installed QNECTOR UIA inspection observed the production window at 451 px width, but Chromium's accessibility tree exposes only native panes; no full interactive UIA verification of the candidate was possible. Dedicated browser/CDP managed automation could not start because Chrome/Edge executables were unavailable. Neither finding is a passing Electron/CDP host gate.
- Latest previously verified package still belongs to commit `4ecf187`; new source commit needs a clean rebuild and new acceptance report. Signed binaries, client-observed host/tunnel performance, true game foreground canary, migration/upgrade/rollback and full-workload ABBA remain unresolved.
- Act Mode Revision 4: 26 of 43 checklist steps supported and marked done after closing the new document session/profile tasks; 17 remain. Explicit user restriction: DO NOT SHUT DOWN the PC.

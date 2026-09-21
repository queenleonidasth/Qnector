# Agent Reach isolated install progress — 2026-09-19 15:48 ICT

User authorized installing all necessary dependencies, but prior no-release/no-disruption requirements remain.

- Isolated root: `%LOCALAPPDATA%\Qnector\integrations\agent-reach\`; upstream source cloned and detached at `a19a171fa980a0785849596492e0af4db800c82f` (Agent Reach 1.5.0). No global PATH or QNECTOR installed-app changes.
- Python venv installed from that checkout with upstream `constraints.txt`, including yt-dlp `2026.07.04`; `pip check` passed. Upstream `install --env=auto --dry-run` exit 0, no changes. Do NOT run `--system`: dry-run includes unrelated gh CLI and mcporter global installation.
- OpenCLI `@jackwener/opencli@1.8.7` installed under isolated `opencli` prefix using `--ignore-scripts`; registry integrity `sha512-2M+oPc70R1jNGzKzNrsm3fN4/gdvxCKlla7s9eaaTjkDjlzHpoZFN1YdV01A185kwCTN/ChOg+rbO4epO73c3w==`. Node CLI --version returned 1.8.7. Its postinstall/prepare scripts deliberately NOT executed; daemon/extension not started or authenticated.
- Live Agent Reach doctor JSON uses ROOT platform keys (`youtube`, `facebook`), not `channels` wrapper. Fixed local parser accordingly. In temporary process-only PATH including venv Scripts, doctor reports YouTube `warn` with active_backend `yt-dlp`, Facebook `off`. Child command runner now scopes PATH to pinned executable's sibling directory only. Neither platform content smoke nor extension auth verified.
- Current Facebook OpenCLI npm installation exposes `opencli.cmd` and Node JS entry, NOT `opencli.exe` required by current allowlist. A secure pinned Node+entry adapter must be implemented and tested before enabling Facebook. Chrome extension needs manual installation and sign-in; do not access cookies or existing user browser without dedicated verification.
- After parser/PATH changes, Typecheck and targeted social tests passed (5/5). Previous full suite before these edits: 327/327. Re-run full suite after integration completed. Feature remains OFF, no commit/push/release/restart.
- Outstanding: actual YouTube metadata/search/subtitles, OpenCLI Facebook CLI schema/auth, security and noninterference tests, durable P4 package gates. Do not claim pilot complete.

## Live smoke follow-up (16:45 ICT)

- Direct pinned yt-dlp metadata read succeeded on a public YouTube video and returned a real canonical video URL, title and available subtitle-language metadata. Direct YouTube search returned two actual result URLs.
- An end-to-end `executeSocialRead` read initially failed with `PARTIAL` because yt-dlp `--dump-single-json` included >256 KiB automatic-caption metadata. Replaced it with six explicitly selected JSON scalar fields, preserving the hard output cap. A fresh end-to-end read succeeded with one verified title/URL, `METADATA_ONLY` and explicit `TRANSCRIPT_UNAVAILABLE`. End-to-end YouTube search also succeeded with two verified items.
- Facebook doctor now detects locally installed OpenCLI 1.8.7 but reports the Chrome extension disconnected; it is not authenticated or ready. Package provides `.cmd` and Node JS entry, not `.exe`; the existing read-only adapter must NOT claim this provider works until a strictly scoped Node entry invocation is implemented and tested. Do not launch daemon/Chrome automatically merely to obtain a green doctor badge.
- Typecheck and focused social tests pass after metadata fix. Full regression and packaged smoke still required before release. Nothing installed globally, no Chrome cookies read, no QNECTOR restart/release.

## Regression rerun (16:51 ICT)

After the YouTube metadata output fix, `pnpm.cmd typecheck`, `pnpm.cmd lint`, and full `pnpm.cmd exec vitest run --maxWorkers=1` all exited 0: 66/66 test files, 327/327 tests. This is NOT a Facebook authenticated test, transcript test, packaged Windows test, or proof of noninterfering OpenCLI browser behavior. Social remains disabled in installed QNECTOR. The current Facebook adapter cannot execute npm's `.cmd` shim with shell=false; implement a vetted Node executable + exact package JS entry before enabling it. The user must manually install/enable the official OpenCLI Chrome extension and sign in to Facebook in the chosen browser profile before an authorized smoke test. No Release.

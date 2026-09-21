# Social reader P0–P3 implementation report (2026-09-19)

Status: LOCAL DEVELOPMENT / FEATURE DISABLED / NO RELEASE / LIVE PROVIDERS NOT VALIDATED.

## Baseline and safety

- Development HEAD at task start: `528a53a`, branch `feat/durable-runtime-foundation`; Qnector installed process was not stopped or replaced.
- `AGENTS.md` specifies `../devq.md` as product truth; file absent. Product-spec gate remains open.
- Upstream Agent Reach HEAD retrieved via `git ls-remote`: `a19a171fa980a0785849596492e0af4db800c82f`. This is a revision reference, NOT a completed audited dependency pin or checksum.
- Observed `py -3 --version`: Python 3.13.15; Node v24.19.0. No `agent-reach`, `opencli`, `yt-dlp`, or `chrome` commands found via PATH probing. CLI help, doctor actual JSON and Facebook authentication cannot be verified locally yet.
- Did not run upstream installer, set system PATH, open browser, read Chrome cookies, change system dependencies, restart installed Qnector or publish anything.

## Implemented source prototype

- Optional `social` config, OFF in defaults and supported by existing config schema; runtime paths must be explicitly selected.
- Typed social request/result and strict platform allowlist; read-only `social` MCP schema integrated in existing ToolRegistry for both HTTP/stdio. Existing Skill routing recognizes new `social` tool and a concise bundled `skills/social-reader/SKILL.md` was added.
- Agent Reach doctor adapter for `doctor --json` with bounded execution and a 30-second cache. Current `channels[platform].active_backend` parser shape is unverified until pinned CLI fixture is obtained; fail-closed.
- Typed yt-dlp metadata/read and YouTube search templates, OpenCLI Facebook search template. Direct spawn without shell, explicit executable paths, limited output/time, no inherited arbitrary environment secrets, platform URL validation and bounded item excerpts. No media download, posting or automated login.
- Not implemented/promised: transcript text extraction, Facebook arbitrary post reading, feed/profile, full image enumeration, account authentication, background/durable `social.start/status/result/cancel`. Those return an unsupported/error status or metadata-only result until upstream verification / P4 proof.

## Live pilot blockers and next authorized gate

1. User approval for exact isolated Agent Reach/pinned yt-dlp/OpenCLI installation path; inspect upstream transitive requirements and capture artifact checksums, then doctor/help output without `--system` or global changes.
2. Manual Chrome extension installation and sign-in/authorization by user, preferably disposable test profile. Do not assume Zen or headless Chrome is compatible.
3. Capture real doctor schema and CLI structured output; test YouTube metadata, actual transcript retrieval/no subtitles, YouTube search and authenticated Facebook search. Expand to feed only if verified and consented.
4. P4 typed durable worker / packaged restart and cancellation tests before advertising durable social calls. Current existing durable runtime is untouched/reused for other tools; social calls are synchronous only.
5. Verify focus/cursor/window noninterference in dedicated test session; NEVER conduct intrusive GUI tests on active gaming desktop.

## Rollback

Keep `social.enabled=false`, do not configure executable paths; all existing tools work without Agent Reach. Source changes are uncommitted and no installed app changes made. Preserve existing Chrome profile, user files and other dependencies.

## Tests

Targeted security tests: 5/5 passed. MCP grouped-tool regression: 44/44 passed. HTTP/stdio social disabled-path parity: passed (see latest Vitest log). Final workspace run: `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd build` all exit 0; `pnpm.cmd exec vitest run --maxWorkers=1` passed 66/66 files and 327/327 tests (2026-09-19 15:23 local). This is source-level regression, NOT live upstream provider or packaged Windows acceptance. The release gate stays blocked.

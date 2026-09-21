# QNECTOR × Agent Reach — resumed implementation and verification (2026-09-19)

## Status / release gate

P0–P3 SOURCE PILOT: YouTube metadata, search and manual-caption read validated against live public YouTube; Facebook search CLI command and isolated Node entry verified statically and via mocks, but **no authorized Chrome/OpenCLI extension session**, so Facebook live-read acceptance remains blocked. Source feature flag remains OFF by default. Social calls are synchronous only: no P4 durable social job claims. **NO COMMIT, PUSH, RELEASE, INSTALLED-APP RESTART OR USER BROWSER AUTOMATION.** Existing unrelated worktree changes were preserved. Installed Qnector processes remained present during checks.

## Dependencies / authorization

Previous user approval covered an isolated install. Agent Reach checkout pinned at `a19a171fa980a0785849596492e0af4db800c82f` (1.5.0), isolated Python venv with yt-dlp `2026.07.04`, isolated OpenCLI npm package `@jackwener/opencli@1.8.7`, under `%LOCALAPPDATA%\Qnector\integrations\agent-reach\`. No system-wide PATH/dependency changes in this resumed session. Installed OpenCLI entry is `opencli\node_modules\@jackwener\opencli\dist\src\main.js`, invoked only through an explicitly selected Node binary with `shell:false`, never its `.cmd` shim. `facebook search --help` confirms a read-only command, query positional argument, `--limit`, YAML/JSON output and columns `index,title,text,url`; this does NOT prove login or browser safety. Local Agent Reach doctor reports YouTube warn/yt-dlp active and Facebook off/extension disconnected. The upstream's read-only doctor probes loopback daemon status rather than launching OpenCLI doctor (which could start a daemon).

## Work completed in this resumed session

- Verified current branch/worktree and original reports; `../devq.md` remains missing despite `AGENTS.md` requiring it. Did not touch unrelated changes or installed binaries.
- Inspected the existing pinned Node + OpenCLI entry adapter and added two fixture-based tests: parse OpenCLI's real YAML-array schema while dropping unsafe Facebook URLs, and fail closed on an unexpected response shape. Existing injection test still verifies literal argv (no shell).
- Improved yt-dlp isolation: optional configured Node executable is passed directly via `--js-runtimes node:<absolute-path>` and a minimal PATH scoped to that verified executable; set `--no-remote-components` for metadata, search and caption invocations. No global yt-dlp config edits, no remote JS component downloads or video downloads.
- Added assertions that the Node runtime and no-remote-components flags are used in caption reads. Updated the `social-reader` Skill and MCP tool description to reflect verified captions, while keeping the durable and Facebook limitations explicit.
- Fixed stale `scripts/smoke-mcp.ts` tool-count assertion (8 -> exactly 9 named tools) and added an actual disabled-by-default `social.health` MCP call. The separate smoke retry passed with the full 9-tool registry.
- Ran an isolated, temporary, read-only TypeScript live probe against local Agent Reach with public YouTube video `jNQXAC9IVRw`: health reports YouTube read/search `true`, Facebook search `false`; live read `ready`, one verified item, `PARTIAL`, 217 characters of actual manual English captions; live search `ready`, two verified results, metadata only. The probe script was deleted after execution; no raw transcripts, browser cookies or tokens were logged.

## Test evidence

- Initial source regression after Facebook tests: `pnpm test`: 70/70 files, **336/336 tests passed**; `pnpm lint` and `pnpm build` passed. An obsolete MCP Smoke assertion failed (expected 8, got 9), then was fixed and its standalone retry exited 0 with `social.health` disabled.
- After Node-runtime improvements: social-specific suite **14/14 passed**, `pnpm typecheck` passed, `pnpm lint` passed. Full final regression/build/MCP smoke rerun is initiated; record final results below rather than assuming they passed.
- Final regression after Node runtime, Skill wording and MCP Smoke changes: `pnpm.cmd test` passed **70/70 test files and 336/336 tests**; `pnpm.cmd lint` exited 0; `pnpm.cmd build` exited 0; `pnpm.cmd smoke:mcp` exited 0 with 9 named tools including `social`, and `social.health` confirmed disabled by default. Targeted social suite: 14/14 passed; `pnpm.cmd typecheck` exited 0. Prettier check on all touched TypeScript files passed.
- The live YouTube test is evidence for one public video with manually available English subtitles and one two-item search, not proof that every YouTube video has captions.

## Release blockers / next gate

1. **Facebook account and browser authorization:** Install/enable the official OpenCLI Chrome extension and sign in manually in an explicitly chosen test profile. Confirm connected status via read-only doctor, then test a real Facebook search, signed-out and extension-disconnected cases, plus foreground-focus/mouse/window noninterference in a disposable Windows session. Do not access the user's personal Chrome cookies, auto-login, start a daemon or open/close existing browser windows to fake readiness. Keep Facebook disabled until proof exists.
2. Facebook feed, profile and arbitrary post/photo reading are intentionally unsupported by the QNECTOR adapter until separate command/output and account-scoped tests pass. Do not claim image enumeration or universal social reading.
3. Packaged Windows smoke and a dedicated no-focus test session remain unverified. P4 durable social start/status/result/cancel is not implemented and must not be advertised as working despite unrelated Durable Runtime tests passing.
4. Required product source `../devq.md` is missing; restore or resolve the source-of-truth gate. Do not deploy the prototype to the currently running app until release gates are met.

## Rollback and handoff

Keep `social.enabled=false` and `platforms=[]` (defaults). Source edits are confined to social pilot, its tests/skill/docs and MCP Smoke; preserve other worktree WIP. No installed-app restart or release; existing installation remains unaffected. Final regression evidence is recorded above. The next gate is a manually authorized isolated Chrome test for Facebook, followed by packaged Windows and no-focus acceptance, before considering a release.

# QNECTOR × Agent Reach — Social & Media Reader Implementation Plan

Date: 2026-09-19 | Status: PLAN ONLY (not implemented, not installed, not released)
Target: Windows QNECTOR; read-only social access from ChatGPT via the QNECTOR MCP bridge.
Primary pilot: YouTube + Facebook. Next: Instagram + Reddit + X. TikTok: separate feasibility spike; do not claim Agent Reach support.

## 0. Source of truth / baseline

- Upstream: https://github.com/Panniantong/agent-reach ; https://github.com/Panniantong/agent-reach/blob/main/docs/install.md ; https://github.com/Panniantong/agent-reach/blob/main/agent_reach/skill/references/social.md ; MIT license. Re-check and PIN an audited upstream commit before any install; `main.zip` in upstream documentation is not reproducible.
- Agent Reach is an installer, backend selector and health checker, NOT a unified content-fetch API. `agent-reach doctor --json` reports each channel's active backend; QNECTOR must invoke vetted upstream executables (e.g. `yt-dlp`, `opencli`) through typed adapters and parse their results. Never assume `agent-reach read URL` exists.
- Facebook/Instagram: OpenCLI + the user's existing, explicitly authorized Chrome login session and OpenCLI extension; not guaranteed to work through Zen. User must install extension/log in manually. Facebook documented search/profile/feed/groups list; arbitrary posts and comments, multi-image extraction, and universal URL reading require separate verification. Instagram `search` means USER search, not global post keyword search.
- YouTube: yt-dlp video metadata, searches and available subtitles. A clip without accessible subtitles must produce `TRANSCRIPT_UNAVAILABLE`, not an invented summary. Download/transcription of audiovisual media is a separate opt-in feature, not MVP.
- Local repo inspected: `packages/tools/src/index.ts` registers tool definitions/handlers; `packages/mcp-server/src/server.ts` constructs runtime; `packages/core/src/agent-skills.ts` maintains routing and tool allowlist; `packages/tools/src/browser-tool.ts` has Playwright/CDP managed browser; `packages/mcp-server/src/durable-task-tool.ts` has `tasks` interface; `apps/daemon/src/server.ts` owns durable work. `packages/core/src/config.ts`/`packages/shared` own configuration. `apps/desktop/src/renderer/skill-manager.tsx` and `renderer.tsx` own UI. Check current paths/exports again at implementation start.
- Repository `package.json` reports v0.4.42 but older documents mention installed v0.4.41 and a pre-existing intermittent cancellation test (317 passed, 1 failed). Establish fresh HEAD/test baseline and resolve release blockers; do not infer installed version from package metadata.
- `AGENTS.md` requires keeping headless MCP usable without Electron, Node 22+/pnpm, no ChatGPT browser automation/cookies, and reading `../devq.md` before changing code. `../devq.md` was not found at inspection time: report missing product source of truth, do not fabricate it. Keep QNECTOR's existing personal full-access bridge model; use feature-specific read-only command constraints, not a wholesale permissions-system redesign.
- Existing QNECTOR browser headless mode is not a guarantee that OpenCLI Chrome-extension operations work headlessly. Test separately in a disposable profile. No interference with foreground games/keyboard/mouse.

## 1. Goal, non-goals and user stories

**Goal:** ChatGPT invokes one discoverable `social` MCP tool in QNECTOR to inspect health, read/search supported social content, get structured, bounded results with canonical URL/provenance, and optionally start long read-only jobs with durable handles. No raw cookies/tokens/HTML dumps are returned.

User stories / MVP acceptance examples:
1. `social.read(url=YouTube URL)` -> title/channel/date/description/transcript available + original URL, partial-data flags.
2. `social.search(platform=youtube,query=...,limit=5)` -> actual search results with links (never fabricated).
3. `social.search(platform=facebook,query=...,limit=5)` -> OpenCLI results when session healthy; otherwise `AUTH_REQUIRED`, `BACKEND_UNAVAILABLE`, or `UNSUPPORTED` with clear fix.
4. `social.feed(platform=facebook,limit=10)` -> only account-visible feed, explicit account/session scope, no writing.
5. `social.health()` -> per-platform installed/auth/session/backend status with secret-safe errors and remediation.
6. A post URL or image-list request must return verified supported output or `UNSUPPORTED_OPERATION`/`PARTIAL` rather than claim it gathered every image.

Non-goals MVP: publishing, likes, follows, comments, DMs, uploading, auto-login, CAPTCHA/anti-bot circumvention, bulk harvesting, private content outside authorized visibility, unrestricted arbitrary shell commands, stealth browsers, full TikTok support, using ChatGPT session cookies, silently extracting personal browser cookies, or altering existing QNECTOR stable installation.

## 2. Target architecture

ChatGPT -> QNECTOR MCP `social` -> typed dispatcher + URL/platform validation -> `SocialCapabilityService` -> `AgentReachDoctor` (`agent-reach doctor --json`, cached) -> `BackendResolver` -> `YouTubeAdapter` (yt-dlp) / `OpenCliAdapter` (Facebook/Instagram/Reddit only where doctor confirms) / optional named adapters -> output parser/normalizer -> QNECTOR result bounder/redactor -> ChatGPT.

Long calls: `social.start` should submit a typed SocialReadJob through an EXISTING daemon-owned durable execution mechanism and immediately return `taskId`; `social.status`/`social.result` use durable task handles and bounded result/output. Do not tell the model a job survives UI close unless package-level Windows survival is tested. Do not create an arbitrary shell template from URL/query. If existing daemon accepts only direct file + args, use a tightly scoped QNECTOR-owned worker executable/subcommand with validated arguments; prefer an internal typed job handler if appropriate after auditing daemon extension points.

Agent Reach remains a separately installed dependency. QNECTOR owns MCP schema, structured result contracts, timeouts, sanitization and activity logging. No new independent long-lived worker/SQLite store where current durable infrastructure can be reused.

## 3. Work packages with concrete target files

### P0 — Baseline and upstream review (blocking)

- Inspect Git HEAD, branch, uncommitted changes and current tests. Preserve unrelated/untracked files; do not rebase/reset/restart/install/release. Find missing `devq.md` source of truth or record absence as open gate.
- Review and pin Agent Reach tag/commit, upstream requirements, `doctor --json` actual shape, Windows support and `opencli`/yt-dlp commands; audit license/dependency transitive security. Verify platform behavior from executable `--help` and safe test commands, not README alone.
- Probe installed Python Launcher (`py -3`), Chrome, Node and OpenCLI extension WITHOUT changing user settings. Produce a capability matrix with observed/untested/unsupported states.
- Exit: recorded baseline, pinned versions/checksums, secure setup steps, and no effects on existing install.

### P1 — Dependency bootstrap (opt-in)

- Add `packages/core/src/social/agent-reach-environment.ts` for discovery of a user-selected absolute venv Python/CLI path, resolved child executables and versions; no global PATH mutation. Add explicit config schema extension under `packages/shared/src/` (locate actual schema file): `social.enabled=false`, allowed platforms, selected runtime path, auth mode (`existing-chrome-session` only if configured), per-backend timeouts, safe limits, no credentials.
- Install upstream in `%LOCALAPPDATA%\Qnector\integrations\agent-reach\venv` or separately approved dedicated path; upstream persistent config in user home `~/.agent-reach/`, not repo; respect upstream instructions. Stage from audited pinned commit and verify hash. `agent-reach install --env=auto --dry-run` then `agent-reach install --env=auto` for diagnostics. NEVER run `--system` or optional channel installation without explicit approval; no global package-manager, firewall, system/registry modifications.
- Meta channel setup (separately approved): documented upstream `agent-reach install --env=auto --system --channels=facebook,instagram` can install/change system tools, so show exact dry-run impact first; user installs OpenCLI Chrome extension and signs into Chrome manually. No promise for Zen. Keep login status `AUTH_REQUIRED` until verified.
- Add feature flag and read-only doctor; disable/uninstall option must not erase personal Chrome profile or other shared packages.
- Exit: independent install/dry-run passes, version pin visible, disabled-by-default feature has zero startup impact.

### P2 — Backend provider abstractions

- New `packages/core/src/social/types.ts`: union `Platform = youtube|facebook|instagram|reddit|x`, `SocialOperation = read|search|feed|profile|health`, `Capability`, `NormalizedItem`, `SourceRef`, `SocialError`, `AuthState`, `ResultCompleteness` and typed per-platform abilities; define `supported` PER OPERATION, not just per platform.
- `packages/core/src/social/agent-reach-doctor.ts`: run exact known binary and literal argv `["doctor","--json"]` with bounded wall clock/stdout/stderr; parse actual JSON schema after fixture capture; cache for 30–120s, invalidate after setup; parse failures => `DOCTOR_UNAVAILABLE`. A `doctor` ready badge is not proof of a successful authenticated content read.
- `packages/core/src/social/backend-resolver.ts`: choose upstream active_backend only if operation supported, binary present and controlled session available; no cross-account fallback; stop for 401/403/429/CAPTCHA/auth-expired, prompt manual intervention; fallback only for documented supported alternatives after safe read-only failure. Bounded once or twice; no recursive retry storms.
- `packages/core/src/social/command-runner.ts`: literal executable allowlist, hardcoded subcommand/flag templates, string args via spawn/execFile without shell, URL scheme https only and host+redirect checks, bounded child memory/output, concurrency semaphore, abort/cancel/kill process tree when proven safe, redacted error messages. Deny private/loopback/link-local/metadata hosts for network URLs unless an explicit vetted first-party backend requires different access; protect against SSRF and URL-based command injection. Never inherit or echo unrelated secrets in child environment.
- `packages/core/src/social/adapters/youtube.ts`: yt-dlp CLI read/search metadata and transcript path as actually supported by verified version; subtitle language selection (th/en preferred), manual captions vs auto captions labeled, size limit and transcript chunking; no full media download. Use temp directory and clean only owned files.
- `packages/core/src/social/adapters/opencli.ts`: explicit per-platform command templates based on installed `opencli <platform> --help`, e.g. `opencli facebook search QUERY -f yaml`, `facebook profile`, `facebook feed --limit N`; `opencli instagram search` only users; parse verified YAML/JSON with strict limits (do not invent generic `read URL`); handle extension disconnected/session expired. If no reliable JSON, parse YAML using existing dependency safely with alias limits and schema validation.
- Exit: fully mocked command runner/doctor/provider tests, no arbitrary OS commands or secret leakage, unsupported combinations are explicit.

### P3 — QNECTOR MCP + skill routing

- Add `packages/tools/src/social-tool.ts` exposing ONE tool: `social` with `action=health|capabilities|read|search|feed|profile|start|status|result|cancel`, strict action-discriminated validation, platform/url/query/limit/taskId/idempotencyKey; per-action narrow result shapes and compact descriptions. Default limit 5, hard cap 20, normalized text excerpts not raw HTML. `start/status/result/cancel` only if the typed durable binding is proven; otherwise ship synchronous read operations first.
- Register definition and executor in `packages/tools/src/index.ts`; bind service in `packages/mcp-server/src/server.ts` and ToolContext in `packages/tools/src/tool-result.ts` only as necessary. Update `packages/core/src/agent-skills.ts` KNOWN_TOOLS and references/routing to include `social`; create a concise bundled `social-reader` SKILL.md following actual bundled skill location and metadata conventions. Distinguish reading from posting and downloading. Avoid loading full upstream SKILL.md/command docs into initial chat context; lazy-load per platform only. Do not pretend existing `system.context_snapshot` dynamically hides actual MCP schemas.
- Return `{ok, platform, operation, backend, status, items, sourceUrl, retrievedAt, completeness, warnings, nextCursor, taskId?}` (integrate with existing ToolResult envelope rather than duplicating it). Include provenance and authentication status only, no account identifiers by default.
- Errors: `NOT_INSTALLED`, `CHANNEL_DISABLED`, `AUTH_REQUIRED`, `EXTENSION_DISCONNECTED`, `BACKEND_UNAVAILABLE`, `UNSUPPORTED_OPERATION`, `CONTENT_UNAVAILABLE`, `RATE_LIMITED`, `TRANSCRIPT_UNAVAILABLE`, `TIMEOUT`, `CANCELED`, `PARTIAL`, `INVALID_INPUT`. Error messages contain actionable non-secret remediation.
- Exit: MCP list/call and skill route tests in stdio and HTTP; minimal tool-schema delta; failures do not hide other existing QNECTOR tools.

### P4 — Durable reads and output preservation (after P3 stable)

- Define canonical read-job payload with platform, operation, normalized URL/query, stable caller idempotencyKey and a bounded result size. Dedup in daemon's existing scope; changed payload with same key => conflict, never replay side effects blindly. Start responds with `taskId` immediately; poll status/results via short calls; ChatGPT transport disconnect must not cancel accepted read unless explicit cancel.
- Use `packages/mcp-server/src/durable-task-tool.ts`, `apps/daemon/src/server.ts` and existing execution package contracts, adding only a vetted typed worker entry if needed. Record manifest with normalized JSON + source URL, warnings and completeness. Do not interpret a time-limited status wait as failure. Cancellation stops owned process descendants and waits for a confirmed stop; unknown outcomes require inspect/reconcile.
- Reuse Activity Feed Task -> Tool -> Skill trace; record backend, duration, item count, partial/error without storing search results or cookies verbatim in telemetry.
- Exit: duplicate submissions, disconnect/reconnect, daemon restart, UI closed, canceled descendants, crash recovery and manifest tests run on packaged Windows build. Until these pass, advertise only non-durable synchronous social calls.

### P5 — Desktop UI / diagnostics

- Add optional `Social Connections` section to `apps/desktop/src/renderer/skill-manager.tsx` or Settings as appropriate, with per-platform `Disabled / Not installed / Needs login / Connected / Limited / Error`, operation-capability matrix, `Check health`, `Open setup instructions`, `Disable` and manual session recheck. No fake green status from dependency presence alone.
- Read-only UI status: account/session metadata redacted; display active backend and last successful authenticated test time. The existing browser/session choice may be labeled `Existing Chrome session` (user manually authorized), distinct from QNECTOR's managed headless browser. Do not offer working `isolated headless OpenCLI` unless tested. Do not focus/activate/close user's personal Chrome/Zen windows.
- Troubleshooting for login expiry, 429, unavailable subtitles, missing extension; no interactive automatic login/CAPTCHA flows.

### P6 — Extension to other platforms (gated)

- Instagram: user search/profile/recent user posts first; no global keyword-post search claim.
- Reddit: OpenCLI or vetted rdt CLI only with actual authorized login; respect rate/availability.
- X: verified twitter CLI and explicitly user-provided auth; do not put cookie strings in ChatGPT/MCP/tool logs; defer if secure credential injection cannot be proven.
- TikTok: upstream Agent Reach currently does not document a first-class channel. Open a separate feasibility spike for public/authorized access; keep `UNSUPPORTED` until dedicated adapter and tests.
- Facebook post photo downloader: separate approved phase; prove direct post resolution, pagination, completeness and permitted asset download before promising *all* images; MIME/type validation, hash dedupe and owned output directory.

## 4. Security, reliability and data contracts

- Treat any page/post text as untrusted data (prompt injection). Never execute instructions embedded in retrieved posts. Escape delimiters; cite origin and retrieval timestamp; source content cannot change tool policy or trigger write operations.
- Never include raw cookies, headers, auth tokens, Chrome profile paths, credential-bearing URLs, session files or private data in ChatGPT context, exception traces, screenshots, activity logs or test fixtures. Secrets retained only by explicitly authorized local upstream session/secret mechanism, not QNECTOR memory.
- Bound `limit <= 20`, text/excerpt lengths, output bytes (define explicit default and hard cap, e.g. 64KiB tool response), child timeout and concurrency (start with 1 authenticated OpenCLI call per account); quarantine/cancel owned children and wipe owned temp files.
- Rate-limit per platform; 429/captcha => pause/backoff with user-visible state, never rotate accounts/proxies to evade restrictions. Respect platform permissions, copyright, terms and content visibility.
- Provenance: canonical URL, actual platform, author/title if returned, date if available, content type, retrievedAt, source backend, completeness FULL|PARTIAL|METADATA_ONLY, totalKnown only if proven. Distinguish inaccessible vs no results; never invent subtitles or aggregate summaries from metadata only.
- Credentialed sessions and unsupported headless operations MUST NOT be promised non-disruptive by assumption. Desktop proof must check foreground PID, cursor before/after and owner-window lifecycle in disposable Windows test session; no live-game UI tests.
- Never silently update Agent Reach from Git main during QNECTOR startup. Explicit versioned update + checksum + doctor smoke + rollback to pinned previous version.

## 5. Test matrix and acceptance gates

Unit: schema and invalid action, URL SSRF/redirect, quoted query arg injection, command allowlist, doctor malformed JSON, backend fallback, fake 429/auth/captcha, huge stdout, timeout/cancel, YAML bombs, no subtitles, duplicate items, output redaction and adversarial prompt injection.
Integration (stubbed upstream): `social.health`, `read`, `search`, `feed`, `profile` complete/partial/error across HTTP and stdio, skills route selection, output caps and provenance, feature flag disabled, offline behavior.
Live manual smoke with user's authorized test Chrome profile ONLY after setup: YouTube public video with subtitles; video without subtitles; YouTube search; Facebook search/feed with auth; Facebook signed out and extension disconnected; Instagram user search (not global post search). Record pass/fail per operation; never infer functionality from doctor alone.
Durability: 20 concurrent duplicate keys -> one accepted job; lost submit response -> same taskId; changed payload -> conflict; network/MCP disconnect does not cancel accepted job; UI/daemon restart survival on packaged build; explicit cancellation terminates descendants; unknown output no blind replay; no leaked temp files.
Noninterference: no focus, keyboard, mouse or activation change for background operations tested in disposable account/VM. Browser session method that cannot pass remains manual-only, not headless.
Regression before release: `npx.cmd pnpm@10.15.0 typecheck`, `npx.cmd pnpm@10.15.0 test`, `npx.cmd pnpm@10.15.0 lint`, `pnpm smoke:mcp`, targeted Skill and daemon cancel tests, packaged Windows smoke. Baseline intermittent daemon cancel test from 2026-09-19 is a hard release blocker until fixed and rerun. Record exact test counts, no claiming green based on source-only tests.

## 6. Rollout / rollback

1. Feature flag OFF by default in code; prototype with mocks; no changes to user account/browser. 2. User approves exact install steps; isolated environment and pin; enable YouTube public metadata/transcript only. 3. Manual OpenCLI Chrome test session + Facebook pilot; document unsupported operations. 4. Instagram/Reddit/X only after platform-specific gates. 5. Durable integration only after packaged daemon gates. 6. Beta release with opt-in, measured schema/context and latency; stable release after all relevant gates.
Rollback: switch `social.enabled=false` without stopping QNECTOR; unregister/disable new social tools only after preserving existing task status/result visibility, or return `CHANNEL_DISABLED` while permitting outstanding task inspection. Stop only QNECTOR-owned social child processes, leave users' Chrome/Zen and existing sessions untouched, keep old config readable, restore pinned integration version, preserve task manifests. Never delete user profile, browser cookies, unrelated packages or existing downloads.

## 7. Definition of done

- ChatGPT can call `social` without generic PowerShell commands; actual result of YouTube and authenticated Facebook read/search is returned with URLs and honest completeness; `social.health` shows actionable per-operation status; no posting/mutations possible through this tool.
- All errors and inaccessible content are surfaced without fictitious content; no tokens/cookies in any logs or MCP results; no foreground interference demonstrated for supported paths; installed QNECTOR still works when integration is absent/disabled.
- Durable behavior is advertised only after end-to-end packaged tests; full regression, lint, typecheck and security tests pass, outstanding daemon cancellation blocker resolved; documented opt-in setup and rollback, release notes, no unauthorized auto-install/restart/release.

## 8. Copy/paste execution instruction to QNECTOR / coding agent

"Implement the plan in docs/agent-reach-social-integration-implementation-plan-2026-09-19.md in dependency order. Start with P0 baseline and P1-P3 read-only YouTube/Facebook pilot; preserve uncommitted files and running QNECTOR. Inspect AGENTS.md and locate product spec (report missing ../devq.md). Audit/pin upstream, do not execute remote installer or `--system` without explicit approval. Use existing ToolRegistry/Skill routing/Activity, typed social adapters, Agent Reach doctor --json and verified upstream CLI commands; never invent a unified Agent Reach reader API. Return real provenance and explicit unsupported/auth/partial states. Test typecheck/test/lint and focused social tests; fix known daemon cancel regression before any release. Do not activate live Chrome/login or modify user accounts without explicit consent. Provide changed-file report, test evidence and next-gate status. No commit/push/release or installed-app restart as part of planning."

References: https://github.com/Panniantong/agent-reach ; https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md ; https://github.com/Panniantong/agent-reach/blob/main/agent_reach/skill/SKILL_en.md ; https://github.com/Panniantong/agent-reach/blob/main/agent_reach/skill/references/social.md ; local `docs/next-release-hardening-2026-09-19.md`; `docs/durable-runtime-foundation.md`; `AGENTS.md`.

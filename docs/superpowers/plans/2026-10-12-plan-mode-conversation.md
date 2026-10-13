# Execution plan: QNECTOR chat-first Plan Mode

> Required when implementing: `superpowers:executing-plans`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`.

- [x] Read existing PlanActStore, MCP mode/guard and Plan Panel architecture, and capture human decisions.
- [x] Install official local Superpowers skills. Limit automatic activation to the three process skills.
- [x] Add failing tests for discovery, human Q&A, AI delegation/provenance, persistence, revision/approval invalidation and legacy state.
- [x] Implement PlanActStore state transition and Q&A persistence; pass targeted tests.
- [x] Add failing MCP tool tests for automatic skill loading on begin/get/back, missing-skill blocker and ask/resolve/finalize.
- [x] Implement allowlisted skill loading in `mode-tool.ts`, error handling, and chat-first tool descriptions.
- [x] Enforce panel finalization on server and add MCP Apps resource v5 with safe decision/design rendering.
- [x] Add MCP/UI regression tests; preserve v2/v3/v4 URI aliases.
- [ ] Run typecheck, lint, full Vitest, Windows Job Host tests, desktop acceptance and dependency audit; fix any regressions.
- [ ] Build a clean Windows setup/portable candidate and verify sourceRevision, build provenance, SHA256 and packaged smoke.
- [ ] Back up production settings, skills and installed app; install candidate with viable rollback; confirm original tunnel and Plan Mode operation.
- [ ] Push tested clean GitHub commit, tag a new release version and independently verify GitHub assets and Stable status.

## Test-first design constraints
A draft cannot be approved. One unanswered decision blocks another question. A delegated AI choice requires explicit delegation, alternatives and rationale. Any return to planning revokes approval, preserves resolved historical decisions for context, and requires at least one new material question in the new activation epoch. Direct tool access stays read-only while planning.

## Safety
The feature workspace is on `D:\Projects\Qnector-PlanMode2` so reinstallation of C: does not erase in-flight code again. Production app and tunnel are not modified during development. The current owner accepts unsigned Windows packages; avoid representing them as signed. A failed deployment gate leaves the installed version unchanged.

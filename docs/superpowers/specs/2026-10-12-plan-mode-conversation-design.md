# QNECTOR Plan Mode 2.0: conversational planning

**Approved:** 2026-10-12 by the repository owner.
**Source repository:** https://github.com/queenleonidasth/Qnector
**Reference skills:** https://github.com/obra/superpowers
**Implementation branch:** `feat/plan-mode-2-superpowers-20261013`.

## Product intent
Every Plan Mode activation starts or resumes an actual design conversation in ordinary ChatGPT messages. The AI asks one material decision question at a time and waits for the answer, follows up with further questions until all important choices are resolved, and only then produces a full design and actionable implementation plan. The final Plan Panel is displayed once, for approval, not as an intermediate planning checklist. Only explicit revision approval enables Act Mode.

## Human decisions
- Chat-first. No questions inside Plan Panel, no early Panel in discovery.
- Use obra/superpowers `using-superpowers`, `brainstorming`, `writing-plans` automatically on **every** Plan entry or return to planning.
- AI may choose delegated implementation details without repeated confirmation; document the selected choice, alternatives, rationale, and attribution as `ai-delegated`.
- No implementation before the completed plan is approved. A revision invalidates prior consent.

## Architecture and rationale
- Persist question/answer records, origin, rationale, and design documents per PlanActStore scope. This survives reconnects, avoids a prompt-only audit trail, and keeps the server as the source of truth.
- Phase transitions: `discovery` (read-only; pending questions or unfinished design) → `ready` (all decisions answered, full design and implementation plan stored) → explicit approval to `act`. Legacy persisted v1 plans with no `phase` remain compatible.
- `mode.begin`, `mode.back_to_plan`, and scoped Plan `mode.get` load locally installed Superpowers instructions from an exact allowlist. Never auto-download/execute arbitrary scripts on activation. Missing skills are an explicit blocker.
- `mode.ask` allows one outstanding question. `mode.resolve` records the answer; AI-delegated requires confirmation of delegation, rationale, and alternatives. `mode.finalize` is disallowed with unanswered questions or without at least one question per discovery activation.
- The MCP `plan_panel` tool refuses if `phase` is not ready. The UI v5 renders full design, implementation, and decisions with safe `textContent`, retains compatibility URIs v2–v4, and revision-locks approval.
- Upon a successful **user click** approving a plan, the widget requests a single ChatGPT follow-up if the host supports it; otherwise it offers a manual fallback. It cannot guarantee execution by an unsupported host.

## Verification
- Unit tests: state machine, Q&A, delegation, rationale, stale/revision guard, persistence and legacy migration.
- MCP integration tests: skill activation/missing skill, read-only before approval, one final Panel only, successful revisioned approval, previous URI compatibility.
- UI: script syntax, keyboard/focus/ARIA, safe decision rendering, approved follow-up.
- Full: TypeScript typecheck, ESLint, Vitest, dependency audit, packaged smoke and rollback checks.
- Release only after a fresh clean commit and exact candidate provenance, with unsigned Windows artifacts clearly disclosed per owner's waiver.

## Scope exclusions
No new chatbot UI in Panel, no second approval system, no universal guarantee that any model always asks every sensible question, no automatic upgrades of remote skills, and no silent mutation of running QNECTOR outside the verified deployment window.

# QNECTOR Memory Center — UX/UI Redesign Implementation Plan

Date: 2026-09-20
Status: PLAN ONLY — not implemented, not released
Scope: QNECTOR desktop Memory drawer and its read-only presentation/overview contract; preserve existing Memory v1/v2 stores, task IDs, runtime and persisted records.

## 0. Product goal

Within 5 seconds of opening Memory, a non-technical user should understand: (1) what QNECTOR has saved about this workspace, (2) what tasks remain open and their next steps, (3) when that information was last updated, and (4) where to see details, verify uncertain information, export or manage it. This is not ChatGPT account-level Memory: label it explicitly as local QNECTOR memory for the selected workspace, not a record of everything ChatGPT knows.

Use the existing royal gold/dark visual language without dense gold text. Remove database/debug metadata from default view, not from diagnostic access. No invented summaries or AI-generated claims of task completion.

## 1. Evidence from source audit

- `apps/desktop/src/renderer/renderer.tsx:1945-2187`: one long Memory page immediately renders v2 task list (up to eight), per-task IDs/statistics, up to four file conflicts, eight raw events, legacy current goal, all pending/completed steps and `state.facts`, followed by View/Export/Wipe controls. Raw labels include `LIVE TASK MEMORY v2`, `session bindings`, `legacy unverified`, `source.action`, and IDs.
- `renderer.tsx:729-745`: `memory.recall` fetches checkpointLimit=10, factLimit=50, changeLimit=20; `packages/tools/src/memory-tool.ts:109-129` also supplies v2 snapshot with default taskLimit=8, eventLimit=12 and memoryLimit derived from factLimit. Therefore showing eight tasks is not the complete task set, and a list of 50 facts is not inherently complete.
- `packages/shared/src/types.ts:116-215`: distinct objects exist for workspace `state.facts`, v2 `memories`, v2 `tasks`, `events`, `conflicts`, categories `fact/decision/rule/note`, timestamps and statuses. UI currently displays `state.facts` but **does not render `v2.memories`** although backend returns it. Do not call one source a complete inventory until counts/limits and scope are reconciled.
- `packages/core/src/memory-v2-store.ts:580-641`: v2 snapshot carries task/event/memory arrays and counts; task and conflict counts are based on the limited task list, while event/memory counts are database-wide. Handle this difference explicitly. `migrateLegacy` at 644-703 copies legacy facts into v2 workspace scope, so deduplication must avoid double showing these copies without hiding genuinely distinct records.
- `renderer.tsx:786-794`: memory refresh uses a 120 ms debounce while drawer is visible. Preserve live updates but avoid scroll/focus jumps and stale async responses after workspace changes.
- `renderer.tsx:923-965`: current Wipe uses a generic `window.confirm`, invokes `memory.clear` scope `all`; View MEMORY.md / Export / Wipe share a button row. Wipe must be visually separated, workspace-labeled, and require explicit deliberate confirmation. Confirm exactly what legacy and v2 data the clear action removes before updating confirmation copy.
- `styles.css:2256-2360, 3086-3240, 3691-3762, 4096-4180`: typography currently reaches 8–10 px for v2 technical rows, single stacked layout is over-dense; multiple overflow overrides exist. Preserve one scroll owner (`drawer-content`), do not introduce nested scrolling or content clipping.
- `apps/desktop/src/renderer/scroll-completeness.test.ts:111-128` tests old JSX structure and unrestricted on-screen fact/step rendering. Replace its assertions with tests guaranteeing the full detail lists remain accessible, not that all items must be expanded by default.
- `AGENTS.md` requires consulting `../devq.md`; that file was not found at `C:\Users\QUEEN\Projects\devq.md` or in a search under `C:\Users\QUEEN`. Locate/restore the authoritative product document before implementation; do not invent its contents.

Audit is source-based, not a visual QA of the running window. The active installed program is not modified by this plan.

## 2. Design principle: memory ≠ task history ≠ tool activity

Create a **Memory Center** in the existing drawer shell. Distinguish:

1. **Things remembered** (workspace facts, decisions, rules and notes; optionally scoped task memories with clear provenance).
2. **Work to resume** (tasks and next steps; status sourced from v2, never inferred from successful tool calls).
3. **History / diagnostics** (events, checkpoints, raw IDs and conflicts).

Default first screen prioritizes #1, then actionable #2. #3 stays available via an advanced disclosure. Display workspace name/path plainly and a timestamp reflecting the relevant data source; do not imply that a fresh event made an old fact current.

### Default wireframe (content concept)

```
MEMORY / ความจำของ QNECTOR                       [Close]
Workspace: QUEEN / selected project              Updated: HH:MM

[ จำไว้ N รายการ ] [ งานค้าง M งาน ] [ ต้องตรวจสอบ K ]

สิ่งที่ QNECTOR จำไว้              [ค้นหา...] [ดูทั้งหมด >]
  กฎของโปรเจกต์       2 รายการ             [เปิด]
  การตัดสินใจ         4 รายการ             [เปิด]
  ข้อมูลสำคัญ         3 รายการ             [เปิด]
  บันทึกอื่น           1 รายการ             [เปิด]
  (preview at most 2–3 items; no IDs in previews)

งานที่ทำต่อได้                     [ดูงานทั้งหมด >]
  [กำลังทำ] Title
  ขั้นตอนถัดไป: ...
  [ติดขัด] Title — reason/context if actually present

[Details: Events / Checkpoints / Task IDs / Debug] (collapsed)
[View MEMORY.md]   [Export]                 [Manage memory ...]
```

This mockup is illustrative only. Display real persisted text verbatim or safely truncated with a visible expand affordance; no generated paraphrase that misstates remembered facts. If backend cannot identify a category or active task reliably, show neutral 'ข้อมูลยังไม่ครบ / ตรวจสอบข้อมูล' rather than inventing content.

## 3. Information architecture and interactions

### A. Overview (default)
- Compact top row: `ความจำของโปรเจกต์นี้` + workspace identity + last memory timestamp + refresh feedback; clarify that this is local QNECTOR memory, not global ChatGPT memory.
- Three truthful metrics: total remembered items, open tasks, warning/unknown items. Do not reuse limited task array length as total count or mark tool success as verified completed work. If no full count is available, label 'shown X' or use a new explicit count endpoint.
- Memory-first categorized accordion: `กฎ`, `การตัดสินใจ`, `ข้อเท็จจริง`, `บันทึก` with category counts and short, legible preview. Search text on key/value and category. Filters apply consistently to what is loaded; if pagination is required, search server-side or clearly label local-only filtering.
- Open tasks: up to 2 cards, title, status, next step, relative/absolute last update, expandable critical context and progress. Blocked tasks visibly distinct. Completed/idle tasks in 'All tasks'. If only legacy active goal exists, label as 'Legacy workspace goal' rather than silently merging it into an unrelated v2 task.
- Empty states independently for no saved memories, no open tasks, unavailable v2, loading and error. Do not declare all memory empty simply because legacy facts/currentTask are empty while v2 still has data.

### B. Full memory list / detail
- List all accessible records using pagination or incremental 'Load more' with exact displayed/total count; no silent `.slice(0,50)` presented as all.
- Categories, scope (`workspace` vs `task`), key, value, tags, updated date, stable ID in optional technical detail. Task-scoped records must identify task; workspace records are shared. Current `MemoryFact` type does not expose v2 scope/task owner, so extend *read-only DTO/query* if provenance is needed; do not infer scope from identical keys.
- Deduplication: reconcile migrated legacy/v2 equivalents only with explicit identity/provenance or well-defined migration mapping; same text alone is not proof of identity. Keep originals intact and label inconsistent records for inspection.
- Preserve full raw content behind expansion, selectable and keyboard accessible. Search/filter should work with long names, Thai text and Windows paths.

### C. Tasks tab / view
- Filter active, blocked, idle, completed; paginate beyond default 8 tasks. Show current task, pending and explicitly verified completed steps, timestamp; never treat `legacy unverified` as completed. Rename jargon to `ผลเก่าที่ยังไม่ยืนยัน`.
- File conflicts: compact banner when detected, expandable list of both task names and affected paths; never hide a meaningful conflict simply because default view collapsed it. If detection runs over a bounded task list, explain coverage or expand read model for accurate conflict counts.

### D. History / advanced section
- Raw event timeline, checkpoints, `source.action`, task IDs, session bindings, database counts only behind `รายละเอียดสำหรับตรวจสอบ` and available on demand. Retain event/error visibility in the advanced view, not in the first viewport.
- Show source (legacy/v2), scope, and last updated for records; timestamp formatting with full timestamp on hover/detail.

### E. Actions and safety
- View MEMORY.md and Export remain visible. Put destructive action in separate `จัดการความจำ` menu/section, not beside View.
- Confirmation must name current workspace, exact clear scope, affected legacy/v2 records and irreversible outcome; require an explicit second step or workspace-name confirmation, not a generic OK/Cancel only. Do not expose delete controls that backend cannot fulfill accurately.
- For P0/P1, prefer read-only UI redesign; editing/deleting an individual fact only after backend semantics, migration and tests are designed separately. Never modify persisted records just to prettify UI.

## 4. Implementation phases / files

### P0 — Data correctness and inventory (first)
- Inspect real `memory.recall` result schema and `MemoryV2Store.listMemories`, legacy read limits, migration and wipe semantics. Write a data-source mapping for legacy/v2, category, scope, totals, truncation flags and task state.
- Add pure, typed presenter/selector `apps/desktop/src/renderer/memory-center-model.ts`: normalization, empty states, status labels, ordering, conditional source labels. Preserve data, do not deduplicate ambiguously. Tests with legacy-only, v2-only, migrated duplicates, mismatched counts, >50 facts, >8 tasks, null/error responses.
- If recall/snapshot lacks complete data or total counts, add a **bounded, read-only paged** overview/list operation in `packages/tools/src/memory-tool.ts`, `packages/core/src/memory-v2-store.ts`, and necessary shared types/preload API. Prefer existing MCP grouped `memory` tool; do not break the eight-tool public contract or task ID conventions. Do not assume counts.tasks is global (currently bounded).
- Exit: every displayed total and source label is explainable from backing data; no misleading 'no memory' or falsely completed state.

### P1 — Component separation and first-screen redesign
- Extract old JSX block from `apps/desktop/src/renderer/renderer.tsx` into `memory-center.tsx`, with focused components `MemoryOverview`, `MemoryCategoryList`, `MemoryTaskCard`, `MemoryDetails`, `MemoryDangerZone` as useful (avoid over-componentization).
- Maintain current drawer navigation, refresh subscription and workspace switching; stable keyed expand state, no scroll reset on live updates, request-sequence guard for async responses.
- Overview initially shows compact summaries; all contents accessible via explicit expansion or 'View all'. Show distinct workspace memory and task memory instead of combining them without attribution.
- Exit: first viewport answers remembered items + current work at current production window size without exposing IDs/event logs.

### P2 — Styling/accessibility
- Add scoped styles in `apps/desktop/src/renderer/memory-center.css` or clearly isolated section of `styles.css`; use royal gold as accent only, visible hierarchy, meaningful spacing, consistent status badges and contrast. Body >=12px at minimum under narrow app window (target 13–14px where space allows); never 8–9px for essential content.
- Keyboard-accessible native buttons and `<details>` or proper aria-expanded; focus-visible, Esc/focus-trap behavior compatible with existing drawer, screen-reader names, no color-only statuses, reduced motion preference. Support text scaling 125–200%, Thai/English wrapping, very long paths/values and high-contrast themes.
- Exactly one primary vertical scroll owner, `drawer-content`; no nested memory event scroll in default view. Test at narrow window and short-height settings, full footer reachability; never use truncation without a way to reveal full content.

### P3 — Safety and quality gates
- Update `scroll-completeness.test.ts` (current raw-`.map` assumptions) and `styles.test.ts`; add `memory-center-model.test.ts`, `memory-center.test.tsx` or equivalent DOM tests according to repo tooling. Test filtering, paging, status fidelity, v2 memories visibility, inactive legacy fallback, empty/error states, conflict visibility, long strings, switching workspace, live updates while expanded, and no destructive API calls during browsing.
- Test clearing separately with workspace-targeted confirmation and both stores; verify cancellation never deletes, successful deletion refreshes count and details, failures preserve visible data and report error.
- Run `node scripts/check-version-sync.mjs`, `pnpm typecheck`, relevant memory / MCP / renderer tests, then `pnpm test` and `pnpm lint`; capture known unrelated failures rather than claiming full pass. Add screenshot/manual checks at actual installed-window dimensions. Keep QNECTOR running; no restart, packaging, installer or GitHub release without a separate explicit request.

### P4 — Optional follow-up, NOT part of initial UI replacement
- Individual fact editing, scope changes, historical comparison and semantic search only after stable backend CRUD/API and provenance guarantees. Consider an accessible per-item 'Where did this come from?' view; do not invent a provenance trail for existing data.

## 5. Acceptance criteria (must be verified)

1. User can identify selected workspace and whether its remembered rules/decisions/facts/notes exist without scrolling past raw task logs; actual v2.memories are represented.
2. No task IDs, event rows, session binding counts or legacy technical labels in initial viewport; accessible under Details.
3. No false empty state when v2 holds memories/tasks but legacy active/facts are absent.
4. 60+ facts and 12+ tasks have accessible full listings; displayed count differs from total clearly, and search scope is explicit.
5. V1 migration copies are not falsely counted as separate semantic facts; ambiguous records are not silently deleted or merged.
6. Tool-call success is not automatically displayed as verified task completion; legacy completion remains marked unverified.
7. Conflicts, errors, unavailable memory and stale data remain discoverable and never silently suppressed.
8. App window at current production size and short height: all controls/text reachable with a single content scrollbar, no horizontal overflow, no stuck footer and no lost focus; Thai/English and long paths work.
9. Clear action is separated, identifies workspace and scope, requires deliberate confirmation, and has no effect on cancel.
10. Existing memory stores, files, tasks, daemon and remote MCP connection remain unchanged by UI-only phases; targeted tests/typecheck pass before implementation is considered complete.

## 6. Out of scope / delivery boundaries

- This document is a plan, not a UI implementation. No source edits beyond this plan, no restart, no release, no memory deletion.
- Do not use generated claims to summarize persisted facts unless the feature clearly labels them as generated and links source; initial redesign shows stored text directly.
- Missing `../devq.md` is a pre-implementation documentation blocker; locate it or establish approved replacement before substantial implementation.
- Keep unrelated uncommitted Social Reader / Durable Runtime work untouched; when implementation is requested, stage only relevant changes and isolate any overlapping hunks.

# Qnector Skill Manager — UX/UI Design

Status: design-first specification for the desktop Skills screen that will replace the current Runtime tab.
Target shell: Qnector desktop, 451 × 978 minimum window, existing dark/glass visual language.

## Product goal

Make Skills a first-class part of Qnector instead of a hidden runtime capability. A user should be able to understand what Qnector knows, add new expertise, customize existing skills, test whether a skill will trigger, and recover safely from a bad edit without opening the filesystem manually.

The primary job of the screen is **manage installed skills**. Diagnostics remain available, but move out of the primary navigation into Settings > Advanced > Runtime & Diagnostics.

## Primary navigation

Replace:

`Workspace | Memory | Runtime | Settings`

with:

`Workspace | Memory | Skills | Settings`

Drawer title:

`◇ SKILL MANAGER`

## Information architecture

### 1. Skills home

Order from top to bottom:

1. Header summary
2. Search
3. Scope/status filters
4. Skill list
5. Sticky action area

The page should not start with large dashboard cards. At 451 px wide they consume too much vertical space. Use one compact summary line instead.

### 2. Skill detail

Opening a skill slides to a detail view inside the same drawer. Do not use a centered modal for normal inspection because it makes long SKILL.md content difficult to read.

### 3. Skill editor

Edit/create uses a full drawer sub-page with a sticky Save bar and inline validation. It should support both a guided metadata form and Markdown instructions without forcing users to understand YAML syntax.

## Skills home wireframe

```text
┌───────────────────────────────────────┐
│ ◇ SKILL MANAGER           ＋ Add Skill⌄│
│ 10 skills · 10 active · 0 issues     │
│                                       │
│ [ Search skills, tools, triggers…  ]  │
│                                       │
│ [All 10] [Bundled 10] [User] [WS]    │
│ [Active] [Issues]                     │
│                                       │
│ ┌───────────────────────────────────┐ │
│ │ ● ui-ux-design          BUNDLED   │ │
│ │ Design and implement polished…   │ │
│ │ 6 tools · MIT          Healthy › │ │
│ └───────────────────────────────────┘ │
│                                       │
│ ┌───────────────────────────────────┐ │
│ │ ● archive-workflows     BUNDLED   │ │
│ │ ZIP / 7z / RAR / TAR workflows…  │ │
│ │ 4 tools · MIT          Healthy › │ │
│ └───────────────────────────────────┘ │
│                                       │
│                    [⌕ Test Trigger]   │
└───────────────────────────────────────┘
```

## Skill card

Each card shows only information needed to choose or diagnose a skill:

- status dot: active / disabled / issue
- skill name
- source badge: `BUNDLED`, `USER`, `WORKSPACE`, `PROJECT`
- 1–2 line description
- allowed-tool count
- validation state
- chevron to detail

Do not render every allowed tool as a chip in the list; that becomes noisy. Tool chips belong in detail.

### Source treatment

- **Bundled**: maintained by Qnector, read-only in place.
- **User**: global custom skill under `%APPDATA%\Qnector\skills`.
- **Workspace**: project-specific skill under `<workspace>\.qnector\skills`.
- **Project**: source-checkout skill used while developing Qnector.

Use distinct small text badges, not strong card colors.

## Search and filters

Search should match:

- name
- description / trigger wording
- allowed tools
- source

Quick filters:

- All
- Bundled
- User
- Workspace
- Active
- Disabled
- Issues

When search is active, show the result count and a one-click clear action.

## Skill detail wireframe

```text
┌───────────────────────────────────────┐
│ ‹ Skills                              │
│ ui-ux-design                 ● Active │
│ BUNDLED · Healthy                     │
│                                       │
│ Design, redesign, and implement…      │
│                                       │
│ [Customize] [Test Trigger]        ⋯   │
│                                       │
│ ALLOWED TOOLS                         │
│ system · workspace · files · process  │
│ browser · computer                    │
│                                       │
│ TRIGGER / DESCRIPTION                 │
│ …                                     │
│                                       │
│ INSTRUCTIONS                          │
│ Readable Markdown preview             │
│                                       │
│ LOCATION                              │
│ C:\…\skills\ui-ux-design\SKILL.md   │
└───────────────────────────────────────┘
```

### Detail actions

Primary action depends on source:

- Bundled → `Customize`
- User / Workspace / Project → `Edit`

Secondary actions in `…` menu:

- Enable / Disable
- Duplicate to User
- Duplicate to Workspace
- Validate
- Export as ZIP
- Open folder
- Delete (custom writable skills only)
- Reset to bundled (when a custom override shadows a bundled skill)

Destructive actions must never sit next to the normal Edit button.

## Add Skill flow

Use **one** primary creation entry point. Do not place a separate `Import Skill` button next to or below `Add Skill`; both are ways of adding a skill and competing actions make the hierarchy ambiguous.

Pressing `+ Add Skill⌄` opens a small action sheet:

1. **Create Skill**
2. **Import Skill** — `SKILL.md`, skill folder, or ZIP archive
3. **Duplicate Existing**

### Create Skill

Step 1 — Scope

- User — available in every workspace
- Workspace — available only in the active workspace

Step 2 — Basics

- Name (kebab-case)
- Description / trigger wording
- Optional compatibility
- License
- Allowed tools

Step 3 — Instructions

- Markdown editor
- readable preview toggle
- optional Files section showing `scripts/`, `references/`, `assets/`

Step 4 — Validate & Save

Validation should be live and explain the error next to the field rather than returning a generic save failure.

## Edit behavior

### Bundled skills

Never edit `Program Files` resources in place. `Customize` creates a writable override with the same skill name in User or Workspace scope. Qnector's existing root precedence can then make the custom version effective.

When an override exists, show:

`Customized · overrides bundled`

and expose `Reset to Bundled`, which deletes the override after confirmation.

### Writable skills

User/Workspace/Project skills can be edited directly. Save should:

1. validate metadata
2. write atomically
3. reload inventory
4. re-run validation
5. keep the editor open and show `Saved` state rather than closing immediately

## Enable / Disable

A skill manager needs a non-destructive way to remove a skill from matching without deleting it.

Recommended persistence:

- global enable state: `%APPDATA%\Qnector\skill-state.json`
- optional workspace override: `<workspace>\.qnector\skill-state.json`

Disabled skills remain visible in the manager but are excluded from session bootstrap, `skills_match`, and `skill_get` unless explicitly requested for management.

The normal row toggle affects the effective skill. Advanced menu can expose `Disable in this workspace` later if needed.

## Validation / Health

Each effective skill gets one health state:

- Healthy
- Warning
- Invalid

Validation checks should include:

- `SKILL.md` exists
- YAML frontmatter parses
- `name` exists and follows lowercase-number-hyphen rules
- directory name matches skill name
- description exists and is not empty
- file size within Qnector limit
- allowed tool names are recognized
- referenced files/resources exist when detectable
- duplicate/override relationship is understandable

Invalid skills should appear in the list rather than silently disappearing. This is important: a manager cannot fix a skill it cannot see.

## Typography / readability

The first mockup was too small for comfortable scanning. At the 451 px minimum width, prioritize readable type over fitting extra rows.

Recommended minimums for the Skills screen:

- page title: 13–14 px
- primary buttons: 11–12 px
- skill name: 12 px
- description: 10.5–11 px with ~1.4 line-height
- search text: 11 px
- filter chips: 10 px
- metadata/source badges: 8–9 px
- summary/footer text: 9.5–11 px

Do not use 6–8 px body text. It can be reserved only for truly secondary decorative labels when unavoidable. Showing one fewer skill row is preferable to making the manager hard to read.

## Test Trigger — important Qnector-specific feature

This is the strongest differentiator for the Qnector manager.

Detail view includes `Test Trigger`:

```text
Try a task:
[ ช่วยออกแบบหน้า settings ให้ใช้ง่ายขึ้น ]

1  ui-ux-design          Best match
2  ui-ux-audit
3  design-system
```

This should use the same matcher as production. It lets the user improve a description/trigger and immediately verify whether the right skill wins.

For a selected skill also show:

- matched / not matched
- rank
- competing skills

Future improvement: expose the lexical score breakdown only under Advanced diagnostics, not in the normal UX.

## Import Skill

Support:

- `SKILL.md`
- folder containing `SKILL.md`
- `.zip`

Import flow:

1. inspect without installing
2. show detected name, description, files and validation result
3. select User or Workspace destination
4. warn on name conflict and offer Replace / Install as copy / Cancel
5. install atomically
6. show the new skill detail

The Archive workflow should be reused for ZIP inspection/extraction instead of implementing a second unrelated archive path.

## Export / backup

`Export as ZIP` packages the complete skill folder, not just SKILL.md. This preserves scripts, references and assets.

Optional future action: `Export all custom skills` for migration/backup.

## Empty states

### No custom skills

Do not say only “No skills”. Bundled skills still exist.

For User filter:

`No personal skills yet`
`Create a global skill or customize a bundled skill.`

### No search results

`No skills match “…”`
`Clear filters or create a new skill.`

### Runtime unavailable

Keep shell visible with skeleton rows and:

`Skill runtime is still starting…`

Do not blank the whole drawer.

## Errors

- Save errors stay inside editor.
- Import errors show the exact file/validation problem.
- Delete requires confirmation containing skill name and scope.
- If deletion fails, preserve the item and show inline error.
- Never optimistically remove a skill before filesystem mutation succeeds.

## Runtime diagnostics relocation

The current Runtime tab contains useful information and should not be deleted.

Move it to:

`Settings → Advanced → Runtime & Diagnostics`

Use the existing Runtime content there with minor compaction. This keeps normal navigation focused on user-facing capabilities while preserving doctor, release state, startup metrics, process state and workflow history.

## Visual direction

Stay inside Qnector's existing dark, restrained gold-accent system.

- background/surface hierarchy rather than many nested glass cards
- muted gold for primary action and active state only
- no purple gradients
- compact 12–13 px body type appropriate for the 451 px shell
- minimum 36–40 px interactive row height
- sticky search/filter block
- single scroll owner for the skill list
- 180–220 ms horizontal detail transition
- reduced-motion: instant content switch/fade only

## Backend/API contract required for implementation

Current runtime already provides read operations:

- `skills_status`
- `skills_list`
- `skills_match`
- `skill_get`

The manager should add a management surface rather than overloading raw filesystem operations from the renderer:

- `skills_inventory` — includes valid + invalid variants, source, writability, effective/override state and enabled state
- `skill_validate`
- `skill_create`
- `skill_update`
- `skill_delete`
- `skill_set_enabled`
- `skill_duplicate`
- `skill_import`
- `skill_export`
- `skill_open_folder` may reuse system open-path through desktop IPC

Management actions should be implemented in `AgentSkillService` so desktop UI and ChatGPT/MCP use the same rules.

## Inventory model

The current discovery model returns only the winning skill per name. The manager needs all variants so it can display overrides and repair invalid skills.

Suggested shape:

```ts
interface SkillInventoryItem {
  id: string; // stable source/path identity
  name: string;
  description?: string;
  source: "bundled" | "project" | "user" | "workspace";
  path: string;
  directory: string;
  writable: boolean;
  enabled: boolean;
  effective: boolean;
  overrides?: string[];
  overriddenBy?: string;
  valid: boolean;
  issues: Array<{ severity: "warning" | "error"; message: string }>;
  allowedTools: string[];
  license?: string;
  compatibility?: string;
}
```

## V1 implementation priority

P0 — required for first usable Skill Manager

1. replace Runtime navigation with Skills
2. inventory/list/search/filter
3. detail view
4. create User/Workspace skill
5. edit writable skill / customize bundled
6. delete custom skill
7. enable/disable
8. validation
9. Test Trigger
10. relocate Runtime diagnostics into Settings

P1 — immediately useful

11. import SKILL.md/folder/ZIP
12. duplicate
13. reset bundled override
14. open folder
15. export ZIP

P2 — future

16. marketplace / Discover tab
17. update remote-installed skills
18. usage analytics / last matched
19. bulk backup/restore
20. cross-agent sync

## Acceptance criteria

The first implementation is complete only when:

- the Runtime top tab is replaced by Skills
- all effective skills are visible
- invalid custom skills remain discoverable and repairable
- a bundled skill can be customized without modifying Program Files
- User and Workspace skills can be created, edited and deleted
- enable/disable changes actual matching behavior
- Test Trigger uses the production matcher
- ZIP import validates before installation
- long descriptions and SKILL.md content do not break drawer scrolling
- Runtime diagnostics are still reachable from Settings
- the screen works at Qnector's 451 × 978 minimum size
- keyboard focus and destructive confirmations are usable

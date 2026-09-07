---
name: skill-authoring
description: "Create, review, and improve Qnector Agent Skills in the open SKILL.md format; write precise trigger descriptions, progressive instructions, optional references/scripts/assets, and validate that new skills stay reusable and bounded."
license: MIT
compatibility: "Qnector 0.4.9+ Agent Skills runtime"
allowed-tools: [system, workspace, files, process]
---

# Skill Authoring

Use this skill when adding or revising reusable capabilities under a Qnector skill root.

## Structure

Each skill is a directory containing `SKILL.md`. The file starts with YAML frontmatter and then Markdown instructions. Use lowercase hyphenated names. `name` and `description` are required; add `license`, `compatibility`, or `allowed-tools` only when useful.

Optional supporting files belong under `scripts/`, `references/`, or `assets/`. Keep references shallow and load them only when the active task needs them.

## Authoring workflow

1. Search existing skills first and avoid duplicating a capability already covered well.
2. Write a description that says both what the skill does and when it should trigger. Include important file extensions, domains, or task verbs that improve deterministic matching.
3. Keep `SKILL.md` focused on procedure, decision points, validation, and common failure modes. Move lengthy reference material out of the main instructions.
4. Prefer existing Qnector tool groups over introducing a new MCP group. A skill may orchestrate multiple existing tools.
5. Do not make discovery execute scripts. Scripts are optional implementation resources and should run only after the skill is activated and the task requires them.
6. Test discovery with `system.skills_list`, routing with `system.skills_match`, and activation with `system.skill_get`.
7. Run project typecheck/tests when runtime code changes; static skill-only changes still need format/review and a live match probe.

## Quality checks

- The skill has one clear responsibility.
- Instructions are actionable rather than generic advice.
- Trigger wording distinguishes it from neighboring skills.
- Paths and commands are portable or clearly declare compatibility constraints.
- The workflow includes output verification before success is reported.

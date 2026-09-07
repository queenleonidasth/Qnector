---
name: project-qc
description: "QC and validate software projects: inspect repository state, run the right typecheck/test/lint/build/smoke gates, diagnose flaky failures, and report regressions without overwriting unrelated work."
license: MIT
compatibility: "Qnector 0.4.9+"
allowed-tools: [system, workspace, files, process, git, browser, computer]
---

# Project QC

Use this skill when the user asks to QC, validate, test, stabilize, review, or release-check a software project.

## Workflow

1. Confirm the target workspace and inspect `git.status` before changing anything. Preserve unrelated uncommitted changes.
2. Read the project manifest and repository guidance (`package.json`, `pyproject.toml`, `Cargo.toml`, `AGENTS.md`, README, CI config) to identify authoritative validation commands.
3. Prefer read-only diagnostics first: workspace diagnostics, targeted searches, dependency/tool status, then project-native checks.
4. Run independent checks in parallel only when they do not mutate shared build state. Otherwise run them sequentially.
5. When a test fails, rerun the smallest failing test/file before changing code. Distinguish a reproducible defect from a flaky environment/race failure.
6. For web UI projects, use the managed browser headlessly for console/network/DOM/screenshot checks. Present a visible browser only when the user explicitly needs a final preview.
7. Re-run the affected gate after every fix and run the complete release gates before declaring the project clean.
8. Report exact pass/fail counts, remaining warnings, and changed files. Do not claim success from a partial run.

## Safety for existing work

- Never reset, clean, checkout, stash, or rewrite unrelated user changes unless explicitly requested.
- Re-read a file before editing if Git or Qnector Memory indicates another task touched it.
- Prefer `files.apply_patch` or precise replacements over full-file rewrites.

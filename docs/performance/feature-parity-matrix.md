# End-to-end performance feature parity

This matrix is a release contract. Preserve the surviving MCP surface and behavioral guarantees after the user-authorized removal of Plan/Act on 16 October 2026. The golden source is [`fixtures/performance/manifest.json`](../../fixtures/performance/manifest.json), checked against the live tool definitions by `packages/tools/src/public-api-contract.test.ts`.

| Area | Required parity | Evidence / negative cases |
|---|---|---|
| Public MCP surface | Retain all 8 surviving grouped tools (`system`, `workspace`, `files`, `process`, `git`, `memory`, `browser`, `computer`), supported actions, input properties and permissions; `tasks` remains opt-in and the timeout diagnostic remains opt-in | Golden manifest test and live HTTP/stdio `tools/list`; negative assertions for removed planning tools and resources |
| Retired Plan/Act feature | The old `mode`, `mode_approve`, `plan_panel` and `inspect` proxies, their interactive resources, prompts, persistent state controller and dispatch guard are intentionally removed. Standard MCP tool permissions remain under ChatGPT host controls; Memory v2 tasks are unaffected | Negative tool/resource advertising tests, task continuity, grouped tool compatibility, and normal host authorization boundaries |
| Workflows and processes | `accepted`, `running`, `succeeded`, and `verified` remain distinct; timeout is not failure; no speculative mutation replay; `/long` and durable lifetime semantics remain truthful | Workflow stale-revision, unknown-outcome, cancellation, restart/recovery and verification tests |
| Context | Resume restores the requested task and full state; stale summaries/checkpoints cannot hide later status/scope/context changes | Task resume freshness tests, multi-task isolation and checkpoint digest tests |
| Files and search | Ordered bounded `read_many` at 1/20/100; fresh revision-aware results; exact path, byte range and hash | Cold/warm/modified input fixtures; traversal/error/ordering limits |
| Browser and Windows UIA | Target identity, closed/replaced target invalidation, scoped DOM and postconditions; no replay of clicks or UI actions | CDP cache lifecycle tests and persistent helper lifecycle tests |
| Documents and media | Preserve image/PDF/DOCX/PPTX/Thai/OCR/high-resolution behavior and output fidelity | Golden extraction/render fixtures, multipage and corrupt PDF tests, image fidelity checks; missing provider capability is reported explicitly |
| Resources and flags | Speculative prewarm defaults off; opt-in resource prewarming is budgeted and game-aware pause is opt-in; flags can roll back optimizations without rolling back user data or dropping current jobs | Flag-off/on parity, budget exhaustion, active-game pause/resume, migration rollback and current-job recovery fixtures |
| Release path | HTTP, stdio, tunnel, native Job Host, Electron/GUI and installed upgrade retain the same contract | Local and packaged acceptance evidence in `task12-acceptance-report.json`; unsupported host timings stay `UNKNOWN` |

The current manifest records the intentional, user-authorized replacement API. Future changes require an explicit compatibility review and updated golden fixture; do not silently regenerate the fixture from candidate code. The historical pre-removal contract remains in Git history.

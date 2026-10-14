# End-to-end performance feature parity

This matrix is a release contract. Performance changes must retain the existing MCP surface and behavioral guarantees. The golden source is [`fixtures/performance/manifest.json`](../../fixtures/performance/manifest.json), checked against the live tool definitions by `packages/tools/src/public-api-contract.test.ts`.

| Area | Required parity | Evidence / negative cases |
|---|---|---|
| Public MCP surface | All 9 baseline grouped tools, all actions, 5 host aliases, input properties, required inputs, annotations and legacy `{action,...fields}` call shape | Golden manifest test and live HTTP `tools/list`; compare packaged HTTP and stdio schemas |
| Plan and Act | Preserve `mode.ask`, `mode.resolve`, `mode.finalize`; approval requires explicit user approval and the exact `mode_approve.expectedRevision`; every mutating dispatch remains behind the task-scoped behavioral guard | Plan denial tests, stale/wrong revision denial, Act permission parity; inspect and proxy paths cannot execute hidden writes |
| Workflows and processes | `accepted`, `running`, `succeeded`, and `verified` remain distinct; timeout is not failure; no speculative mutation replay; `/long` and durable lifetime semantics remain truthful | Workflow stale-revision, unknown-outcome, cancellation, restart/recovery and verification tests |
| Context | Resume restores the requested task and full state; stale summaries/checkpoints cannot hide later status/scope/context changes | Task resume freshness tests, multi-task isolation and checkpoint digest tests |
| Files and search | Ordered bounded `read_many` at 1/20/100; fresh revision-aware results; exact path, byte range and hash | Cold/warm/modified input fixtures; traversal/error/ordering limits |
| Browser and Windows UIA | Target identity, closed/replaced target invalidation, scoped DOM and postconditions; no replay of clicks or UI actions | CDP cache lifecycle tests and persistent helper lifecycle tests |
| Documents and media | Preserve image/PDF/DOCX/PPTX/Thai/OCR/high-resolution behavior and output fidelity | Golden extraction/render fixtures, multipage and corrupt PDF tests, image fidelity checks; missing provider capability is reported explicitly |
| Resources and flags | Speculative prewarm defaults off; opt-in resource prewarming is budgeted and game-aware pause is opt-in; flags can roll back optimizations without rolling back user data or dropping current jobs | Flag-off/on parity, budget exhaustion, active-game pause/resume, migration rollback and current-job recovery fixtures |
| Release path | HTTP, stdio, tunnel, native Job Host, Electron/GUI and installed upgrade retain the same contract | Local and packaged acceptance evidence in `task12-acceptance-report.json`; unsupported host timings stay `UNKNOWN` |

The manifest captures the baseline API shape. Additive behavior changes require an explicit compatibility review and updated golden fixture; do not silently regenerate the fixture from candidate code.

# QNECTOR Memory freshness repair - QA report (2026-10-16)

## Symptom and root cause

The Memory Center favored its last linked session (October 14) over newer saved tool/task activity (October 16). The link is historical context, not a live ChatGPT transcript. Its timestamp was presented as the primary date, falsely implying that local Memory had stopped updating.

The QNECTOR MCP server is tool-driven, not a passive ChatGPT message receiver. Ordinary chat messages cannot be persisted automatically unless an authorized excerpt is explicitly passed through memory.record_turn (consent required). This is a transport limitation, not a database write error.

## Changes on isolated source branch

- Always show Latest Activity as the newest persisted task, tool event, note, or legacy change, using its own timestamp.
- Present Last linked session separately as historical metadata, never as a substitute for latest activity.
- Keep Current Task separate and retain the explicit chat-capture privacy disclaimer.
- Added regression tests for older linked sessions, newer saved tasks, newer events, and newer notes.
- Retained NoPlan removal; no Plan Mode implementation was restored.
- Production QNECTOR v0.4.57 was not overwritten or restarted.

## Verification evidence

| Check                                                          | Result                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Targeted Memory Center + Memory v2 + MCP tool tests (79 tests) | PASS                                                                                |
| TypeScript workspace typecheck                                 | PASS                                                                                |
| ESLint workspace                                               | PASS                                                                                |
| QNECTOR live memory.note write                                 | PASS                                                                                |
| Live memory.get readback                                       | PASS                                                                                |
| Live Memory v2 inventory readback                              | PASS (1 task-scoped record, timestamp 2026-10-16T15:35:57.900Z)                     |
| Full serialized pnpm test:acceptance                           | INCOMPLETE / FAIL: one unrelated Windows Job Host case failed, run stopped at 180 s |

### Unrelated full-suite failure

The execution reached packages/execution/src/windows-job-host.test.ts and reported 1 failed test out of 2 in that file: "kills the command tree when the durable worker itself is terminated". The full suite stopped on COMMAND_TIMEOUT after 180000 ms. No root cause was established in this Memory-only change. This is not marked PASS or silently waived; diagnose in a separate Job Host task if needed.

Live memory.health after the write reported 0 write errors, 1 persisted Memory v2 fact, and a new semantic-fact timestamp on October 16. It also reported 22 tool events skipped by workspace filtering while project files were on D: and the active workspace was C:\Users\QUEEN. Workspace Scope behavior was intentionally left unchanged.

## Remaining boundaries

- The change is source-side only until a distinct new version is packaged, verified, and installed; the currently installed v0.4.57 UI still has its original display logic.
- The MCP host does not pass the complete ChatGPT transcript to QNECTOR. This fix does not invent or claim passive full-message synchronization.
- Never infer successful task completion from a tool event alone; rely on verified checkpoints and task updates.

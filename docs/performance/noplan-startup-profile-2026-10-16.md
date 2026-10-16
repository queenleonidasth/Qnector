# QNECTOR NoPlan — native startup profiling checkpoint

Date: 16 October 2026 (Asia/Bangkok)
Profile evidence: apps/desktop/release/durable-candidate-20261016-125851/qc-evidence/startup-abba.json
Source measured: candidate 76f8bcc2aac8a193e799f397891ec651563c02cd; installed baseline e5e09d6aabc6d611d92008329b43ead223aff909
Current working revision at this review: ea3d154. Git diff confirms main.ts and renderer.tsx are unchanged between measured candidate and current source, but this is **not** a fresh exact-current-commit packaged startup benchmark.

## Comparative ABBA results (milliseconds)

Five ABBA warmup rounds, 30 samples per variant and 10 separate packaged-process cold starts per variant; verified stage hashes match.

| Stage | Installed baseline p50 / p95 | Measured NoPlan p50 / p95 | Warm p95 delta | Interpretation |
|---|---:|---:|---:|---|
| Process wall-time including probe shutdown | 3,321.28 / 3,363.79 | 3,352.89 / 3,396.09 | +0.96% | **No clear win** and below 5% threshold; 95% confidence intervals overlap |
| Renderer ready milestone | 548.87 / 571.05 | 545.84 / 574.27 | +0.56% | Approximate parity |
| Renderer loaded milestone | 290.70 / 307.37 | 294.13 / 315.89 | +2.77% | Possible small drift; below 5%, warrants later confirmation |
| BrowserWindow creation milestone | 240.08 / 251.80 | 238.30 / 251.58 | -0.09% | Parity |
| Cold process wall-time p50 / p95 | 3,279.52 / 3,338.99 | 3,311.55 / 3,412.07 | +2.19% | 10 samples each; not a proven speedup |

The process wall clock begins in the external benchmark harness before spawn and stops after the startup-probe Electron process exits. Renderer milestones are measured inside Electron and **must not be subtracted from wall-time as though they share the same time origin**.

## Source-level stage inspection

- apps/desktop/src/main/main.ts defers loading the MCP runtime through a dynamic import until the initial renderer-ready callback. This preserves GUI-first startup.
- Automatic update checking is scheduled later rather than awaited on the critical renderer path. The splash, tray and global shortcut remain present on normal startup.
- apps/desktop/src/renderer/renderer.tsx isolates live Activity state in a memoized ActivityPanel and coalesces memory refreshes; motion is paused only when the app is hidden or disabled by the user.
- Resource budget and foreground-game pause tests passed as simulations. They are not evidence of production game frame-time.

## Conclusion and next independent action

**Do not enable new speculative startup prewarming** based on these numbers. There is no demonstrated >5% p95 improvement. Keep normal startup behavior and all animations, tray, tunnel and activity features. To close the original Task 10 fully, a separate exact-current-package runtime initialization profile (including non-probe startup) and CPU/RSS regression evidence is still required; companion-app/game tests were explicitly waived by the user and remain unverified.

This profiling checkpoint documents a completed safe *analysis step*, not a completed full release/acceptance gate.

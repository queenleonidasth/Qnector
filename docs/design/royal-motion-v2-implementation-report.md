# QNECTOR Animation Rework V2.1 — Native Integration QA Report

Status: SOURCE INTEGRATION & NATIVE MOCK BRIDGE QC, 2026-10-19.
Branch: feat/royal-motion-60fps-trial.
Installed stable QNECTOR 0.4.57 remains unchanged. No release or live connector behavior was modified.
Approved artwork: Queen frameless portrait and Luxury Liquid Glass V2.1, documents in docs/design.

## Implemented

1. Queen liquid glass Orb with sharp original transparent 256x256 Queen logo, glass caustics and native compositor float. Ring is fully invisible while idle; real 3-second hold controls backend disconnect; release cancels.
2. Silk/Aurora Canvas background with non-text flowing light curves/particles; old Matrix rain source remains solely for rollback/testing.
3. One shared requestAnimationFrame driver for both continuous visual canvases, listening to native window visibility, document visibility, OS Reduced Motion and animation policy. Canvas complexity/DPR quality budget changes without artificially capping live frame cadence.
4. Full/Balanced/Eco/Off segmented controls in the real Settings drawer, separately persisted as a local UI-only preference. Original animationsEnabled=false overrides all new modes.
5. Opt-in local FPS callback and frame-time telemetry, updated approximately once per second. Production default is off, no uploads or network transmission.
6. Liquid Glass surface and state-specific motion on Dashboard/header, floating dock, modal/drawer, Workspace, Memory, Skills, Runtime, Settings, Setup and Updater. One expensive blur per outer modal where possible; nested cards use inset border/paint.
7. Retargetable drawer route navigation without 200ms input lock; closes/opens with bounded animation/fallback, per-page scroll preservation and focus trap/Escape.
8. Activity Feed virtualization correction: outer layer owns absolute Y position, inner row owns entry/hover. Native synthetic burst confirms rows no longer stack due to transform conflict.
9. Accessible consistent gold one-stroke SVG icons replace colored OS emojis in the dock and drawer; all four nav labels remain readable.
10. Removed eight original transition:all declarations in styles.css to avoid accidental layout animation. Explicit properties only.
11. Maintains Memory latest-activity truth, backend-confirmed state semantics for skills, updater and activity, and current no-Plan Mode capability. No new backend tool actions or data collection.

## Native Electron test evidence

- Build and TypeScript: PASS (both compilation steps, Queen PNG included as relative file:// asset).
- Lint: PASS.
- Existing Electron five-drawer UI acceptance: PASS at 420x620, 435x900, 451x978 and 700x900. No horizontal overflow, Escape/Tab focus.
- New native motion system QC: PASS. Full/Balanced/Eco moving, Off static, 40 rapid tab retargets, correct final route, per-view scroll retained, opt-in FPS reading, real Queen asset 256, synthetic 16 Activity events laid out distinctly, 0 console errors.
- Native Orb hold/visibility QC: PASS. Invisible idle ring, cancel early, continuous 3s hold invokes backend request, intentionally rejected synthetic disconnect keeps actual Connected status, native hide/show pauses/resumes Canvas, no JS exceptions.
- Screenshots: docs/design/royal-motion-native-system/dashboard.png, activity-feed.png, settings-*.png, telemetry.png, plus original baseline images and orb before/after images.
- No live files, actual QNECTOR settings, Memory, Windows tunnel or production bridge were mutated by QC.
- Full project suite and packaged candidate results are recorded separately when completed; do not assume they passed from a previous commit.

## Quality profile sampling (2026-10-19)

The native fixture window is 475x865 on the currently exposed display setup.
The NVIDIA driver reports 3440x1440 and 59 Hz through WMI; the visible remote display reports 1920x1080 via Parsec. Refresh ambiguity is a limitation. Each quality is an isolated 4.1-second rAF callback interval sample from Electron; this is NOT GPU present-time tracing.

| Profile | Mean rAF callbacks/s | P95 frame interval | Worst interval | Intervals >17ms | Errors |
|---|---:|---:|---:|---:|---:|
| Full | 59.97 | 16.8ms | 18.3ms | 2 | 0 |
| Balanced | 59.97 | 16.8ms | 17.7ms | 1 | 0 |
| Eco | 59.49 | 16.8ms | 33.4ms | 2 | 0 |
| Off (no decoration) | 59.21 | 16.8ms | 50.0ms | 3 | 0 |

Off mode still allows a benchmark's external rAF probe to run, while the actual decorative Canvas becomes static (native QC confirmed). This callback probe is affected by event-loop/OS scheduling even without any user animation. The values should not be represented as a guaranteed strict lower bound of 60.0 frames/s.

Evidence: docs/design/royal-motion-native-system/profile-*-fps.json, scripts/bench-royal-motion-profiles.cjs, scripts/accept-royal-motion-system.cjs.

## Remaining release gates

- **Physical refresh and presentation:** measure GPU compositor/present frame pacing at true 60/120/144/165Hz and varied DPI/zoom with an appropriate measurement tool. Current 59Hz/remote display constrains validation.
- **Game coexistence:** Delta Force not running during this iteration. Test RTX 4070 CPU/GPU/frame-time with actual foreground game, memory consumption, VRAM pressure and sudden activity bursts. Source callback FPS alone is insufficient.
- **Long-running soak:** stress sustained high activity and 20+ minutes of repeated connect/navigation to detect leakage; short rapid-switch and 16-event tests do not substitute.
- **Packaging/rollback:** create isolated Windows package and smoke it, keep installed v0.4.57 unchanged; a user decision is needed before overwriting current install or publishing a GitHub release.
- **Motion semantics remaining optional:** physically shared-element row-to-detail animation in virtualized lists and fully illustrated animations for every existing legacy state are not yet implemented. Current fallback preserves accessibility and information.
- **Real network/backend:** production tunnel, Memory write, updater success and recovery cannot be end-to-end verified with the synthetic QC bridge.

## Practical operating policy

Motion Quality Full draws more detail, Balanced is default, Eco draws fewer particles/lines at full native VSync, Off is a static canvas. OS Reduced Motion forces static decoration. The original global Interface Animations toggle still wins. Native window minimized/hidden pauses continuous drawing and preserves actual task completion/error feedback.

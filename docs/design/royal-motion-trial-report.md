# QNECTOR Royal Precision Motion — Native Electron Trial 1

**Status:** isolated source-level trial, NOT released and NOT applied to installed QNECTOR.  
**Branch:** `feat/royal-motion-60fps-trial`  
**Known installed stable app:** QNECTOR 0.4.57, source revision `cd483185`, unchanged.  
**Design reference:** `qnector-liquid-glass-motion-v2-1.html` with frameless Queen portrait.

## Performance requirement and interpretation

- User target: moving UI animations should update at **>=60 frames per second while the window is visible on hardware capable of 60Hz or more**.
- Implementation: **native VSYNC via requestAnimationFrame**, with no 18/30/42 FPS artificial cap and no frame-stepping increments. Orb float is a compositor `transform` animation; Silk and Orb fluid Canvas use absolute wall-clock time and a fixed per-frame complexity ceiling.
- Functional accuracy has priority: hidden/minimized/OS reduced motion/user motion-off **must stop** continuous effects; therefore a background window's FPS is intentionally zero. Native system under load can still miss frames, so sustained 60 FPS cannot be guaranteed unconditionally.
- Existing performance architecture and MCP backend are untouched. This is the first vertical slice (Orb, ambient, hero surface, hold feedback), not the entire 48-task redesign.

## Before-and-after experimental measurements

4-second isolated Electron renderer samples, 440×790, synthetic preload, visible window, active motion. The screen's rAF cadence appears ~165 Hz. These measurements represent renderer callback cadence, **not a complete GPU present-time profile**.

| Metric | Baseline old Gold Matrix | Candidate first pass | Candidate final sampled pass |
|---|---:|---:|---:|
| Mean rAF cadence | 153.29 FPS | 149.41 FPS | **165.00 FPS** |
| p95 frame interval | 6.20 ms | 6.10 ms | **6.10 ms** |
| Frames >17 ms | 4 | 4 | **0** |
| Longest frame | 151.5 ms | 254.6 ms | **6.30 ms** |
| Queen images loaded | no | broken file URL | **256px x2 correct** |
| Animated background | falling text Matrix | Silk/Aurora | **Silk/Aurora** |
| Dynamic Orb | molten gradient | Liquid canvas | **Liquid canvas** |

The final pass is a **single passing sample**; earlier spikes show why the result does not establish a universal no-drops guarantee. Additional repeated trials and foreground-game coexistence tests are still required.

Evidence: `royal-motion-baseline-fps.json`, `royal-motion-candidate-fps.json`, and the corresponding `-electron.png` screenshot images.

## Source changes

1. `apps/desktop/src/renderer/royal-motion-clock.ts`: native rAF visual timing, visibility, animation preference and reduced motion policy, cancellation on unmount. Constant `MIN_ACTIVE_MOTION_TARGET_FPS=60` documents the target but does not fake or force achieved frame rate.
2. `royal-silk-background.tsx`: replaces running Matrix glyph rain with bounded non-text Silk/Aurora Canvas; DPR cap and ResizeObserver callbacks deferred to animation frames to eliminate ResizeObserver delivery warnings.
3. `queen-liquid-orb.tsx`: native fluid glass Canvas layered with original transparent `queen-portrait.png`, no square backing, protected from pointer interception.
4. `liquid-motion.css`: thin liquid-glass layer, compositor-driven float and frameless Queen visual. Charge SVG fully hidden when idle, becomes visible only on 3-second hold; immediate visibility cancellation on release.
5. `renderer.tsx`: integrates native components and the Queen brand; replaces per-frame `setHoldProgress` React State updates with SVG DOM ref writes per frame and low-frequency countdown text updates (no full App rerender at 165Hz).
6. `vite.config.ts`: relative asset base for Electron's `file://` loading; previously the image failed in native renderer.
7. `scripts/native-renderer-motion-preload.cjs`: isolated fixture, **rejects actual mutating actions**; can simulate native visibility for QC.
8. `scripts/bench-royal-motion.cjs`, `scripts/accept-royal-motion-trial.cjs`, `scripts/preview-royal-motion-trial.cjs`: reproducible benchmark, hold/visibility smoke, isolated visible preview.
9. `royal-motion-v2.test.ts` and updated old source tests: guard the new design and keep Matrix component tests for rollback/reference. Also updated one stale Memory Center test selector **without changing Memory behavior**, because the preexisting Memory freshness migration renamed the relevant UI.

## Quality checks

- `pnpm typecheck`: **PASS**
- `pnpm build`: **PASS**
- `pnpm lint`: **PASS**
- Focused Royal tests: **27/27 PASS** at first run (added new assertions; rerun if more code changes).
- `pnpm accept:native-ui`: **PASS** (all five native drawers, four viewport sizes: 420×620, 435×900, 451×978, 700×900; keyboard Esc/Tab, no overflow, no console errors). Initial ResizeObserver loop warning was fixed before final pass.
- `electron scripts/accept-royal-motion-trial.cjs`: **PASS** before visibility extension, then **PASS** with native visibility hide/resume simulation: actual Queen PNG loads, idle ring hidden, hold progress updates, early release cancels, full 3-second hold invokes real UI command, synthetic backend rejection handled without false success.
- **Final full project suite on clean committed trial branch: 462/462 tests PASS across 100 test files (106.02 seconds).** Initial full run 460/462 found a correct package-evidence dirty-worktree guard and an outdated pre-existing Memory Center selector. After committing a clean tree and updating *only the test assertion* to current latest activity, linked session and freshness markers, targeted tests 10/10 and complete suite 462/462 passed. Memory behavior and package guards remain unchanged.
- No installed QNECTOR binary, updater, live Bridge or tunnel is modified or exercised by these smoke tests.

## Orb portrait clarity refinement (2026-10-16, source trial only)

**Reported:** Queen portrait looked soft inside an otherwise approved Orb. The 256×256 transparent original is sharp; the problem was primarily compositing. `mix-blend-mode: screen` lifted the opaque dark hair/eye outlines to match the underlying bright fluid, the image was only 76% of the sphere, and the reflection overlaid the portrait.

**Targeted fix:** retain the original unchanged PNG and the frameless transparent design, but render it with normal alpha compositing, slightly increase its size to 84%, add restrained static contrast/saturation, and mask glass reflection in the central portrait area while preserving refractive lighting at the rim. No new asset dependency or extra animation loop; no other menu or functionality changed.

**Verified:** before/after captures from the actual Electron renderer at 440×790 are `royal-motion-orb-clarity-before.png`, `royal-motion-orb-clarity-after.png`, and enlarged side-by-side `royal-motion-orb-clarity-comparison.png`. Image loading 256px ×2, TypeScript/build, focused test 4/4, native Orb hold/visibility smoke (including computed-style clarity assertions) and lint PASS; Impeccable CSS detector yielded no findings. Measured native rAF cadence 165.01 FPS average, p95 6.20ms and no intervals over 17ms during one 4.2s pass (not a guaranteed minimum FPS under every load).

**Delivery boundary:** updated only the isolated `feat/royal-motion-60fps-trial` source and synthetic Electron preview, not installed QNECTOR v0.4.57.

## Remaining checks before shipping

- Repeated real frame **presentation** and GPU/CPU utilization, including gaming/Delta Force foreground coexistence, not just renderer rAF metrics.
- Check high-DPI and varied refresh rates using physical equipment where available.
- Full cross-screen Liquid Glass design parity beyond the Orb/hero/background. Most of 48 implementation tasks remain outstanding.
- Packaged Windows update/rollback acceptance, actual production connection hold under the installed user app, reduced-motion screen-reader QA. The full automated source suite is already green (462/462).
- Keep latest user-approved `animation-rework.md` master checklist as the authority; do not mark a phase complete from one visual trial.

## How to preview safely

Run from repository root (requires locally installed Electron):
`node_modules\electron\dist\electron.exe scripts\preview-royal-motion-trial.cjs`

This opens the **actual newly-built Electron renderer** using a **synthetic local bridge**, marked `ROYAL MOTION TEST - SIMULATED DATA`. No real file deletion, tunnel action, Memory write or update is possible in the fixture. This is deliberately distinct from the user's installed QNECTOR.

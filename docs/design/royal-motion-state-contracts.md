# QNECTOR Royal Liquid Motion — State and Interaction Contracts

Source: apps/desktop/src/renderer on feat/royal-motion-60fps-trial, 2026-10-19.
Design authority: animation-rework.md V2.1. Installed QNECTOR 0.4.57 is unchanged.

## Design system

- Black and restrained gold Liquid Glass, sharp real Queen portrait integrated into the orb without any square icon frame.
- One expensive backdrop blur at each top-level modal, cheap refractive paint for nested rows.
- Motion tokens: press 120ms, hover 175ms, panel entrance 270ms, drawer enter 310ms, easing cubic-bezier(.16,1,.3,1).
- Native one-stroke SVG icon vocabulary, with no large new third-party motion dependency.
- Orb and Silk share a single native VSYNC requestAnimationFrame clock. Quality modes Full/Balanced/Eco adjust ribbon count, particle count, arc count and DPR, never reduce the frame cadence below the available VSYNC. Off, Reduced Motion, legacy animationsEnabled=false and hidden/minimized suspend decoration.

## Connection state machine

| From | Input | To / behavior |
|---|---|---|
| disconnected | click connect / orb | connecting; backend request |
| connecting | verified backend connected | connected |
| connecting | backend rejected/error | disconnected + actual error |
| connected | pointer or keyboard press | holding; hold-only 3s radial ring visible |
| holding | release before 3s, pointer cancel, lost focus | connected; ring hidden and reset |
| holding | continuous hold >=3s | disconnecting; backend disconnect request |
| disconnecting | backend confirms disconnected | disconnected |
| disconnecting | backend rejects/error | connected + actual error; never fake success |
| disconnected | click reconnect | connecting |

The hold visual updates using SVG ref without full React rerender every frame. Countdown text is updated about 10 times/s, while ring uses display VSYNC. Idle ring and its zero-progress cap must not be visible.

## Drawer state machine

| From | Input | To / behavior |
|---|---|---|
| closed | open dock/tab | opening, focus trapped |
| opening/open | any other tab clicked | active new route immediately, even when rapidly repeated |
| open | Escape, close, backdrop | closing |
| closing | reopen/different destination | reverse/retarget to newest route |
| closing | CSS exit or bounded timeout | closed, focus restored |

Drawer shell persists, and scroller position is stored for each route. The source captures last click using activeDrawerRef rather than stale React state. No 200ms timeout blocks tab clicks.

## Data-specific behavior

- Live Activity is driven by real events, not by animation timers. Running/error/success labels reflect actual tool data. The parent virtualization row owns the Y transform; its child owns microinteraction transforms, so item entry never teleports a virtualized row.
- Memory shows persisted activities/tasks and explicitly saved excerpts. Animation must not pretend it captures all ChatGPT conversation turns.
- Skills enable, import, validate and save only show success after real backend confirmation. Filters remain keyboard-accessible.
- Runtime progress derives from actual process/job status, no guessed percentages. Errors retain their real messages.
- Setup is four logical steps: Check, Tunnel, ChatGPT, Done. Inputs are kept in React state across steps. Validation is inline, never hidden by transition.
- Updater states: idle, checking, available/up-to-date/error, downloading, downloaded, preparing restart and restarting. Download percentage is derived from real downloaded/total bytes, and restart remains indeterminate until actually confirmed.

## Acceptance matrix

| Surface | Motion behavior | QA evidence |
|---|---|---|
| Header & brand | one brief entrance, actual Queen logo | native screenshot, build |
| Orb | float/flow/hold, backend-confirmed states | actual Electron 3s press smoke |
| Silk Aurora | Canvas native VSYNC, quality budgets | 4-profile native QC |
| Dock | selection, hover, press, keyboard focus | viewport and rapid-nav QC |
| Drawer | open, close, retarget, per-route scroll | 40 rapid tab clicks + scroll restoration |
| Activity | bounded feed entrance, stable virtualization | synthetic 16-event native QC |
| Workspace, Memory, Skills | same Liquid Glass visual vocabulary, truthful data | five-drawer native QC |
| Runtime, settings | semantic states, persisted quality preference | Electron QC |
| Setup, updater | fast bounded transitions, real validation/progress | source & UI regression tests |
| Error/Toast/Focus | accessible feedback, no fake success | native error / focus tests |

## Limits and safe rollback

Native callback-cadence FPS is only one measure; graphics present-time, CPU/GPU and gameplay coexistence need separate validation. On ~60 Hz screens callback counts cannot continuously exceed physical display refresh. Off/reduced/hidden intentionally stops decorative loops. Do not automatically replace an installed v0.4.57 binary or publish external releases for a UI trial. Previous source commit 30ed82f remains rollback point for animation source.

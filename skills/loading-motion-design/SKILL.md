---
name: loading-motion-design
description: Design and implement splash screens, startup transitions, skeletons, progress indicators, loading states and interface motion. Trigger for splash, loading, animation, transition, skeleton, spinner, startup, เปิดช้า, โหลดช้า, หน้าโหลด, อนิเมชัน, แอนิเมชัน, เปลี่ยนหน้า, or perceived lag.
license: MIT
compatibility: Qnector 0.4.9+; browser/performance diagnostics recommended
allowed-tools: system workspace files process browser computer
---

# Loading and Motion Design

Motion must communicate state and continuity. Loading UI must reduce uncertainty and perceived delay, not simply decorate waiting time.

## Choose the right loading pattern

- **Splash**: app process/window startup before the primary shell can paint. Keep it lightweight and self-contained.
- **Skeleton**: content geometry is known and data arrives asynchronously. Match final layout closely to prevent jumps.
- **Inline progress/status**: a local action is running while the rest of the UI stays usable.
- **Determinate progress**: real measurable progress exists. Never fake a percentage.
- **Indeterminate indicator**: work duration is unknown but the UI must confirm activity.
- **Optimistic update**: action is highly likely to succeed and rollback is clear.

Do not block the entire screen for a task that can run behind an already usable shell.

## Startup rule

Prioritize first useful paint over background initialization. For desktop apps:

1. Load minimal configuration needed to decide visibility.
2. Show a lightweight splash or shell quickly.
3. Keep the heavy runtime/import/network initialization off the first-window critical path when architecture permits.
4. Create the main window hidden and reveal it at `ready-to-show`/equivalent to avoid blank flashes.
5. Transition from splash to main window once the shell is visually ready; background services may continue and report their own connecting state.
6. Record startup milestones so perceived improvements can be compared with actual timings.

## Motion rules

- Use motion to explain entrance, exit, hierarchy change, navigation direction or success/failure feedback.
- Keep related transitions consistent in distance, duration and easing.
- Avoid animating expensive layout properties continuously when transform/opacity can express the same change.
- Do not stack multiple attention-seeking animations in one region.
- Prevent queued activity animations from visually colliding when events arrive quickly; coalesce or shorten backlog transitions.
- Respect `prefers-reduced-motion` and keep the interface fully understandable without animation.

## Quality gate

Verify:

- no blank/white flash before the first branded frame,
- no fake progress values,
- no layout shift from skeleton to content where avoidable,
- no animation blocks input longer than necessary,
- rapid repeated events do not produce a broken animation queue,
- reduced-motion mode remains usable,
- startup/load errors have a recovery or understandable status,
- performance marks or browser metrics show no major regression from added effects.

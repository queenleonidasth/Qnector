---
name: ui-ux-design
description: Design, redesign, and implement polished production UI/UX for desktop/web apps and product surfaces. Trigger for UI, UX, frontend design, redesign, layout, styling, responsive, ออกแบบ, ดีไซน์, UI UX, หน้าตา, ทำให้สวย, ใช้งานง่าย, ใช้งานยาก, ปรับ UI, or visual polish.
license: MIT
compatibility: Qnector 0.4.9+; managed browser and screenshots improve visual verification
allowed-tools: system workspace files process browser computer
---

# Qnector UI/UX Design

Treat UI work as product design plus implementation, not decoration. The default goal is a distinctive, coherent, buildable interface that remains easy to use under real data and real states.

## Trigger rule

Activate this skill for any material UI/UX task: new screens, redesigns, navigation, forms, dashboards, responsive behavior, styling, animation, loading states, component systems, spacing, typography, hierarchy, or visual polish.

For an existing product, **audit before redesigning**. Do not discard an established visual language unless the user asks for a new direction.

## Required workflow

1. Inspect the existing surface: source files, component structure, CSS/theme tokens, target screen size, screenshots or a headless browser render when available.
2. Identify the primary user task and the dominant action on the screen. Remove or quiet anything competing with it without a product reason.
3. Choose one explicit visual direction appropriate to the product. Avoid generic AI defaults such as arbitrary purple gradients, excessive cards, random glows, oversized hero typography, and decorative animation without purpose.
4. Establish or reuse a small design system before one-off styling:
   - typography hierarchy
   - spacing rhythm
   - surface/elevation rules
   - color roles and contrast
   - radius/border rules
   - interactive states
   - motion rules
5. Implement the smallest coherent component structure that supports the design. Prefer reusable tokens/components over repeated magic values.
6. Design all important states, not only the happy path: loading, empty, error, disabled, hover, focus, selected, submitting, success, long content, overflow, and slow data.
7. Validate responsiveness at the actual target sizes. Desktop and mobile layouts should recompose rather than merely shrink proportionally.
8. Verify keyboard/focus behavior and readable contrast. Respect `prefers-reduced-motion` for non-essential motion.
9. Run the UI headlessly. Check DOM/layout, console errors, network errors, scrollability, clipping, overflow and screenshots. Fix visual defects before presenting.
10. Re-check the user task after visual polish: fewer steps, obvious hierarchy, no hidden controls, no accidental scroll traps, and no dead states.

## Visual quality rules

- Hierarchy first: primary, secondary and tertiary actions must look different.
- Use whitespace deliberately; dense tools may be compact, but never cramped accidentally.
- Typography should carry hierarchy before borders and shadows do.
- Align to a grid/rhythm. Small alignment errors make otherwise good UI feel unfinished.
- Motion should explain change, continuity or feedback. One strong transition is better than many unrelated micro-animations.
- Use skeletons only when the final geometry is known. Use progress/status copy when the duration or phase matters.
- Avoid nested-card syndrome. Use cards for genuinely grouped/framed units, not every section.
- Keep hit targets comfortable and labels explicit.
- Never hide required functionality for aesthetic cleanliness.

## Existing-app redesign discipline

Before editing, capture or inspect the current state and identify what is actually wrong: hierarchy, spacing, discoverability, flow complexity, state handling, responsiveness, consistency, or aesthetics. Preserve working interaction patterns unless there is a reason to change them.

For large redesigns, make changes in coherent passes: structure → tokens → components → states → motion → visual QC. Do not randomly restyle unrelated elements in parallel.

## Done gate

Do not call a UI task finished until:

- the primary task is obvious,
- loading/empty/error states are covered where applicable,
- no key content clips or escapes its container,
- scrolling works in every scrollable panel,
- focus/keyboard behavior is usable,
- responsive target sizes were checked,
- browser/app console has no new relevant errors,
- a final visual inspection was performed.

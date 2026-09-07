---
name: ui-ux-audit
description: Audit an existing desktop/web UI for usability, hierarchy, layout, scroll/overflow, responsiveness, states, accessibility and perceived performance. Trigger for UI QC, UX audit, visual bug, clipping, scroll, ใช้งานยาก, เลื่อนเพี้ยน, UI เพี้ยน, ตรวจ UX UI, เช็คความสวย, or make this easier/better.
license: MIT
compatibility: Qnector 0.4.9+; browser/computer screenshot and DOM inspection recommended
allowed-tools: system workspace files process browser computer
---

# UI/UX Audit

Audit with evidence from the real interface. Source review alone is not enough for material UI work when Qnector can render or inspect the product.

## Audit passes

### 1. Task flow

Identify the 1–3 most important user tasks on the surface. Count unnecessary decisions, hidden steps, duplicated controls, ambiguous labels and places where the user can get stuck without recovery.

### 2. Hierarchy and composition

Check attention order, alignment, whitespace, density, typography, primary/secondary actions, repeated card framing, visual noise and consistency with the rest of the product.

### 3. State coverage

Exercise or inspect loading, empty, error, disabled, hover, focus, selected, submitting, success and long-content states where applicable. Treat missing states as product defects, not polish backlog.

### 4. Scroll and responsive behavior

Check nested scrollers, inaccessible content, clipped drawers/modals, fixed headers/footers, minimum viewport, small-screen reflow, text wrapping, table overflow and touch-target spacing.

### 5. Interaction and accessibility

Check focus visibility, keyboard reachability, labels, contrast, control semantics, destructive-action clarity, error recovery and `prefers-reduced-motion` behavior.

### 6. Perceived performance

Check blank startup windows, layout jumps, long unacknowledged waits, blocking spinners, repeated data reloads and screens that appear frozen. Prefer immediate shell/skeleton/status feedback while expensive work continues asynchronously.

### 7. Visual verification

Use browser DOM/computed styles plus screenshots where possible. For desktop-native controls use `computer` inspection and screen capture. Verify after fixes; do not assume CSS changes look correct.

## Severity

Prioritize findings by user impact:

- P0: blocks a primary task or loses data.
- P1: major confusion, inaccessible control, severe clipping/scroll defect.
- P2: friction, inconsistent state handling, responsive defect, weak hierarchy.
- P3: polish/detail issue with limited task impact.

Fix P0/P1 first. Batch related P2/P3 fixes by component or design token instead of scattering one-off overrides.

## Done gate

A UI audit is complete only when important findings include concrete evidence and a proposed or implemented correction, and material fixes are visually re-checked in the real surface.

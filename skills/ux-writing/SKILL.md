---
name: ux-writing
description: Write and audit interface microcopy for labels, buttons, menus, onboarding, empty states, loading, errors, confirmations and notifications. Trigger for UX writing, microcopy, wording, label, CTA, ข้อความใน UI, ชื่อปุ่ม, เมนู, ข้อความ error, ข้อความโหลด, or wording that affects usability.
license: MIT
compatibility: Qnector 0.4.9+
allowed-tools: workspace files browser computer
routing:
  positive-triggers:
    - "ux writing"
    - "microcopy"
    - "wording"
    - "button label"
    - "button labels"
    - "error copy"
    - "validation messages"
    - "empty state copy"
    - "loading copy"
    - "ข้อความใน ui"
    - "ชื่อปุ่ม"
    - "ข้อความ error"
  negative-triggers:
    - "document writing"
    - "source code"
  capabilities:
    - "ux-writing"
---

# UX Writing

Treat interface text as part of the interaction design. Good microcopy reduces decisions, explains consequences and helps users recover without requiring documentation.

## Rules

1. Prefer the user's task vocabulary over internal implementation terms.
2. Button labels should describe the action or outcome. Avoid vague `OK`, `Submit`, `Process` or `Continue` when a precise label fits.
3. Keep labels stable across screens for the same concept.
4. Put essential guidance near the control that needs it; do not rely on distant help text.
5. Error messages must state what happened and the next useful action when recovery is possible.
6. Loading/status text should describe the phase when the wait is meaningful: `Preparing workspace`, `Connecting tunnel`, `Checking update`, not generic `Please wait` everywhere.
7. Empty states should explain why the area is empty and offer the most likely next action when applicable.
8. Confirmation dialogs should name the object/action and make destructive vs safe choices visually and verbally distinct.
9. Avoid blaming language, jokes in failure states, unnecessary exclamation marks and technical stack traces in primary UI copy.
10. Check truncation and readability at the actual component width, especially buttons, tabs, badges and mobile layouts.

## Audit checklist

- Can a first-time user predict what each primary action does?
- Are irreversible actions explicit before execution?
- Are loading, success and failure states distinguishable without relying only on color?
- Do errors contain a recovery path rather than only an error code?
- Are labels concise without becoming cryptic?
- Is terminology consistent with the rest of the product?

When editing an existing product, preserve its established voice unless the user asks to change tone globally.

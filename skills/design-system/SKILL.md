---
name: design-system
description: Create, extract, normalize, or extend a practical design system with tokens, typography, spacing, color roles, components, states, responsive rules, and motion. Trigger for design system, theme, tokens, consistency, ระบบดีไซน์, ธีม, สี, ฟอนต์, spacing, or UI consistency across many screens.
license: MIT
compatibility: Qnector 0.4.9+
allowed-tools: workspace files process browser
---

# Design System

Use this skill when a UI needs reusable visual rules rather than isolated styling fixes.

## Workflow

1. Inventory the existing system before creating a new one: CSS variables, theme files, component primitives, typography, spacing values, radii, borders, shadows and breakpoints.
2. Preserve intentional existing brand choices. Consolidate accidental duplicates and magic values.
3. Define semantic tokens by role rather than by component name:
   - background / surface / elevated surface
   - text primary / secondary / muted / inverse
   - accent / success / warning / danger / focus
   - border subtle / strong
   - spacing scale
   - type scale and weights
   - radius and elevation scale
   - motion duration/easing
4. Map components to tokens. Components may compose tokens but should not invent a new palette or spacing scale without a product reason.
5. Specify component states: default, hover, active, focus-visible, disabled, loading, selected, error and success where relevant.
6. Define responsive behavior as layout rules, not just breakpoint numbers. State what stacks, collapses, scrolls, truncates or becomes a drawer/menu.
7. Keep the system small. If two tokens are visually/functionally indistinguishable, merge them unless future theming needs the distinction.
8. Validate representative screens after token changes so a global cleanup does not silently break dense or edge-case surfaces.

## Output discipline

When the project benefits from a persistent artifact, create or update `DESIGN.md` with:

- visual direction
- semantic tokens
- type/spacing scales
- surface/elevation rules
- component/state rules
- responsive rules
- motion rules
- accessibility constraints

Do not create `DESIGN.md` merely for a tiny one-component adjustment.

## Quality gate

- No unnecessary duplicate tokens.
- No hard-coded visual values repeated across multiple components when a token fits.
- Primary/secondary hierarchy remains clear.
- Focus, disabled and error states are not omitted.
- Dark/light variants, if present, are role-consistent rather than manually recolored screen by screen.
- Representative screens still render correctly after normalization.

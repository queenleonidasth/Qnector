# QNECTOR Liquid Glass V2.1 — Frameless Queen Orb

**Status:** Interactive offline HTML prototype, NOT the installed QNECTOR runtime.

## Open

- Main HTML: `qnector-liquid-glass-motion-v2-1.html`
- Windows copy: `C:\Users\QUEEN\Downloads\QNECTOR-Liquid-Glass-Motion-Mockup-v2.1.html`
- Earlier comparison: `qnector-liquid-glass-motion-v2.html`

Double-click the V2.1 file to use Chrome or Zen Browser. No npm, CDN, API or extra PNG is needed: the exact user's `icon-256_square.png` is embedded inside the HTML.

## Design change (requested)

The older Orb used a black square icon tile with a gold outline, padding, black background and multiple box shadows. V2.1 **removes that square completely**.

The PNG has transparent pixels already. V2.1 places it directly inside `.orb-shell` above the live fluid canvas and below the glass reflection layers; the image uses screen blending and a subtle warm-gold light response. The transparent `#orbAction` remains a circular button spanning the Orb for its original 3-second pointer/keyboard interaction.

The small header QNECTOR appmark is unchanged; only the mark inside the Orb has been integrated.

## What to test

Hold the Orb for 3 seconds, release early to cancel, or click again after a completed disconnect to reconnect. Other functionality is inherited unchanged: Liquid Silk/Aurora background, Full/Balanced/Eco/Off and Reduced Motion, Workspace, Memory, Skills, Settings, Runtime, command search and the Motion Lab.

The project retains **V2** side by side as a before-and-after visual reference.

## Verified browser QA

Run from the project root:
`node docs/design/qnector-liquid-glass-v2-1-qc.cjs`

Headless Chrome CDP verifies that the original 256x256 PNG loaded, the Queen image is nested within the glass orb (not the action button), the emblem has zero border, background-image and box-shadow, and `mix-blend-mode:screen` is active. It also checks the hidden idle hold-progress state, full/early hold and reconnect, 30 rapid tab changes, focus handling, search, motion quality/Reduced Motion, 420px viewport and zero JavaScript exceptions.

Screenshots: `qnector-liquid-v2-1-*.png` in the same folder (nine screen captures), all rendered by Chrome from the real HTML.

**Production status:** All 48 product implementation tasks in `../../animation-rework.md` remain pending. This is an approved visual prototype only.

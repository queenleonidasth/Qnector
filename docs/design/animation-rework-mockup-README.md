# QNECTOR Animation Rework — Interactive Mockup

**Status:** design prototype, not installed in QNECTOR. **Date:** 2026-10-16. **Canonical plan:** ../../animation-rework.md.

## Open it

Double-click animation-rework-mockup.html, or run in Windows PowerShell:

Start-Process "D:\Projects\Qnector-NoPlan-20261016\docs\design\animation-rework-mockup.html"

The file is self-contained HTML/CSS/JavaScript, needs no npm install or connection, and does **not** call QNECTOR/MCP or transmit any data. All connection, Memory, Skills, Runtime, Setup, and Updater values are invented for safe UI evaluation and labeled as demos.

## What to try

1. **Dashboard:** Observe dark–gold glass panels, Matrix rain, quiet ambient background, floating Orb, active indicator and live event feed.
2. **Orb:** Hover/press. Hold mouse or Space/Enter for a **full 3 seconds** to run a simulated disconnect. Releasing early cancels. Click the now-disconnected Orb to run a simulated reconnect.
3. **Live Feed:** Click New event. It enters as Running, then settles on Done in preview. Click an entry to inspect a sample detail dialog.
4. **Dock / Drawer:** Click Workspace, Memory, Skills, Settings or Runtime. Change tabs quickly and close with Escape / X / backdrop.
5. **Memory:** Latest activity appears separately from historical linked sessions. Filter illustrative stored notes.
6. **Skills:** Toggle examples, filter by text, and simulate a save/skill import; no real feature is changed.
7. **Settings:** Compare Full, Balanced, Eco and Off; change ambient intensity; toggle feedback and reduced-motion. Everything resets on reload.
8. **Runtime:** Inspect determinate and indeterminate progress treatments.
9. **Header controls:** Simulate updater, open animation settings, or open Motion Lab.
10. **Motion Lab:** Replay nine visually distinct motion samples, or replay all. The full 90-entry map links to source examples from animation-rework.md.
11. **Setup Wizard:** Navigate steps without configuring real tunnels or accessing credentials.
12. **Guided tour:** Bottom-left button runs a short coordinated animation sequence.

## Preview screenshots

- animation-rework-dashboard-preview.png — Dashboard, Orb and Activity
- animation-rework-workspace-preview.png — Workspace drawer
- animation-rework-memory-preview.png — Memory drawer over Dashboard
- animation-rework-skills-preview.png — Skill toggles and list
- animation-rework-runtime-preview.png — Runtime and Durable Jobs
- animation-rework-settings-preview.png — Quality profile controls
- animation-rework-setup-preview.png — Setup Wizard
- animation-rework-updater-preview.png — Simulated updater progress
- animation-rework-motion-lab-preview.png — Motion interaction gallery
- animation-rework-mobile-preview.png — 420px viewport responsive layout

The preview screenshots were captured with **headless Chrome**, not generated concept art.

## Verified QC

- HTML + embedded JavaScript syntax: Node --check: PASS
- Real headless Chrome CDP interactions: PASS
- Tested: Dashboard / Workspace / Memory / Skills / Runtime / Settings / Motion Lab / Activity / Updater / Setup; Full/Balanced/Eco/Off + Reduced Motion; early pointer release remains connected; 3-second pointer hold/disconnect/reconnect; Memory search and Skill persistence; 30 rapid navigation actions; Shift+Tab drawer focus wrap; 420px viewport overflow; JS exceptions = 0
- Reproducible command: node docs/design/animation-rework-mockup-qc.cjs
- The QC script only launches a temporary, headless Chrome instance and writes ten screenshots in this folder. It does **not** install dependencies, modify the real QNECTOR runtime, or publish anything.

### Known limits

This is a **visual interactive approximation**, not the actual QNECTOR desktop renderer. It has no real performance baseline, GPU frame pacing benchmark, system integration, persistent configuration, external URLs (except optional Motion Reference), or production-grade accessibility audit. Those are mandatory implementation tasks and release gates in the plan, not completed by this mockup.

# QNECTOR Liquid Glass Motion V2 — Interactive HTML Mockup

**Status:** Prototype complete; NOT installed in production QNECTOR.  
**Source-of-truth specification:** `../../animation-rework.md` (revision V2 in §0A).  
**Built with:** UI/UX Pro Max + Impeccable design guidance, reviewed from QNECTOR Agent Skills installed on 2026-10-16.

## Main deliverable

`qnector-liquid-glass-motion-v2.html` — one fully portable HTML/CSS/JavaScript file. It contains the **actual 256×256 Queen logo** from `C:\Users\QUEEN\Downloads\icon-256_square.png` as two embedded PNG data URIs, so there is no relative asset dependency, no CDN, no library install and no network request.

On Windows, double-click the HTML or open it in Chrome / Zen Browser. Project folder:
`D:\Projects\Qnector-NoPlan-20261016\docs\design\`

## What changed from Mockup V1

1. Crown-only placeholder replaced by user's official gold Queen mark.
2. Orb upgraded to translucent 3D-style liquid glass: glass shell, inner light filaments, refraction and caustic rings, elegant orbit lines, subtle float.
3. Hold-to-disconnect: **no track, cap dot or pre-progress appears while idle.** The separate radial SVG ring is visible ONLY after real pointer/keyboard hold begins; it follows a 3,000ms timer. Early release or pointer cancellation resets. Completed hold suppresses the next synthetic click; reconnect needs a new click.
4. Matrix falling text/glyphs removed entirely from new visual target. Background is a single Canvas rendering flowing Silk/Aurora ribbon paths and suspended warm-gold particles; all text stays legible.
5. Liquid Glass treatment extended to top search bar, header, dashboard, metrics, activity feed, motion-quality panel, footer dock, all drawers, settings, skill controls and modals.
6. Added Full/Balanced/Eco/Off motion profiles, manual Reduced Motion override and user setting for ambient animation.
7. Interactive command search (Ctrl+K), responsive drawers with focus trap and Escape, simulated activity detail, local skill toggles, sample Memory filters and 6 live Motion Lab examples.
8. All fake runtime information is marked as **sample/demo only**. This HTML cannot call QNECTOR/MCP or modify real Windows files/settings.

## How to try

- **Orb:** while connected, press and hold for 3s, then observe "Disconnected" state; click once afterwards to reconnect. Release early to cancel; watch the ring disappear immediately.
- **Ambient:** observe ribbon and caustic motion at Full/Balanced; switch Eco or Off; switch Reduced Motion in Settings.
- **Navigation:** bottom Workspace/Memory/Skills/Settings/Runtime dock opens a refractive side drawer; navigate rapidly, press Escape to close.
- **Search:** select the top search bar or Ctrl+K to open a command palette; type Memory, Skills, etc.
- **Settings:** open Motion Lab and click each microinteraction to replay animations; toggle ambient intensity.
- **Activity:** click an event card to see detail; demo-only toast feedback appears on simulated actions.

## Browser QC evidence

Run:
`node docs/design/qnector-liquid-glass-v2-qc.cjs`

Headless Chrome CDP checks and image captures:
- Actual user icon embedded twice; Canvas rendering without any Matrix text rain.
- Idle hold progress `visibility:hidden` and `opacity:0`.
- Hold progress visible only mid-press; early release cancel; full 3s disconnect; separate click reconnect.
- Responsive dashboard, 420px viewport, no horizontal overflow.
- Workspace, Memory, Skills, Runtime, Settings, command palette, Motion Lab.
- 30 rapid drawer switches, keyboard Shift+Tab focus wrap/Escape close.
- Full/Balanced/Eco/Off/Reduced Motion settings, simulated Memory filter and Skill switch persistence.
- Chrome Runtime exception count = 0.

The script generated nine real Chrome screenshots in this folder:
`qnector-liquid-v2-{dashboard,memory,skills,workspace,runtime,settings,motion-lab,orb-holding,mobile}.png`.

### Remaining before production integration

This mockup does not imply completion of any AR-01..AR-48 production work. In the actual Electron app, CPU/GPU/frame pacing baseline, visual-performance quality levels, actual state binding, accessibility screen-reader pass, DPI scaling and packaged-Windows startup still require full verification.

The Impeccable detector reported decorative dark-gold glow warnings; the art direction intentionally uses these highlights because the user explicitly approved this visual. Contrast and functional states are prioritized over background decorations.

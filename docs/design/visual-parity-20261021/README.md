# QNECTOR — approved V2.1 Liquid Glass vs native Electron reality

Checked on Windows 2026-10-21. User rejected the published v0.4.58 visual effects as *not resembling the approved mockup*. This is a source-only visual fidelity revision on the separate branch `fix/royal-motion-parity-20261021`; **the public v0.4.58 release and installed v0.4.57 were not modified**.

## Visual baseline and exact measured mismatch

Reference: `../qnector-liquid-glass-motion-v2-1.html`, not an illustration.
Same Electron capture viewport: **475 × 865**.

| Element | Approved mockup | v0.4.58 prior build | Visual parity rewrite |
|---|---:|---:|---:|
| Orb | outer 269 px, x 99, y 165 | inner 132 px, x 172, y 248 | glass inner 249 px, x 113, y 159; full shell 269 px |
| Ambient | full viewport ~467 × 865 px | only 300 × 150 px, x 88, y 81 | full window ~499 × 887 px, x −12, y −12 |
| Hero scene | x 9, y 94; 449 × 572 | x 16, y 60; 443 × 538 with competing opaque card | x 12, y 90; 451 × 580 with frameless hero |
| Dock | x 14, y 790 | x 16, y 799; 52 high | x 12, y 790; 65 high |

The v0.4.58 bug was architectural: the legacy CSS selector `.hero-glass-section > *:not(.gold-matrix-layer)` forced the unrelated Silk Canvas to `position:relative` inside the Hero flex column; it consumed 150 px of vertical space and prevented a full-window background. The Orb itself was also capped at ~140 px rather than the approved 269 px.

## Rework executed in production source

1. Mount exactly one `RoyalSilkBackground` at the `app-container` level and give it a fullscreen, pointer-transparent background paint layer.
2. Port the approved HTML's broad refractive ribbon gradients (67/26/3.2 px stroke stack), moving light motes and dark glass aurora to the real Canvas with dynamic quality-based complexity.
3. Rebuild the Queen Orb fluid light as responsive inner ellipses, gradient/candle glints, white/gold caustics, small motes and transparent queen portrait with natural alpha, not `screen` blend or an image tile.
4. Add paired celestial orbital rings, two oblique eclipse planes, moving comet highlights and a warm radial halo around the full-size Orb, without disturbing the 3-second backend-confirmed disconnect input handler.
5. Match narrow-window glass header/brand, isolated frameless hero, live state badge, ivory serif status, endpoint action buttons, lower activity glass and vertical nav dock.
6. Rework hover glass specular reflection to follow pointer with one delegated passive handler and at most one RAF update; Off/Eco/Reduced disabled and cleanup included.
7. Retain the existing shared native VSYNC clock, no 30/42 FPS throttling, hidden window motion pause, OS Reduced Motion, Full/Balanced/Eco/Off, original no-Plan Mode and backend/Memory/Tools functions.
8. Ensure small 420×620 windows do not hide essential buttons or create horizontal overflow. The approved long prototype itself scrolls and partially hides controls at this viewport; the real Electron app deliberately preserves keyboard and essential UI visibility.

## Screenshot comparison

- `approved-mock-475x865.png`: user-approved HTML rendered at 475×865.
- `actual-v0.4.58-baseline.png`: old real Electron renderer before fix.
- `actual-after-parity-475x865.png`: corrected real Electron renderer.
- `approved-mock-420x620.png`, `actual-after-parity-420x620.png`: low-height safe area.
- `approved-mock-435x900.png`, `actual-after-parity-435x900.png`: standard taller window.
- `approved-mock-1280x850.png`: conceptual widescreen layout; the current narrow-window production app does not introduce fake dashboard panels or pretend to be a widescreen desktop redesign.

## Acceptance scope and limits

- Full source `pnpm build` including TypeScript passes.
- Native four-viewport, 5-tab accessibility, Escape and tab QA passes; native 4-profile Motion and hidden/reduced/off state QA passes.
- Native 40 rapid tab retargets, Activity virtualization and input/focus QA pass.
- A measured short active Balanced profile on current user's high-refresh display observed 163.78 average RAF callbacks per second, P95 6.2 ms over ~4.1 seconds, no visible JS console errors in the benchmark. **This measures animation callback intervals, not compositor presentation, and is not a minimum guaranteed FPS or game workload test.**
- User should approve the actual *separately running, simulated-data Electron preview* before we publish a distinct new release. Neither published GitHub v0.4.58 nor currently installed v0.4.57 are overwritten.

# QNECTOR — COMPLETE ANIMATION REWORK MASTER SPECIFICATION

> **DESIGN APPROVED / NATIVE ELECTRON TRIAL UNDERWAY (NOT RELEASED)** | Revision V2.1 trial | 2026-10-16 | Owner: QNECTOR Desktop UI
> This is the durable, canonical task checklist. Do not mark an item complete solely because code was written; require its named verification evidence. No Plan Mode changes, no new feature unrelated to motion, no production deployment from this task.

## 0. Non-negotiable brief (read before every implementation session)
1. Scope: rebuild ALL QNECTOR animations: brand, background, Canvas Matrix, central Orb, connect/hold/disconnect, header, all UI controls, navigation, dock, drawer, modal, activity, Memory, Skills, Skill Editor, Workspace, Runtime, Settings, Setup, updater, validation, typography, accessibility.
2. Keep existing navigation/information architecture and business logic. This is an animation redesign, NOT a redesign of MCP operations, Memory recording, updater semantics, or Plan Mode.
3. Visual identity: Royal Precision Motion; premium charcoal/black, subtle warm gold, soft glass, clean legible data, cinematic only for meaningful success/connection events. Orb is the visual hero; background is subordinate.
4. Responsiveness: input and functional state must never be blocked on an entrance effect. Long loops must never be tied to task success. Changing drawer tabs rapidly must retarget or cancel the prior animation.
5. Game-conscious performance: default Balanced, adaptive Canvas cap, stop loops when hidden/minimized; protect game frame pacing ahead of visual flourishes. Measure before/after on actual Windows Electron builds.
6. Privacy/data correctness: no fake success, no guessed percentages, no passive ChatGPT transcript capture. Diagnostics must never show animation as an authoritative completion signal.
7. Availability: use reduced-motion fallback for every action; no essential information may be conveyed by motion alone. Keyboard, focus, screen reader, mobile/touch and high DPI must work.
8. Use the Motion Reference site as a visual/behavioral design source—not as code to blindly copy. Check dependencies/licensing before reuse; implement with existing CSS/WAAPI/Canvas; only add Motion for React if demonstrably necessary.
9. Mockup is demonstrative and offline; interactions are simulated, not connected to MCP, file deletion, tunnel, updater or real settings. Never mistake mockup for shipped implementation.
10. Record every implementation checkpoint, test outcomes, evidence, defects, mitigations, and revisions in the progress section at the end of this file.

## 0A. Approved V2 visual authority — Liquid Glass + Queen Orb + Silk Aurora (2026-10-16)

**This is the V2 design baseline; the V2.1 correction in section 0B below is the latest authority.** If earlier sections mention preserving Gold Matrix Rain or the old crown-only Orb, treat those statements as historical baseline, **not future design requirements**. Keep the AR-01..AR-48 IDs stable; production implementation remains pending.

- **Design target:** the user's most recently approved QNECTOR dark-and-gold visual reference, with much stronger **Liquid Glass** materials throughout all menus, cards, search, popup, drawer, buttons, toolbar and dock. Refracted edges, layered translucency, anisotropic highlights, restraint for legibility.
- **Brand:** use the exact user's PNG at \`C:\Users\QUEEN\Downloads\icon-256_square.png\` as QNECTOR header and central Orb mark, preserving its aspect ratio and colors. It is a gold Queen portrait, not a crown-only surrogate. The new HTML demo embeds the actual PNG data URI and works standalone.
- **Orb (V2.1):** a layered glass energy sphere with a dynamic flowing light field, caustic arcs, precision concentric rings, subtle chrome reflection and the Queen portrait **integrated directly into the orb surface**. The Queen artwork must have **no square border, badge, tile, backplate or box shadow**; preserve its transparency and blend with the glass/energy underneath. Avoid any idle progress dot above the Orb.
- **Hold interaction:** the existing long-hold-to-disconnect requires **3 seconds**; the progress ring MUST be fully hidden in the idle state (no zero-length cap dot, no waiting track). Only reveal track + active progress after a real pointer/keyboard hold begins; release or cancel immediately hides and resets. After completion show true disconnected demo state and **suppress the synthetic release click** so reconnect does not happen accidentally.
- **Background:** retire falling Matrix text/glyph rain from the **target UI**. Replace with non-text animated **Liquid Silk Ribbon / Aurora Light Field / glass caustic waves / restrained suspended particles**, rendered in a single budgeted Canvas. Dark-dim foreground glass panels keep data legible. Quality profiles Full/Balanced/Eco/Off; pause while hidden/minimized; respect reduced motion.
- **Scope:** visual + animation rework only, do not modify Memory capture, tunnel, MCP, workspaces, update workflow, Plan Mode removal or operational permissions.
- **Latest interactive prototype:** docs/design/qnector-liquid-glass-motion-v2-1.html. V2 remains archived as a comparison. Standalone HTML with real PNG embedded, no dependencies; all existing mock UI sections and interactions retained.
- **Latest mockup QC:** docs/design/qnector-liquid-glass-v2-1-qc.cjs, headless Chrome: the unf framed Queen logo is nested inside the orb shell with screen blending and no rectangular background, border or box-shadow; 3-second hold/cancel/reconnect, 30 navigation switches, Quality/Reduced, 420px viewport, and zero JS exceptions. Images: docs/design/qnector-liquid-v2-1-*.png. No production implementation tasks completed.
- **UX skill guidance:** QNECTOR Agent Skills \`ui-ux-pro-max\` and \`impeccable\` installed 2026-10-16. Their hierarchy, contrast, focus, motion, animation and performance guidance was applied; their decorative-style warnings are subordinated to the user-approved deliberate glass/gold-glow art direction.
- **Rendering architecture:** CSS layers for refractive materials and simple micro-interactions, single rAF/Canvas driver for animated ribbons and Orb fluid, explicit hold timer as independent source of truth, no external GSAP/WebGL requirement for prototype. Production must measure perf before assuming its budget fits.

## 0B. Queen mark integrated into the Orb (V2.1, 2026-10-17)

- **Current design reference:** docs/design/qnector-liquid-glass-motion-v2-1.html; retain V2 for visual before/after comparison.
- **User-requested correction:** remove the square black/gold icon frame from the center of the Orb. Do not add a replacement square tile, inset plaque, bezel or rectangular backing.
- **Implementation model:** the source PNG already has a transparent outer background. Preserve its original proportions and colors. Render the Queen art as an image INSIDE the translucent orb shell (behind its glass highlight), rather than as a framed child of the transparent hold-interaction button. Use screen optical blending and restrained warm-gold lighting so the subject reads as part of the moving fluid.
- **Functional behavior retained:** no hold ring/dot before pressing; 3-second hold and cancel; reconnect; all five navigation drawers, Motion Lab, search, Quality profiles and reduced motion. Header app icon may retain its small square brand badge: the no-frame requirement concerns the central Orb.
- **Verified demo:** docs/design/qnector-liquid-glass-v2-1-qc.cjs. Checks transparent image loaded and moved into Orb shell, zero framed border/background/box-shadow, screen blend, and the existing Chrome functional suite; output screenshots qnector-liquid-v2-1-*.png. Demo success DOES NOT complete production AR tasks.
## 0C. Native Queen Orb portrait clarity — isolated source refinement (2026-10-16)

- **Latest approved Orb artwork treatment:** keep the actual transparent `queen-portrait.png` icon, but avoid `screen` blending over the moving light field: it erased the subject's opaque black hair/face edges and made the illustration look fuzzy. In the Electron trial, render the image with normal alpha compositing and measured static contrast, at 84% of Orb interior, with a central-clear/edge-only glass reflection mask. Preserve all lighting, frameless integration, animations, 3s hold interaction and native-VSync cadence.
- **Screenshots from actual Electron renderer:** `docs/design/royal-motion-orb-clarity-before.png`, `royal-motion-orb-clarity-after.png`, `royal-motion-orb-clarity-comparison.png`; subject details are noticeably clearer after the change without a square backing.
- **Implementation boundary:** only the existing Royal Motion source-trial branch was modified. No installed QNECTOR build updated, no release performed, and remaining 48-task-wide design acceptance is still pending. See `docs/design/royal-motion-trial-report.md` for quantitative QC and limitations.

## 1. Source-of-truth baseline

| Item | Verified at audit (2026-10-16) |
|---|---|
| Target baseline | QNECTOR no-Plan v0.4.57 source; docs branch design/animation-rework-20261016 |
| Reference | https://motion-reference.takayustudio.jp/; 782 catalog items, 64 categories, 228 Text Motion entries, checked against downloaded site catalog source |
| CSS animation definitions | 42 named @keyframes: styles.css 25 + royal-effects.css 15 + skill-manager.css 2; CSS transitions and JS/Canvas motion not included in 42 |
| Runtime components | apps/desktop/src/renderer/{renderer.tsx,styles.css,royal-effects.css,gold-matrix-rain.tsx,skill-manager.tsx,skill-manager.css,skill-editor.tsx,memory-center.tsx,memory-center.css,runtime-diagnostics.tsx} |
| Gold Matrix | Canvas 2D, requestAnimationFrame; TARGET_FPS=165, max DPR 2, paused on app window visibility callback and reduced motion |
| Existing controls | config.ui.animationsEnabled, html[data-motion=off], qnector-window-paused and prefers-reduced-motion mechanisms |
| Risks spotted | style layering overrides, continuous filters/glow, multiple loops, some transition:all, React row virtualization transform conflicts, drawer timers, missing drawerSlideIn keyframe definition, some reduced-motion drawer transitions still run |
| Existing UI areas | dashboard hero/orb, Gold Matrix, Activity Feed/detail, Workspace, Memory, Skills+Editor, Runtime Diagnostics, Settings, Setup Assistant, Updater/restart |
| Known constraint | Prior Memory freshness fix is committed separately; preserve it, do not imply a new release or installation |

### 1.1 Exhaustive CSS keyframe inventory — exactly 42
- **Brand, Background and Header (6)** — `crestShine`, `royalRailShimmer`, `royalDustDrift`, `royalHeaderIn`, `royalCrestBreathe`, `royalCrestSymbol`
- **Orb and Energy (10)** — `auraPulse`, `auraPulseFast`, `moltenFloat`, `moltenSpin`, `sparkOrbit1`, `sparkOrbit2`, `chargingJitter`, `burstExpand`, `royalOrbShell`, `royalOrbBreathe`
- **Connection and Status (5)** — `pulseGreen`, `beaconPulse`, `blinkFast`, `pulseRed`, `royalStatusPulse`
- **Main Buttons (1)** — `royalGoldButtonFlow`
- **Component Entrance (3)** — `royalPanelRise`, `royalDockIn`, `royalSkillRowIn`
- **Activity Feed (5)** — `activityQueueReveal`, `activityDetailRise`, `royalActivityEnter`, `royalActivityProcessingGlow`, `royalActivityRipple`
- **Drawer, Overlay and Modal (9)** — `backdropFade`, `backdropFadeOut`, `drawerSlideUp`, `drawerSlideDown`, `drawerPageFromRight`, `drawerPageFromLeft`, `itemFadeIn`, `skillModalBackdropIn`, `skillModalRise`
- **Updater (3)** — `updateUxSpin`, `updateUxPulse`, `updateRestartSweep`
- **TOTAL: 42 declarations** (not unique runtime animations; some rules override others and some are state-specific).

### 1.2 Additional motion that MUST be included beyond keyframes
- [ ] Audit and rework: GoldMatrixRain(Canvas 2D rAF, opacity, connect/disconnect deceleration, glyph mutation)
- [ ] Audit and rework: Orb charging SVG stroke-dashoffset; 3-second hold progress; separate hover/press and glow state
- [ ] Audit and rework: Floating dock active underline indicator using CSS translateX and :has; button hover/press
- [ ] Audit and rework: Activity Feed virtualized absolute row transform plus entering rows and live state
- [ ] Audit and rework: All component CSS transitions (some transition:all), focus styling, tooltips and press states
- [ ] Audit and rework: Settings/Skills toggles; search and filter reflow; Memory accordion/list; Runtime diagnostics details
- [ ] Audit and rework: Drawer switching React timer (200ms) and close fallback (600ms); modal focus traps
- [ ] Audit and rework: Setup wizard steps, dropdowns and validation; update progress and restart overlay
- [ ] Audit and rework: Electron window-visible integration, reduced-motion overrides and global animation off switch

## 2. Target motion language, design tokens and rules

### 2.1 Visual hierarchy
1. **Hero / focal motion:** Central Orb only: subtle Float, Rim Glow, connected state and a single Connection Success energy ring.
2. **Supporting ambient (V2 override):** Replace Gold Matrix falling letters with Liquid Silk Ribbon / Aurora / non-text light particles; constrain contrast underneath text-heavy glass panels, and pause/adapt rendering by visibility and quality.
3. **Interactive motion:** fast, crisp, precise; create a tactile response, not an animation waiting room.
4. **Information motion:** short one-time entrance and clear state transitions; no flicker or scramble on task IDs, Memory facts or error messages.
5. **Celebration:** use radial flash/check-draw once on verified success; no confetti or whole-window shake by default.

### 2.2 Shared durations (target values, tune after measurement)
| Token | Duration | Best use |
|---|---:|---|
| instant | 80–120ms | press/down-up |
| hover | 140–180ms | hover/tooltip hover reaction |
| selection | 180–240ms | tab indicator/toggle |
| tooltip | 140–200ms | tooltip |
| enter | 200–320ms | card/row/panel entrance |
| drawer-open | 260–340ms | large drawer enters |
| drawer-close | 180–240ms | exit faster than entry |
| route | 180–260ms | drawer tab/panel route |
| modal | 240–320ms | modal/setup entry |
| success | 350–600ms | verified state completion |
| ambient | 8–16 seconds/cycle | background only, opt-out and pause-aware |

### 2.3 Easing and rules
- Ease-out cubic for content entrance; ease-in for exit, ease-in-out cubic for route changes; capped overshoot critically damped spring for selection; sine/linear for quiet ambient loops.
- Never animate layout position with expensive continuous left/top/width if transform+opacity can express the same effect; exceptions for true measurement/auto-height with FLIP or managed layout.
- Explicit transition properties only; remove unintended transition:all from motion-critical surfaces.
- Use aria-expanded, aria-selected, aria-busy and actual state as source of truth. Inputs remain usable during transitions.
- Auto-removing elements must wait for verified state + cancellation-safe exit, with immediate reduced/off path; do not rely on a single CSS animationend event as only exit path.
- Limit running loops to visual regions needing them, and prefer once-on-event keyframes.
- Adapt filter/blur/backdrop-filter usage for low-quality profile and load; avoid many animated box-shadows.
- Use layered transforms: outer node for virtualization/layout position, inner node for hover/enter transform. Do not overwrite the same transform.
- Accessibility: reduced motion = no spatial travel/bouncy effects, instant content/focus, optional short opacity only; never conceal reading content.

### 2.4 Motion Quality profiles
| Profile | Canvas/ambient proposal | UI motion | Intended purpose |
|---|---|---|---|
| Full | Test ceiling 60–120 FPS, tune based on real refresh/CPU/GPU; high density | All transitions | Opt-in best visuals, not default |
| Balanced (default) | Test 60 FPS cap, moderate density and low-cost static accent | All meaningful interactions | Normal use incl gaming in parallel |
| Eco | Test 30 FPS or static frame, sparse/no particles | Only functional feedback | When competing workload is heavy |
| Off / Reduced | Static background; stop continuous rAF | Instant state plus accessible cues | Global UI animations off or system reduced-motion |

All caps are PROPOSED. Validate on the user's Windows setup before treating them as established performance values. Distinguish hidden/minimized from visible-but-unfocused; stop hidden/minimized canvas work, avoid unnecessary window background throttling side effects.

## 3. Exhaustive component mapping — reference links, required state and target

### A. Background, Crest, Header, Dashboard Entrance
| Current component / state | Proposed Motion Reference | Exact behavior / implementation rule |
|---|---|---|
| royalDustDrift | [Twinkle Sparkles + Flow Field](https://motion-reference.takayustudio.jp/#motion=pt-twinkle) | Sparse glints; combine with low-density flow, use one budgeted background canvas, pause when hidden |
| royalRailShimmer | [Light Sweep](https://motion-reference.takayustudio.jp/#motion=light-sweep) | Run on meaningful reveal, not constantly across all panels |
| app-container backdrop | [Aurora Glow](https://motion-reference.takayustudio.jp/#motion=aurora-glow) | Gold ambient field at low opacity, slow 8–16s loop |
| crestShine | [Holographic Sheen](https://motion-reference.takayustudio.jp/#motion=holographic-sheen) | Directional single crest reflection; throttle |
| royalCrestBreathe | [Breathing Scale](https://motion-reference.takayustudio.jp/#motion=breathing) | ≤1% crest idle scale or keep static |
| royalCrestSymbol | [Rim Glow](https://motion-reference.takayustudio.jp/#motion=rim-glow) | Accent edge, not continuous moving title |
| royalHeaderIn | [Fade + Slide](https://motion-reference.takayustudio.jp/#motion=fade-slide) | Header Y 8–12px, approx 240–300ms on startup only |
| royalPanelRise | [Staggered Reveal](https://motion-reference.takayustudio.jp/#motion=catalog-ui-navigation-staggered-reveal) | Dashboard panels short stagger, total entrance capped |

### B. Central Orb, Connect, Hold, Disconnect
| Current component / state | Proposed Motion Reference | Exact behavior / implementation rule |
|---|---|---|
| moltenFloat | [Float](https://motion-reference.takayustudio.jp/#motion=lp-float) | Connected/idle Orb position subtler, deterministic pause/visibility |
| royalOrbShell | [Rotating Gradient Ring](https://motion-reference.takayustudio.jp/#motion=lp-conic) | Thin concentric ring instead of large glowing filters |
| royalOrbBreathe | [Glow Pulse](https://motion-reference.takayustudio.jp/#motion=glow-pulse) | Single low-amplitude light pulse |
| auraPulse / auraPulseFast | [Aurora Glow](https://motion-reference.takayustudio.jp/#motion=aurora-glow) | Consolidate glow and adapt by connection state |
| sparkOrbit1 / sparkOrbit2 | [Orbit Trail](https://motion-reference.takayustudio.jp/#motion=catalog-ui-loading-orbit-trail) | Two small orbiting lights at most, ring-follow path |
| Connecting, moltenSpin | [Energy Charge](https://motion-reference.takayustudio.jp/#motion=energy-charge) | Light flows inward while actual connect in progress |
| chargingJitter | [Anticipation](https://motion-reference.takayustudio.jp/#motion=anticipation) | Replace 0.08s jitter with one controlled wind-up then settle |
| burstExpand | [Radial Flash](https://motion-reference.takayustudio.jp/#motion=radial-flash) | One verified success burst approx 400–550ms |
| Orb pointer hover / press | [Elastic Membrane Press](https://motion-reference.takayustudio.jp/#motion=catalog-ui-material-membrane-press) | Small scale compression, spring back; keyboard focus clearly visible |
| Charge SVG / hold disconnect | [Hold to Confirm](https://motion-reference.takayustudio.jp/#motion=catalog-ui-button-hold-confirm) | Preserve actual 3s long-hold behavior, progress 0–100%; cancel on release |
| Disconnected | [Soft Shrink](https://motion-reference.takayustudio.jp/#motion=soft-shrink) | Reduce glow then static disconnected state; no false success |

### C. Navigation, Dock, Drawer, Modal
| Current component / state | Proposed Motion Reference | Exact behavior / implementation rule |
|---|---|---|
| royalDockIn | [Soft Rise](https://motion-reference.takayustudio.jp/#motion=soft-rise) | One-time dock entrance ~280ms |
| Dock hover | [Hover Lift](https://motion-reference.takayustudio.jp/#motion=hover-lift) | Lift 1–2px, 140–180ms |
| Active dock indicator | [Pill Indicator](https://motion-reference.takayustudio.jp/#motion=catalog-ui-control-pill-indicator) | Translate to active tab smoothly without jumping |
| Dock press | [Button Press](https://motion-reference.takayustudio.jp/#motion=ui-press) | Short compress/return ~100ms |
| drawerSlideUp | [Modal Enter / Exit](https://motion-reference.takayustudio.jp/#motion=ui-modal) | Retargetable spring open 260–340ms |
| drawerSlideDown | [Exit Faster than Enter](https://motion-reference.takayustudio.jp/#motion=t-exit) | 180–240ms closing; interruptible, no input lock |
| backdropFade/Out | [Crossfade / Dissolve](https://motion-reference.takayustudio.jp/#motion=tr-dissolve) | Backdrop based on open state, cancel-safe |
| drawerPageFromRight/Left | [Route Slide](https://motion-reference.takayustudio.jp/#motion=route-slide) | Switch sections 12–20px with overlap/crossfade |
| Drawer tabs | [Sliding Underline](https://motion-reference.takayustudio.jp/#motion=catalog-ui-control-sliding-underline) | Moving gold selection indicator, 180–240ms |
| Section detail | [List-to-Detail Expand](https://motion-reference.takayustudio.jp/#motion=detail-expand) | Shared row to detail identity; focus correct |
| Activity detail | [Shared Element](https://motion-reference.takayustudio.jp/#motion=shared-element) | Retain origin row when opening/closing |
| Dropdown/menu | [Dropdown Origin Reveal](https://motion-reference.takayustudio.jp/#motion=dropdown-origin) | Menu appears from trigger edge |
| Tooltip | [Tooltip](https://motion-reference.takayustudio.jp/#motion=ui-tooltip) | 140–200ms, pointer/focus/touch equivalent |

### D. Live Activity Feed
| Current component / state | Proposed Motion Reference | Exact behavior / implementation rule |
|---|---|---|
| activityQueueReveal / royalActivityEnter | [Staggered List](https://motion-reference.takayustudio.jp/#motion=list-stagger) | One entry system, no overlapping keyframes |
| Burst of new rows | [Cascade List](https://motion-reference.takayustudio.jp/#motion=list-cascade) | Batch delay capped and never delays data |
| royalActivityProcessingGlow | [Glow Pulse](https://motion-reference.takayustudio.jp/#motion=glow-pulse) | Subtle running badge / border only |
| royalActivityRipple | [Focus Pulse](https://motion-reference.takayustudio.jp/#motion=pulse-focus) | One pulse on state change; remove infinite row ripple |
| Success | [Success Check Draw](https://motion-reference.takayustudio.jp/#motion=success-check) | Draw only on server-confirmed success |
| Error | [Error Shake](https://motion-reference.takayustudio.jp/#motion=error-shake) | One controlled warning reaction only |
| Detail open | [List-to-Detail Expand](https://motion-reference.takayustudio.jp/#motion=detail-expand) | Virtualized row shared-element aware |
| Removal | [List Trim Collapse](https://motion-reference.takayustudio.jp/#motion=list-trim-collapse) | No gaps/jumps, respect virtualization |
| History loading | [Skeleton Resolve](https://motion-reference.takayustudio.jp/#motion=skeleton-resolve) | Only show while actual data pending |

### E. Skill Manager and Editor
| Current component / state | Proposed Motion Reference | Exact behavior / implementation rule |
|---|---|---|
| royalSkillRowIn | [Staggered List](https://motion-reference.takayustudio.jp/#motion=list-stagger) | Accessible stagger rows, cap total delay |
| Skill row hover | [Card Spotlight](https://motion-reference.takayustudio.jp/#motion=card-spotlight) | Pointer light local XY; static focus/touch fallback |
| Enable / disable | [Springy Switch](https://motion-reference.takayustudio.jp/#motion=catalog-ui-control-spring-switch) | Checked state from actual setting |
| skillModalBackdropIn/skillModalRise | [Modal Enter / Exit](https://motion-reference.takayustudio.jp/#motion=ui-modal) | Shared modal primitive |
| Skill detail open | [Shared Element](https://motion-reference.takayustudio.jp/#motion=shared-element) | List row → skill details |
| Search/filter reflow | [Filter Reflow](https://motion-reference.takayustudio.jp/#motion=filter-reflow) | FLIP where safe, preserve scroll/focus |
| Import / Discover | [Skeleton Shimmer](https://motion-reference.takayustudio.jp/#motion=skeleton-shimmer) | Actual request state only |
| Save successful | [Submit Success Morph](https://motion-reference.takayustudio.jp/#motion=submit-success) | Only on confirmed mutation |
| Field validation | [Inline Validation](https://motion-reference.takayustudio.jp/#motion=inline-validation) | Stable layout, inline error |

### F. Memory Center
| Current component / state | Proposed Motion Reference | Exact behavior / implementation rule |
|---|---|---|
| Overview panels | [Fade + Slide](https://motion-reference.takayustudio.jp/#motion=fade-slide) | Play once on first open, not every refresh |
| Notes list | [Staggered List](https://motion-reference.takayustudio.jp/#motion=list-stagger) | Animate newly appended records only |
| Expand record | [Intrinsic Height Expand](https://motion-reference.takayustudio.jp/#motion=auto-height-expand) | Preserve text readability and scrollbar |
| Counters | [Number Ticker](https://motion-reference.takayustudio.jp/#motion=catalog-ui-feedback-number-ticker) | Only when actual value changes |
| Memory saved | [Highlight Sweep](https://motion-reference.takayustudio.jp/#motion=highlight-sweep) | Once on new confirmed record |
| Task status | [Badge Pop](https://motion-reference.takayustudio.jp/#motion=badge-pop) | Subtle accurate status switch |
| Load More | [Cascade List](https://motion-reference.takayustudio.jp/#motion=list-cascade) | Only new records, not full list |
| Delete confirmation | [Modal Enter / Exit](https://motion-reference.takayustudio.jp/#motion=ui-modal) | Never remove required confirm |

### G. Runtime Diagnostics and Durable Jobs
| Current component / state | Proposed Motion Reference | Exact behavior / implementation rule |
|---|---|---|
| Summary cards | [Stat Card](https://motion-reference.takayustudio.jp/#motion=dv-stat) | Short card entrance |
| CPU/memory/process figures | [Metric Odometer Cascade](https://motion-reference.takayustudio.jp/#motion=catalog-data-story-odometer-cascade) | Data immediately readable; optional animated progression |
| Expandable sections | [Intrinsic Height Expand](https://motion-reference.takayustudio.jp/#motion=auto-height-expand) | Accessible details |
| Job running | [Gradient Arc](https://motion-reference.takayustudio.jp/#motion=catalog-ui-loading-gradient-arc) | Only while truly running |
| Job progress | [Progress Fill](https://motion-reference.takayustudio.jp/#motion=progress-fill) | Only use determinate progress with genuine percentage |
| Job complete | [Success Check Draw](https://motion-reference.takayustudio.jp/#motion=success-check) | Only after verified completion |
| Warnings/errors | [Focus Halo](https://motion-reference.takayustudio.jp/#motion=focus-halo) | One accessible focus emphasis |
| Timeline if present | [Timeline Scrub Trail](https://motion-reference.takayustudio.jp/#motion=catalog-data-story-timeline-trail) | Only if a real timeline UI exists |

### H. Settings, Setup, Updater
| Current component / state | Proposed Motion Reference | Exact behavior / implementation rule |
|---|---|---|
| Settings toggle | [Springy Switch](https://motion-reference.takayustudio.jp/#motion=catalog-ui-control-spring-switch) | Shared switch with Skills |
| Settings card hover | [Hover Lift](https://motion-reference.takayustudio.jp/#motion=hover-lift) | Small lift only |
| Dropdown | [Dropdown Origin Reveal](https://motion-reference.takayustudio.jp/#motion=dropdown-origin) | Keyboard-accessible menu |
| Checkbox | [Checkbox Stroke](https://motion-reference.takayustudio.jp/#motion=checkbox-stroke) | Checked-state feedback |
| Setup open | [Modal Morph](https://motion-reference.takayustudio.jp/#motion=modal-morph) | Trigger-anchored where feasible |
| Setup step | [Page Stack Transition](https://motion-reference.takayustudio.jp/#motion=page-transition-stack) | No text hidden until transition ends |
| Setup progress | [Progress Fill](https://motion-reference.takayustudio.jp/#motion=progress-fill) | Genuine step count |
| Setup validation | [Inline Validation](https://motion-reference.takayustudio.jp/#motion=inline-validation) | Near offending field |
| Setup complete | [Submit Success Morph](https://motion-reference.takayustudio.jp/#motion=submit-success) | Only when verified |
| updateUxSpin | [Gradient Arc](https://motion-reference.takayustudio.jp/#motion=catalog-ui-loading-gradient-arc) | One shared loading indicator |
| updateUxPulse | [Pulse Ring](https://motion-reference.takayustudio.jp/#motion=ld-pulse) | Only real busy status |
| Download progress | [Progress to Success](https://motion-reference.takayustudio.jp/#motion=catalog-ui-loading-progress-success) | True download + verify |
| updateRestartSweep | [Indeterminate Bar](https://motion-reference.takayustudio.jp/#motion=ld-bar) | No guessed percentages |
| Restart overlay | [Crossfade / Dissolve](https://motion-reference.takayustudio.jp/#motion=tr-dissolve) | Readable during restart and failure |

### I. Typography, Toast, Controls, Microinteraction
| Current component / state | Proposed Motion Reference | Exact behavior / implementation rule |
|---|---|---|
| App title | [Center-Out Reveal](https://motion-reference.takayustudio.jp/#motion=tx-center-out-reveal) | Once on first mount, do not animate every render |
| Drawer heading | [Word Fade Up](https://motion-reference.takayustudio.jp/#motion=tx-fade-up-words) | Short sentence-level reveal, cap duration |
| Connection label | [Blur Crossfade](https://motion-reference.takayustudio.jp/#motion=tx-blur-crossfade) | Low blur, instant accessible label update |
| Numeric progress | [Odometer Digit Roll](https://motion-reference.takayustudio.jp/#motion=tx-odometer-roll) | Never delay actual numerical accessibility |
| Copied toast | [Toast](https://motion-reference.takayustudio.jp/#motion=ui-toast) | 180–220ms entry |
| Error toast / multiple toasts | [Toast Stack](https://motion-reference.takayustudio.jp/#motion=toast-stack) | Stack without hiding alerts |
| Interactive card hover | [Card Spotlight](https://motion-reference.takayustudio.jp/#motion=card-spotlight) | Select hero cards only |
| All button press | [Inner Press](https://motion-reference.takayustudio.jp/#motion=catalog-ui-button-inner-press) | Shared press primitive |
| Processing to success | [Loading to Success](https://motion-reference.takayustudio.jp/#motion=catalog-ui-button-loading-success) | State-aware success |
| Keyboard focus | [Focus Halo](https://motion-reference.takayustudio.jp/#motion=focus-halo) | Focus visible even with reduced motion |

**Mapping entries: 90.** Web examples may be longer than production timings; normalize to the token system above and assess whether animation is a net usability win. Keep explicit fallback for reduced motion.

## 4. Architecture: QNECTOR Motion System
State → Motion Controller (tokens + priority + concurrency + quality + visibility + reduced motion) → CSS (micro) / WAAPI (interruptible navigation) / optional Motion for React (shared layout only if justified) / Canvas 2D (ambient).

### Proposed modules
- [ ] apps/desktop/src/renderer/motion/tokens.ts — typed durations/easings/amplitudes with tests
- [ ] apps/desktop/src/renderer/motion/controller.ts — cancel/retarget/reverse and no-op for reduced/off; no indefinite Promise waits
- [ ] apps/desktop/src/renderer/motion/use-motion-preferences.ts — config UI flag, OS prefers-reduced-motion, visibility and selected quality
- [ ] apps/desktop/src/renderer/motion/use-animated-state.ts — state-driven transitions and focus semantics
- [ ] apps/desktop/src/renderer/motion/ambient-scheduler.ts — adaptive FPS/particle budget and pause semantics
- [ ] apps/desktop/src/renderer/motion/metrics.ts — rAF frame time, dropped frames, active animations for QC; production logging off by default
- [ ] apps/desktop/src/renderer/motion/presets.css — static CSS microinteraction presets
- [ ] apps/desktop/src/renderer/motion/motion-system.test.ts — cleanup, cancellation, repeated rapid-switch, off/reduced and visibility tests

### Component contracts and tricky cases
- Drawer switching must derive destination order and transition direction from state; on rapid click retarget current animation, do not reject clicks for a 200ms timer; ensure focus trap and Escape always work.
- Close behavior must handle a real animation finish, cancellation and reduced/off fallback. Replace name-specific drawerSlideDown animationend with a reliable completion controller or redundant safeguard.
- Activity virtualization currently positions each row via translate3d(0,index*50px,0). Add nested inner element for row reveal/hover to avoid transform collision.
- Animation quality stored separately from current boolean UI preference; migrate configuration safely and preserve global on/off semantics.
- Canvas scheduler must honor Electron's window visible event, resize observer and destroyed state; never animate when hidden, no forced 165-FPS redraw by default.
- Animation starting while data arrives must not mutate data or hide errors; status pulses must use real backend/task state and be idempotent on rerender.
- Shared transitions must preserve React keys, focus management and scroll restoration; support interrupt and component unmount.
- Rendering engine must avoid excessive promotion of layers with will-change on idle; set will-change only during meaningful transition.

## 5. Detailed mockup contract
**File:** docs/design/animation-rework-mockup.html (standalone offline HTML + embedded CSS/JS; no dependency; clearly marked prototype only).
**Preview states (V1 archive and V2 current):** Connected/connecting/disconnected, 3-second hold-to-disconnect and early release, V2 Liquid Silk Aurora background (no falling Matrix glyphs) with Full/Balanced/Eco/Off/Reduced, live activity simulation, Toast, Liquid Glass Dock/Drawer, Workspace, Memory, Skills, Settings, Runtime, Search palette and Motion Lab. The older V1 prototype remains for historical comparison.
**Visual objective:** reproduce QNECTOR header + hero + Activity + floating bottom dock composition, not reinvent the product IA; rich dark gold glass; orbital rings, glyph rain, quiet aurora.
**Interaction requirements:** Click Orb to connect if disconnected; press/hold 3 seconds to simulate disconnect; open drawer from dock; toggle simulated skill and settings; choose Full/Balanced/Eco/Off; demo buttons trigger state-change and toast; all controls keyboard-accessible and status legible.
**Safety:** all buttons in prototype modify only in-page demo state. Labels must say Mockup / Demo and never claim real MCP connectivity, real updates or stored preferences.

## 6. QA, safety, feature parity and release gates
| Gate ID | Evidence required | Failure handling |
|---|---|---|
| G1 baseline | Windows Electron screenshot/video + frame-time/CPU/GPU idle baseline at 60Hz/120Hz/actual refresh, visible and hidden | Do not start performance claims without baseline |
| G2 semantics | E2E repeated connect/hold/disconnect, drawer navigation, setup and updater; no false completion | Block shipping |
| G3 performance | Balanced idle and animation stress vs baseline; measure median/p95 frame time, CPU/GPU; no meaningful regression while game running | Profile GPU/Canvas/blur and scale down |
| G4 accessibility | Keyboard-only, Escape, focus trap, screen reader states, reduced motion and animations off across all views | Block shipping |
| G5 stability | 100+ rapid nav cycles, 100+ activity bursts, hidden/restore, DPI 100/125/150%, several window sizes; no timer leaks, lost scroll or stalled interaction | Block shipping |
| G6 compatibility | Preserve v0.4.57 no-Plan architecture, startup, update, memory fixes, existing workspace scope and bridge logic | Block shipping |
| G7 packaging | Build candidate, Smoke Test installed Electron, rollback/uninstall/update verification | Do not tag/release without clean results |

Special acceptance: keep focus usable during mid-animation, don't start a new background loop because of every React render, do not animate disconnected signal as connected, avoid false processing percentage, and no unexpected foreground notification.

## 7. Implementation tasks — exactly 48; all unchecked initially
> Check the task only after code + applicable tests + QA evidence have been recorded. Reference IDs AR-01 to AR-48 are stable. Phase gates cannot be silently skipped.

### Phase 0 — Baseline & Design Specification
- [ ] **AR-01** — Capture screenshot/video baseline for Dashboard, Drawer, Memory, Skills, Runtime, Settings, Setup, Updater and all connection states; record sizes and paths. **Evidence:** _pending_
- [x] **AR-02** — Map all 42 current CSS keyframes and other transitions/Canvas/rAF handlers to owners, selectors and event triggers. **Evidence:** royal-motion-keyframe-inventory.md and 90-reference source mapping
- [x] **AR-03** — Freeze design tokens, motion style hierarchy, safe durations/easing, accessible fallback states. **Evidence:** royal-motion-system.css token palette; state-contracts.md
- [x] **AR-04** — Document exact state transition diagrams for Orb connect/disconnect, task status, setup and updater. **Evidence:** royal-motion-state-contracts.md connection/drawer/setup/update diagrams
- [ ] **AR-05** — Record real Windows Electron CPU/GPU/frame-time baseline including visible/minimized/hidden and game-coexistence tests. **Evidence:** _pending_
- [x] **AR-06** — Approve canonical mapping and mockup; note any final visual adjustments without erasing original requirements. **Evidence:** approved Queen Liquid Glass HTML V2.1 and user design feedback

### Phase 1 — Motion Foundation
- [x] **AR-07** — Implement typed motion tokens; unit tests for semantic categories/timings. **Evidence:** motion-policy.ts and motion-policy.test.ts
- [x] **AR-08** — Implement central Motion Controller and motion quality provider with unchanged boolean-off config semantics. **Evidence:** motion-policy.ts, royal-motion-clock.ts, native controls and QA
- [x] **AR-09** — Create reusable CSS/WAAPI presets for press/hover/enter/exit/status/loop, with centralized theme values. **Evidence:** royal-motion-system.css shared transitions for press/hover/enter/exit/status
- [x] **AR-10** — Implement interrupt/reverse/retarget/cancel with cleanup on unmount and repeated state changes. **Evidence:** 40 rapid native route retargets; rAF pause/cancel cleanup
- [x] **AR-11** — Unify visibility, adaptive quality and OS reduced-motion policies across Electron/renderer. **Evidence:** native window visibility/OS reduce/quality/old boolean-off tested
- [x] **AR-12** — Add opt-in QC instrumentation for frame time, dropped frames and animation counts; production disabled by default. **Evidence:** opt-in local-only native telemetry FPS/P95/missed frames

### Phase 2 — Ambient & Brand Motion
- [x] **AR-13** — Retire **falling Matrix text** from production background and replace with **Liquid Silk Ribbon / Aurora Canvas**, adaptive frame scheduling, DPR bounds and resize/visibility safeguards; retain old Matrix implementation only for reference and rollback if needed. **Evidence:** royal-silk-background.tsx replaces runtime Matrix, DPR and visibility QA
- [x] **AR-14** — Implement coordinated refracted waves, glass caustic glow, suspended particles and layered ambient lighting as one GPU/CPU-budgeted system; no duplicated loops and no text rain. **Evidence:** bounded Silk/caustic/particles and Queen Orb share one native rAF
- [x] **AR-15** — Rework Header, Logo and Dashboard entrances with the user's actual `icon-256_square.png` Queen brand mark (no crown-only placeholder); glass material consistency across menus. **Evidence:** Queen PNG in header, Liquid Glass top-level materials, native images
- [x] **AR-16** — Rework Orb as premium multi-layer liquid glass with living light filaments and internal caustics, outer orbit, and a **free-floating Queen portrait blended directly into the internal glass layer, with no square icon tile, frame, rectangular background or bezel**; preserve connected/idle quality and connection-specific intensity. **Evidence:** frameless sharp Queen Orb, Canvas flow and native Electron preview
- [x] **AR-17** — Implement 3-second hold-to-disconnect with **zero visible track/dot when idle**, a real hold-only visible radial progress ring, early-release/pointer-cancel reset, keyboard hold, synthetic click suppression, accurate disconnect/reconnect and verified success burst. **Evidence:** native 3s hold/cancel/rejected backend and hidden idle ring QC
- [ ] **AR-18** — Benchmark full/balanced/eco/off ambient quality and tune budgets to protect gaming performance. **Evidence:** _pending_

### Phase 3 — Navigation & Layout
- [x] **AR-19** — Replace dock hover/press/indicator animations with shared presets and accessible active semantics. **Evidence:** royal-icons.tsx and dock hover/press/selection/focus CSS
- [x] **AR-20** — Rework drawer open/close with reliable completion, no missing keyframes, accessible focus and Escape. **Evidence:** reversible drawer open/close and focus/Escape native QC
- [x] **AR-21** — Replace drawer tab timeout blocking with retargetable route transitions; preserve fast-click behavior. **Evidence:** 40 instant retargeted tab clicks without 200ms lock and scroll restore
- [x] **AR-22** — Consolidate shared Backdrop/Modal/Popover motion and safe click-outside/keyboard behavior. **Evidence:** shared modal/backdrop glass + existing keyboard/focus/click-outside QA
- [ ] **AR-23** — Implement optional Shared Element list-to-detail transitions with fallback for virtualized rows. **Evidence:** _pending_
- [x] **AR-24** — Verify rapid nav, direction changes, focus, scrolled content persistence, keyboard and reduced mode. **Evidence:** native multi-viewport drawer navigation, focus and scroll retention

### Phase 4 — Microinteractions & Screens
- [x] **AR-25** — Rework shared buttons/switches/checkboxes/dropdowns; remove transition:all where harmful. **Evidence:** central controls and removal of 8 transition:all declarations
- [x] **AR-26** — Rework Live Activity entrance/running/error/success/detail; separate virtualization transforms. **Evidence:** synthetic 16-event native Activity virtualization layout QA
- [ ] **AR-27** — Rework Skill Manager and Editor hover/toggle/search/import/modal/save/validation. **Evidence:** _pending_
- [ ] **AR-28** — Rework Memory Center panels/notes/counters/accordion/recent saves without implying chat transcript capture. **Evidence:** _pending_
- [ ] **AR-29** — Rework Runtime/Durable Jobs status cards/progress/errors with strictly verified data. **Evidence:** _pending_
- [ ] **AR-30** — Rework Typography/Toast/Tooltip/validation and keyboard focus feedback across all views. **Evidence:** _pending_

### Phase 5 — Setup & Update States
- [x] **AR-31** — Rework Setup open/close and step transitions preserving typed inputs. **Evidence:** native Setup Escape/focus and Back-Continue retains typed inputs (motion-reduced-off-matrix.json)
- [x] **AR-32** — Rework form validation, pending state, inline error and submission interactions. **Evidence:** required field validation, synthetic pending submit, rejected request and retry enabled
- [ ] **AR-33** — Rework setup successful/failed states with accurate completed-step feedback. **Evidence:** _pending_
- [x] **AR-34** — Rework updater checking/downloading states; avoid multiple simultaneous spinners. **Evidence:** six synthetic updater phase transitions, no duplicate download spinner
- [x] **AR-35** — Implement determinate progress-to-success only for real percentages and verified update success. **Evidence:** 37pct backend-provided determinate download, checksum-verification boundary + updater e2e tests
- [ ] **AR-36** — Rework restart overlay/indeterminate progress, preserve recovery messages and no false restart completion. **Evidence:** _pending_

### Phase 6 — QA & Performance
- [x] **AR-37** — Execute reduced-motion and animation-off matrix across every screen/event. **Evidence:** five views x four motion states + Setup and native hide/resume QA
- [ ] **AR-38** — Test 60/120/144/165 Hz where available, DPI/zoom/window scaling and different frame budgets. **Evidence:** _pending_
- [x] **AR-39** — Stress rapid interactions and long-running activity feeds; detect memory/timer/rAF leaks. **Evidence:** 120s native stress: 3720 synthetic events, 288 route interactions, bounded rows and plateaued memory
- [ ] **AR-40** — Capture before/after CPU/GPU/frame-time including percentiles and screenshot/video evidence. **Evidence:** _pending_
- [ ] **AR-41** — Measure minimized/hidden/game-foreground behavior and frame pacing; tune or disable high-cost effects. **Evidence:** _pending_
- [ ] **AR-42** — Fix regressions, document failures honestly, sign off all applicable acceptance gates. **Evidence:** _pending_

### Phase 7 — Release Preparation
- [x] **AR-43** — Audit all motion dependencies and bundle size/licensing; avoid GSAP unless explicitly justified. **Evidence:** no new third-party runtime package; CSS, TS, Canvas and inline SVG only
- [x] **AR-44** — Document migration, preferences, reduced-motion and compatibility constraints for maintainers. **Evidence:** royal-motion-state-contracts.md and royal-motion-v2-implementation-report.md
- [x] **AR-45** — Build Windows Electron packaged candidate without overwriting production install. **Evidence:** 2026-10-21 unsigned internal setup+portable candidate, 19 clean-source gates and package-acceptance.json (revision 0bfab3f; latest focus fix needs repack)
- [ ] **AR-46** — Verify cold launch, update, rollback, uninstall/reinstall and profile retention in packaged build. **Evidence:** _pending_
- [ ] **AR-47** — Confirm feature parity with v0.4.57 no-Plan, local Memory and core bridge/tunnel behavior. **Evidence:** _pending_
- [ ] **AR-48** — Publish release-candidate evidence and version plan only after all required gates; no silent GitHub release. **Evidence:** _pending_

**Total planned tasks: 48; verified complete: 0; pending: 48.** (Initial state, before implementation.)

## 8. Rollout and implementation protocol
1. Create a dedicated implementation branch; this document and the mockup stay the canonical source of planned behavior.
2. Before touching each component, inspect its latest code and known tests, collect baseline evidence, and only then update implementation.
3. Do not modify or release QNECTOR for visual changes without task-level test evidence and key performance gates.
4. At each checkpoint, edit this file: check AR-ID only when verified, append changeset/commit, exact tests, metrics, screenshot/video path, known issues and next task.
5. If any test fails, write an issue entry rather than declaring that phase complete; continue independent tasks where safe.
6. Keep shared animations independent from MCP task timing; status and progress are driven exclusively by actual data.
7. Never remove functionality, memory behavior or user settings to make an animation appear fast.
8. Do not re-add Plan Mode; prior decision explicitly removed it from v0.4.57.

## 8A. Interactive mockup deliverables and verified visual QC

- **Standalone interactive demo:** docs/design/animation-rework-mockup.html (offline, approx. 76 KB, all CSS/JS inline; simulated states only).
- **Mockup usage guide:** docs/design/animation-rework-mockup-README.md.
- **Reproducible functional UI smoke:** docs/design/animation-rework-mockup-qc.cjs; use node docs/design/animation-rework-mockup-qc.cjs from repo root. Headless Chrome required.
- **Headless Chrome screenshots:** 10 images in docs/design/animation-rework-*-preview.png (Dashboard, Workspace, Memory, Skills, Runtime, Settings, Setup, Updater, Motion Lab, 420px Mobile).
- **Validated:** embedded JavaScript syntax; headless Chrome CDP interactions for Dashboard, Workspace, Memory, Skills, Runtime, Settings, Setup, Updater, Motion Lab; Skill toggle persistence + Memory filtering; 30 rapid drawer switches; keyboard Shift+Tab focus wrap; four quality profiles and Reduced Motion; early hold release preserves connection; full 3-second Orb hold disconnect/reconnect; 420px responsive viewport without horizontal overflow; 0 JavaScript exceptions.
- **Regression discovered/fixed during mockup QC:** a completed hold emitted a synthetic follow-up click which initially auto-triggered reconnect. The click is now consumed following hold completion, and CDP re-test passes.
- **Not yet validated:** production Electron animation engine, CPU/GPU performance against baseline, actual screen reader and full keyboard focus trap, package/release behavior; these remain AR tasks and gates, not success claims.
- **Source catalog check:** 90 mapping references / 68 distinct site motion IDs; all checked against the downloaded 782-item catalog. Stable AR-01..AR-48 sequence verified.

## 9. Progress journal (append-only, newest last)
| Date (ICT) | AR IDs | Evidence / tests | Commit / artifact | Blockers / next action |
|---|---|---|---|---|
| 2026-10-16 | Specification only, 0/48 | Source inventory and Motion Reference catalog cross-check; NO production code changes | animation-rework.md + docs/design/animation-rework-mockup.html | UI design mockup and spec created; next: AR-01 baseline before implementation |
| 2026-10-16 | Mockup finalized, 0/48 implementation tasks | Chrome CDP passed: 10 screenshots, navigation stress (30 switches), drawer keyboard focus/Escape, early and full Orb hold, responsive 420px, Memory/Skills, four quality modes, updater/setup simulations, zero JS exceptions | docs/design/animation-rework-mockup-qc.cjs and docs/design/animation-rework-*-preview.png | Begin AR-01 before modifying QNECTOR runtime; full Electron performance testing still pending |

| 2026-10-16 | Liquid Glass V2 design prototype, **0/48 production tasks** | Chrome CDP PASS: Queen logo embedded in standalone HTML; no Matrix glyph rain; hold progress hidden when idle; early cancel and full 3-second hold; reconnect; 30 rapid navigations, focus trap, quality/reduced controls, 420px viewport, zero JS exceptions; 9 Chrome screenshots | `docs/design/qnector-liquid-glass-motion-v2.html`, `qnector-liquid-glass-v2-qc.cjs`, `qnector-liquid-v2-*.png` | Begin AR-01 production baseline; do not mistake HTML prototype for completed Electron implementation |

| 2026-10-17 (ICT) | **AR-01/AR-13–AR-17 native vertical slice IN PROGRESS**; full acceptance 0/48 | Isolated real-Electron renderer baseline 153.29 fps/p95 6.2ms, candidate sample 165 fps/p95 6.1ms; native Silk/Queen Orb/frameless portrait/hold circle and VSync driver. Typecheck/build/lint PASS; focused tests 27/27 PASS; native multi-size UI and hold/visibility smoke PASS. Full suite initially 460/462: dirty-worktree evidence guard (correct behavior), and stale preexisting Memory selector test, now updated without modifying Memory code. | `feat/royal-motion-60fps-trial`, `docs/design/royal-motion-trial-report.md`, `royal-motion-{baseline,candidate}-fps.json` and screenshots | Obtain repeated frame+GPU evidence with foreground games, clean-tree test, complete remaining 48 item acceptance; installed v0.4.57 untouched. |

| 2026-10-17 (ICT) | First native vertical slice **built, validated, not shipped**; full-phase acceptance **0/48** | Full project Vitest suite now **462/462 PASS across 100 files** on clean commit after updating stale Memory test assertion (no Memory code change); isolated native hold and visibility QA PASS, typecheck/build/lint PASS; rAF candidate sample 165 FPS but not universal guarantee | `feat/royal-motion-60fps-trial` commit `196d4b1`, `docs/design/royal-motion-trial-report.md` | Next: evaluate repeated FPS and GPU frame presentation during gaming, complete remaining screen motion, package QA. Installed v0.4.57 untouched. |

| 2026-10-19 (ICT) | **24/48 verification checklists complete**; 24 pending release/performance/optional motion gates | Native Liquid Glass on Dashboard, Dock, Drawer, Workspace, Memory, Skills, Runtime, Settings, Setup and Updater. One shared VSYNC Orb/Silk, Full/Balanced/Eco/Off, local opt-in telemetry, SVG icons, 40 rapid tab switches, per-tab scroll, 16-event virtual feed QA, original hold / native hide / multi-viewport QA; typecheck/build/lint PASS; real Electron FPS samples near 60 Hz, some delayed frames recorded | `docs/design/royal-motion-v2-implementation-report.md`, `royal-motion-state-contracts.md`, `royal-motion-keyframe-inventory.md`, `royal-motion-native-system/` | Physical game coexistence / GPU present-time / other monitor refresh rates / long soak / package acceptance / actual release still require evidence. Installed v0.4.57 untouched. |

## 10. Sign-off definition
- [ ] All 48 task IDs finished and supported by evidence.
- [ ] No known blocker in G1–G7; all failed tests and deferred external tests explicitly documented.
- [ ] Windows packaged build visually verified, not just unit tests.
- [ ] Existing QNECTOR features unchanged, no Plan Mode, no broken Memory/Workspace/Tunnel, no deceptive status.
- [ ] Balanced performance validated while other applications/game run, and reduced-motion/hidden/minimized paths validated.
- [ ] Release only after user's separate release instruction.

---
**Exact references:** https://motion-reference.takayustudio.jp/ (live catalog), main source apps/desktop/src/renderer, mockup docs/design/animation-rework-mockup.html. Screen mockup interactions are illustrative only.

## 2026-10-21: Native integration checkpoint — 31/48 verified

Six additional checklist items (AR-31, AR-32, AR-34, AR-35, AR-37,
AR-39) now have synthetic native Electron test evidence. Focus-trap
stacking was corrected to route Escape to the actual topmost Setup
modal. The 20-screen Motion Matrix also verifies Setup form state
preservation, submission rejection, and six truthful Updater states.
A two-minute synthetic soak delivered 3,720 events and approximately
288 rapid menu interactions with a stable post-warm-up memory plateau.
Full results and limitations are in
docs/design/royal-motion-v2-implementation-report.md.

The 2026-10-21 internal Windows package on revision 0bfab3f passed
19 release gates with clean-source SHA-256 attestation. Its installer
and portable binaries are **unsigned**, and it predates the later modal
focus fix. A new package is required for the updated source.

Do not mark the remaining physical/game/host/rollback acceptance gates
complete without directly observing them. Do not overwrite installed
QNECTOR v0.4.57 or publish another public artifact under the same
version without an explicit version/signing plan.

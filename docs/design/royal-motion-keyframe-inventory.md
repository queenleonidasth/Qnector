# Royal Motion - Keyframe and transition ownership inventory

Generated from actual renderer sources on 2026-10-19; historical keyframes remain for rollback and preference-gated paths.

| Animation | CSS owner | Occurrences (including keyframe definition) | Current target |
|---|---|---:|---|
| auraPulse | styles.css | 4 | Queen Orb / connection (some legacy) |
| auraPulseFast | styles.css | 2 | Queen Orb / connection (some legacy) |
| moltenFloat | styles.css | 3 | Queen Orb / connection (some legacy) |
| moltenSpin | styles.css | 4 | Queen Orb / connection (some legacy) |
| crestShine | styles.css | 2 | Ambient / setup / shared UI |
| pulseGreen | styles.css | 2 | Updater / status |
| beaconPulse | styles.css | 4 | Updater / status |
| blinkFast | styles.css | 2 | Ambient / setup / shared UI |
| itemFadeIn | styles.css | 2 | Ambient / setup / shared UI |
| activityDetailRise | styles.css | 2 | Lists / activity / skills |
| activityQueueReveal | styles.css | 2 | Lists / activity / skills |
| backdropFade | styles.css | 7 | Navigation / modal |
| backdropFadeOut | styles.css | 2 | Navigation / modal |
| drawerSlideUp | styles.css | 2 | Navigation / modal |
| drawerSlideDown | styles.css | 2 | Navigation / modal |
| sparkOrbit1 | styles.css | 2 | Queen Orb / connection (some legacy) |
| sparkOrbit2 | styles.css | 2 | Queen Orb / connection (some legacy) |
| chargingJitter | styles.css | 2 | Ambient / setup / shared UI |
| burstExpand | styles.css | 2 | Ambient / setup / shared UI |
| pulseRed | styles.css | 2 | Updater / status |
| drawerPageFromRight | styles.css | 3 | Navigation / modal |
| drawerPageFromLeft | styles.css | 3 | Navigation / modal |
| updateUxSpin | styles.css | 3 | Updater / status |
| updateUxPulse | styles.css | 3 | Updater / status |
| updateRestartSweep | styles.css | 2 | Updater / status |
| royalRailShimmer | royal-effects.css | 3 | Ambient / setup / shared UI |
| royalDustDrift | royal-effects.css | 2 | Ambient / setup / shared UI |
| royalHeaderIn | royal-effects.css | 2 | Ambient / setup / shared UI |
| royalPanelRise | royal-effects.css | 2 | Ambient / setup / shared UI |
| royalCrestBreathe | royal-effects.css | 2 | Ambient / setup / shared UI |
| royalCrestSymbol | royal-effects.css | 2 | Ambient / setup / shared UI |
| royalStatusPulse | royal-effects.css | 2 | Updater / status |
| royalOrbShell | royal-effects.css | 2 | Queen Orb / connection (some legacy) |
| royalOrbBreathe | royal-effects.css | 2 | Queen Orb / connection (some legacy) |
| royalGoldButtonFlow | royal-effects.css | 2 | Ambient / setup / shared UI |
| royalActivityEnter | royal-effects.css | 2 | Lists / activity / skills |
| royalActivityProcessingGlow | royal-effects.css | 2 | Lists / activity / skills |
| royalActivityRipple | royal-effects.css | 2 | Lists / activity / skills |
| royalDockIn | royal-effects.css | 2 | Navigation / modal |
| royalSkillRowIn | royal-effects.css | 2 | Lists / activity / skills |
| skillModalBackdropIn | skill-manager.css | 2 | Navigation / modal |
| skillModalRise | skill-manager.css | 2 | Navigation / modal |
| queenAura | liquid-motion.css | 2 | Queen Orb / connection (some legacy) |
| queenFloat | liquid-motion.css | 2 | Queen Orb / connection (some legacy) |
| glassSurfaceArrive | royal-motion-system.css | 2 | Ambient / setup / shared UI |
| liquidPageFromRight | royal-motion-system.css | 2 | Navigation / modal |
| liquidPageFromLeft | royal-motion-system.css | 2 | Navigation / modal |
| liquidBackdropIn | royal-motion-system.css | 2 | Navigation / modal |
| liquidBackdropOut | royal-motion-system.css | 2 | Navigation / modal |
| liquidDrawerIn | royal-motion-system.css | 2 | Navigation / modal |
| liquidDrawerOut | royal-motion-system.css | 2 | Navigation / modal |
| liquidFeedEnter | royal-motion-system.css | 4 | Lists / activity / skills |
| liquidStatusHalo | royal-motion-system.css | 2 | Ambient / setup / shared UI |
| liquidPendingPulse | royal-motion-system.css | 2 | Updater / status |
| liquidDialogOpen | royal-motion-system.css | 3 | Ambient / setup / shared UI |
| liquidListReveal | royal-motion-system.css | 2 | Lists / activity / skills |

## Current runtime owners

- royal-motion-clock.ts: one shared VSYNC callback and single native visibility handler for Silk and Queen Canvas.
- royal-silk-background.tsx: bounded ambient ribbons/dust with per-quality budgets.
- queen-liquid-orb.tsx: glass caustic paths and the frameless sharp transparent Queen PNG.
- motion-policy.ts: user preference, reduced motion, local-only telemetry (no network).
- royal-motion-system.css: centralized Material/hover/press/route/feed/panel/settings/setup/update microinteraction tokens.
- styles.css and royal-effects.css: legacy CSS retained for rollback and preexisting surface contracts.

## Outstanding manual review

- Check the user-facing visuals of every legacy keyframe retained in those CSS files. Unused declarations need not run, but avoid duplicate concurrent loops and transform collisions.
- Measure actual GPU presentation under game foreground load; code inventory is not performance proof.

# QNECTOR V2.3 - Activity-first Dashboard and Sharp Queen

Date: 2026-10-21, Thailand.
Source: D:\Projects\Qnector-NoPlan-20261016
Branch: fix/royal-motion-parity-20261021
Target: actual React + Electron renderer. User-approved image is visual direction, not fake backend activity.

## Changes

1. Reduced Orb size and upper decorative whitespace so the real Live Activity Feed gets more height and a wider inner content area.
2. Added readable timeline rows using actual event timestamp, tool/action, arguments, duration and status. Maintained virtual scrolling and original detail modal access. Synthetic example activity is confined to QC/preview fixture.
3. Moved the original transparent 256x256 Queen image into a stationary layer ABOVE animated liquid glass. Removed image filters and all outer scaling under hover/hold. The old 620px responsive mode used a 78% scale transform on the Orb stage: now disabled.
4. Moved eclipse highlights BEHIND the Queen portrait so they do not cross the face. Halo/caustics/inner glass still move using native VSYNC and Full/Balanced/Eco/Off budgets.
5. Preserved three-second hold-to-disconnect, focus and modal behavior, native windows pause, reduced motion and actual MCP state semantics.

## Visual geometry measured from Electron

| Viewport | Orb diameter | Activity card height | Actual Feed viewport |
|---|---:|---:|---:|
| 475x865 | 190px | 302px | 244px |
| 435x900 | 192px | 338px | 280px |
| 420x620 | 138px | 206px | 157px |
| 700x900 | 192px | 334px | 276px |

Old card was about 100px high at 475x865. No horizontal overflow at tested sizes.

## Verified tests

- TypeScript+Vite production build and ESLint: PASS.
- Four targeted renderer suites: 18/18 tests PASS.
- V2.3 native visual/geometry integration: 4/4 viewport cases PASS.
- Native four-viewport, five-drawer screen/keyboard/Escape checks: PASS.
- Native 20 UI + motion profile matrix, synthetic Setup/Updater: PASS.
- Native Motion Quality Full/Balanced/Eco movement, Off static, 40 instant tab switches and per-tab scroll: PASS.
- Native real 3s hold test: idle ring invisible; cancel early; 3s calls backend; rejected synthetic request shows error without falsely disconnecting: PASS.
- Queen logo original bitmap loads, has no filters or transforms and does not move with animated glass over 650ms: PASS.

Screenshots: docs/design/visual-parity-20261021/v23-compact-*.png and v23-real-hold-ring.png.
Synthetic Activity labels visible in test/preview are not real MCP tool messages.

## Pending

Full serialized regression and extended GPU-present/game-coexistence tests are separate evidence. Native rAF callback FPS is not proof of GPU present FPS under Delta Force.
Installed QNECTOR and public release v0.4.58 have not been overwritten. The live V2.3 preview is isolated from the real profile and Tunnel; next public build would require a distinct version.

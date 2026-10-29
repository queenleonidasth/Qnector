# QNECTOR — Slint + Rust Native Rebuild: End-to-End Implementation Plan

**Plan date:** 2026-10-29 (Asia/Bangkok)
**Status:** APPROVED TECHNICAL DIRECTION / PLAN ONLY — implementation NOT started
**Decision:** Replace the Electron desktop UI with a new native desktop application written in Rust + Slint; redesign the UI completely. Preserve existing MCP functionality and user data.
**Design language:** Cupertino-inspired, macOS-like restraint, premium minimalism, distinctly QNECTOR; modern desktop Windows behavior.
**Primary UX/UI inspiration:** Slint Widget Gallery (Cupertino), https://docs.slint.dev/latest/demos/gallery/?style=cupertino
**User-supplied gallery URL:** https://docs.slint.dev/latest/demos/gallery/?style=cosmic (the URL selects Cosmic; the user explicitly chose **Cupertino** instead)
**Motion references:** https://motion-reference.takayustudio.jp/ and https://motion-reference.takayustudio.jp/#motion=iris-open
**Primary repo (inspected):** D:\Projects\Qnector-NoPlan-20261016
**Git observed at planning time:** fix/royal-motion-parity-20261021 @ c4425142d24cfca274a726ec79da925f58354f56
**Existing deployed application:** QNECTOR v0.4.60, Electron/React/TypeScript. The portable executable is version 0.4.60 despite a filename containing 0.4.58.
**Scope of THIS task:** produce plan and reference ledger only. No native app, package installation, source migration, release, or deletion has been performed.

---

## 1. Product intent and non-negotiable decisions

1. Build a **genuinely native, WebView-free UI** with Rust + Slint. Do not substitute Tauri, Electron, or a React WebView for the target UI.
2. **Redesign every view**; this is not a pixel-for-pixel port of the old React design. Preserve interaction semantics, feature coverage, brand identity and user data.
3. Visual direction: *Cupertino-inspired minimal luxury*. Make it feel orderly and high-end, with macOS-inspired proportions, softly rounded controls, readable typography, restrained translucent layers and meticulous spacing. Do not clone Apple artwork or platform APIs.
4. Maintain QNECTOR's charcoal/dark graphite and restrained champagne-gold identity; provide a coherent optional light appearance. Avoid overglow, decorative noise, generic dashboard templates and so-called AI-slop aesthetics.
5. Preserve performance and responsiveness as a first-class product requirement. Do not assume Rust/Slint is automatically faster: prove it with controlled CPU, private-memory, GPU and frame-present measurements.
6. Reuse existing working Node.js/TypeScript MCP, Memory, Skills, process, transport and durable-task logic via an **isolated sidecar** in the first migration. Optimize and selectively rewrite only after profiling. No forced rewrite of every backend module.
7. Preserve existing behavior: the eight direct MCP tool groups (system, workspace, files, process, git, memory, browser, computer), ChatGPT connection/tunnel, native computer-use integrations, task continuity, Memory v2, updater, configuration, tray and startup options.
8. **Do not reintroduce Plan Mode** or legacy approval/Plan-Act controls. Current direct-action permission model remains the authority.
9. Build a new native variant side-by-side. Do not overwrite, uninstall, terminate, auto-update or silently modify the currently running Electron QNECTOR until explicit release approval.
10. The approved motion site is for **reference**. Reimplement effects in Slint/Rust/WGPU from concepts, durations, easing and behavior. Do not scrape and redistribute proprietary assets or copy code unless its specific license permits it.

### Major upstream constraints discovered on 2026-10-29

- Slint currently supports cupertino / cupertino-light / cupertino-dark widget styles. HOWEVER Slint announced on 2026-03-31 that, from 1.16, Fluent is the default and non-Fluent built-in styles will receive less maintenance and eventually be deprecated. **Treat Cupertino as a visual reference, not as a hard dependency.** Build QNECTOR-owned styled components and tokens.
- Slint widget style is generally selected at **compile time** via SLINT_STYLE. Runtime dark/light switching must be implemented through our own application design tokens/components rather than assuming the built-in style changes live.
- Some direct Slint↔WGPU integration APIs in the current documented release (1.18.1 at research time) are behind the feature **unstable-wgpu-30** and may change. Pin compatible versions only after a working proof of concept; provide graceful fallback and do not block the whole GUI on experimental APIs.
- Slint license choice is an explicit engineering gate. The community/royalty-free desktop license requires Slint attribution (e.g., accessible AboutSlint page or website badge); GPLv3 and paid-seat options have different conditions. Review exact current agreement and dependent crates before packaging.
- Motion Reference's terms clarify that referenced code/media remain owned by their respective rightsholders; viewing/linking does not grant reproduction or commercial redistribution rights. Use original effects with tracked sources/permissions.
- Slint Testing with Python may require an access token/license; do NOT assume its private package index is freely available. Use standard Rust tests, UI state tests and available free accessibility/manual testing first.

## 2. Verified existing-system inventory (read-only audit)

The source tree already contains:
- apps/desktop/src/main/main.ts: Electron app lifecycle, BrowserWindow, tray, global shortcuts, native dialogs, updater, IPC and MCP runtime bootstrap.
- apps/desktop/src/main/platform-services.ts: Electron-backed clipboard, notifications, screen capture, window listing/focusing and image preview.
- apps/desktop/src/preload/preload.cts and api.ts: Electron contextBridge + IPC contract for UI operations.
- apps/desktop/src/renderer: React 19/TypeScript UI, Activity Feed, Skills, Memory Center, diagnostics, configuration, updater and custom effects.
- apps/desktop/src/renderer/queen-liquid-orb.tsx and royal-silk-background.tsx: Canvas 2D animations plus current Queen portrait asset and golden silk background.
- apps/desktop/src/renderer/royal-motion-clock.ts, motion-policy.ts: shared rAF clock, visibility/reduced-motion behavior, motion quality budgets.
- apps/daemon and packages/execution: durable daemon and job host (including packaged .NET Windows job-host components).
- packages/core, packages/mcp-server, packages/transports, packages/shared and other workspace packages: much of the business logic remains in TypeScript/Node.
- apps/relay: separate relay service.
- apps/desktop/electron-builder.yml and scripts: current Windows setup/portable packaging and release/update chain.
- skills/, native UIA helper, tunnel-client and other binaries: must be inventoried and preserved at runtime.

Observed 2026-10-29 performance snapshot (NOT a controlled benchmark):
- 7 QNECTOR-related processes, including Electron main, GPU, renderer, Node daemon, portable launcher and tunnel client.
- Around 824 MiB combined Working Set; **summing Windows Working Sets can double-count shared pages**. Use process Private Bytes, working-set breakdown and whole-app metrics in future comparisons.
- Around 2.91 seconds from desktop process bootstrap to bridge-connected milestone in the sampled startup.
- 3-second CPU sampling of the old UI: Electron GPU process ~44% of ONE logical core, renderer process ~10.9% of ONE logical core with active visuals. Not a prediction for Slint or a measured GPU percentage.
- Current portable EXE observed around 232 MiB. Compare packaged outputs on equal feature configurations; the whole distribution also includes sidecars/resources.
- Old renderer motion telemetry measures rAF callback cadence, not actual screen presentation FPS.

Existing repo safety note: root AGENTS.md says read ../devq.md as source of truth; that file was **not found** under D:\Projects during planning. The implementing agent MUST locate/confirm the applicable product authority before behavioral changes and record the missing-file decision instead of fabricating its contents. Do not change or delete unrelated untracked docs/computer-use-implementation-plan-2026-10-22.md.

### Preserve compatibility with
- Config path and values; migrated appearance settings; existing workspace selection.
- MCP endpoint, transport profiles, tunnel client, credentials handling, recovery/reconnection.
- Eight existing grouped tools, result/output formats, permission model and errors.
- Memory v2 files, skills import/editor, durable tasks persisted independently of GUI.
- QNECTOR native UI automation, browser integration, file/document tooling and process manager.
- System tray, minimize/restore/close behavior, startup hidden, login autostart, global shortcut, OS integration.
- Open ChatGPT behavior, update checking/downloading/installation, version/provenance and release rollback.
- No key/token copying to logs, diagnostics or screenshots.

## 3. Proposed target architecture

    +-------------------------------------------------------------+
    | QNECTOR Native Desktop (Rust process)                       |
    | Slint UI + self-owned Cupertino-inspired Design System       |
    | ViewModels / state reducer / async event ingress             |
    | Native Windows window/tray/clipboard/notifications adapters  |
    | Optional GPU effects: WGPU textures / shaders / compositor   |
    +-------------------------|-----------------------------------+
                              | versioned local IPC
                              | Windows Named Pipe preferred
                              | protected with per-user ACL
    +-------------------------v-----------------------------------+
    | Existing QNECTOR Runtime Host (dedicated Node.js sidecar)   |
    | MCP tools, Memory, Skills, Browser, Computer Use, Transports |
    | Existing TypeScript packages, no Electron dependencies      |
    +--------------------|----------------------|-----------------+
                         |                      |
                 Durable daemon/job host     Tunnel/relay
                 (unchanged ownership)       (unchanged contract)

Architecture rules:
- GUI is a client to a durable backend: closing the GUI must not cancel already accepted durable tasks.
- The Rust shell owns only presentation, app lifecycle, window integration and explicitly ported services.
- Build a standalone Node runtime-host entrypoint that does **not** require Electron or ELECTRON_RUN_AS_NODE.
- Prefer Windows named pipes with unique per-user endpoint, ACL, protocol version, handshake, message size bound, cancellation IDs and resumable event subscriptions. A loopback transport is an alternative only with equivalent origin/auth controls and no unintended external binding.
- Use typed request/response/event schemas (e.g. JSON Schema + generated Rust/TypeScript types, or carefully audited equivalent). Never pass unvalidated arbitrary shell commands between UI and backend as a shortcut.
- No direct UI-thread filesystem, network, shader compilation, parsing or synchronous heavy data work.
- Model streams and activity list updates must be bounded/coalesced; avoid a full UI tree refresh for every token/log line.
- Reuse existing transport behavior. Do not launch two conflicting tunnel owners against the same user's profile.
- Gradually replace high-cost Node functionality with Rust **only if a profiler proves a meaningful benefit** and parity tests exist.

### Suggested new repo layout (proposal, not created)

    apps/native-desktop/
      Cargo.toml
      build.rs
      src/main.rs
      src/app_state.rs
      src/bridge/{client,protocol,reconnect}.rs
      src/platform/windows/{window,tray,clipboard,capture,notifications,autostart}.rs
      src/effects/{orb,iris,background,renderer_adapter}.rs
      ui/app.slint
      ui/design/{tokens,typography,theme,motion}.slint
      ui/components/{titlebar,sidebar,button,field,card,toast,drawer,status}.slint
      ui/components/{activity_row,orb,setting_row,empty_state}.slint
      ui/views/{dashboard,activity,workspace,skills,memory,processes,diagnostics}.slint
      ui/views/{connections,settings,updater}.slint
      tests/{state,contract,interaction,visual,perf}/
    apps/runtime-host/
      src/main.ts
      src/transport.ts
      tests/
    packages/native-bridge-protocol/
      schema/ (canonical protocol + compatibility fixtures)
    docs/native-rebuild/
      screenshots/ motion-catalog.md baseline/ adr/ benchmark-results/
    scripts/native-rebuild/
      measure-baseline.ps1
      smoke-native.ps1
      package-native.ps1

Keep existing Electron desktop as a separate stable build until the new implementation clears every release gate.

## 4. UX/UI art direction and design system

### Design principles
- Quiet luxury: clear hierarchy, exceptional typographic rhythm, tight alignment, carefully chosen whitespace, controlled restraint. Avoid clutter, fake neon, excessive texture, giant hero dead zones and flashy motion without information purpose.
- A recognizable QNECTOR: preserve the Queen mark, precise gold details and connected/disconnected status semantics. The redesign may reposition the orb and structure, but it must remain usable and meaningful.
- Cupertino-inspired shape and density, not a literal Apple UI copy. Respect Windows taskbar, shortcuts, accessibility and window controls.
- Compact portrait/vertical orientation is a first-class design requirement; make useful activity/status visible without scrolling through decorative whitespace.
- Background should be subtle, with a *static* graceful fallback when dynamic motion is off.

### Design-token draft (NOT final artwork)
- Base dark: #101216; surface: #1A1D22; elevated: #23272D; foreground: #F2F1ED; secondary text: #A1A6AF; hairline: #353940; gold accent: #C3A26B.
- Light alternative: warm ivory surfaces #F5F4F0 and #FFFFFF, dark graphite text, sparing champagne gold accents.
- Spacing scale: 4, 8, 12, 16, 20, 24, 32 logical px.
- Rounded controls: 10–16px; elevated cards: 16–20px; larger sheets: 20–24px. Avoid turning every component into an oversized pill.
- Typography: use legally available local Windows system font fallback (e.g. Segoe UI Variable), with tested Thai glyph coverage and legible weights. Do NOT redistribute unlicensed Apple fonts.
- Translucency: only where it conveys depth; no dependency on expensive full-window live background blur.
- WCAG-like accessibility: adequate text contrast, focus indicator, non-color-only status, 44px-ish targets for primary controls where layout allows.

### Screens to redesign and functional requirements
1. **Dashboard:** status, central/compact animated orb, connection control, real connection state, quick access, actionable live activity. Never waste most of viewport on chrome.
2. **Live Activity Feed:** condensed readable rows, newest-item behavior, grouping/filtering, skill/tool label, progress, accessibility, efficient virtual list for high volume.
3. **Workspace:** current path, searchable files/workspace context, visible actions, safe empty/loading/error states.
4. **Skills:** list/search/install/import/enable/editor, precise state and provenance, simple management.
5. **Memory Center:** fresh workspace/task memory, saved events, retrieval and health with correct timestamps and clear empty/error states.
6. **Processes/Tasks:** individual process/task state, output streaming, cancellation with explicit semantics, durable-job continuity.
7. **Connection Setup:** tunnel mode/profile, connected/reconnecting/disconnected/error with helpful resolution UI.
8. **Diagnostics:** runtime status, performance metrics, error details and actionable export, no accidental secret exposure.
9. **Settings:** appearance/motion quality, performance presets, launch settings, preferences and keyboard shortcuts.
10. **Updater/About:** check/download/install/release notes/version integrity, Slint attribution per chosen license, rollback information.
11. **System tray/compact window:** status and primary actions, native close/minimize/restore, no stuck background animation.
12. **Startup/Splash:** short and consistent with final aesthetic, no forced slow animations.

### UX approval artifacts before functional port
- A mini design system: color, spacing, type, radii, iconography, states and motion tokens.
- 3 visual directions within the same brief: Graphite Luxury (default), Light Cupertino, Gold Accent Variant. Choose one cohesive design with minimal mixing.
- Screenshots of Dashboard, Skills, Memory, Activity, Settings, Connection, Diagnostics in: 420x620, 435x900, 475x865, 700x900 and 1280x850 viewports, plus 100%/150%/200% DPI.
- Interactive preview in native Slint using **synthetic data only**; no real tool calls for design approval.
- Side-by-side screenshots, a UI inventory and a list of design feedback before proceeding to all screens.

## 5. Motion System design (Slint + optional WGPU)

### Mandatory approach
- **Slint built-in:** property animations, states/transitions, easing, spring, opacity, position, rotation, scale-like geometry, feedback and opening/closing panels.
- **Rust motion coordinator:** event state machine, cancel/retarget handling, reduced-motion policy, visibility gating, animation budget, event loop scheduling and frame telemetry.
- **WGPU custom rendering:** only where native Slint alone cannot deliver the approved Orb, Iris mask, shimmering ribbons or controlled glass reflections. Do a separate WGPU interoperability proof first. Do not assume unstable APIs work without a compiled test.
- **Fallback:** static Slint visual or simpler performant renderer if the adapter/driver is incompatible. Never crash/black-screen the entire app for a nonessential effect.
- Neither GSAP, React animations nor CSS clip-path can be pasted into Slint. Translate motion semantics, not web runtime code.

### Motion catalog to implement as reusable QNECTOR primitives
| ID | Reusable component/token | Reference | First target |
|----|--------------------------|-----------|--------------|
| MOT-01 | QFadeReveal | motion site basics / Slint animations | status labels, page mount |
| MOT-02 | QSlideSpring | Slint spring easing | panels and menus |
| MOT-03 | QStaggerList | motion site stagger concepts | activity list |
| MOT-04 | QMicroPress | spring + Cupertino-like button feedback | controls |
| MOT-05 | QIrisOpen | motion-reference #motion=iris-open | connection/page reveal |
| MOT-06 | QLiquidOrb | existing QNECTOR orb semantics + WGPU demo | connect/hold/disconnect |
| MOT-07 | QAmbientSilk | existing golden background + WGPU render | subtle background |
| MOT-08 | QStatusMorph | connection state transitions | success/error/reconnecting |
| MOT-09 | QSheetTransition | Slint states/transitions | settings/side sheets |
| MOT-10 | QProgressFlow | easing/animation controls | task/process progress |

Suggested initial timings to tune experimentally (not copied from any source): 100–160ms hover/press; 180–260ms micro-transitions; 260–420ms panels; 350–600ms page/hero effects. Preserve the existing *three-second hold interaction* and cancellation semantics where currently required.

### Iris Open implementation
- Define normalized progress p ∈ [0,1]; apply easing; calculate a radial reveal mask over the target content.
- Prefer a Slint clipping strategy only if it is actually supported for the required geometry, smoothness and hit testing. For a full circular/feathered reveal, use a small WGPU shader with a single texture/mask or scene integration.
- Handle reverse close/interrupt without snapping or resetting the visual state. Test at 100/150/200% DPI and while window resizes.
- Content accessibility and pointer/keyboard activation must not be masked inappropriately.

### Orb & continuous background
- Keep the Queen image crisp: no screen blend that washes out features; no huge blur overlay across the emblem.
- Use one disciplined scheduler; no multiple independent infinite loops for orb/background/list.
- Stop/reduce animation when app is hidden/minimized, Reduce Motion is active, animations-off is selected, or game-foreground low-resource policy applies.
- Progressive modes: Full / Balanced / Eco / Off. Eco should simplify effects; Off should show a clean static frame.
- The GPU must own shader-heavy animation where validated; CPU must handle only bounded simulation and UI state changes.
- Prevent flashes on resize, connection transitions and disconnect; no jump cut on spring retargeting.
- Do not animate decorative effects continually if static appearance is sufficient.

## 6. Execution phases, task IDs, dependencies and exit gates

**Implementation policy:** complete phases in order. An agent may parallelize independent research/design/tests, but MUST NOT declare a later phase complete while prior exit gates are open. Every claimed result needs reproducible commands, screenshots/logs and a revision hash. Do not release after just a mockup.

### P0 — Source audit, license and controlled baseline (PREREQUISITE)
- [ ] P0.01 Read root AGENTS.md, inspect existing git status and all relevant package manifests. Resolve the missing ../devq.md authority question; never invent contents.
- [ ] P0.02 Inventory all Electron-specific APIs, IPC names, native binaries, Node native modules, install/update paths, config fields, data stores, startup logic and OS permissions.
- [ ] P0.03 Build a functionality-to-owner matrix: Electron shell vs independent Node modules vs .NET job host/tunnel/native helper.
- [ ] P0.04 Capture clean idle/connected/disconnected/active-animation/cold-start performance baseline with multiple repeated runs; save process tree, private bytes, working sets, CPU over fixed windows, GPU load, app package size, startup milestones and real frame presentations.
- [ ] P0.05 Confirm latest compatible Slint/Rust/WGPU versions and Windows prerequisites by compiling minimal probes. Record exact dependency versions/feature flags.
- [ ] P0.06 Review Slint license chosen and attribution; audit fonts/icons/animations and third-party licenses; document expected redistribution rights.
- [ ] P0.07 Freeze supported features and baseline screenshots, interaction contracts, config schema and existing test suites.
**Artifacts:** ADR-001 architecture; API/feature matrix; baseline measurement manifest; license ledger; environment/versions; blocker list.
**Gate P0:** product authority resolved, reproducible baseline and inventory signed off. No unsupported performance claims.

### P1 — Isolated native skeleton and backend transport
- [ ] P1.01 Create an isolated feature branch named feat/slint-native-redesign; leave stable branch/install untouched.
- [ ] P1.02 Add Rust Cargo workspace application under apps/native-desktop with Slint build.rs and a minimal window. Build on Windows x64.
- [ ] P1.03 Create an independent runtime-host Node sidecar entrypoint (not Electron), with versioned IPC schema and contract tests.
- [ ] P1.04 Implement connect/disconnect/status/read-only activity subscription in a mutation-blocked synthetic backend first.
- [ ] P1.05 Add Rust async worker/event-loop handoff; bounded event queues and reconnection/backpressure logic.
- [ ] P1.06 Include single-instance and window lifecycle behavior, resource path resolver and diagnostic logging redaction.
- [ ] P1.07 Document temporary dependency costs of shipping Node separately. Confirm native module compatibility.
**Gate P1:** native Slint window launches, status reconnect demo passes, backend works with Electron closed, no existing user data modified.

### P2 — New visual language and static/interactive design approval
- [ ] P2.01 Create the new tokens, component library and typography/icon rules without copying the old React layout.
- [ ] P2.02 Build custom Titlebar, Sidebar/Navigation, StatusPill, Button, Card, ListRow, Sheet, Drawer, Toast, SettingsRow and FocusRing.
- [ ] P2.03 Prototype three cohesive visual directions and select a single final aesthetic based on screenshots.
- [ ] P2.04 Implement Dashboard, Orb placeholder, Activity Feed and Settings using synthetic seeded data.
- [ ] P2.05 Validate dynamic compact/window size behavior, focus navigation, Thai text and DPI scaling.
- [ ] P2.06 Compare against Cupertino Gallery, app showcase and accepted user preference; ensure native Windows window behavior.
**Gate P2:** design mockups/screenshots and interactive native preview reviewed before full backend/UI migration. No production change.

### P3 — Native motion primitives and GPU feasibility
- [ ] P3.01 Implement reusable Slint motion primitives and motion tokens.
- [ ] P3.02 Produce standalone WGPU compatibility spike: render a texture/underlay in the *same* graphics context as Slint if supported by the chosen API; document version pinning and resource ownership.
- [ ] P3.03 Build QIrisOpen, QLiquidOrb, QAmbientSilk with safe fallbacks; validate loss/reset and resize.
- [ ] P3.04 Implement one shared animation policy (visibility, Reduce Motion, quality budget, frame pacing, game-foreground behavior).
- [ ] P3.05 Add frame timing and GPU/CPU use instrumentation; measure actual presented frames, not only callback counts.
- [ ] P3.06 Test interruptions/retargeting and crisp central emblem. Avoid decorative CPU loops.
**Gate P3:** visually accepted motion, no flicker/jump, functional fallback, quantified resource evidence at each quality level.

### P4 — Service bridge and live backend parity
- [ ] P4.01 Port all necessary preload/IPC methods to typed Rust↔Node IPC, preserving result types/error semantics.
- [ ] P4.02 Test live MCP startup/stop/reconnect; all eight tool groups retain identical external behavior.
- [ ] P4.03 Reuse Memory v2, Skills, Workspace, browser/computer adapters, process and durable task access without creating duplicate owners.
- [ ] P4.04 Replace Electron-native clipboard, screen capture, window focus/listing, image preview, notifications, tray and global shortcuts using Rust/Windows integrations.
- [ ] P4.05 Verify security boundaries: named-pipe ACL, validated messages, no secret logs, sane timeout/cancellation/error recovery.
- [ ] P4.06 Make GUI restart independent of task host state; verify job IDs, outputs and cancellation remain correct.
**Gate P4:** identical service parity contract passes and existing user data/state remains usable.

### P5 — Full view migration and interaction regression
- [ ] P5.01 Implement every view in section 4 against real typed ViewModels, not arbitrary JSON glued to Slint components.
- [ ] P5.02 Implement high-volume Activity Feed virtual list, filters and scroll/newest behavior with low allocation overhead.
- [ ] P5.03 Implement Skills import/editor, Memory Center, process/tasks, diagnostics, config, updater and connection setup.
- [ ] P5.04 Verify proper empty/loading/success/error/permission/timeout states, keyboard shortcuts, accessibility and localized rendering.
- [ ] P5.05 Verify tray, autostart, minimize/close behavior, Open ChatGPT and update status.
**Gate P5:** no missing feature in the parity matrix; synthetic and live integration tests green.

### P6 — Controlled optimization, test automation and hardening
- [ ] P6.01 Profile full-process memory and CPU by scenario; compare equal workload and build configuration.
- [ ] P6.02 Optimize only measured hot spots (render, list updates, IPC, loading, unnecessary copies).
- [ ] P6.03 Run Windows ETW/PresentMon or equivalent for presented frame time, GPU activity and stutter.
- [ ] P6.04 Run long soak while connected, while processing many events, while minimized and while a game is in foreground.
- [ ] P6.05 Run visual regressions across viewport/DPI matrix; automated Slint tests if available/licensed; Windows UIA and manual accessibility fallback.
- [ ] P6.06 Repeat 5+ cold/warm runs; report medians, p95 and confidence caveats.
**Gate P6:** every acceptance target in section 7 met or explicitly documented as an exception, with side-by-side benchmark proof.

### P7 — Packaging, updater migration, rollback and staged release
- [ ] P7.01 Package signed-when-available Windows Installer and Portable distribution; include required Node sidecar/native binaries/assets/licenses exactly once.
- [ ] P7.02 Verify package provenance, correct app version, checksums and update channel; no stale asset selection.
- [ ] P7.03 Document and test config backups/forward migration and reverse rollback; never destructively rewrite old files.
- [ ] P7.04 Preserve accepted durable jobs and tunnel identity during old/new switch; use controlled ownership handoff.
- [ ] P7.05 Do real installed Windows tests (not just dev console/mock bridge); verify startup after reboot.
- [ ] P7.06 Produce release notes, risk list, installer/portable smoke evidence and user-review screenshots.
- [ ] P7.07 Do not replace installed Electron app or publish a release without explicit user authorization.
**Gate P7:** approved candidate, clean reproducible build, tested update/rollback and functional/resource sign-off.

## 7. Acceptance targets and test protocol

### Performance budgets (candidate targets — NOT promises)
- **Whole-app steady-state memory:** target ≥30% lower combined **Private Bytes** than Electron baseline under comparable connected/visible scenario, including Rust UI, Node sidecar, job host and tunnel. Report any shared-page nuance separately.
- **Visible idle CPU:** target ≥30% lower average normalized CPU usage (sum across owned processes, percentages of one logical CPU core) while animations are running at agreed quality, without degraded interaction.
- **Minimized/hidden animation CPU:** target near-zero incremental animation work (proposed ≤1% of one logical core for UI rendering), while required backend/tunnel stays alive. Measure, do not assert.
- **Interactive animations:** target ~60 real presented FPS on 60Hz-capable equipment; target p95 frame presentation interval ≤16.7ms in controlled 60Hz visual tests where the hardware is capable, with tracked dropped/long frames. For faster monitors, use refresh-specific frame budgets (120Hz ≈8.33ms, 144Hz ≈6.94ms) and report limitations. No universal 60 FPS guarantee under arbitrary system load.
- **Startup:** maintain or improve current ~2.91-second bridge-connected sample once a statistically sound baseline is collected; separately report first-window time and runtime-ready time.
- **Package:** seek meaningful size reduction from current ~232 MiB portable EXE, but do not game this goal by silently omitting backend, assets or required dependencies.
- **Memory/CPU regression:** retain robust sustained performance after 30–60-minute activity soak and multiple reconnects.

### Scenarios and methods
1. cold boot and warm boot, five runs each; same machine and comparable system load;
2. idle disconnected, idle connected, connecting, error/retry;
3. Orb Full/Balanced/Eco/Off while foreground and hidden;
4. 1k/10k Activity rows with bursts; memory updates and long streaming outputs;
5. minimized-to-tray and foreground-game low-resource mode;
6. window resizing, 100/150/200% DPI and compact/large sizes;
7. 60/120/144/165Hz where devices support those modes; report actual display refresh;
8. tunnel failure/reconnect; sidecar crash/restart; OS reboot; durable job still running;
9. user control actions (read-only smoke first, mutating tests only in isolated fixture);
10. Windows UI Automation, keyboard-only navigation, screen-reader smoke and Reduce Motion.

Keep baseline/candidate telemetry in JSON or CSV plus screenshots, run commands, hardware specs, timestamps, git revision and caveats. GPU Process CPU is NOT GPU utilization. The former Electron renderer's rAF cadence is NOT display-present FPS.

### Functional must-pass conditions
- 8 tool groups and major sub-actions have no unexplained regressions.
- Memory v2 freshness, stored state, Skills, Computer Use, Workspace and durable task continuity are intact.
- Connection, updater, tray, autostart, global shortcuts, window controls work correctly.
- No second tunnel owner, no disclosure of credentials, no lost accepted jobs.
- No crashes, unhandled promise/panic loops, resize flicker, lost focus, hidden window stuck animations.
- UI loads correctly on reduced-motion, GPU-adapter fallback and after restart.

## 8. Risks and mitigations

| Risk | Impact | Mitigation / evidence required |
|------|--------|--------------------------------|
| Cupertino built-in maintenance/deprecation | Style break in future Slint | Custom QNECTOR design tokens/components; reference-only use of Cupertino; version-pin and test |
| Experimental Slint/WGPU API | shader/texture integration break | isolated spike and pinned compatible versions; simpler Slint fallback |
| Node sidecar still uses resources | total app not much lighter | measure whole stack; optimize high-cost modules after parity |
| Electron-only native OS APIs | missing functionality | explicit replacement matrix and Windows smoke tests |
| Native code changes privileges/attack surface | security regression | per-user IPC, ACLs, validated commands, secret redaction |
| Unfinished durable jobs | lost task state | retain daemon ownership and reconnection; migration testing |
| Updater/installer overwrites running system | user downtime | side-by-side beta, checksums, backup and rollback |
| Custom titlebar breaks window ergonomics | Windows usability problems | test drag, snap, system menu, resize, keyboard, minimize/maximize/close |
| Slint gallery was requested with Cosmic query parameter | design mismatch | use Cupertino style explicitly; keep original Cosmic URL as historical reference |
| License/asset/animation attribution | distribution noncompliance | license ledger and approved attribution path before release |
| Tool/UI automated testing unavailable | inadequate regression evidence | rust tests, mocks, screenshots, manual keyboard/UIA; gate licensed testing separately |
| Unresolved ../devq.md from AGENTS.md | wrong product requirements | identify source of truth before behavior-altering implementation |
| 'Looks like a generic AI dashboard' | aesthetic rejection | design review gate and concrete art direction; require screenshots before full port |

## 9. Build / validation conventions for the implementing AI

- Read AGENTS.md and product specification. Do not delete/rename/change existing frontend in early phases.
- Prefer minimal tests/isolated simulations with no real file/system mutations. Tests for destructive tools must use fixtures.
- Rust: cargo fmt --all -- --check; cargo clippy --workspace --all-targets -- -D warnings; cargo test --workspace; exact commands may be adapted based on feature gate or Windows toolchain.
- Existing TypeScript: npx pnpm@10.15.0 typecheck; npx pnpm@10.15.0 test; run relevant integration/smoke tests and report omissions.
- Add GUI screenshots and real GPU/frame measurements at every visual milestone.
- Maintain CHANGELOG/ADR, issue checklist, source attribution and user-facing acceptance checklist.
- Never claim the native rebuild is complete from an isolated renderer preview or passing unit tests alone.
- Commit only related files on a separate branch; do not push, publish or install without authorization.
- Favor performance and clarity over gratuitous animation. Never substitute rendered images or static mockups for a functioning native GUI.

## 10. Ready-to-copy AI kickoff instruction

> You are implementing the QNECTOR native desktop redesign. Read this entire document, then read the repository AGENTS.md and resolve the missing ../devq.md issue before changing behavior. The chosen target is **Rust + Slint native (NO Electron/Tauri/WebView)** with a **fully redesigned, Cupertino-inspired minimal luxury UI**, preserving all QNECTOR features and user data. Use original animation implementations influenced by Slint Official Examples and Takayu Motion Reference, with Slint native transitions and selective WGPU shaders only after feasibility testing. Start with **P0 and P1 only**. Create an isolated feature branch feat/slint-native-redesign. Audit and benchmark the current Electron v0.4.60 build; create a functional minimal Slint shell and synthetic read-only IPC; do not modify/install/stop/uninstall the currently running production app. Make no changes to unrelated QDM files. Do not reintroduce Plan Mode. Save reproducible tests, benchmark evidence, architecture ADR, sources/licenses and any blockers. Before proceeding to full UI implementation, create a real Slint preview for design review and obtain approval at Gate P2. Report exactly which acceptance gates passed and which did not. Do not claim completion or publish a release without full production parity and explicit approval.

### Agent finish/continuation format
At the end of every work session write:
- branch and exact Git commit/dirty state;
- task IDs completed / pending / blocked;
- paths created/changed;
- actual test commands, exits, screenshots and benchmark artifacts;
- remaining risks and the next **single** prioritized step;
- whether installed QNECTOR, bridge, credentials, tunnel and durable jobs were untouched.

---

## Appendix A — Reference registry (reviewed 2026-10-29)

**Verification convention:** "Official" = official docs/gallery/blog or official upstream README observed. "Showcase" = listing in Slint's app showcase. "Reference-only" = illustrative project/site. "Catalog-listed" = named in official examples README, but deep-link availability and latest API must be checked at implementation time. Historical discussion links are retained so the next AI can revisit without searching from scratch.

### A1 — Cupertino / macOS-inspired design
- [A01] **Primary REQUIRED Cupertino Widget Gallery** — https://docs.slint.dev/latest/demos/gallery/?style=cupertino — user-selected target style; JS/WASM preview might need browser rendering.
- [A02] **Original user-supplied Cosmic Gallery** — https://docs.slint.dev/latest/demos/gallery/?style=cosmic — original query parameter selects Cosmic; reference history only, not final chosen style.
- [A03] **Slint Desktop styles, including Cupertino screenshot** — https://slint.dev/desktop — Official; study native controls, sizing, contrasts and rounded treatment.
- [A04] **Slint standard widget style docs** — https://docs.slint.dev/latest/docs/slint/reference/std-widgets/style/ — Official; compile-time style setting, -dark/-light variants.
- [A05] **Slint 2026 built-in-style deprecation decision** — https://slint.dev/blog/default-native-style-change — Official; mandatory future-proofing.
- [A06] **Slint demos directory** — https://slint.dev/demos — Official; Weather, Energy Monitor, widget galleries and source links.
- [A07] **SlintPad / interactive prototyping** — https://slintpad.com/ — Official design exploration; do not mistake WASM preview for native performance.
- [A08] **Official app showcase** — https://madewithslint.com/ — Showcase; real products and links.

### A2 — Slint language, animations, renderer, Windows integration
- [B01] **Animations, spring and easing** — https://docs.slint.dev/latest/docs/slint/reference/language/animations/ — Official; property animation and spring.
- [B02] **States and Transitions** — https://docs.slint.dev/latest/docs/slint/reference/language/states-and-transitions/ — Official; build state-driven interaction.
- [B03] **Animation guide** — https://docs.slint.dev/latest/docs/slint/guide/language/coding/animation/ — Official; duration, easing, delay, iterations.
- [B04] **Rust Slint crate API** — https://docs.slint.dev/latest/docs/rust/slint/ — Official; main binding.
- [B05] **Backends and Renderers** — https://docs.slint.dev/latest/docs/slint/guide/backends-and-renderers/backends_and_renderers/ — Official.
- [B06] **Winit backend and renderer selection** — https://docs.slint.dev/latest/docs/slint/guide/backends-and-renderers/backend_winit/ — Official; GPU/software options.
- [B07] **Slint WGPU integration module** — https://docs.slint.dev/latest/docs/rust/slint/wgpu_30/ — Official; unstable-wgpu-30 and shared device/queue limitations.
- [B08] **Slint frame/animation debugging & slow motion** — https://docs.slint.dev/latest/docs/slint/guide/development/debugging_techniques/ — Official.
- [B09] **SystemTrayIcon** — https://docs.slint.dev/latest/docs/slint/reference/window/systemtrayicon/ — Official; inspect current Windows support.
- [B10] **Headless testing backend (internal crate docs)** — https://docs.slint.dev/latest/docs/rust/i_slint_backend_testing/ — Official; mock time and event-loop tests.
- [B11] **Slint UI Testing Python** — https://testing.slint.dev/ — Official; may need license/access token; optional, not an assumed free dependency.
- [B12] **Slint Rust getting started/template** — https://slint.dev/get-started — Official.
- [B13] **Slint licensing** — https://slint.dev/terms-and-conditions — Official; verify attribution/license selection before distribution.
- [B14] **Slint Rust GUI desktop overview** — https://slint.dev/desktop — Official.
- [B15] **Slint video tutorials** — https://slint.dev/videos — Official; optional visual learning materials.

### A3 — Official source-code examples for reusable native animation
- [C00] **Examples index and authoritative descriptions** — https://github.com/slint-ui/slint/blob/master/examples/README.md — Official: use this index if individual paths change.
- [C01] **orbit-animation** — https://github.com/slint-ui/slint/tree/master/examples/orbit-animation — Official/catalog-listed; orbital motion for QNECTOR orb.
- [C02] **fancy-switches** — https://github.com/slint-ui/slint/tree/master/examples/fancy-switches — Official/catalog-listed; native animated toggles.
- [C03] **fancy_demo** — https://github.com/slint-ui/slint/tree/master/examples/fancy_demo — Official/catalog-listed; custom UI component library.
- [C04] **dial** — https://github.com/slint-ui/slint/tree/master/examples/dial — Official/catalog-listed; rotary interaction.
- [C05] **speedometer** — https://github.com/slint-ui/slint/tree/master/examples/speedometer — Official/catalog-listed; animated gauge.
- [C06] **sprite-sheet** — https://github.com/slint-ui/slint/tree/master/examples/sprite-sheet — Official/catalog-listed; frame-based animation.
- [C07] **wgpu_texture** — https://github.com/slint-ui/slint/tree/master/examples/wgpu_texture — Official/catalog-listed; WGPU textures in Slint.
- [C08] **opengl_underlay** — https://github.com/slint-ui/slint/tree/master/examples/opengl_underlay — Official/catalog-listed; custom graphics rendered beneath Slint.
- [C09] **OpenGL integration** — https://github.com/slint-ui/slint/tree/master/examples/opengl — Official/catalog-listed; custom render to texture.
- [C10] **custom-titlebar** — https://github.com/slint-ui/slint/tree/master/examples/custom-titlebar — Official/catalog-listed; frameless dragging, resizing and OS controls.
- [C11] **carousel** — https://github.com/slint-ui/slint/tree/master/examples/carousel — Official/catalog-listed; dynamic navigational motion.
- [C12] **gallery** — https://github.com/slint-ui/slint/tree/master/examples/gallery — Official/catalog-listed; widget layouts and styles.
- [C13] **Slint Energy Monitor live demo** — https://docs.slint.dev/latest/demos/energy-monitor/ — Official; responsive dashboard reference.
- [C14] **Slint Weather demo** — https://slint.dev/demos — Official; responsive custom UI using Rust backend.

### A4 — Third-party/example apps mentioned in research
- [D01] **WSL Dashboard** — https://github.com/owu/wsl-dashboard — Showcase-verified Rust/Slint Windows app.
- [D02] **WSL Dashboard website** — https://www.wslui.com — External product site.
- [D03] **SurrealismUI** — https://github.com/Surrealism-All/SurrealismUI — Showcase-verified Slint component library, Fluent2-inspired, not the requested final Cupertino design.
- [D04] **Flectar Mail** — https://flectar.com — Showcase-verified native Rust/Slint app (third-party performance claims are NOT QNECTOR benchmarks).
- [D05] **WesAudio (Slint DAW plugin UI)** — https://madewithslint.com/ — Showcase-verified; high-polish custom UI reference.
- [D06] **Vivi and Coop third-party component collections** — https://madewithslint.com/ — Showcase-listed; review license and maintenance before reuse.

### A5 — Takayu motion references (inspiration only; not directly runnable in Slint)
- [E01] **Motion Movement Reference home** — https://motion-reference.takayustudio.jp/ — 782 motion references shown at review time; use timing/easing/behavior conceptually.
- [E02] **Iris Open** — https://motion-reference.takayustudio.jp/#motion=iris-open — radial/circular reveal concept; Slint requires custom mask/rendering for parity.
- [E03] **Reference-site terms and rights** — https://takayustudio.jp/reference-network/terms.html — Official terms last updated 2026-10-28; rights remain with respective owners.
- [E04] **TakayuStudio home** — https://takayustudio.jp/ — Reference creator.
- [E05] **Additional motion clips previously discussed** — use E01 and individual stable deep links only after testing. Do not claim the site's HTML/CSS/React/GSAP/WAAPI examples run in Slint unchanged.

### A6 — Repository/internal sources inspected
- [F01] Root AGENTS.md — project instructions and prohibition on bringing Plan Mode back.
- [F02] Root package.json — pnpm workspace, Electron 44, React 19, Node 22+, TypeScript.
- [F03] apps/desktop/src/main/main.ts — desktop lifecycle, bridge, tray, updater, IPC.
- [F04] apps/desktop/src/main/platform-services.ts — Electron-dependent native integrations.
- [F05] apps/desktop/src/preload/{preload.cts,api.ts} — IPC compatibility surface.
- [F06] apps/desktop/src/renderer/{queen-liquid-orb.tsx,royal-silk-background.tsx,royal-motion-clock.ts,motion-policy.ts} — existing functional/motion reference and visibility design.
- [F07] apps/desktop/electron-builder.yml — package contents and Windows resources.
- [F08] apps/daemon, packages/core, packages/mcp-server, packages/execution, packages/transports — backend architecture.
- [F09] docs/design/royal-motion-trial-report.md, docs/design/royal-motion-native-system/profile-*-fps.json — old synthetic-renderer rAF data; not GPU-present benchmarks.
- [F10] Current source Git state observed at plan creation; preserve unrelated untracked files.
- [F11] ../devq.md — referenced in AGENTS.md but NOT found in D:\Projects; needs resolution before modifying product behavior.

## Appendix B — Explicit exclusions and decision log

- Do not copy a proprietary macOS UI, Apple SF Symbols or Apple font files without rights.
- Do not rely exclusively on cupertino built-in style for long-term maintenance.
- Do not replace every Node service with Rust on day one.
- Do not accept a benchmark that excludes Node sidecar, tunnel or job host when claiming total resource savings.
- Do not auto-start CPU-expensive background visuals at 60/144 FPS when hidden.
- Do not install a fake updater or break the current reliable updater/portability.
- Do not re-enable Plan Mode, store ChatGPT browser sessions or tokens, or expand remote access.
- Do not silently delete source trees, existing user config, accepted durable jobs or the live app.
- Do not declare P0-P7 complete until corresponding evidence and user-required approvals are recorded.

**Next recommended action:** Send the instruction in section 10 to an AI coding agent, explicitly asking it to execute P0 and P1, then stop for Gate P2 design review. This file is the authoritative implementation plan for the native-rebuild effort, subordinate to the project's verified product requirements and user decisions.

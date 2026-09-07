# Qnector — Royal Porcelain UI Redesign

## Activated Agent Skills

- `ui-ux-design`: preserve working task flows while redesigning hierarchy and component language.
- `design-system`: define semantic roles before one-off styling.
- `loading-motion-design`: use motion for connection, navigation, loading and state continuity.
- `ui-ux-audit`: verify the real 451×978 surface, scrolling, clipping, focus and slow states.

## Direction

**Royal Porcelain** is a modern luxury desktop utility inspired by white-and-gold royal interiors rather than a dark gaming dashboard.

The interface uses polished ivory porcelain, champagne gold metalwork, pearl glass and warm daylight. Royal references come from proportion, fine gold keylines and restrained serif display typography rather than dense baroque ornament.

## Approved constraints

- White / ivory is the dominant surface and champagne gold defines hierarchy.
- Body copy uses dark warm brown for contrast; gold is reserved for emphasis.
- Minimum UI text floor is **10px** at the current 451px app width; normal readable body copy targets 11–12px.
- The hero around the Orb must **not** use curved dark/black corner ornaments.
- Frames and controls must **not** use a large white blade/sheen sweeping across the surface.
- Gold-gradient drift, narrow gold rail shimmer, status pulse, subtle particles and transform/opacity transitions are allowed.
- Drawers and the Skill Manager use the same porcelain system instead of reverting to a dark theme.

## Core semantic tokens

```css
--canvas: #f8f4ea;
--surface: rgba(255, 253, 247, 0.82);
--surface-raised: #fffdf8;
--ink: #30291f;
--ink-secondary: #716859;
--ink-muted: #918777;
--gold: #c79b35;
--gold-strong: #946b18;
--gold-light: #e7ca78;
--gold-line: rgba(145, 112, 36, 0.24);
--success: #338860;
--danger: #b4554c;
```

## Main shell

- Header uses the Qnector crest, `QNECTOR` as the primary name and `Royal MCP Bridge` as the descriptor.
- Connection state stays top-right in a compact pearl status pill.
- Hero uses a clean pearl/white surface with a thin gold keyline and no corner ornaments.
- Orb remains the focal control: crystal/pearl enclosure with a champagne-gold core and low-amplitude breathing motion.
- Endpoint is a white inset field with readable mono text and a compact gold Copy action.
- Primary CTA animates its gold gradient rather than sweeping a white highlight across the button.
- Disconnect hint remains tertiary and does not compete with the main action.

## Activity Feed

- White surface with a narrow animated gold top rail.
- Tool/action typography remains the primary row information.
- Incoming calls use short fade/blur reveal; existing queue coalescing remains unchanged.
- Hover strengthens the gold boundary slightly without heavy glow.
- Live/running indicators use a low-amplitude pulse.

## Dock

- Floating pearl glass dock with a thin gold border.
- Active selection uses a pale-gold capsule that glides between Workspace, Memory, Skills and Settings.
- When no drawer is open, the capsule stays hidden so the dock does not imply a selected page.

## Drawers and Skill Manager

- Warm-white bottom sheet with gold hairline dividers.
- Header/tabs remain fixed while page content scrolls.
- Skill rows enter with a short cascade using transform/opacity only.
- Search, filters, forms, validation and modals keep readable dark text on pale surfaces.
- Runtime & Diagnostics remains secondary under Settings.

## Motion rules

- No animation may delay first useful paint.
- Header and panels enter in roughly 400–520ms only on shell appearance.
- Decorative gold rail and dust motion stays slow and peripheral.
- Connection/live pulses stay low amplitude.
- Drawer page changes remain short and directional.
- Update check keeps at least one second of visible acknowledgment.
- Restart uses the branded state overlay and no fake percentage.
- `prefers-reduced-motion` disables decorative loops and makes transitions effectively immediate.

## QC follow-ups

The UI is stable, but future cleanup should continue to split the large renderer/CSS files, replace blocking `window.confirm()` dialogs with app modals, strengthen renderer interaction tests, improve Orb keyboard semantics and eventually normalize icons into a small SVG set.

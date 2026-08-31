# Aurelle — Royal Modern Login Prototype

A standalone login-page prototype created for the **Royalist + Modern** visual direction, using a restrained white / ivory / warm-gold palette.

## Design direction

Visual design was delegated to **Antigravity CLI** in design-only / plan mode. The selected direction was **Modern Sovereign**:

- Warm alabaster canvas: `#FDFCFA`
- Pristine white surfaces: `#FFFFFF`
- Burnished royal gold: `#C5A059`
- Deep antique gold hover: `#B38E46`
- Accessible gold text: `#8C6D2B`
- Warm charcoal primary text: `#1A1917`
- Fine architectural lines and geometric signets instead of heavy Baroque ornament
- Display serif + modern sans-serif pairing

All implementation, form behavior, accessibility, responsive behavior, and browser QC were handled separately from the visual-design delegation.

## Features

- Responsive desktop / tablet / mobile layout
- Email validation and password-length validation
- Accessible error reporting with `aria-invalid`, `aria-describedby`, and live status regions
- Show / hide password control
- Remember-me behavior using `localStorage`
- Loading and successful demo-authentication states
- Demo feedback for password recovery, access request, Google, and Apple buttons
- Keyboard-visible focus states
- Antigravity-directed premium motion system: ceremonial staggered entrance, counter-rotating royal orbit, crest levitation, ambient glow breathing, gold-line sheen, and refined micro-interactions
- Desktop pointer parallax constrained to the left showcase panel only
- Animated input focus, checkbox draw, password-eye transition, SSO lift, toast accent, and loading-to-success checkmark feedback
- Reduced-motion support that disables continuous motion and pointer parallax
- WCAG-conscious button/text contrast (dark text on burnished gold)

## Run

Open `index.html` directly in a browser, or serve this directory with any static web server.

Example with Python:

```powershell
cd C:\Users\QUEEN\qnector\examples\royal-modern-login
python -m http.server 8080
```

Then browse to `http://localhost:8080`.

## Authentication note

The submit action is intentionally a front-end prototype. It simulates an 850 ms authentication request and then shows a success state. Replace that delay in `script.js` with the real authentication API when integrating it into an application.

## Preview files

- `preview-desktop.png` — desktop render QC
- `preview-mobile.png` — mobile-breakpoint render QC (500 px browser viewport)

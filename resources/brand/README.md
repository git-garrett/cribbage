# Strong Cribbage brand assets

Direction A, **Counted Monogram**, is the production identity for Strong Cribbage.
The editable SVG masters live in `vector/`; generated web and iOS PNGs are created
by `scripts/export-brand-assets.sh`.

## System

- Felt: `#0B5B43`
- Deep felt: `#063D30`
- Navy: `#071F38`
- Ivory: `#FBF8F0`
- Brass: `#E8C575`
- Supporting mint: `#CFE8DE`
- Display face: Georgia Bold (with Times fallback)
- Utility face: Avenir Next Heavy (with system sans-serif fallbacks)

The full mark uses a separated ivory `S`, brass `C`, and five-hole scoring line.
The micro mark deliberately omits the line below 32 px so that the initials remain
clear. Do not add gradients, shadows, card suits, or additional peg holes to the
core mark.

## Masters and exports

| Master | Purpose |
| --- | --- |
| `strong-cribbage-app-icon.svg` | Full-bleed, opaque mobile and PWA icon |
| `strong-cribbage-mark.svg` | Standalone full mark for medium and large use |
| `strong-cribbage-mark-micro.svg` | Favicons and very small UI placements |
| `strong-cribbage-lockup-dark.svg` | Horizontal lockup on navy/green backgrounds |
| `strong-cribbage-lockup-light.svg` | Horizontal lockup on ivory/light backgrounds |
| `strong-cribbage-mark-monochrome.svg` | One-color production and accessibility use |
| `strong-cribbage-social-preview.svg` | 1200 x 630 social and iMessage source |
| `strong-cribbage-splash.svg` | Square, center-safe iOS launch source |

Run `scripts/export-brand-assets.sh` after editing a master. The script copies the
web SVGs and regenerates all favicons, PWA icons, the Apple touch icon, iOS app
icon, iOS splash images, and social preview.

Metadata uses `social-preview-counted-monogram.png` so social clients do not reuse
the cached square preview. `social-preview.png` remains an identical compatibility
copy for old links.

## Deprecated assets

The following are retained only for history and must not be used by new code:

- `legacy/app-icon-v1.svg`
- `legacy/strong-cribbage-dark-lockup-v1.svg`
- `web/strong-cribbage-logo.png`

The former runtime paths `resources/app-icon.svg` and
`web/public/strong-cribbage-dark-lockup.svg` were removed. Their production
replacements live under `resources/brand/vector/` and `web/public/brand/`.

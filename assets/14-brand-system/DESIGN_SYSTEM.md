# Hyeni Calendar Design System

## Purpose

This design system is the redesign source of truth for Hyeni Calendar. It is based on the current React/Vite/Capacitor app tokens and copied assets in `asset2`, so design work can move forward without guessing colors, fonts, or asset categories.

## Design Principles

1. Paired consistency first: parent and child mode must share the selected family theme color.
2. Safety before decoration: SOS, location, chat, notification, credits, and child data must stay scoped to the paired family/child.
3. Image-led, low text: replace long feature explanations with 3D assets, concise labels, transient toasts, and micro interactions.
4. No feature deletion: redesign visual hierarchy and affordance only. Menus and functions stay available.
5. Android WebView stability: use local Pretendard, fixed dimensions, 44px+ touch targets, and no clipped prices or button labels.

## Source Files

| File | Role |
|---|---|
| `brand-structure.md` | Brand architecture and mode-level rules |
| `design-tokens.css` | CSS token draft for implementation |
| `design-tokens.json` | Portable token source for Figma/design tooling |
| `component-specs.md` | Buttons, sheets, toasts, cards, stickers, subscription specs |
| `screen-patterns.md` | Parent, child, auth, location, subscription screen rules |
| `asset-usage-rules.md` | Asset selection and replacement rules |
| `figma-structure.md` | Recommended Figma page/component structure |
| `style-board.html` | Local visual board using copied assets |

## Foundations

### Color Roles

| Role | Token | Primary use |
|---|---|---|
| Theme accent | `--theme-accent` | Current selected theme color, shared across parent/child |
| Theme deep | `--theme-accent-deep` | Primary pressed/strong accent |
| Theme soft | `--theme-accent-soft` | Screen and card tint |
| Theme line | `--theme-accent-line` | Tinted borders and dividers |
| Theme text | `--theme-accent-text` | Accent text on light surfaces |
| Mint | `--hyeni-mint` | Safety, location OK, parent confidence |
| Rose | `--hyeni-rose` | Child warmth, praise, family emotion |
| Lavender | `--hyeni-lavender` | AI, friend play, secondary playfulness |
| Danger | `--hyeni-danger` | SOS, critical warning, destructive |

### Typography

Use only `Pretendard Variable` for Korean readability and Android WebView stability.

| Style | Size | Weight | Line height | Use |
|---|---:|---:|---:|---|
| Screen title | 24-28px | 700 | 1.3 | Main screen/page title |
| Section title | 17-20px | 650-700 | 1.3 | Section headers |
| Card title | 15-17px | 650-700 | 1.35 | Card and tile headings |
| Body | 14-16px | 500 | 1.5 | Short explanatory text |
| Caption | 11-13px | 600 | 1.35 | Status, metadata, helper |
| Price | 26-34px | 800 | 1.1 | Subscription plan price |

Letter spacing stays `0` except small uppercase system labels. Prefer wrapping over truncation.

### Layout

- Page horizontal inset: 20px on phones, 24px on larger phones.
- Section gap: 24px minimum.
- Title-to-button gap: 16px minimum.
- Touch target: 44px minimum, 48px preferred for Android.
- Avoid nested cards. Use sections, sheets, repeated tiles, and toasts.

### Motion

| Pattern | Duration | Easing | Use |
|---|---:|---|---|
| Press | 120ms | standard | Buttons, tiles |
| State change | 180ms | standard | Toggle, selected state |
| Sheet/toast enter | 220-260ms | standard/pop | Bottom sheet, transient notice |
| Sticker attach | 320ms | pop | Praise sticker placement |

Reduced motion must disable decorative animation while preserving state changes.

## Core Component Families

| Component | Implementation direction |
|---|---|
| Button | One primary CTA per view, 48-56px high, icon+text when action benefits from recognition |
| Bottom sheet | Same handle, radius, inset, mid/full height rules across menus |
| Toast | Bottom transient explanation for short state changes, not static paragraphs |
| Status card | Compact, scannable, icon/asset first, one status line |
| Menu tile | Keep all menus, use consistent 3D icon scale and spacing |
| Sticker | White border, paper shadow, large art, short attach motion |
| Subscription plan | Large tappable plan blocks, no clipped price, direct purchase CTA |

## Asset Anchors

| Need | Folder |
|---|---|
| Current runtime 3D assets | `../01-runtime-3d/` |
| Hyeni character source candidates | `../03-hyeni-character/` |
| Praise/deco/mood stickers | `../04-stickers/` |
| Feature/location/safety icons | `../05-icons/` |
| Background and empty states | `../06-backgrounds/`, `../07-illustrations/` |
| Store and platform assets | `../10-platform/`, `../11-store-listing/` |

## Implementation Mapping

| Design system concept | Current app hook |
|---|---|
| Theme tokens | `src/styles/tokens.css`, `src/App.css` `--theme-accent*` |
| 3D icons | `src/components/icons/ThreeDIcon.jsx` |
| Mascot | `src/components/auth/HyeniMascot.jsx` |
| Animal character | `src/components/icons/AnimalIcon.jsx` |
| Bottom sheet | `src/components/common/BottomSheet.jsx` |
| Sticker visuals | `src/components/sticker/StickerBookModal.jsx`, `src/components/childMode/ReceivedStickersSheet.jsx` |
| Subscription | `src/components/settings/SubscriptionManagement.jsx` |

## Redesign QA Gate

- Parent and child selected theme color matches.
- Paired-only chat, notification, location, AI credit, and child info remain scoped.
- All existing menus are still reachable.
- No paragraph-style explanation remains where toast/micro interaction is sufficient.
- All buttons have 16px+ spacing from titles and 44px+ tap area.
- Prices and Korean labels do not clip on small Android screens.
- Meaningful images have alt labels; decorative images do not create duplicate announcements.

## Implementation Status

This design system is a **redesign target**. It is intentionally ahead of the shipped code: it normalizes the token vocabulary and encodes design decisions (for example, mint-led parent mode) that the current app has not yet adopted. Treat every value here as the *intended* state, and check it against the code before implementing.

Verified on 2026-07-02 against `src/App.css` and `src/styles/tokens.css`.

### Already implemented (design == code)

| Concept | Token | Value | Location |
|---|---|---|---|
| Spacing scale | `--space-1` … `--space-12` | 4/8/12/16/20/24/32/40/48px | `src/styles/tokens.css:194-202` |
| Font family | `--font-sans` | `"Pretendard Variable", "Pretendard", sans-serif` | `src/styles/tokens.css:205` |
| Radius core | `--radius-xs/sm/md/lg/xl/full` | 8/12/16/22/28/9999px | `src/styles/tokens.css:178-185` |
| Radius aliases | `--radius-control`(16) `--radius-card`(22) `--radius-pill` | via core | `src/styles/tokens.css:187-191` |
| Theme accent | `--theme-accent` | `#F779A8` (rose base) | `src/App.css:48` |
| Theme accent soft | `--theme-accent-soft` | `#FFF5FA` | `src/App.css:50` |
| Theme accent line/text | `--theme-accent-line` / `--theme-accent-text` | `rgba(255,255,255,0.5)` / `#B0477A` | `src/App.css:51-52` |

### Target ahead of code (design != code — do NOT assume these values are live)

| Concept | Design target (this folder) | Current code | Location |
|---|---|---|---|
| Parent role color | Mint (`--hyeni-mint` family) | **Blue** `--hyeni-parent: #3b82f6` | `src/App.css:19` |
| Accent pressed | `--theme-accent-deep: #D94F7F` | `#E65C92` | `src/App.css:49` |
| Primary ink | `--hyeni-ink: #171719` | `#38252d` | `src/App.css:22` |
| Muted text | `--hyeni-muted: rgba(46,47,51,0.88)` | `#9b7c85` | `src/App.css:23` |
| Cream | `--hyeni-cream: #FFF7E8` | `#fff8f2` | `src/App.css:18` |
| Panel radius | `--radius-panel: 28px` | not defined (use `--radius-xl: 28px`) | `src/styles/tokens.css:182` |
| Hero radius | `--radius-hero: 34px` | not defined | — |
| Named brand scales | `--hyeni-rose/mint/lavender-*`, `--hyeni-danger-*` | **not defined** — roles are expressed via `--theme-accent*` (rose), `--hyeni-parent*` (blue), `--hyeni-success` (green `#059669`), and category colors `--hyeni-cat-*` | `src/App.css:19-36,48-52` |

### How to use this during redesign

1. For spacing, radius core, and font: use the tokens as-is — they already match the code.
2. For the color palette: the target vocabulary (`--hyeni-rose/mint/lavender` scales, mint-led parent) is **not yet in the code**. Adopting it is a deliberate migration step, not a drop-in. Do not hard-code these hexes into components (AGENTS.md의 디자인 토큰 규칙) — introduce them into `src/App.css` / `src/styles/tokens.css` first, then reference via `var(--*)`.
3. When code and this folder disagree, that gap is a redesign TODO, not a bug in either file. Resolve it explicitly with the owner before changing values.

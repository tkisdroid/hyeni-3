# Hyeni Calendar Asset2

This folder is a separated local asset library for redesign work. It copies source assets from the current repository without changing runtime app code.

## Contents

- `00-manifest/` - generated inventory with original path, copied path, file size, extension, and SHA-256 hash.
- `01-runtime-3d/` - current app 3D assets from `src/assets/3d`.
- `02-runtime-brand/` - current brand fallback assets from `src/assets`.
- `03-hyeni-character/` - Hyeni character images split into main, widget, and profile groups.
- `04-stickers/` - praise, decorative, mood, schedule, family, and movement sticker assets.
- `05-icons/` - category, place, location, notification, emergency, and system icon assets.
- `06-backgrounds/` - background/environment elements.
- `07-illustrations/` - splash and empty-state illustrations.
- `08-source-sheets/` - raw Stitch/ChatGPT source sheets and extracted raw elements.
- `09-fonts/` - local font files used by the app.
- `10-platform/` - web public icons and Android launcher/splash/raw resources.
- `11-store-listing/` - Play Console/store listing assets.
- `12-design-references/` - existing design previews and screenshots.
- `13-audio/` - notification sound assets.
- `14-brand-system/` - redesign brand structure, tokens, and asset rules.

## Inventory

Generated from the current repo on 2026-07-02.

- Copied asset files: 687
- Copied bytes: 189,539,367
- Manifest files: `00-manifest/assets-manifest.json`, `00-manifest/assets-manifest.csv`, `00-manifest/assets-summary.json`

Sensitive configuration JSON files are intentionally excluded. This folder contains media, font, platform visual resources, and audio assets only.

## Design System

Start here:

- `14-brand-system/DESIGN_SYSTEM.md` - master design system.
- `14-brand-system/style-board.html` - local visual board that can be opened in a browser.
- `14-brand-system/design-tokens.css` and `14-brand-system/design-tokens.json` - token drafts.
- `14-brand-system/component-specs.md` - component-level rules.
- `14-brand-system/screen-patterns.md` - parent/child/subscription/auth screen rules.
- `14-brand-system/figma-structure.md` - Figma setup structure.

## Redesign Rule

Use `14-brand-system/brand-structure.md` as the visual source of truth before replacing or adding assets. Use `00-manifest/assets-manifest.json` when tracing a copied file back to its original repo path.

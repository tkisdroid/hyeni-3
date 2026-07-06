# 14 · Brand System

Consolidated, referenceable design system for Hyeni Calendar. Start here, then open the file you need.

**Entry point:** [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) — the index/source-of-truth: purpose, principles, foundations (color/type/layout/motion), core components, asset anchors, implementation mapping, and the **Implementation Status** drift table.

> ⚠️ **This is a redesign target, not a mirror of the shipped app.** Spacing, radius core, and font already match the code; the color palette (named `--hyeni-rose/mint/lavender` scales, mint-led parent mode) is the *intended* state and is not all in the code yet. Always check `DESIGN_SYSTEM.md → Implementation Status` before implementing a value.

## Files

| File | Role |
|---|---|
| `DESIGN_SYSTEM.md` | Main index + foundations + Implementation Status (current-vs-target token drift) |
| `brand-structure.md` | Brand thesis, product roles, foundations, asset system, non-negotiables |
| `component-specs.md` | Buttons, sheets, toasts, status cards, menu tiles, stickers, subscription |
| `screen-patterns.md` | Parent/child/auth/location/subscription per-screen rules |
| `asset-usage-rules.md` | Asset selection, sizing, and replacement checklist |
| `design-tokens.css` | CSS token draft (redesign target values — see drift table before use) |
| `design-tokens.json` | Portable token source for Figma / design tooling |
| `figma-structure.md` | Recommended Figma page/component/style structure |
| `brand-structure.mmd` | Mermaid source for the brand architecture diagram |
| `style-board.html` | Local visual board built from copied assets |
| `style-board-preview.png` | Rendered preview of the style board |

## How to reference

- **In code / Claude Code sessions:** `CLAUDE.md → Project context` points here. For any brand, color, token, or component-spec question, read `DESIGN_SYSTEM.md` first.
- **Assets:** paths in `DESIGN_SYSTEM.md → Asset Anchors` are relative to this folder (e.g. `../01-runtime-3d/`, `../05-icons/`).
- **Live tokens:** the shipped values live in `src/App.css` (`:root`) and `src/styles/tokens.css`. This folder is the design intent; those files are ground truth for what is currently rendered.

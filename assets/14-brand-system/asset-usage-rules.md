# Asset Usage Rules

## General

- Keep the original transparent WebP/PNG/SVG files as source assets.
- Prefer WebP for runtime images unless SVG is needed for crisp vector controls.
- Meaningful images need accessible labels. Decorative character images should use empty alt text only when nearby text already explains the state.
- Do not use raw emoji as structural icons in redesigned UI. Use `ThreeDIcon`, Lucide, or a curated asset.

## Hyeni Character

- Main child-facing Hyeni art can be large: 96-160px on phone hero areas.
- Parent-facing Hyeni art should support, not dominate: 40-72px in headers, cards, and empty states.
- Avoid showing multiple Hyeni mascots in the same first viewport unless one is clearly background/decorative.
- State-specific Hyeni art should match the actual state: safe, late, busy, danger, celebrate, sad, love.

## Stickers

- Praise sticker images must have a white sticker-like outline, subtle paper shadow, and visible scale.
- Sticker attach feedback should use a short pop/press motion around 220-320ms.
- Use large sticker art in child mode and sticker books. Avoid small emoji-style rendering for praise moments.

## Safety And Location

- Emergency visuals use red only for SOS, danger, destructive, or critical alert states.
- Location and safety OK states should lean mint.
- Unstable location, pairing lost, or child offline states should use a friendly toast/sheet with one clear recovery action.

## Subscription

- Subscription assets should support the decision, not decorate the page.
- Pricing must use tabular figures or stable layout so Android font scaling cannot clip amounts.
- Annual discount and launch discount should be visually prominent but not alarmist.

## Asset Replacement Checklist

- Preserve source path in `00-manifest/assets-manifest.json` or add a new manifest entry.
- Check the asset at small and large phone sizes.
- Verify transparent edges and white sticker borders.
- Confirm light/dark and theme color behavior.
- Confirm no menu/function was removed while replacing visuals.

# Component Specs

## Buttons

### Primary Button

- Height: 56px
- Radius: pill
- Font: Pretendard 700, 16px
- Icon: optional 22-24px 3D or Lucide
- Gap: 8px between icon and label
- Press: scale `0.97`, 120ms
- Disabled: muted surface, no shadow, no tap action

Use for one main action: subscribe, start listening, send, save, pair.

### Secondary Button

- Height: 48px
- Radius: 16px or pill
- Border: `--line-default`
- Background: white
- Font: 650, 14-15px

Use for cancel, edit, later, view detail.

### Icon Button

- Visual icon: 24px
- Hit area: 44x44px minimum
- Radius: 9999px
- Label: `aria-label` required

Use for close, back, refresh, settings, calendar navigation.

## Bottom Sheets

### Standard Temporary Sheet

- Width: full with 16-20px side inset visual rhythm
- Height: content or 52dvh
- Radius: 28px top corners
- Grabber: 40x5px visual, 44px touch height
- Dismiss: drag down, backdrop tap, close button when needed

Use for contacts, AI credit purchase, feedback, quick choices, short settings.

### Full Task Sheet

- Height: up to `calc(100dvh - safe-area-top - 8px)`
- Scroll body only
- Fixed title area and bottom CTA if required

Use for place management, subscription, AI schedule registration, long forms.

## Toasts

### Informational Toast

- Position: bottom above tab/navigation
- Duration: 3-4s
- Height: content, min 48px
- Icon: 24-32px
- Text: one line preferred, two lines max
- Motion: enter from bottom, 220ms

Use for short explanations like friend-play matching notice, child offline, location unstable.

## Status Cards

- Layout: icon/asset 40-56px + text column + optional action
- Text: title one line, helper one short sentence
- Border: tokenized semantic line
- Background: semantic tint
- No long paragraphs

## Menu Tiles

- Icon: 44-56px 3D asset
- Title: 15-16px, 700
- Caption: 12-13px max one line
- Min height: 72-84px
- Gap from section title: 16px minimum
- All original menu items must remain present.

## Sticker Cards

- Sticker art: 72-112px depending on surface
- Border: white 5-8px sticker outline
- Shadow: soft paper shadow
- Motion: attach/pop 320ms on placement
- Copy: title only, optional short caption

## Subscription Plan Button

- Height: 88-112px
- Radius: 24px
- Price size: 26-34px, tabular figures
- Label: `프리미엄 월구독`, `프리미엄 연구독`
- CTA: plan block itself starts purchase; optional `구독하기` text can sit inside the block
- No small helper lines that create clutter.
- Launch discount and future price increase notice must be visible.

## Empty And Blocked States

- Use one relevant 3D image at 72-120px.
- Title: one friendly line.
- Helper: one concise recovery sentence.
- Action: one primary recovery button if user can act.
- Do not leave silent no-op states.

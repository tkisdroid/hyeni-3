# Hyeni Calendar Brand Structure

## Visual Thesis

Hyeni Calendar should feel like a calm safety app for parents and a warm character-led companion for children: soft 3D, clear trust cues, low text density, and friendly micro interactions.

## Product Roles

| Role | Primary user | Feeling | Visual priority |
|---|---|---|---|
| Parent mode | Guardian | Trust, clarity, control | Dense but calm information, location and alert clarity, restrained 3D icons |
| Child mode | Child | Friendly, safe, easy | Large character imagery, simple words, obvious actions |
| Shared family layer | Parent and child | Matched, connected | Same theme color, paired-only communication, consistent feedback |
| Premium layer | Paying parent | Easy upgrade | Clear value, large plan buttons, no cramped pricing |

## Brand Foundations

### Color

Hyeni already uses a theme-driven system. Redesigns must keep feature UI bound to semantic tokens instead of hard-coded pink.

| Token | Hex | Use |
|---|---:|---|
| `--hyeni-rose` | `#F779A8` | Child warmth, praise, emotional CTAs |
| `--hyeni-rose-deep` | `#D94F7F` | Rose pressed/strong text |
| `--hyeni-mint` | `#31C48D` | Parent trust, safety, location OK |
| `--hyeni-mint-deep` | `#15936B` | Parent primary action text/strong state |
| `--hyeni-lavender` | `#A78BFA` | AI, friend play, soft secondary moments |
| `--hyeni-cream` | `#FFF7E8` | Warm background accents only |
| `--hyeni-bg` | `#FBFAF6` | App page base |
| `--hyeni-surface` | `#FFFFFF` | Sheet/card/control surface |
| `--hyeni-ink` | `#171719` | Primary text |
| `--hyeni-muted` | `rgba(46, 47, 51, 0.88)` | Secondary text |
| `--hyeni-danger` | `#E03030` | SOS and destructive actions only |

Theme colors must flow through `--theme-accent`, `--theme-accent-deep`, `--theme-accent-soft`, `--theme-accent-line`, and `--theme-accent-text` so parent and child paired views stay visually matched.

### Typography

Use one family:

- Display: `Pretendard Variable`
- Body: `Pretendard Variable`
- Mono: `ui-monospace`, `SFMono-Regular`

Avoid adding a second decorative font. Character and 3D assets should carry warmth; the type system should stay readable and stable on Android WebView.

### Spacing

Use a 4px grid:

| Token | Value | Use |
|---|---:|---|
| `space-1` | `4px` | Micro gaps |
| `space-2` | `8px` | Icon/text gap |
| `space-3` | `12px` | Compact row gap |
| `space-4` | `16px` | Control padding |
| `space-5` | `20px` | Page horizontal inset |
| `space-6` | `24px` | Section gap |
| `space-8` | `32px` | Hero/major section gap |

Buttons or copy must never touch a section title. Default title-to-action spacing is at least `16px`, and section-to-section spacing is at least `24px`.

### Radius And Elevation

| Token | Value | Use |
|---|---:|---|
| `radius-control` | `16px` | Buttons, inputs |
| `radius-card` | `22px` | Repeated feature items |
| `radius-panel` | `28px` | Bottom sheets and major panels |
| `radius-pill` | `9999px` | Chips and capsule controls |

Use thin borders and soft shadows. Do not nest cards inside cards. Sheets and temporary menus should feel like the same component family.

### Motion

| Token | Value | Use |
|---|---:|---|
| `motion-fast` | `120ms` | Press feedback |
| `motion-base` | `180ms` | Button/control state |
| `motion-enter` | `260ms` | Sheet/toast entrance |
| `motion-sticker` | `320ms` | Sticker attach/pop |
| `ease-standard` | `cubic-bezier(0.2, 0, 0.2, 1)` | Default |
| `ease-pop` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Character/sticker moments |

Motion must explain state: send, receive, attach sticker, open sheet, dismiss toast. Decorative looping motion is limited to character-led child moments and must respect reduced motion.

## Asset System

| Asset group | Folder | Redesign rule |
|---|---|---|
| Hyeni character | `03-hyeni-character/` and `01-runtime-3d/mascot/` | Use as the emotional anchor. Child screens can use larger character art; parent screens should use smaller supportive art. |
| AI friend animals | `01-runtime-3d/animal/` | Always render the child-selected character, not text fallbacks. |
| Praise stickers | `01-runtime-3d/sticker/` and `04-stickers/` | Add a white sticker border and visible paper depth. Sticker art must appear large enough to inspect. |
| Safety/location icons | `05-icons/location/`, `05-icons/place/`, `05-icons/emergency/` | Keep trust-oriented, not cute at the expense of clarity. SOS red is reserved for emergency. |
| Feature/menu icons | `01-runtime-3d/ui/` | Keep all existing menus. Redesign presentation, not feature availability. |
| Background elements | `06-backgrounds/` | Use sparingly. Never compete with safety data, maps, or CTAs. |

## Screen Structure

### Parent Home

- Top: paired child identity, status, theme continuity.
- Middle: today schedule, child location, alert state.
- Actions: all shortcut menus remain available.
- Feedback: transient bottom toast for short explanations instead of long static text.

### Child Home

- Top: large selected character and friendly single action.
- Middle: schedule, chat, stickers.
- Actions: fewer words, bigger images, obvious tappable areas.
- Feedback: short, warm copy with micro interactions.

### Bottom Sheets

- Use consistent side inset.
- Use a drag handle.
- Temporary menus open to mid-height unless the task needs full-screen focus.
- Keep title-to-body and title-to-button spacing consistent.

### Subscription

- Treat as a decision screen, not a settings list.
- Show launch discount clearly.
- Make monthly and yearly subscription buttons large and direct.
- Do not let prices clip at Android font scaling.

## Figma Or Design File Structure

```text
Hyeni Calendar Redesign
  01 Foundations
    Colors
    Typography
    Spacing
    Radius
    Shadow
    Motion
  02 Assets
    Hyeni Character
    AI Friend Animals
    Praise Stickers
    Safety And Location
    Menu Icons
    Background Elements
  03 Components
    Buttons
    Bottom Sheets
    Toasts
    Navigation
    Status Cards
    Subscription Plans
  04 Screens Parent
    Home
    Location
    Chat
    Places
    Ambient Audio
    Subscription
  05 Screens Child
    Home
    AI Friend Chat
    Stickers
    SOS
    Settings
  06 QA
    Small Android Phone
    Large Android Phone
    Font Scaling
    Light And Dark Theme
```

## Non-Negotiables

- Paired parent and child must share theme color.
- Notification, chat, location, credits, and child information must be scoped to the paired family/child only.
- Menu/function availability must not be removed for visual cleanup.
- Avoid long explanatory text. Prefer image-led hierarchy, concise copy, toasts, and micro interactions.
- Structural icons should be assets or Lucide icons, not raw emoji.

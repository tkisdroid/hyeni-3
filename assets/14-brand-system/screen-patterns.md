# Screen Patterns

## Parent Mode Home

### Structure

1. Paired child selector/status
2. Today schedule and location summary
3. Shortcut menu grid with all existing actions
4. Alerts and recent activity

### Visual Rules

- Parent mode can be denser than child mode, but each row must remain scannable.
- Safety/location cards use mint when OK, danger only for SOS/critical.
- Menu icons use consistent 3D size.
- Do not hide shortcut actions to make the page look cleaner.

## Child Mode Home

### Structure

1. Large selected AI friend/child character
2. Today schedule and friendly next action
3. Parent chat entry
4. Stickers and child-safe actions

### Visual Rules

- Character is the primary visual anchor.
- Text must be friendly and short.
- Sticker art should be large and tactile.
- If paired/login state is missing, show a designed recovery state.

## Chat And "Today's Memo"

- Parent mode should guide to `아이와 대화하기`.
- Child mode should guide to `부모님에게 이야기하기`.
- Avoid memo copy that overlaps with homework/preparation.
- Chat entry should feel direct and paired-only.

## Ambient Audio

- If child device is offline, unpaired, or logged out, show a designed blocked state.
- Avoid duplicated notices.
- Use `아이에게 알림이 가요` once only.
- Put time explanation near the bottom action: `1분동안 아이의 주변소리를 들을 수 있어요`.

## Friend Play

- Main copy: `친구랑 놀고 싶어할 때 아이가 요청할 수 있어요`.
- Parent-wide matching notice should appear as a short bottom toast.
- Avoid technical terms like location-based in user-facing copy.
- Remove unnecessary buttons, but do not remove actual feature access.

## Place Management

- Sheet behavior should match other menus: not blindly full-top unless the task requires it.
- Prefer clear place cards and action buttons over static explanatory text.
- Long-stay route summary should group by place, not raw GPS jumps.

## Subscription

- Section spacing should be tight and deliberate.
- Monthly and yearly plan buttons should be large.
- Launch discount must be clear.
- Include future price notice: monthly price will rise to 4,900 KRW.
- Remove unnecessary child selector when subscription is for the selected child.

## Authentication And Pairing

- New signup, existing login, device restore, and alternate login merge must all preserve account/family matching.
- Role state must restore from current device session when valid.
- When token/session is invalid, show a recovery path instead of silent failure.

## Settings

- Use consistent rows with 44px+ touch targets.
- Short labels first, helper copy only when needed.
- Destructive actions are visually separated and use danger styling.

# 컴포넌트 명세 / Component Spec — 혜니캘린더

> 값은 실제 웹/PWA 런타임 정본인 `src/styles/tokens.css`의 CSS custom property로 표기합니다.
> 먼저 이 8종 기본 컴포넌트를 만들고, 화면은 그 위에 조립하세요.

공통 규칙 / Global rules
- **탭 피드백:** 눌림 시 `transform: scale(var(--press-scale))`, `--duration-fast`, `--easing-standard`.
- **최소 터치 44×44.** 아이콘 버튼도 히트영역 44 확보.
- **카드 언어 통일:** 기본 카드는 `--bg-card` + `--radius-16` + `border 1px --line-card`이며 그림자를 쓰지 않습니다. hero·modal만 `--radius-20`, sheet만 `--radius-24`를 씁니다.
- 색은 역할대로(로즈=기본/부모·아이, 민트=안전/선생님, 라벤더=AI, 골드=보상, danger=위험).

---

## 1. Button
| 변형 / Variant | 배경 | 텍스트 | 높이 | radius | 그림자 |
|---|---|---|---|---|---|
| Primary (rose) | rose gradient | 배경과 4.5:1 검증된 전경, `--type-body-lg` | 48–52 | `--radius-16` | 핵심 CTA만 rose shadow |
| Primary (mint) | mint gradient | 배경과 4.5:1 검증된 전경 | 48–52 | `--radius-16` | 핵심 CTA만 mint shadow |
| Primary (AI) | lavender gradient | 배경과 4.5:1 검증된 전경 | 48–52 | `--radius-16` | 핵심 CTA만 lavender shadow |
| Secondary | `--bg-card` + border `--line-strong` | `--fg-secondary` | 44–48 | `--radius-12` | none |
| Tint chip-button | `--rose-soft` | `--rose-text` | 44 이상 hit area | pill | none |
| Icon-circle | `--bg-card` | glyph 20, `--fg-secondary` | 44×44 | pill | `--shadow-soft` |

상태 / States: default · press(scale .96) · disabled(`--disabled-opacity`, `cursor: not-allowed`) · busy(`aria-busy="true"`, `--busy-opacity`, 진행 라벨, `cursor: progress`). 아이콘+라벨은 `--spacing-8`.

## 2. 부모 헤더 스티커 액션 / Parent header sticker action
- 부모 헤더에서 아이에게 스티커를 보내는 명시적 액션입니다. 아이콘과 `스티커` 라벨을 함께 사용하고 전체 hit area를 44px 이상 확보합니다.
- 탭하면 스티커 선택·전송 화면을 열며 press `scale .96`을 사용합니다.

## 3. Card
- **Base:** `radius-16`, border, 무그림자. padding `spacing-16` 또는 `spacing-20`.
- **Hero (gradient):** `radius-20` + 역할 gradient + 필요한 경우에만 컬러 shadow + 우하단 마스코트(`hy-float` 애니메이션). 텍스트는 대비가 검증된 `on-solid`, `type-title-xl`.
- **Stat/metric:** 2×2 그리드, 각 셀 = 틴트 아이콘 타일(44, `radius-12`) + 라벨(`type-caption`, `fg-muted`) + 값(`type-title`/tabular-nums).

## 4. SectionHeader
- 구성: 틴트 아이콘 타일(32, `radius-12`) + 제목(`type-title`, `fg-primary`) + (선택) 우측 메타 칩 또는 "전체보기 ›" 링크(`rose-text`, `type-label`).
- 섹션마다 이 한 패턴만. 아이콘 타일 배경 = 섹션 성격색의 soft.

## 5. ListRow (일정/현황 행)
- 좌: 카테고리 3D 아이콘 타일(48, `radius-16`, 카테고리 soft색). 중: 제목(`type-body`) + 서브(`type-caption`, `fg-muted`). 우: 상태 태그(§7) 또는 chevron.
- press 시 배경 `--bg-press`. 행 높이 ≥ 60.

## 6. Avatar
- 크기: 26(칩) · 44(행) · 46(팩) · 60(현황). radius = 크기의 ~0.3 (rounded square), 배경 = 아이 soft색, 3D 동물/가족 이미지.
- **라이브 점:** 우하단 `--mint-500` 원 + 2.5px 흰 테두리(실시간 위치 표시).

## 7. Chip / Tag
| 종류 | 배경 | 텍스트 |
|---|---|---|
| 안전/참석 | `--mint-soft` | `--mint-text` |
| 임박/기본 | `--rose-soft` | `--rose-text` |
| AI/숙제 | `--lav-soft` | `--lav-text` |
| 보상 | `--cream-soft` | `--gold-text` |
| 위험 | `--danger-soft` | `--danger-text` |
- 시각 높이 24–28이더라도 interactive hit area는 44 이상, `radius-pill`, 최소 `type-caption`. 상태색은 **색+텍스트** 동반(색맹 대응). 실시간 뱃지는 앞에 맥동 점(`hy-soft`).

## 8. Checklist item (준비물·숙제) — 편집 가능 / editable
- 행: 체크박스(26, `radius-8` — 완료 시 `mint` gradient+흰 체크) + 라벨. 숙제는 `lavender` "숙제" 태그.
- **편집 모드:** 헤더 "편집" 토글 → 라벨이 인풋(`--bg-press`)으로, 우측 삭제(×, `--danger-soft`), 하단 "+ 준비물 / + 숙제" 추가 버튼(점선 보더). 개수 `n/총계`는 실시간.
- RN: 항목 배열 상태 + FlatList. IME 안정 위해 비제어 입력(onEndEditing로 커밋) 권장.

## 9. SegmentedControl
- 용도: AI 입력 방식(음성·텍스트·알림장), 느낌 트윅. 트랙 `lavender-soft`(8% 틴트), 선택 칩 `bg-card` + `shadow-soft` + `lavender-text`, 비선택 `fg-muted`.
- 2–3개 짧은 라벨. 그 이상은 드롭다운.

## 10. Switch / Toggle
- 48×28 트랙, 24 노브(흰, `shadow-soft`). on=`mint-500`, off=`line-strong`. 전환 `duration-base`. 자동충전·알림 설정 등.

## 11. TabBar
- 플로팅 흰 바(`radius-20`, `shadow-floating`), 상단 그라데이션 페이드. 아이템 = 아이콘(22) + 라벨(`type-caption`). 활성 = 아이콘 틴트 타일 + 강조색, 비활성 `fg-muted`. 배지 점(danger).

## 12. BottomSheet / Modal / Toast
- **Sheet:** 상단 그래버(40×5, `--line-strong`), `--radius-24` 상단만, `--shadow-floating`, 백드롭 `scrim`. 등장 `hy-sheetup` `--easing-standard`.
- **Modal(통화 등):** `radius-20`, `shadow-modal` 중앙 카드, 백드롭 딤.
- **Toast:** 하단 중앙 알약, 아이콘+문구, `hy-toast` 등장 후 자동 소멸(~2s). 예: "일정을 추가했어요 ✅".

## 13. Input / Textarea
- 배경 `--bg-press` 또는 `--bg-card`+border `--line-soft`, `--radius-12`, 높이 48(인풋)·120+(텍스트영역), `--type-body-sm`. placeholder는 AA 대비의 `--fg-placeholder`. 포커스 시 전역 focus ring과 border 강조를 함께 사용합니다.

## 14. Splash (오프라인 빌드용)
- 풀스크린 rose 브랜드 배경 + 흰 폰+하트 SVG. 로드 후 페이드아웃(.45s) 뒤 제거. (스탠드얼론 HTML 한정)

---

## 카테고리 아이콘 세트 / Category icons
학교·태권도·미술·음악·수영·축구·공부·취미·친구·가족 등 전용 3D webp. 각 카테고리에 soft 배경색 매핑(`_catMap` 참고). RN에선 @1x~@3x 래스터 또는 동등 SVG로 대체.

## 애니메이션 / Animations (keyframes)
`hy-float`(마스코트 부유) · `hy-bob`(상하) · `hy-ring`(맥동 링) · `hy-rise/fadein`(화면 등장) · `hy-sparkle`(반짝) · `hy-wave`(음성 바) · `hy-sheetup`(시트). 전부 `prefers-reduced-motion`/`data-motion="calm"`에서 정지.

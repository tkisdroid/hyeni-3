# 혜니캘린더 — 제품 디자인 시스템 / Product Design System

> 현재 혜니캘린더 웹/PWA와 Capacitor Android 래퍼가 공유하는 디자인 원칙·컴포넌트 계약입니다.

**대상 / Audience:** 개발자 · 디자이너 · 기획(PM)  ·  **현재 스택 / Stack:** Vite · React · TypeScript · CSS custom properties · Capacitor
**언어 / Language:** 한국어 중심  ·  **런타임 정본 / Source of truth:** `src/styles/tokens.css`

---

## 📦 패키지 구성 / Contents

```
design-system/
├─ index.html                     # 디자인 시스템 참조 페이지 (브라우저로 열기)
│                                 # Living style guide — open in a browser
├─ tokens/
│  ├─ tokens.css                  # 과거 핸드오프 참조
│  ├─ tokens.json                 # 플랫폼 무관 참조
│  └─ theme.ts                    # 과거 React Native 핸드오프 참조
├─ brand/
│  └─ BRAND.md                    # 브랜드명·마스코트·톤·로고·색 의미
└─ spec/
   ├─ INFORMATION-ARCHITECTURE.md # 화면·네비게이션·모드·기능 전체 명세
   └─ COMPONENTS.md               # 버튼·카드·칩·시트 등 컴포넌트 스펙
```

실제 제품 코드는 루트의 `src/styles/tokens.css`, `global.css`, `components.css`를 사용합니다. `design-system/tokens/`는 과거 플랫폼 핸드오프와 비교를 위한 참조이며 런타임 정본이 아닙니다.

---

## 🚀 시작하기 / Getting started

1. **폰트 / Fonts** — 번들된 `PretendardVariable.woff2`를 사용하고 시스템 한글 폰트를 fallback으로 유지합니다.
2. **토큰 / Tokens** — `src/styles/tokens.css`의 의미 토큰을 사용합니다. 기존 `--text-*`, `--space-*`, `--radius-*` 이름은 화면별 이행 동안만 호환 alias로 유지합니다.
3. **컴포넌트 / Components** — `spec/COMPONENTS.md`의 공통 Button, Card, Chip, Sheet, ListRow, SectionHeader, TabBar 계약 위에 화면을 조립합니다.
4. **화면·플로우 / Screens** — `spec/INFORMATION-ARCHITECTURE.md`의 화면 목록·내비게이션·역할 경계를 따릅니다.

```css
.feature-card {
  padding: var(--spacing-16);
  border: 1px solid var(--line-card);
  border-radius: var(--radius-16);
  background: var(--bg-card);
}
```

## 🔢 정본 토큰 척도 / Canonical scales

| 역할 | 정본 값 |
|---|---|
| Type size | 32 / 24 / 20 / 18 / 16 / 15 / 14 / 13 / 12 |
| Spacing | 2 / 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 |
| Radius | 8 / 12 / 16 / 20 / 24 / pill |
| Shadow | soft / floating / modal |
| Icon glyph | 16 / 18 / 20 / 22 / 24 |

타이포는 각 `--type-*` 크기와 같은 이름의 `-line-height`, `-weight`를 항상 함께 사용합니다. 버튼 hit area는 glyph 크기와 무관하게 최소 44×44px입니다.

---

## 🎨 디자인 원칙 / Design principles

1. **따뜻하고 안전하게 / Warm & safe** — 차가운 회색·순수 블랙 대신 웜 잉크(`#201A1D`)와 로즈·민트·라벤더 파스텔. 부모에겐 신뢰, 아이에겐 다정함.
2. **절제된 카드 언어 / Restrained cards** — 기본 카드는 `radius 16 · border 1px · no shadow`, hero·modal은 radius 20, sheet만 radius 24입니다.
3. **역할별 강조색 / Accent by role** — 부모·아이=로즈, 선생님=민트, AI=라벤더. 나머지는 중립.
4. **검증된 아이콘 언어 / Verified icon language** — 기능·hero에는 검증된 3D WebP 자산을 사용하고, 텍스트 행·utility에는 Lucide를 사용합니다.
5. **큰 터치 타깃 / Big targets** — 최소 44px. 아이·긴급 상황에서도 누르기 쉽게.
6. **부드러운 모션 / Gentle motion** — 스프링(`cheer`) 등장, 눌림 `scale .96`. 항상 `prefers-reduced-motion` 존중.

## 🎚 제품 레벨 "느낌" 모드 / Product feel modes
제품의 느낌 설정은 루트 data-속성 또는 Context 기반 테마 플래그로 관리합니다.
- **깊이감 / Depth** — `soft`(그림자 있는 3D) ↔ `flat`(그림자 제거)
- **색감 / Vibe** — `pastel` · `base` · `pop`(채도)
- **모션 / Motion** — `lively` ↔ `calm`(애니메이션 on/off, 접근성)

---

## ✅ 핸드오프 체크리스트 / Handoff checklist
- [ ] Pretendard Variable 번들 + 폴백 확인
- [ ] `src/styles/tokens.css` 의미 토큰으로 단일화
- [ ] 공통 컴포넌트 8종 구현 (COMPONENTS.md)
- [ ] 3D 아이콘/마스코트 에셋 파이프라인 (webp, @1x~@3x 또는 SVG 대체)
- [ ] 3개 역할(부모·아이·선생님) 셸 + 하단 탭
- [ ] 접근성: 44px 타깃 · reduced-motion · 명도대비 AA
- [ ] 딥링크/푸시(도착·위험·SOS·스티커·놀이요청·피드백)

자세한 값·근거는 각 문서를 참고하세요. / See each doc for exact values & rationale.

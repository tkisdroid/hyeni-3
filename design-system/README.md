# 혜니캘린더 — 앱 제작 패키지 / Build Package

> 이 프로토타입(`혜니캘린더 리디자인.dc.html`)을 실제 앱으로 만들기 위한 디자인 시스템 · 브랜드 · 명세 · 핸드오프 문서 묶음입니다.
> Everything an engineer/designer needs to build the real app from the redesign prototype.

**대상 / Audience:** 개발자 · 디자이너 · 기획(PM)  ·  **스택 가정 / Stack:** React Native (모바일 앱)
**언어 / Language:** 한국어 · English (bilingual)  ·  **기준 / Source of truth:** 「혜니캘린더 리디자인」 프로토타입

---

## 📦 패키지 구성 / Contents

```
design-system/
├─ index.html                     # 디자인 시스템 참조 페이지 (브라우저로 열기)
│                                 # Living style guide — open in a browser
├─ tokens/
│  ├─ tokens.css                  # CSS custom properties (웹/웹뷰)
│  ├─ tokens.json                 # 플랫폼 무관 토큰 (Style Dictionary / Tokens Studio)
│  └─ theme.ts                    # React Native 테마 객체 (그대로 import)
├─ brand/
│  └─ BRAND.md                    # 브랜드명·마스코트·톤·로고·색 의미
└─ spec/
   ├─ INFORMATION-ARCHITECTURE.md # 화면·네비게이션·모드·기능 전체 명세
   └─ COMPONENTS.md               # 버튼·카드·칩·시트 등 컴포넌트 스펙
```

원본 프로토타입 / Source prototype: `혜니캘린더 리디자인.dc.html`
오프라인 데모 / Offline demo: `혜니캘린더 리디자인 (오프라인).html`

---

## 🚀 시작하기 / Getting started (React Native)

1. **폰트 / Fonts** — `PretendardVariable.ttf`(또는 `.otf`)를 번들하고 패밀리명을 `"Pretendard Variable"`로 등록합니다. (expo-font 또는 `react-native.config.js`) 미설치 시 시스템 한글 폰트로 폴백됩니다.
2. **토큰 / Tokens** — `tokens/theme.ts`를 `@/theme`로 임포트해 색·타이포·라운드·그림자·간격을 참조합니다. 하드코딩 금지 — 항상 토큰을 쓰세요.
3. **컴포넌트 / Components** — `spec/COMPONENTS.md`의 스펙대로 기본 컴포넌트(Button, Card, Chip, Sheet, ListRow, SectionHeader, TabBar)를 먼저 만드세요. 화면은 그 위에 조립합니다.
4. **화면·플로우 / Screens** — `spec/INFORMATION-ARCHITECTURE.md`의 화면 목록·네비게이션·모드 전환을 따릅니다.

```ts
import { theme } from "@/theme";

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.bg.card,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.color.line.hair,
    padding: theme.space.s4,
    ...theme.shadow.card,
  },
});
```

---

## 🎨 디자인 원칙 / Design principles

1. **따뜻하고 안전하게 / Warm & safe** — 차가운 회색·순수 블랙 대신 웜 잉크(`#201A1D`)와 로즈·민트·라벤더 파스텔. 부모에겐 신뢰, 아이에겐 다정함.
2. **하나의 카드 언어 / One card language** — 모든 카드는 동일한 값: `radius 24 · border 1px hairline · shadow-card`. 화면마다 제각각 금지.
3. **역할별 강조색 / Accent by role** — 부모·아이=로즈, 선생님=민트, AI=라벤더. 나머지는 중립.
4. **3D 캐릭터·아이콘 / 3D imagery** — 플랫 라인 아이콘이 아니라 부드러운 3D 마스코트/아이콘(webp). 감정과 온기를 담당.
5. **큰 터치 타깃 / Big targets** — 최소 44px. 아이·긴급 상황에서도 누르기 쉽게.
6. **부드러운 모션 / Gentle motion** — 스프링(`cheer`) 등장, 눌림 `scale .96`. 항상 `prefers-reduced-motion` 존중.

## 🎚 제품 레벨 "느낌" 모드 / Product feel modes
프로토타입의 Tweaks가 그대로 앱 설정/테마 플래그가 됩니다 (루트에 data-속성 또는 Context):
- **깊이감 / Depth** — `soft`(그림자 있는 3D) ↔ `flat`(그림자 제거)
- **색감 / Vibe** — `pastel` · `base` · `pop`(채도)
- **모션 / Motion** — `lively` ↔ `calm`(애니메이션 on/off, 접근성)

---

## ✅ 핸드오프 체크리스트 / Handoff checklist
- [ ] Pretendard Variable 번들 + 폴백 확인
- [ ] `theme.ts`로 토큰 단일화 (매직 넘버 0개)
- [ ] 공통 컴포넌트 8종 구현 (COMPONENTS.md)
- [ ] 3D 아이콘/마스코트 에셋 파이프라인 (webp, @1x~@3x 또는 SVG 대체)
- [ ] 3개 역할(부모·아이·선생님) 셸 + 하단 탭
- [ ] 접근성: 44px 타깃 · reduced-motion · 명도대비 AA
- [ ] 딥링크/푸시(도착·위험·SOS·스티커·놀이요청·피드백)

자세한 값·근거는 각 문서를 참고하세요. / See each doc for exact values & rationale.

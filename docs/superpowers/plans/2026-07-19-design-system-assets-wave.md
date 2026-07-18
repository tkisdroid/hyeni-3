# Design System and Assets Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브랜드 정체성은 유지하면서 글자·간격·아이콘·터치·카드·이미지를 작고 검증 가능한 제품 토큰으로 통합한다.

**Architecture:** `tokens.css`를 정본으로 만들고 공통 component부터 화면 CSS로 바깥 방향으로 이행한다. 자산은 실제 참조·디코딩·alpha·optical bbox를 테스트한 뒤 create-only 교체 또는 안전한 삭제를 수행한다.

**Tech Stack:** CSS custom properties, React 19, lucide-react, Sharp 0.35, Node test runner.

## Global Constraints

- 새 디자인 라이브러리와 외부 폰트를 추가하지 않는다.
- 로즈·민트·라벤더 의미 체계와 3D 클레이 정체성을 유지한다.
- 기능·hero는 3D WebP, 텍스트 행·유틸리티는 Lucide를 사용한다.
- 핵심 텍스트는 12px 미만을 사용하지 않고 일반 텍스트 대비 4.5:1을 만족한다.
- interactive hit area는 44×44px 이상이다.

---

### Task 1: 디자인 토큰 정본화

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`
- Modify: `src/styles/components.css`
- Modify: `design-system/spec/COMPONENTS.md`
- Modify: `design-system/brand/BRAND.md`
- Modify: `design-system/README.md`
- Test: `tests/designTokenContract.test.mjs`

**Interfaces:**
- Produces: `--type-display`, `--type-title-xl`, `--type-title-lg`, `--type-title`, `--type-body-lg`, `--type-body`, `--type-body-sm`, `--type-label`, `--type-caption`와 짝이 맞는 line-height·weight.
- Produces: spacing `2/4/8/12/16/20/24/32/40/48`, radius `8/12/16/20/24/pill`, shadow `soft/floating/modal`, icon size `16/18/20/22/24`.

- [ ] **Step 1: muted/placeholder 대비, 공통 44px 버튼, 기본 카드 radius 16px, base card 무그림자 계약을 읽는 소스 테스트를 작성해 실패를 확인한다.**
- [ ] **Step 2: 토큰을 추가하고 `body` 기본 행간, 전역 focus-visible, disabled·placeholder 색을 정본화한다.**
- [ ] **Step 3: `.hy-iconbtn`, `.hy-card`, `.hy-btn`, `.hy-loading`을 새 토큰으로 이행한다.**
- [ ] **Step 4: 44px와 42px를 동시에 요구하던 디자인 문서 모순을 제거하고 새 토큰 표를 기록한다.**
- [ ] **Step 5: 테스트와 typecheck를 실행하고 커밋한다.**

### Task 2: 출시 화면 타이포·간격·elevation 이행

**Files:**
- Modify: `src/screens/onboarding/Onboarding.css`
- Modify: `src/screens/parent/*.css`
- Modify: `src/screens/shared/*.css`
- Modify: `src/screens/feature/*.css`
- Modify: `src/screens/child/*.css`
- Modify: `src/screens/teacher/*.css`
- Test: `tests/designSystemUsage.test.mjs`

**Interfaces:**
- 화면 제목은 Title XL/L/Title, 일반 본문은 Body/Body S, 메타는 Label/Caption만 사용한다.
- 일반 카드 radius는 16px, modal/hero 20px, sheet 24px만 허용한다.

- [ ] **Step 1: 실제 selector block에서 핵심 UI의 12px 미만 글자, 44px 미만 버튼, `min-height: 848px`, 대체 focus 없는 `outline:none`을 수집하는 테스트를 추가하고 현재 위반으로 실패시킨다.**
- [ ] **Step 2: 온보딩·부모·공용 출시 화면을 먼저 토큰으로 이행하고 7.5~11.5px 핵심 글자를 Caption 이상으로 올린다.**
- [ ] **Step 3: 아이 화면을 역할별 밀도를 유지하며 이행하고 SOS·dock의 큰 hit area를 보존한다.**
- [ ] **Step 4: 프로덕션 gate 안쪽 선생님 화면을 이행하되 기능 노출 조건은 변경하지 않는다.**
- [ ] **Step 5: 848px 고정 프레임을 `min-height: 100dvh` 또는 콘텐츠 기반으로 바꾸고 safe-area header를 공통 규격에 맞춘다.**
- [ ] **Step 6: 정적 디자인 테스트, 전체 테스트, build를 실행하고 커밋한다.**

### Task 3: Lucide·원시 이모지·터치 영역 통합

**Files:**
- Modify: `src/screens/parent/ParentLocation.tsx`
- Modify: `src/screens/feature/DaySummary.tsx`
- Modify: `src/screens/feature/RemoteAudio.tsx`
- Modify: `src/screens/feature/FriendPlay.tsx`
- Modify: `src/screens/feature/RemoteRing.tsx`
- Modify: `src/screens/feature/PlaceManager.css`
- Modify: `tests/iconConsistency.test.mjs`

**Interfaces:**
- 유틸리티 아이콘은 glyph 16/18/20/22/24와 stroke 2.2 또는 2.4를 사용한다.
- OAuth 심볼과 ChildHome 지도 경로 inline SVG는 허용 목록으로 유지한다.

- [ ] **Step 1: ParentLocation의 유틸리티 inline SVG와 지정 icon slot의 원시 이모지를 검출하는 테스트를 추가하고 실패를 확인한다.**
- [ ] **Step 2: 새로고침·대화·전화·안내·경고·삭제를 현재 설치된 Lucide로 교체한다.**
- [ ] **Step 3: 18~22px glyph는 유지하되 PlaceManager 삭제를 포함한 버튼 hit area를 44px 이상으로 맞춘다.**
- [ ] **Step 4: iconConsistency와 전체 테스트를 실행하고 커밋한다.**

### Task 4: 이미지 자산 품질과 PWA 용량

**Files:**
- Modify: `public/assets/status/safe.webp`
- Modify: `public/assets/place/*.webp`
- Modify: `public/assets/ui/battery.webp`
- Modify: `public/assets/ui/clock-3d.webp`
- Modify: `public/assets/ui/lock-open-3d.webp`
- Modify: `public/assets/ui/wifi-3d.webp`
- Modify: `src/transform/placeVisual.ts`
- Modify: `vite.config.ts`
- Create: `tests/assetQuality.test.mjs`

**Interfaces:**
- 사용 중 상태·장소 자산은 정상 decode, 투명 배경, 피사체 bbox 72~90% 범위를 만족한다.
- PWA precache에는 실제 앱 참조 또는 manifest 필수 자산만 들어간다.

- [ ] **Step 1: Sharp로 `safe.webp` alpha, 장소·안전지표 bbox, SHA-256 중복, 미사용 precache를 검사하는 테스트를 작성하고 실패를 확인한다.**
- [ ] **Step 2: `safe.webp`를 체크무늬 없는 투명 클레이 자산으로 교체하고 장소·안전지표를 512×512 투명 캔버스에서 optical normalization한다.**
- [ ] **Step 3: 동일한 `menu-place-manager.webp`와 `place-frequent.webp` 참조를 한 정본으로 합친다.**
- [ ] **Step 4: 정적·동적 참조가 없는 12개 자산을 precache glob에서 제외하고 manifest 필수 PWA 아이콘은 유지한다.**
- [ ] **Step 5: asset test와 build의 precache 크기 비교를 실행하고 커밋한다.**

### Task 5: 네트워크 이미지와 레이아웃 안정성

**Files:**
- Modify: `src/screens/shared/MemoChat.tsx`
- Modify: `src/screens/shared/MemoChat.css`
- Modify: `src/screens/parent/ParentFamily.tsx`
- Modify: `src/screens/parent/ParentFamily.css`
- Test: `tests/imageLoadingContract.test.mjs`

**Interfaces:**
- 네트워크 첨부·프로필 이미지는 고정 aspect ratio, `loading="lazy"`, `decoding="async"`를 사용한다.
- 첫 viewport의 hero·역할 이미지는 eager를 유지한다.

- [ ] **Step 1: MemoChat의 네트워크 이미지에 lazy/async와 CSS aspect ratio가 없음을 검출하는 테스트를 작성하고 실패를 확인한다.**
- [ ] **Step 2: 메시지 첨부와 화면 아래 프로필 사진에 lazy/async를 적용하고 크기·비율을 CSS로 고정한다.**
- [ ] **Step 3: 첫 화면 hero에는 lazy가 추가되지 않았다는 역회귀 테스트를 넣는다.**
- [ ] **Step 4: 관련 테스트와 build를 실행하고 커밋한다.**


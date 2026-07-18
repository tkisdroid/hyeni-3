# Screen, Performance, and Release Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전체 사용자 화면을 동일 상태·접근성 기준으로 마이그레이션하고 초기 번들을 분할한 뒤 브라우저·A17·razr·Git 원격까지 검증한다.

**Architecture:** route-level lazy boundary와 공통 skeleton을 도입하고 58개 화면 매트릭스를 자동·수동 검증 목록으로 관리한다. 최종 Android 설치는 기존 앱 데이터를 유지하며 자동 게이트를 모두 통과한 동일 commit의 APK만 사용한다.

**Tech Stack:** React 19 lazy/Suspense, Vite 7, Capacitor 8, Gradle, ADB, Git.

## Global Constraints

- S25는 어떤 ADB 작업에서도 제외한다.
- A17 `RFKL40DP73J`는 부모 모드, razr는 아이 모드만 검증한다.
- 앱 데이터·세션·페어링을 삭제하지 않고 `adb install -r`만 사용한다.
- refresh 토큰을 읽거나 출력하거나 회전하지 않는다.
- 자동·브라우저·실기기 결과가 같은 commit을 가리킬 때만 push한다.

---

### Task 1: route-level code splitting과 공통 전환 상태

**Files:**
- Modify: `src/app/App.tsx`
- Create: `src/app/lazyScreen.tsx`
- Create: `src/components/ui/RouteLoading.tsx`
- Create: `src/components/ui/RouteLoading.css`
- Test: `tests/routeLazyLoading.test.mjs`

**Interfaces:**
- `lazyScreen(loader, exportName)`은 named export screen을 `React.lazy` default로 변환한다.
- route tree는 `Suspense` fallback으로 `RouteLoading`을 사용한다.

- [ ] **Step 1: App.tsx의 화면 정적 import와 Vite main chunk 500KB 초과를 기준선으로 기록하는 테스트를 추가하고 실패를 확인한다.**
- [ ] **Step 2: provider·shell·error boundary는 eager로 유지하고 사용자 screen import를 `lazyScreen(() => import(path), exportName)`으로 변경한다.**
- [ ] **Step 3: skeleton에 `role="status"`, 고정 최소 높이, reduced-motion 규칙을 적용한다.**
- [ ] **Step 4: typecheck·전체 테스트·build를 실행하고 main chunk, chunk 수, 전체 gzip을 baseline과 비교한다.**
- [ ] **Step 5: cold route와 뒤로가기에서 빈 화면·무한 fallback이 없는지 브라우저로 확인하고 커밋한다.**

### Task 2: 전체 화면 상태·모달·말투 회귀 게이트

**Files:**
- Create: `tests/routeQualityMatrix.test.mjs`
- Modify: `src/screens/parent/*.tsx`
- Modify: `src/screens/child/*.tsx`
- Modify: `src/screens/shared/*.tsx`
- Modify: `src/screens/feature/*.tsx`
- Modify: `src/screens/teacher/*.tsx`
- Modify: `src/components/MapPickerSheet.tsx`
- Modify: `src/screens/parent/ParentAccount.tsx`

**Interfaces:**
- 각 query 화면은 loading/error/empty/success 또는 명시적인 정적/mutation 전용 분류를 가진다.
- dialog는 `MessageSafetyDialog`와 같은 focus lifecycle을 갖는다.

- [ ] **Step 1: 58개 화면의 route, 역할, query error 처리, back affordance, dialog aria, 말투를 JSON 상수로 고정한 matrix test를 작성한다.**
- [ ] **Step 2: 오류를 `?? []`로 숨기는 화면을 부모 출시 화면, 공용 화면, 아이 화면, DEV 선생님 화면 순으로 수정한다.**
- [ ] **Step 3: ParentAccount·MapPickerSheet·RemoteRing의 dialog에 초기 focus, Tab trap, Escape, 복귀 focus를 적용한다.**
- [ ] **Step 4: ParentFamily 뒤로가기, teacher DEV 설정 링크, 역할별 말투를 matrix 기준으로 정리한다.**
- [ ] **Step 5: matrix와 전체 테스트를 실행하고 커밋한다.**

### Task 3: 브라우저 전수 검증

**Files:**
- Create: `docs/qa/2026-07-19-ui-route-matrix.md`
- Modify: `docs/qa/2026-07-19-ui-route-matrix.md`

**Interfaces:**
- 각 행은 route, role, viewport, 상태, console, overflow, keyboard, dialog, 결과, 증거를 기록한다.

- [ ] **Step 1: `npm run dev -- --port 5199 --strictPort`를 실행하고 공개 화면을 360×800, 390×844, 412×915에서 확인한다.**
- [ ] **Step 2: 허용된 테스트 세션으로 부모·아이 route를 열고 정상·empty·error·slow 상태, 주요 버튼 spinner, cold deep link back을 검증한다.**
- [ ] **Step 3: keyboard-only, 200% zoom, reduced motion, 긴 한국어, modal focus, console error, horizontal overflow를 확인한다.**
- [ ] **Step 4: 발견 결함마다 실패 테스트를 먼저 추가하고 수정한 뒤 같은 matrix 행을 재검증한다.**
- [ ] **Step 5: 모든 사용자 route 결과와 남은 제한을 문서화하고 커밋한다.**

### Task 4: 자동·Android 빌드 게이트

**Files:**
- Modify: `docs/qa/2026-07-19-ui-route-matrix.md`

**Interfaces:**
- APK 경로: `android/app/build/outputs/apk/debug/app-debug.apk`.
- 동일 commit에서 web dist와 debug APK를 생성한다.

- [ ] **Step 1: `npm run typecheck`를 실행해 exit 0을 확인한다.**
- [ ] **Step 2: `node --test tests/*.test.*`를 실행해 fail 0을 확인한다.**
- [ ] **Step 3: `npm audit --audit-level=high`를 실행해 high 이상 취약점 0을 확인한다.**
- [ ] **Step 4: `npm run build`와 `npx cap sync android`를 실행한다.**
- [ ] **Step 5: `android/gradlew.bat lintDebug assembleDebug`를 실행해 lint error 0과 APK 생성을 확인한다.**
- [ ] **Step 6: build가 만든 `tsconfig.app.tsbuildinfo` 등 비제품 산출물은 diff를 확인한 뒤 커밋에서 제외한다.**

### Task 5: A17 부모·razr 아이 설치와 역할별 실기기 검증

**Files:**
- Modify: `docs/qa/2026-07-19-ui-route-matrix.md`

**Interfaces:**
- A17 serial은 정확히 `RFKL40DP73J`다.
- razr serial은 `ZY22H9VTQD`다. S25 `R5CY521CFNZ`는 사용하지 않는다.

- [ ] **Step 1: `adb devices -l`을 읽기 전용으로 확인하고 A17·razr만 명시적으로 분리한다.**
- [ ] **Step 2: `adb -s RFKL40DP73J install -r android/app/build/outputs/apk/debug/app-debug.apk`와 `adb -s ZY22H9VTQD install -r android/app/build/outputs/apk/debug/app-debug.apk`를 실행한다.**
- [ ] **Step 3: A17에서 부모 세션 유지, 홈·가족·위치·일정·메모·보고서·설정·resume을 검증한다.**
- [ ] **Step 4: razr에서 아이 세션·페어링 유지, 홈·길찾기·준비물·메모·위치 상태·SOS 진입·resume을 검증한다.**
- [ ] **Step 5: 앱 데이터 초기화, refresh 요청, 계정 재페어링 없이 완료됐는지 기록한다.**

### Task 6: 최종 커밋·main 반영·원격 push

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- 문서에는 이번에 확정된 UI 토큰, fail-closed report, 공용 route, 검증 기기 규칙만 현재 사실로 기록한다.

- [ ] **Step 1: `git status --short`, `git diff --check`, `git diff --stat`로 변경 범위와 생성물 누락을 확인한다.**
- [ ] **Step 2: 자동·브라우저·실기기 증거와 실제 코드가 일치하는지 fresh-context 리뷰를 실행한다.**
- [ ] **Step 3: 검증된 변경만 한국어 커밋 메시지로 커밋한다.**
- [ ] **Step 4: 현재 브랜치가 main이 아니면 non-interactive merge로 main에 반영하고 충돌 시 즉시 중단해 파일별로 해결한다.**
- [ ] **Step 5: `git push origin main`을 실행하고 `git ls-remote origin refs/heads/main`이 로컬 `git rev-parse HEAD`와 일치하는지 확인한다.**
- [ ] **Step 6: 커밋·push·A17 설치·razr 설치·웹/Android build 상태를 분리해 최종 보고한다.**

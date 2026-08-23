# 역할별 전체 동선 안정화와 1.4.1 출시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to execute this plan task-by-task.

**Goal:** 역할별 주요 동선을 읽기 전용으로 전수 감사하고, 확인된 아이 홈 길찾기 이중 동선을 한 번의 탭으로 고친 뒤 1.4.1/code 13 Play 업데이트 산출물과 배포 증거를 만든다.

**Architecture:** 기존 HashRouter, 역할 가드, `useActiveChild`, Query 오류 상태와 `RouteView`를 그대로 유지한다. 아이 홈에서 중복으로 수행하던 위치·경로 시트 로직을 제거하고 길찾기 의도의 세 진입점을 정본 전체 지도 `/route`에 연결한다. 감사에서 확인된 오류·빈 상태만 기존 화면 안의 재시도·뒤로가기·아이 연결 행동으로 복구하고, 번역 라벨에 묶인 바로가기는 안정적인 ID로 바꾼다. Worker와 D1 계약은 변경하지 않는다.

**Tech Stack:** React 19, TypeScript strict, React Router, TanStack Query, Node test runner, Playwright, Vite PWA, Capacitor 8, Android Gradle.

**Spec:** [`docs/superpowers/specs/2026-08-24-role-journey-ux-release-design.md`](../specs/2026-08-24-role-journey-ux-release-design.md)

## 제약

- 모든 앱 문구는 부모 존댓말·아이 반말 규칙을 유지한다.
- 라이브 계정의 로그아웃·역할 전환·재페어링·refresh token 조회/회전을 하지 않는다.
- 실기기 설치는 연결된 허용 serial에 `npm run android:install:debug -- <serial>`만 사용한다.
- 사용자 untracked 파일과 기존 증거물을 stage하거나 수정하지 않는다.
- Worker 코드가 바뀌지 않으면 Worker를 배포하지 않는다.
- 서명 비밀번호와 keystore 자격 값은 사용자가 직접 입력하며 저장하거나 출력하지 않는다.

---

### Task 1: 역할별 감사 결과 확정

**Files:**

- Read: `src/screens/**`
- Read: `src/app/**`
- Read: `src/auth/**`
- Read: `tests/**`

- [x] 가입·로그인·온보딩·부모·아이·공동보호자·선생님·결제/출시 감사를 병렬 완료한다.
- [x] 발견마다 재현 경로, 실제 영향, 파일/라인을 확인한다.
- [x] 자동화가 이미 통과하고 실제 결함 근거가 없는 항목은 변경 범위에서 제외한다.

### Task 2: 아이 홈 길찾기 동작을 TDD로 변경

**Files:**

- Modify: `tests/childRedesignWiring.test.ts`
- Modify: `tests/routeQualityMatrix.test.mjs`
- Modify: `tests/routeEventTimeZone.test.ts`
- Modify: `tests/sharedRouteAccess.test.mjs`
- Modify: `src/screens/child/ChildHome.tsx`
- Modify: `src/screens/feature/RouteView.tsx`
- Modify: `src/transform/routeDestinationScope.ts`

- [x] `길찾기 출발!`, 다음 일정 지도 노드, 혜니의 다음 일정 버튼이 `/route`로 직접 이동해야 한다는 실패 테스트를 먼저 작성한다.
- [x] 관련 테스트를 실행해 기존 `RouteSheet` 동작 때문에 실패하는 것을 확인한다.
- [x] `ChildHome`의 `RouteSheet`, 홈 전용 GPS·경로 state와 출발·도착 중복 핸들러를 제거한다.
- [x] 다음 일정 id를 route query로 넘기고 명시 일정이 다른 장소 있는 일정으로 치환되지 않게 한다.
- [x] 아이 기기 GPS를 먼저 기다리고 실패 뒤에만 서버 위치로 강등하며 GPS 재시도를 제공한다.
- [x] RouteView의 가족·위치·저장 장소·일정 조회 실패를 빈 상태와 분리해 전체 재시도를 제공한다.
- [x] 다음 일정 없음 분기는 오늘 시간표를 여는 기존 동작을 유지한다.
- [x] 대상 테스트를 다시 실행해 통과시킨다.

### Task 2A: 역할별 복구 가능성 보강

**Files:**

- Modify: `src/screens/feature/Subscription.tsx`
- Modify: `src/screens/shared/MemoChat.tsx`
- Modify: `src/screens/parent/ParentHome.tsx`
- Modify: `src/app/TabBar.tsx`
- Modify: 관련 `tests/**`

- [x] 웹 구독 카탈로그 실패에 재시도 행동을 추가한다.
- [x] Play 상품·가격 재검증 실패를 구매 불가 오류로 분류한다.
- [x] 잘못된 명시 아이 메모 딥링크에서 뒤로 갈 수 있게 한다.
- [x] 가족 조회 성공 뒤 아이가 없는 부모 홈에서만 아이 연결 화면으로 이동시킨다.
- [x] 부모 바로가기를 번역 라벨 대신 shortcut ID로 연결한다.
- [x] 하단 탭 탐색 이름을 현재 언어 라벨로 만든다.

### Task 3: 1.4.1/code 13 메타데이터를 TDD로 동기화

**Files:**

- Modify: `tests/appVersionConsistency.test.mjs`
- Modify/Create: `tests/playReleaseV141Metadata.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `android/app/build.gradle`
- Modify: `ios/App/App.xcodeproj/project.pbxproj`
- Create: `docs/store/play-release-notes-v1.4.1.md`
- Create: `docs/store/play-console-submission-v1.4.1.md`
- Modify: `docs/store/play-listing.md`

- [x] 새 버전·빌드 번호와 출시 문서 계약을 먼저 테스트에 반영하고 실패를 확인한다.
- [x] package, Android, iOS 메타데이터를 `1.4.1`/`13`으로 맞춘다.
- [x] 출시 노트에는 실제 이번 변경만 쓰고 미완료 Play 제출을 완료로 표시하지 않는다.
- [x] 메타데이터 테스트를 통과시킨다.

### Task 4: 전체 회귀와 Android 빌드 검증

- [x] `npm run typecheck`
- [x] `npm run typecheck:worker`
- [x] `npm test`의 `fail 0` 확인
- [x] `npm run test:worker`의 `fail 0` 확인
- [x] `npm run build`
- [x] `npm run qa:browser` (부모 43화면·아이 14화면, 문제 0건)
- [x] `npm run qa:pwa-runtime`
- [x] `npx cap sync android`
- [x] Android unit test, `lintDebug`, `assembleDebug`
- [x] 연결된 실기기가 있으면 세션 보존 설치 후 길찾기 직접 이동과 버전을 확인한다. (허용 기기 0대라 설치 생략)

### Task 5: main 커밋·푸시와 Pages 배포

- [x] 사용자 untracked 파일이 stage되지 않았는지 확인한다.
- [x] 구현과 출시 문서를 한국어 커밋 `15bd55c`로 `main`에 기록한다.
- [x] `origin/main`으로 push한다.
- [x] 저장소 `.env`가 없는 임시 디렉터리에서 새 `dist`를 Cloudflare Pages main으로 배포한다.
- [x] 배포 URL과 commit SHA를 기록하고 배포별·고정·브랜드 URL의 동일 entry/SHA를 확인한다.
- [x] Play 1.4.1 제공 가능 readback 전에는 원격 update policy를 1.4.0으로 유지한다.

### Task 6: Google Play 업데이트 AAB 정리

- [ ] clean worktree와 push된 최신 commit SHA를 확인한다.
- [ ] 사용자 입력 서명 환경으로 fresh release AAB를 만든다.
- [ ] 서명 인증서, versionName/code, 내장 commit SHA, SHA-256, mtime을 검증한다.
- [ ] `artifacts/release-evidence/play-upload-v1.4.1-vc13-<sha>/`에 AAB와 증거를 모은다.
- [ ] Play Console 최종 제출은 사용자의 별도 명시가 없으면 수행하지 않는다.

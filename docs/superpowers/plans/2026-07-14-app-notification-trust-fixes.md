# App Notification Trust Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 부모·아이 화면이 위치, 메모, 알림 설정, 웹 푸시, 아이 기기 상태를 현재 계정과 실제 보고 상태 기준으로만 표시하도록 고친다.

**Architecture:** 화면별 임시 분기 대신 위치 신뢰 문구, 최근 날짜 범위, 메모 대상, 기기 상태를 순수 함수로 판정하고 React 훅은 그 결과만 소비한다. 웹 푸시는 로컬 구독과 서버의 현재 계정 등록을 분리해 확인하며 Service Worker context 저장을 ACK로 확정한다.

**Tech Stack:** React 19, TypeScript strict, TanStack Query 5, Vite PWA Service Worker, Node test runner.

## Global Constraints

- Worker와 Android 파일은 수정하지 않는다.
- 현재 프로젝트 의존성만 사용한다.
- 부모 문구는 존댓말, 아이 문구는 반말을 유지한다.
- 명시적 자녀 대상이 유효하지 않으면 다른 자녀로 폴백하지 않는다.
- 테스트를 먼저 실패시킨 뒤 최소 구현을 적용한다.

---

### Task 1: 위치 신뢰 문구와 화면 상태

**Files:**
- Modify: `src/transform/locationTrustCopy.ts`
- Modify: `src/screens/parent/ParentHome.tsx`
- Modify: `src/screens/feature/SosReceive.tsx`
- Test: `tests/locationTrustCopy.test.ts`
- Test: `tests/locationTrustScreens.test.mjs`

**Interfaces:**
- Consumes: `LocationMode`, 위치 query의 `isLoading/isError`, `updated_at`.
- Produces: `resolveLocationTrustCopy({ mode, modeKnown, updatedAt, loadState, now })`.

- [ ] **Step 1: 잠금 우선·로딩·오류·지연·실시간 화면 문구 테스트를 추가한다.**
- [ ] **Step 2: `node --test tests/locationTrustCopy.test.ts tests/locationTrustScreens.test.mjs`가 기존 고정 `실시간`과 잠금 순서 때문에 실패하는지 확인한다.**
- [ ] **Step 3: `locked`를 좌표 유무보다 먼저 판정하고 두 화면이 query 상태와 helper 결과만 표시하도록 최소 수정한다.**
- [ ] **Step 4: 같은 테스트를 재실행해 통과시킨다.**

### Task 2: 날짜 경계와 메모 자녀 격리

**Files:**
- Create: `src/app/useRecentDateKeys.ts`
- Create: `src/transform/memoChildScope.ts`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/screens/shared/MemoChat.tsx`
- Modify: `src/queries/useMemo.ts`
- Test: `tests/recentDateKeys.test.ts`
- Test: `tests/memoNotificationTargeting.test.mjs`
- Test: `tests/memoChildScope.test.ts`

**Interfaces:**
- Produces: `recentDateKeysFor(now, days)`, `useRecentDateKeys(days)`, `resolveMemoChildScope(...)`.
- Invariant: `childHint`가 있으면 일치 자녀 또는 `null`만 반환한다.

- [ ] **Step 1: 자정·visibility 갱신, invalid hint 무폴백, childId 없는 query 비활성, 읽음 실패 재시도 테스트를 추가한다.**
- [ ] **Step 2: 관련 테스트가 기존 `useMemo(..., [])`, `hintedChild ?? activeChild`, 선기록된 `markedRef` 때문에 실패하는지 확인한다.**
- [ ] **Step 3: 공용 날짜 훅과 대상 resolver를 연결하고 읽음 mutation `onError`에서 ID를 제거한다.**
- [ ] **Step 4: 관련 테스트를 재실행한다.**

### Task 3: 알림 설정 계정·세션 격리와 실시간 갱신

**Files:**
- Modify: `src/lib/api/endpoints/notifications.ts`
- Modify: `src/queries/keys.ts`
- Modify: `src/queries/useNotifications.ts`
- Modify: `src/queries/useFamilyRealtime.ts`
- Modify: `src/screens/feature/NotificationSettings.tsx`
- Test: `tests/notificationSettingsReliability.test.ts`

**Interfaces:**
- `saveNotifSettings(familyId, expectedUserId, settings)`는 `expected_user_id`를 서버에 보낸다.
- 대기 mutation은 캡처한 `userId/session_instance_id`가 실행 시점 정본과 다르면 요청 전에 실패한다.

- [ ] **Step 1: 사용자 변경 hydration reset, expected user/nonce guard, `notification_settings` WS invalidation 테스트를 추가한다.**
- [ ] **Step 2: 기존 구현에서 실패를 확인한다.**
- [ ] **Step 3: 사용자별 hydration 키와 세션 guard, user_id가 맞는 query key 무효화를 구현한다.**
- [ ] **Step 4: 관련 테스트를 재실행한다.**

### Task 4: Web Push 현재 계정 등록과 Service Worker 안전성

**Files:**
- Modify: `src/lib/webPush.ts`
- Modify: `src/transform/notificationDeliveryView.ts`
- Modify: `src/screens/feature/NotificationSettings.tsx`
- Modify: `src/sw.ts`
- Create: `src/transform/pushExpiry.ts`
- Test: `tests/notificationUiReliability.test.ts`
- Test: `tests/webPushWiring.test.mjs`
- Test: `tests/webPushExpiry.test.ts`

**Interfaces:**
- `GET /api/push-subscriptions/status?endpoint=...` → `{ registered: boolean }`.
- `getWebPushState(context)`는 로컬 구독과 `accountRegistered`를 함께 반환한다.
- `syncWebPushSessionContext`는 `MessageChannel` ACK 뒤에만 `true`를 반환한다.
- `isPushExpired(expiresAt, nowMs)`는 만료 payload 표시와 ledger 기록을 차단한다.

- [ ] **Step 1: 다른 계정 등록, VAPID 조회 실패 중 해제, ACK, 만료 push 폐기 테스트를 추가한다.**
- [ ] **Step 2: 기존 구현에서 실패를 확인한다.**
- [ ] **Step 3: status 조회·정직한 view·ACK·만료 가드를 구현한다.**
- [ ] **Step 4: 관련 테스트를 재실행한다.**

### Task 5: 아이 기기 상태와 앱 일정 알림 상태

**Files:**
- Modify: `src/lib/api/endpoints/family.ts`
- Modify: `src/lib/api/endpoints/notifications.ts`
- Modify: `src/queries/useNotifications.ts`
- Modify: `src/transform/deviceNotificationHealth.ts`
- Modify: `src/transform/familyView.ts`
- Modify: `src/screens/parent/ParentHome.tsx`
- Modify: `src/screens/feature/DailySafetyReport.tsx`
- Test: `tests/deviceNotificationHealth.test.ts`

**Interfaces:**
- `GET /api/notif-settings/child-status?...` → `{ user_id, child_enabled, configured }`.
- `deviceStatusView(health, now, childScheduleEnabled)`는 보고 신선도, 알림 표시 설정, 위치 권한·서비스, 네트워크를 함께 판정한다.

- [ ] **Step 1: 오래된 보고를 정상으로 표시하지 않는 테스트와 위치/네트워크/child_enabled 주의 테스트를 추가한다.**
- [ ] **Step 2: 기존 구현에서 실패를 확인한다.**
- [ ] **Step 3: Android가 이미 보고하는 필드 타입·뷰와 부모 화면 표시를 연결한다.**
- [ ] **Step 4: 관련 테스트를 재실행한다.**

### Task 6: 계정 삭제 전 앱 푸시 정리와 전체 검증

**Files:**
- Modify: `src/auth/AuthProvider.tsx`
- Test: `tests/pushLogoutCleanup.test.mjs`

**Interfaces:**
- 계정 삭제는 access token이 남아 있을 때 FCM 해제, Web Push 해제, SW context 삭제를 먼저 시도한다.

- [ ] **Step 1: 계정 삭제 순서 회귀 테스트를 추가하고 실패를 확인한다.**
- [ ] **Step 2: 로그아웃과 같은 제한시간 cleanup helper를 계정 삭제에도 적용한다.**
- [ ] **Step 3: 관련 Node 테스트, `npm run typecheck`, `npm run build`를 실행한다.**

# 알림 전달 신뢰성 강화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아이는 일정·도착·위험장소·부모 메시지를, 부모는 아이 위치·일정·안전 알림을 정확한 가족·사용자 범위에서 받고, 앱은 실제 표시 여부와 실패 원인을 정직하게 보여준다.

**Architecture:** Worker가 현재 가족·역할·수신자·알림 원장을 정본으로 판정하고 FCM/Web Push/내구성 큐를 동일한 `pushId`로 조정한다. Android는 수신 payload가 현재 네이티브 세션과 일치하는지 확인한 뒤 OS 알림 게시 성공 시에만 표시 ACK를 기록한다. React 라우터와 알림 화면은 역할을 강제하고 서버의 실제 유형·상태만 표현한다. PWA는 기존 Vite PWA 서비스 워커를 `injectManifest`로 전환해 Web Push와 탭 경로를 처리한다.

**Tech Stack:** Cloudflare Worker/Hono/D1, Firebase Admin FCM, Vite 7, React 19, TypeScript strict, TanStack Query, Capacitor 8 Android(Java), Vite PWA/Workbox, Node test runner, Gradle/JUnit, ADB/CDP

## Global Constraints

- 라이브 refresh 토큰 원문을 읽거나 출력하거나 외부에서 회전시키지 않는다.
- razr의 혜니 계정·가족·페어링·앱 데이터를 삭제하거나 재생성하지 않는다.
- D1 변경은 additive migration만 허용하며, 기존 알림·가족·토큰 행을 파괴적으로 정리하지 않는다.
- 서버가 확인하지 못한 전달 성공, 위치, 역할, 수신자, 위험상태를 가정하지 않는다.
- FCM HTTP 성공은 `accepted`, OS 게시 성공은 `displayed`, 사용자가 연 것은 `read`로 분리한다.
- SOS·emergency는 설정과 구독에 관계없이 안전 경로를 유지한다. `danger_exit`와 `not_arrived`는 전체화면 전환 대상이 아니다.
- 아이 문구는 반말, 부모·설정 문구는 존댓말을 사용한다.
- 기존 변경 `TeacherStudents.*`, `tsconfig.app.tsbuildinfo`, `output/`, 임시 파일과 Worker의 교사 공지 연결 변경은 보존한다.
- 각 구현은 실패 테스트를 먼저 확인한 뒤 최소 수정하고, 관련 테스트가 초록색이 되기 전 다음 작업으로 넘어가지 않는다.

## 패치 계약

1. 현재 가족 정본은 활성 `family_members` 소속을 최우선으로 하고, 없을 때만 주보호자가 소유한 활성 구성원 가족, 마지막으로 빈 가족을 사용한다.
2. 일반 사용자는 자기 `user_id`와 현재 가족에 대해서만 FCM 토큰을 등록·해제할 수 있다. 서비스 역할만 명시 대행할 수 있다.
3. 메모 sender·role은 JWT와 DB에서 판정하고, 부모·아이는 유효한 활성 child member가 지정된 1:1 스레드만 읽고 쓴다.
4. 위험지역 판정은 실제 provider `accuracy_m`이 있고 75m 이하인 신선한 실측점만 사용한다.
5. 위치 알림 설정을 꺼도 위험지역·SOS 알림은 차단하지 않는다. 친구놀이 설정은 실제 수신자 필터에 연결한다.
6. Android는 권한·앱 전체 알림·채널 중요도·`notify()` 예외를 확인해 `posted=true`인 경우에만 ACK한다.
7. 명령형 push와 일반 알림 모두 `targetUserId`, `targetRole`, `familyId`가 현재 네이티브 세션과 불일치하면 표시·실행하지 않는다.
8. 알림의 탭 경로는 서버→FCM/pending→Android/PWA에서 allowlist로 보존한다.
9. 부모 전용 alert API와 화면은 DB 역할 및 `RequireRole` 양쪽에서 차단한다.
10. 알림 내역은 최근 목록 제한과 무관한 내구성 원장에서 읽고, 빈 상태 문구는 관측 범위를 넘는 안전을 단정하지 않는다.

---

### Task 0: 기준선과 공격 재현 고정

**Files:**
- Create: `tests/notificationReliabilityContract.test.mjs`
- Create: `../hyeni-1/worker/tests/canonicalFamilyResolution.test.mjs`
- Create: `../hyeni-1/worker/tests/fcmTokenOwnership.test.mjs`
- Create: `../hyeni-1/worker/tests/memoAuthorization.test.mjs`
- Create: `android/app/src/test/java/com/hyeni/calendar/NotificationDeliveryPolicyTest.java`
- Create: `android/app/src/test/java/com/hyeni/calendar/PushTargetPolicyTest.java`

- [ ] 기존 전체 앱·Worker·Android 테스트가 초록색인지 기록한다.
- [ ] 빈 과거 가족과 활성 현재 가족을 함께 가진 부모가 과거 가족으로 발급되는 실패 테스트를 작성한다.
- [ ] 같은 가족의 다른 사용자 FCM 토큰을 일반 사용자가 등록하는 공격 테스트를 작성한다.
- [ ] child 대상이 없거나 다른 아이인 메모 읽기·쓰기가 허용되는 공격 테스트를 작성한다.
- [ ] 알림 권한 또는 채널이 꺼져도 ACK되는 Android 실패 테스트를 작성한다.
- [ ] family/user/role이 다른 `force_ring` 및 일반 알림이 실행되는 Android 실패 테스트를 작성한다.
- [ ] 새 테스트가 기존 구현에서 의도한 이유로 실패하는 RED를 확인한다.

### Task 1: 현재 가족 정본과 FCM 토큰 소유권

**Files:**
- Modify: `../hyeni-1/worker/db/authz.ts`
- Modify: `../hyeni-1/worker/routes/auth.ts`
- Modify: `../hyeni-1/worker/routes/family.ts`
- Modify: `../hyeni-1/worker/routes/naver-auth.ts`
- Modify: `../hyeni-1/worker/routes/oauth.ts`
- Modify: `../hyeni-1/worker/routes/oauth-bridge.ts`
- Modify: `../hyeni-1/worker/routes/rest-shim-rpc.ts`
- Modify: `src/lib/api/endpoints/notifications.ts`
- Modify: `src/auth/AuthProvider.tsx`

**Interfaces:**

```ts
export interface CanonicalFamilyMembership {
  familyId: string;
  role: "parent" | "child";
}

export async function resolveCanonicalFamilyMembership(
  db: D1Database,
  userId: string,
): Promise<CanonicalFamilyMembership | null>;
```

- [ ] `resolveCanonicalFamilyMembership`가 활성 membership → 활성 구성원이 있는 소유 가족 → 빈 소유 가족 순으로 하나만 반환하게 한다.
- [ ] 로그인·OAuth·fresh session·refresh 응답과 새 refresh 행이 모두 같은 정본 family/role을 사용하게 한다.
- [ ] `/api/family/mine` 성공 시 클라이언트 세션의 family/role 보정과 같은 결과인지 테스트한다.
- [ ] `upsert_fcm_token`은 `caller.sub === p_user_id`와 정본 family 일치를 강제한다.
- [ ] 현재 사용자·현재 토큰만 삭제하는 `unregister_fcm_token` RPC를 추가하고 로그아웃 전에 호출한다.
- [ ] 로그아웃은 서버 해제 실패와 무관하게 로컬 종료를 계속하되, native push context의 사용자·가족·FCM 매핑을 지운다.
- [ ] 원래 공격 테스트가 403이고 정상 자기 등록·해제가 성공하는지 확인한다.

### Task 2: 메모 1:1 스레드 권한과 부모 alert 역할 권한

**Files:**
- Modify: `../hyeni-1/worker/routes/memos.ts`
- Modify: `../hyeni-1/worker/routes/parent-alerts.ts`
- Modify: `../hyeni-1/worker/routes/push-notify.ts`
- Modify: `../hyeni-1/worker/tests/memoAuthorization.test.mjs`
- Create: `../hyeni-1/worker/tests/parentAlertRoleAuthorization.test.mjs`

**Interfaces:**

```ts
interface MemoThreadScope {
  familyId: string;
  childMemberId: string;
  childUserId: string;
  callerRole: "parent" | "child";
}
```

- [ ] GET/POST 모두 인증 user와 DB role에서 `MemoThreadScope`를 계산한다.
- [ ] 부모는 명시한 활성 child member만, 아이는 자기 활성 member만 허용한다.
- [ ] `child_id` 누락·비활성·타가족·역할 위조를 400/403으로 실패시킨다.
- [ ] memo push recipient 계산 실패 시 family-wide fallback을 제거하고 전송하지 않는다.
- [ ] parent-alerts 조회·읽음·생성의 각 계약에 현재 DB parent role을 강제하되, 활성 child가 만드는 허용된 안전 alert 생성 경로는 별도로 유지한다.
- [ ] 부모 정상 메모와 아이 답장, 부모 alert 조회가 계속 성공하는지 확인한다.

### Task 3: 안전 알림 수신자·정확도·긴급도 정책

**Files:**
- Modify: `../hyeni-1/worker/lib/parentAlertRecipients.ts`
- Modify: `../hyeni-1/worker/lib/notificationRouting.ts`
- Modify: `../hyeni-1/worker/cron/danger-zone-geofence-check.ts`
- Modify: `../hyeni-1/worker/cron/push-notify.ts`
- Modify: `../hyeni-1/worker/routes/push-notify.ts`
- Modify: `../hyeni-1/worker/shared/dangerZoneGeofence.js`
- Modify: `../hyeni-1/worker/tests/parentAlertRecipients.test.mjs`
- Modify: `../hyeni-1/worker/tests/dangerZoneGeofence.test.mjs`
- Create: `../hyeni-1/worker/tests/childSafetyNotificationRecipients.test.mjs`

- [ ] `danger_enter`, `danger_entry`, `danger_zone`, SOS/emergency는 `location_enabled`와 무관하게 부모에게 전달한다.
- [ ] `danger_exit`는 일반 안전 안내로 보내고 emergency/full-screen 목록에서 제거한다.
- [ ] `playdate_enabled=false`인 부모는 친구놀이 시작·종료 알림 수신자에서 제외한다.
- [ ] 도착 확정 시 아이에게 “도착했어” 일반 알림, 위험지역 진입 시 아이에게 즉시 벗어나도록 하는 안전 알림을 별도 child target으로 만든다.
- [ ] 아이 알림은 부모용 alert row를 복제하지 않고 동일 사건의 별도 수신 claim과 `pushId`를 사용한다.
- [ ] danger cron의 `ChildFix.accuracyM`을 전달하고 null·비수치·75m 초과 fix는 상태머신과 알림에서 제외한다.
- [ ] 24시간 창 밖 또는 한 번도 위치를 보고하지 않은 활성 아이도 stale 상태 점검 대상으로 남는지 테스트한다.
- [ ] push/alert insert/state advance가 부분 성공하지 않도록 claim·pending·상태 전이를 재시도 가능 순서로 고정한다.

### Task 4: 내구성 알림 상태와 탭 경로

**Files:**
- Create: `../hyeni-1/worker/db/notification-delivery-ledger.sql`
- Modify: `../hyeni-1/worker/routes/push-notify.ts`
- Modify: `../hyeni-1/worker/routes/rest-shim-rpc.ts`
- Modify: `../hyeni-1/worker/cron/notification-dispatch.ts`
- Modify: `../hyeni-1/worker/lib/eventBatch.ts`
- Modify: `src/lib/api/endpoints/notifications.ts`
- Modify: `src/queries/useNotifications.ts`

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  target_role TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  route TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued','accepted','displayed','read','failed')),
  accepted_at TEXT,
  displayed_at TEXT,
  read_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] additive migration과 target/status/created_at 인덱스를 추가한다.
- [ ] FCM 전 pending+ledger queued, FCM ACK accepted, native/web ACK displayed, 화면 열기 read로 분리한다.
- [ ] FCM 토큰 0건 또는 전송 실패는 queued를 유지하고 같은 push id로 재시도한다.
- [ ] pending 조회는 긴급 우선·생성순으로 하고 LIMIT 20의 오래된 일반 알림이 긴급 알림을 막지 않게 한다.
- [ ] 일정 알림도 시작+5분 뒤 사라지는 pending만 의존하지 않고 ledger 내역에서 조회 가능하게 한다.
- [ ] route는 `#/parent/calendar`, `#/parent/location`, `#/notifications`, `#/arrival-alerts`, `#/danger-alert`, `#/child/home`, `#/child/memo`, `#/child/sos` allowlist만 허용한다.
- [ ] 기존 클라이언트가 ledger migration 전에도 pending/parent_alerts로 동작하도록 호환 폴백을 유지한다.

### Task 5: Android 실제 게시 판정·대상 검증·라우팅

**Files:**
- Modify: `android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/LocationService.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/NativePushTokenSync.java`
- Create: `android/app/src/main/java/com/hyeni/calendar/PushTargetPolicy.java`
- Create: `android/app/src/main/java/com/hyeni/calendar/NotificationDeliveryPolicy.java`
- Modify: `android/app/src/test/java/com/hyeni/calendar/NotificationDeliveryPolicyTest.java`
- Modify: `android/app/src/test/java/com/hyeni/calendar/PushTargetPolicyTest.java`

**Interfaces:**

```java
public enum NotificationPostResult {
    POSTED, PERMISSION_DENIED, APP_NOTIFICATIONS_DISABLED,
    CHANNEL_DISABLED, INVALID_TARGET, FAILED
}

public static NotificationPostResult showNotification(/* existing args */);
```

- [ ] API 33 권한, `NotificationManagerCompat.areNotificationsEnabled()`, 채널 importance, `SecurityException`을 판정해 결과를 반환한다.
- [ ] FCM/pending/일정 게시 경로는 `POSTED`일 때만 `PolledNotificationStore.markAck`와 서버 displayed ACK를 호출한다.
- [ ] foreground라 UI로 실제 소비한 스티커 등은 별도 `displayed_in_app` 상태로 기록한다.
- [ ] 모든 data push에서 현재 prefs user/family/role과 target을 비교한 뒤 일반 알림·force ring·stop·remote listen·location 명령을 처리한다.
- [ ] `danger_exit`, `not_arrived`, `missed_arrival`은 full-screen이 아닌 일반 heads-up으로 고정한다.
- [ ] 서버 route allowlist를 `MainActivity` intent/hash로 전달하고 알림 탭 시 정확한 화면으로 연다.
- [ ] 로그아웃 세대가 바뀐 뒤 늦게 도착한 push와 token sync가 이전 세션을 되살리지 못하게 한다.
- [ ] JUnit 전체와 실제 채널 계측 테스트를 통과시킨다.

### Task 6: React 역할 가드·알림 유형·정직한 설정 UI

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/screens/feature/NotificationSettings.tsx`
- Modify: `src/screens/feature/NotificationSettings.css`
- Modify: `src/screens/feature/Notifications.tsx`
- Modify: `src/screens/feature/ArrivalAlerts.tsx`
- Modify: `src/screens/feature/DangerAlert.tsx`
- Modify: `src/screens/feature/PermDenied.tsx`
- Modify: `src/screens/child/ChildSettings.tsx`
- Modify: `src/transform/notificationsView.ts`
- Create: `tests/notificationRoleRoutes.test.mjs`
- Create: `tests/notificationCopyAndTypes.test.mjs`

- [ ] 부모 상세 화면을 하나의 `RequireRole role="parent"` 묶음으로, 아이 상세 화면을 child 묶음으로 이동한다.
- [ ] `notifications`, `notification-settings`, `arrival-alerts`, `danger-alert`, `sos-receive`, 위치·원격 제어 화면이 역할 밖에서 렌더되지 않는지 검사한다.
- [ ] `late_arrived`, `missed_arrival`, `danger_enter`, `danger_entry`, `low_battery`, `emergency`, `sos_followup`을 canonical mapping에 포함하고 잘못된 `battery_low` 의존을 제거한다.
- [ ] 위험 알림 빈 상태를 “최근 위험 알림이 없습니다”로 바꾸고 현재 안전을 단정하지 않는다.
- [ ] 가짜 localStorage 방해금지 토글을 제거하고 Android 알림 권한·앱 알림·채널 상태 및 “기기 알림 설정 열기”를 표시한다.
- [ ] 위치 알림 토글 설명은 도착·이탈만, 위험 알림은 설정과 무관한 필수 안전 알림임을 분리해 설명한다.
- [ ] 이모지와 inline hex를 lucide 아이콘·디자인 토큰으로 교체한다.
- [ ] ChildSettings는 실제 native 위치 서비스/권한 상태를 표시하고 확인 불가할 때 “항상 켜져 있어”라고 단정하지 않는다.
- [ ] PermDenied 버튼을 네이티브 `openNotificationSettings`/권한 설정과 웹 브라우저 안내에 실제 연결한다.

### Task 7: PWA Web Push 수신과 알림 클릭

**Files:**
- Modify: `vite.config.ts`
- Create: `src/sw.ts`
- Create: `src/lib/webPush.ts`
- Modify: `src/app/NativeBootstrap.tsx`
- Modify: `../hyeni-1/worker/routes/push-subscriptions.ts`
- Modify: `../hyeni-1/worker/routes/push-notify.ts`
- Create: `tests/webPushWiring.test.mjs`
- Create: `../hyeni-1/worker/tests/webPushSubscriptionAuthorization.test.mjs`

- [ ] Vite PWA를 기존 precache를 보존하는 `injectManifest`로 전환한다.
- [ ] 서비스 워커가 push payload target/route를 검증하고 `showNotification` 결과 뒤 displayed ACK를 보낸다.
- [ ] `notificationclick`은 같은 origin과 allowlist hash만 열거나 focus한다.
- [ ] 부모가 명시적으로 허용했을 때만 PushManager를 구독하고 현재 user/family에 서버 등록한다.
- [ ] 로그아웃 시 현재 endpoint 구독을 서버 해제하고 로컬 subscription도 정리한다.
- [ ] 서버는 endpoint를 다른 사용자에게 재바인딩하지 못하게 하고 FCM과 같은 `pushId`/ledger를 사용한다.
- [ ] iPhone 설치형 PWA와 일반 브라우저에서 미지원·권한거부 상태를 정직하게 안내한다.

### Task 8: 통합 검증·배포·문서·인수

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Update: this plan checklist

- [ ] 앱 `node --test tests/*.test.mjs tests/*.test.ts`, `npm run typecheck`, `npm run build`를 통과시킨다.
- [ ] Worker `node --test worker/tests/*.test.mjs`, `npx tsc --noEmit`을 통과시키고 additive migration 뒤 배포한다.
- [ ] 웹을 `.env` 없는 임시 디렉터리에서 Cloudflare Pages에 배포하고 배포 URL을 브라우저에서 확인한다.
- [ ] `npx cap sync android`와 `gradlew testDebugUnitTest assembleDebug`를 통과시킨다.
- [ ] S25·A17·razr에 `adb install -r`로 설치하고 버전·세션·현재 family 정본을 토큰 원문 없이 확인한다.
- [ ] 일정 사전/시작, 부모→아이 메모, 등록장소 도착, 위험지역 알림, 부모 위치 stale/복구를 실기기+D1 ledger로 교차 검증한다.
- [ ] 위험지역/SOS 실발사는 사용자 안전에 영향이 있으므로 실제 이동 없이 테스트 전용 로컬/허용된 테스트 사건으로만 검증하고 생성 데이터를 삭제한다.
- [ ] A17 토큰이 현재 가족으로 재등록되며 S25와 함께 부모 알림을 받는지 확인한다.
- [ ] 권한/채널을 의도적으로 끈 테스트 기기에서는 displayed가 기록되지 않고 UI에 복구 안내가 뜨는지 확인한 뒤 설정을 원복한다.
- [ ] 새 운영 규칙과 검증 함정을 `AGENTS.md`와 `CLAUDE.md`에 동일하게 기록한다.
- [ ] 변경 파일만 선별해 앱과 Worker 각각 `git diff --cached --check` 후 한국어 커밋을 만들고 원격 브랜치에 push한다.
- [ ] 독립 코드 리뷰에서 BLOCKER/HIGH가 없고 최종 전체 검증이 초록색인 경우에만 완료로 보고한다.

# 부모 관리 알림 조용한 시간 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 부모가 본인 계정과 활성 아이 계정별로 매일 반복되는 조용한 시간 1개를 설정하고, 일반 알림은 서버 생성 단계와 Android 표시 단계에서 억제하되 안전 예외와 위치·지오펜스 상태 진행은 보존한다.

**Architecture:** `notification_settings(user_id PK)`를 서버 정본으로 확장하고 Worker의 공통 수신자 정책이 pending·FCM·Web Push 생성 전에 사용자별로 필터한다. 웹은 부모 전용 가족 조회/부분 수정 API와 아이 본인 읽기 전용 조회를 사용하고, Android는 현재 세션 user id에 바인딩한 캐시와 공통 `NotificationHelper` 표시 경계로 늦게 도착한 일반 알림까지 방어한다. 억제 결과는 전달 성공으로 완료해 아침 재생과 지오펜스 재시도를 막는다.

**Tech Stack:** Cloudflare Worker · Hono · D1/SQLite · TypeScript · Node test runner · Vite 7 · React 19 · TanStack Query · 플레인 CSS · Capacitor 8 · Android Java · JUnit 4

## Global Constraints

- 모든 응답·주석·커밋 메시지는 한국어로 작성한다. 부모·페어링·구독 문구는 존댓말, 아이 모드 문구는 반말을 사용한다.
- 새 라이브러리를 추가하지 않고 현재 저장소의 TypeScript strict, React, CSS 토큰, Hono, D1, Capacitor 8, Java 패턴만 사용한다.
- 조용한 시간은 매일 같은 구간 1개이며 기본은 비활성, 초기 시간은 `22:00`부터 `07:00`, 시간대는 `Asia/Seoul`, 구간은 `[start, end)`이다.
- 분 값은 정수 `0..1439`만 허용하고 `start === end`는 저장을 거부한다.
- 부모 본인 설정은 설정한 부모 계정의 모든 기기에만 적용하며 다른 공동부모를 조회하거나 수정하지 않는다.
- 아이 설정은 활성 아이 user id별로 저장하고 부모만 변경한다. 전역 활성 아이를 바꾸거나 `children[0]`으로 폴백하지 않는다.
- 항상 전달·실행하는 명시 목록은 `sos`, `emergency`, `sos_followup`, `not_arrived`, `missed_arrival`, `danger_zone`, `danger_enter`, `danger_entry`, `danger_exit`, `force_ring`, `force_ring_stop`, `force_ring_reminder`, `remote_listen`, `remote_listen_stop`, `request_location`, `request_device_status`, Android 위치 foreground service이다.
- `urgent=true`, severity, 알림 채널 이름만으로 예외를 늘리지 않는다. `kkuk`, 스티커, 메모, 일정, 일반 도착·출발, AI, 놀이, 저배터리, 선생님 알림은 조용한 시간 적용 대상이다.
- quiet 수신자에는 pending·FCM·Web Push를 만들지 않고 `suppressed_quiet_hours` 성공으로 완료한다. 억제한 알림은 종료 뒤 재생하지 않는다.
- `parent_alerts` 이력, 위치 측정·저장, 지오펜스 평가·전이·상태 영속은 계속 수행한다.
- 설정 조회 실패 시 일반 알림은 `settings_unavailable`로 fail-closed하고 지연 재생하지 않는다. 명시적 안전 예외는 설정 조회 없이 전달한다.
- refresh token을 읽거나 출력하거나 회전하지 않는다. 연결 해제된 razr와 검증 제외 상태인 S25는 조작하지 않는다.
- 실기기 설치 대상은 A17 `RFKL40DP73J` 한 대뿐이다. 현재 부모모드 세션을 유지하고 `adb install -r`로 앱 데이터·세션·페어링을 보존한다. 아이 역할 전용 동작은 A17 계측 테스트와 브라우저 역할 검증으로 확인한다.
- 프로덕션 D1은 additive migration 1회만 적용하고 사전/사후 `PRAGMA table_info(notification_settings)` readback을 남긴다.

## 파일 구조와 책임

### `C:\Users\TK\Desktop\hyeni-1`

- Create `worker/db/notification-quiet-hours.sql`: 기존 운영 D1에 적용할 additive 컬럼 migration.
- Modify `cloudflare/schema_d1.sql`: fresh bootstrap 정본의 quiet 컬럼·기본값·CHECK 제약.
- Create `worker/lib/notificationQuietHours.ts`: KST 분 계산, 시간창, 명시 예외, batch 수신자 분할, 과거 pending 생성시각 판정.
- Modify `worker/lib/notificationSettingsAccess.ts`: 부모 본인+활성 아이 조회와 수정 대상 권한 판정.
- Modify `worker/routes/notif-settings.ts`: self GET 확장, 부모 family GET, quiet PUT, lease, 정확한 realtime/FCM control 전송.
- Modify `worker/lib/accountNotificationCleanup.ts`: 삭제 부모를 참조하는 `quiet_hours_updated_by`만 NULL 처리.
- Modify `worker/lib/parentAlertRecipients.ts`: 기존 종류별 토글 뒤 부모별 quiet 분할 결과 제공.
- Modify `worker/lib/pendingNotificationDelivery.ts`: 생성시각이 quiet 구간인 일반 pending을 미표시 완료 처리.
- Modify `worker/routes/parent-alerts.ts`: 부모 pending 생성 전 allowed 수신자만 사용.
- Modify `worker/routes/push-notify.ts`: generic/parent/child safety/schedule/not-arrived/playdate 경로의 공통 정책과 표시 없는 설정 동기화 command.
- Modify `worker/cron/_deliver.ts`: 부모·아이 모두 quiet인 경우도 성공으로 상태머신에 반환하는 계약 고정.
- Modify `worker/routes/stickers.ts`, `worker/routes/ai-proactive.ts`, `worker/routes/teacher-notices.ts`: 중앙 helper를 우회하는 직접 pending/FCM 경로에 같은 분할 적용.
- Modify `worker/routes/rest-shim-rpc.ts`: pending 조회가 생성시각 quiet 억제 결과를 사용하도록 연결.
- Modify `worker/tests/*.test.mjs`: 정책, 권한, durability, 직접 경로, schema, 삭제, 지오펜스 회귀.

### `C:\Users\TK\Desktop\hyeni-3`

- Create `src/transform/notificationQuietHours.ts`: 서버 row 정규화, 분↔time input, 한국어 범위 요약, draft 검증.
- Modify `src/lib/api/endpoints/notifications.ts`: self quiet read, family quiet GET, quiet PUT 타입과 방어적 응답 검증.
- Modify `src/queries/keys.ts`, `src/queries/useNotifications.ts`, `src/queries/useFamilyRealtime.ts`: target별 캐시·세션 소유권·직렬 mutation·정확한 realtime invalidation.
- Modify `src/screens/feature/NotificationSettings.tsx/.css`: 부모 대상 칩 1개 선택 편집기, 접근성, 반응형, 오류·저장 상태.
- Modify `src/screens/child/ChildSettings.tsx/.css`: 부모가 정한 시간을 본인 self row에서 읽기 전용으로 표시.
- Create `src/lib/native/notificationQuietHours.ts`: Capacitor `NativeNotification.setQuietHours` 호출 타입과 서버 self 설정 동기화.
- Modify `src/app/NativeBootstrap.tsx`: 앱 시작·foreground에서 self 정본을 Android에 동기화.
- Create `android/app/src/main/java/com/hyeni/calendar/NotificationQuietHoursPolicy.java`: type+alertType 명시 분류와 KST 시간창 순수 정책.
- Create `android/app/src/main/java/com/hyeni/calendar/NotificationQuietHoursStore.java`: session user-bound 원자 캐시와 최신성 검증.
- Modify `android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java`: 공통 표시 gate와 의도적 억제 receipt.
- Modify `android/app/src/main/java/com/hyeni/calendar/SessionTokenStore.java`: 로그아웃 동일 editor에서 quiet 캐시 제거.
- Modify `android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java`: WebView 설정 동기화와 show/showPending descriptor 전달.
- Modify `android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java`: control command 저장, 일반 FCM descriptor 전달, 명령·안전 예외 보존.
- Modify `android/app/src/main/java/com/hyeni/calendar/LocationService.java`: 인증된 self 정본 복구, local 일정·pending descriptor 전달, 지오펜스 무변경.
- Modify `android/app/src/main/java/com/hyeni/calendar/NotificationScheduleManager.java`, `ParentPendingRecoveryWorker.java`: 예약·복구 알림 descriptor 전달과 suppression ACK.
- Modify `tests/*`, Create Android unit/instrumentation tests: 웹·Android 계약과 실기기 미표시/예외 검증.
- Modify `AGENTS.md`, `CLAUDE.md`: 구현된 정본 계약·검증·배포 이력.

---

### Task 1: Worker 순수 정책과 정본 스키마

**Files:**
- Create: `C:\Users\TK\Desktop\hyeni-1\worker\lib\notificationQuietHours.ts`
- Create: `C:\Users\TK\Desktop\hyeni-1\worker\db\notification-quiet-hours.sql`
- Modify: `C:\Users\TK\Desktop\hyeni-1\cloudflare\schema_d1.sql:649`
- Create: `C:\Users\TK\Desktop\hyeni-1\worker\tests\notificationQuietHours.test.mjs`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\tests\canonicalSchemaBootstrap.test.mjs`

**Interfaces:**
- Consumes: D1 `notification_settings.user_id`와 `pgNow()`가 기록하는 UTC 시각 문자열.
- Produces:
  ```ts
  export const DEFAULT_NOTIFICATION_QUIET_HOURS: Readonly<NotificationQuietHours>;
  export interface NotificationQuietHours {
    enabled: boolean;
    startMinute: number;
    endMinute: number;
    updatedAt: string | null;
  }
  export interface QuietHoursNotificationIdentity {
    action: string;
    alertType?: string | null;
  }
  export function minuteOfDayInSeoul(nowMs: number): number;
  export function isQuietHoursActive(setting: NotificationQuietHours, minute: number): boolean;
  export function isQuietHoursBypass(identity: QuietHoursNotificationIdentity): boolean;
  export function isNotificationQuietAtMs(
    setting: NotificationQuietHours,
    identity: QuietHoursNotificationIdentity,
    nowMs: number,
  ): boolean;
  export async function partitionNotificationRecipients(
    db: D1Database,
    args: { userIds: Iterable<string>; identity: QuietHoursNotificationIdentity; atMs: number },
  ): Promise<{ allowed: Set<string>; suppressed: Set<string> }>;
  ```

- [ ] **Step 1: Worker feature branch를 만들고 RED 정책 테스트를 작성한다**

  Run:
  ```powershell
  Set-Location C:\Users\TK\Desktop\hyeni-1
  git switch -c codex/notification-quiet-hours
  ```

  테스트는 다음 고정 테이블을 사용한다.
  ```js
  import test from "node:test";
  import assert from "node:assert/strict";
  import {
    isQuietHoursActive,
    isQuietHoursBypass,
    minuteOfDayInSeoul,
  } from "../lib/notificationQuietHours.ts";

  const bypassCases = [
    ["sos", ""], ["emergency", ""], ["parent_alert", "sos_followup"],
    ["parent_alert", "not_arrived"], ["parent_alert", "missed_arrival"],
    ["parent_alert", "danger_zone"], ["parent_alert", "danger_enter"],
    ["parent_alert", "danger_entry"], ["parent_alert", "danger_exit"],
    ["force_ring", ""], ["force_ring_stop", ""], ["force_ring_reminder", ""],
    ["remote_listen", ""], ["remote_listen_stop", ""],
    ["request_location", ""], ["request_device_status", ""],
  ];
  const quietCases = [
    ["parent_alert", "arrived"], ["parent_alert", "place_arrived"],
    ["parent_alert", "place_left"], ["schedule_reminder", ""],
    ["new_memo", ""], ["sticker", ""], ["kkuk", ""],
    ["playdate_started", ""], ["ai_proactive", ""], ["teacher_notice", ""],
  ];

  test("22시부터 7시는 시작을 포함하고 종료를 제외한다", () => {
    const setting = { enabled: true, startMinute: 1320, endMinute: 420, updatedAt: null };
    assert.equal(isQuietHoursActive(setting, 1320), true);
    assert.equal(isQuietHoursActive(setting, 0), true);
    assert.equal(isQuietHoursActive(setting, 420), false);
    assert.equal(minuteOfDayInSeoul(Date.parse("2026-07-18T13:00:00.000Z")), 1320);
  });

  test("명시 예외만 quiet를 우회한다", () => {
    for (const [action, alertType] of bypassCases) {
      assert.equal(isQuietHoursBypass({ action, alertType }), true, `${action}/${alertType}`);
    }
    for (const [action, alertType] of quietCases) {
      assert.equal(isQuietHoursBypass({ action, alertType }), false, `${action}/${alertType}`);
    }
  });
  ```
  disabled, `13:00→15:00`, `22:00→07:00`, 22:00 포함, 07:00 제외, KST 변환, `urgent` 비사용, DB 오류 throw를 각각 독립 assertion으로 둔다.

- [ ] **Step 2: RED를 확인한다**

  Run:
  ```powershell
  node --test worker/tests/notificationQuietHours.test.mjs worker/tests/canonicalSchemaBootstrap.test.mjs
  ```
  Expected: `ERR_MODULE_NOT_FOUND` 또는 quiet 컬럼 assertion 실패.

- [ ] **Step 3: 순수 정책과 batch 조회를 구현한다**

  핵심 시간창과 예외는 다음 코드로 고정한다.
  ```ts
  const BYPASS_ACTIONS = new Set([
    "sos", "emergency", "force_ring", "force_ring_stop", "force_ring_reminder",
    "remote_listen", "remote_listen_stop", "request_location", "request_device_status",
  ]);
  const BYPASS_ALERT_TYPES = new Set([
    "sos", "emergency", "sos_followup", "not_arrived", "missed_arrival",
    "danger_zone", "danger_enter", "danger_entry", "danger_exit",
  ]);

  export function isQuietHoursActive(setting: NotificationQuietHours, minute: number): boolean {
    if (!setting.enabled || !Number.isInteger(minute) || minute < 0 || minute > 1439) return false;
    const { startMinute, endMinute } = setting;
    if (startMinute === endMinute) return false;
    return startMinute < endMinute
      ? startMinute <= minute && minute < endMinute
      : minute >= startMinute || minute < endMinute;
  }
  ```
  `partitionNotificationRecipients`는 예외면 DB를 읽지 않고 모두 allowed로 반환한다. 일반 알림은 `userIds.map(() => "?").join(",")`로 만든 bind marker를 사용해 `user_id IN (${markers})` 한 번으로 읽고, 행이 없는 user id는 기본 disabled로 허용하며 쿼리 실패는 throw한다.

- [ ] **Step 4: migration과 bootstrap 정본을 구현한다**

  `worker/db/notification-quiet-hours.sql`의 실제 SQL:
  ```sql
  ALTER TABLE notification_settings ADD COLUMN quiet_hours_enabled INTEGER NOT NULL DEFAULT 0 CHECK (quiet_hours_enabled IN (0, 1));
  ALTER TABLE notification_settings ADD COLUMN quiet_hours_start_minute INTEGER NOT NULL DEFAULT 1320 CHECK (quiet_hours_start_minute BETWEEN 0 AND 1439);
  ALTER TABLE notification_settings ADD COLUMN quiet_hours_end_minute INTEGER NOT NULL DEFAULT 420 CHECK (quiet_hours_end_minute BETWEEN 0 AND 1439);
  ALTER TABLE notification_settings ADD COLUMN quiet_hours_updated_by TEXT NULL;
  ALTER TABLE notification_settings ADD COLUMN quiet_hours_updated_at TEXT NULL;
  ```
  bootstrap `CREATE TABLE notification_settings`에도 같은 컬럼·기본값·CHECK를 직접 포함한다.

- [ ] **Step 5: GREEN을 확인한다**

  Run:
  ```powershell
  node --test worker/tests/notificationQuietHours.test.mjs worker/tests/canonicalSchemaBootstrap.test.mjs
  ```
  Expected: 두 파일 전체 PASS.

- [ ] **Step 6: Worker 정책 단위를 커밋한다**

  ```powershell
  git add worker/lib/notificationQuietHours.ts worker/db/notification-quiet-hours.sql cloudflare/schema_d1.sql worker/tests/notificationQuietHours.test.mjs worker/tests/canonicalSchemaBootstrap.test.mjs
  git commit -m "feat: 알림 조용한 시간 정책과 스키마를 추가"
  ```

### Task 2: 부모 가족 조회·부분 수정 API와 계정 삭제 정리

**Files:**
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\lib\notificationSettingsAccess.ts`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\routes\notif-settings.ts`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\lib\accountNotificationCleanup.ts`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\routes\push-notify.ts`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\tests\notificationSettingsAuthorization.test.mjs`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\tests\notificationAccountCleanup.test.mjs`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\tests\postDeleteMutationSafety.test.mjs`

**Interfaces:**
- Consumes: Task 1 `NotificationQuietHours`, `acquireAccountMutationLeases`, `releaseAccountMutationLeases`, `resolveCanonicalFamilyMembership`, `notifyPg`.
- Produces:
  ```ts
  export interface FamilyQuietHoursRecipient {
    target_user_id: string;
    role: "parent" | "child";
    enabled: boolean;
    start_minute: number;
    end_minute: number;
    updated_at: string | null;
    configured: boolean;
  }
  export async function loadFamilyQuietHoursRecipients(
    db: D1Database,
    args: { callerUserId: string; familyId: string },
  ): Promise<FamilyQuietHoursRecipient[] | null>;
  export async function validateQuietHoursTarget(
    db: D1Database,
    args: { callerUserId: string; familyId: string; targetUserId: string },
  ): Promise<"self_parent" | "active_child" | null>;
  ```

- [ ] **Step 1: API 권한과 삭제 RED 테스트를 작성한다**

  다음을 고정한다: parent self 성공, active child 성공, 다른 공동부모 403, 다른 가족 403, inactive child 404/403, child caller 403, `expected_parent_user_id` mismatch 409, 범위 밖/동일 시각 400, lease blocked 409, lease unavailable 503, 기존 self POST 뒤 quiet 컬럼 불변, 삭제 부모 참조만 NULL, 아이 quiet 행 유지.
  ```js
  test("quiet 수정은 부모 본인과 같은 가족 활성 아이로 한정한다", () => {
    const route = readFileSync(new URL("../routes/notif-settings.ts", import.meta.url), "utf8");
    assert.match(route, /put\("\/quiet-hours", requireAuth/);
    assert.match(route, /expected_parent_user_id/);
    assert.match(route, /validateQuietHoursTarget/);
    assert.match(route, /acquireAccountMutationLeases/);
    assert.match(route, /releaseAccountMutationLeases/);
    assert.doesNotMatch(route, /target_user_id\s*=\s*body\.target_user_id\s*\|\|\s*children\[0\]/);
  });

  test("기존 전체 저장 SQL은 quiet 컬럼을 갱신하지 않는다", () => {
    const route = readFileSync(new URL("../routes/notif-settings.ts", import.meta.url), "utf8");
    const selfPost = route.slice(route.indexOf('post("/"'), route.indexOf('put("/quiet-hours"')));
    assert.doesNotMatch(selfPost, /quiet_hours_(enabled|start_minute|end_minute)/);
  });
  ```

- [ ] **Step 2: RED를 확인한다**

  Run:
  ```powershell
  node --test worker/tests/notificationSettingsAuthorization.test.mjs worker/tests/notificationAccountCleanup.test.mjs worker/tests/postDeleteMutationSafety.test.mjs
  ```
  Expected: family/quiet-hours route 및 quiet 컬럼 assertion 실패.

- [ ] **Step 3: self GET과 가족 GET을 구현한다**

  self GET의 기존 필드에 아래 필드만 additive로 반환하고 self POST SQL은 변경하지 않는다.
  ```ts
  quiet_hours: {
    enabled: toBool(row.quiet_hours_enabled),
    start_minute: Number(row.quiet_hours_start_minute ?? 1320),
    end_minute: Number(row.quiet_hours_end_minute ?? 420),
    updated_at: row.quiet_hours_updated_at ?? null,
    configured: row.quiet_hours_updated_at != null,
  }
  ```
  `GET /family`는 canonical role이 parent인 호출자 본인과 `family_members.role='child' AND is_active=1 AND user_id IS NOT NULL`만 반환한다. 공동부모 행은 SQL 결과에 포함하지 않는다.

- [ ] **Step 4: `PUT /quiet-hours`를 lease와 재검증으로 구현한다**

  body 파싱 후 다음 scope를 정렬된 입력으로 잡는다.
  ```ts
  const leaseResult = await acquireAccountMutationLeases(c.env.DB, [
    { userId: user.sub, familyId },
    { userId: targetUserId, familyId },
  ]);
  if (leaseResult.status === "blocked") return c.json({ error: "account_mutation_blocked" }, 409);
  if (leaseResult.status === "unavailable") return c.json({ error: "account_mutation_unavailable" }, 503);
  try {
    const targetKind = await validateQuietHoursTarget(c.env.DB, {
      callerUserId: user.sub, familyId, targetUserId,
    });
    if (!targetKind) return c.json({ error: "quiet_hours_target_not_found" }, 403);
    // quiet 컬럼만 UPDATE 또는 기본 설정값을 포함한 INSERT
  } finally {
    await releaseAccountMutationLeases(c.env.DB, leaseResult.leases);
  }
  ```
  성공 realtime은 `notifyPg(c.env, familyId, "notification_settings", eventType, realtimeRow, null, { targetUserIds: [user.sub, targetUserId] })`로 제한하고 row에는 `user_id`, `family_id`만 노출한다.

- [ ] **Step 5: 표시 없는 설정 동기화 command를 구현한다**

  `handleInstantNotification`에 `notification_quiet_hours_updated`를 exact-target native command로 추가한다. 활성 가족 user id와 `targetUserId`가 일치할 때만 해당 사용자의 active FCM endpoint로 보내고 pending·Web Push를 만들지 않는다. payload는 다음 키만 포함한다.
  ```ts
  {
    action: "notification_quiet_hours_updated",
    type: "notification_quiet_hours_updated",
    familyId,
    targetUserId,
    enabled: enabled ? "true" : "false",
    startMinute: String(startMinute),
    endMinute: String(endMinute),
    timeZoneId: "Asia/Seoul",
    updatedAt,
  }
  ```
  API 저장 성공 뒤 best-effort로 호출하고, command 전달 실패는 토큰·endpoint 없이 운영 로그에 남긴다. 저장 응답은 정본 row를 그대로 반환하며 앱 시작 복구 경로가 누락 command를 보정한다.

- [ ] **Step 6: 삭제 참조 정리를 구현한다**

  `deleteUserNotificationStateStmts`의 own-row DELETE 앞에 다음 statement를 넣는다.
  ```ts
  db.prepare(
    "UPDATE notification_settings SET quiet_hours_updated_by = NULL WHERE quiet_hours_updated_by = ? AND user_id <> ?",
  ).bind(userId, userId)
  ```

- [ ] **Step 7: GREEN과 Worker typecheck를 확인한다**

  Run:
  ```powershell
  node --test worker/tests/notificationSettingsAuthorization.test.mjs worker/tests/notificationAccountCleanup.test.mjs worker/tests/postDeleteMutationSafety.test.mjs
  Set-Location worker
  npx tsc --noEmit
  Set-Location ..
  ```
  Expected: 전체 PASS, TypeScript exit 0.

- [ ] **Step 8: API 단위를 커밋한다**

  ```powershell
  git add worker/lib/notificationSettingsAccess.ts worker/routes/notif-settings.ts worker/lib/accountNotificationCleanup.ts worker/routes/push-notify.ts worker/tests/notificationSettingsAuthorization.test.mjs worker/tests/notificationAccountCleanup.test.mjs worker/tests/postDeleteMutationSafety.test.mjs
  git commit -m "feat: 부모 관리 알림 시간 API를 추가"
  ```

### Task 3: 부모 안전 알림·pending·지오펜스 전달 억제

**Files:**
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\lib\parentAlertRecipients.ts`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\lib\pendingNotificationDelivery.ts`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\routes\parent-alerts.ts`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\routes\push-notify.ts`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\routes\rest-shim-rpc.ts`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\cron\_deliver.ts`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\tests\parentAlertRecipients.test.mjs`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\tests\pendingNotificationOwnership.test.mjs`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\tests\parentAlertRoute.test.mjs`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\tests\childSafetyNotifications.test.mjs`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\tests\registeredPlaceGeofence.test.mjs`

**Interfaces:**
- Consumes: Task 1 `partitionNotificationRecipients`, `isNotificationQuietAtMs`.
- Produces:
  ```ts
  export async function loadParentAlertRecipients(
    db: D1Database,
    familyId: string,
    alertType: string,
    atMs?: number,
  ): Promise<{ allowed: Set<string>; suppressed: Set<string> }>;
  ```
  `handleInstantNotification` 성공 JSON에 `suppressedQuietHours: string[]`를 추가하며 `Response.ok === true`를 유지한다.

- [ ] **Step 1: 공동부모·아이·pending·상태머신 RED 테스트를 작성한다**

  고정 시나리오:
  - quiet parent A만 제외되고 parent B는 pending/FCM/Web Push 대상.
  - parent quiet/child allowed와 parent allowed/child quiet가 독립.
  - 모두 quiet여도 `parent_alerts` 1행, pending 0행, push 0건, `pushOk=true`.
  - `place_arrived`/`place_left` quiet suppression 뒤 geofence phase/episode가 진행되고 다음 cron에서 같은 episode를 재전송하지 않음.
  - `danger_exit`, `not_arrived`는 quiet 중에도 허용.
  - quiet 설정 DB 오류인 일반 arrival는 503 또는 suppressed success로 외부 전달 0건.
  - quiet 시간에 생성된 과거 일반 pending은 오전 조회에서 결과 0행이고 delivered/suppressed 상태로 완료.
  ```js
  test("일반 등록장소 알림의 quiet 억제도 상태 전이 성공이다", () => {
    const deliver = readFileSync(new URL("../cron/_deliver.ts", import.meta.url), "utf8");
    const geofence = readFileSync(
      new URL("../cron/registered-place-geofence-check.ts", import.meta.url),
      "utf8",
    );
    assert.match(deliver, /suppressedQuietHours/);
    assert.match(geofence, /pushOk\s*&&\s*alertId/);
    assert.doesNotMatch(geofence, /quietHours[\s\S]*saveGeoState/);
  });

  test("과거 quiet pending은 표시하지 않고 완료한다", () => {
    const source = readFileSync(
      new URL("../lib/pendingNotificationDelivery.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /isNotificationQuietAtMs/);
    assert.match(source, /suppressed["']?,\s*["']quiet_hours/);
    assert.match(source, /delivered\s*=\s*1/);
  });
  ```

- [ ] **Step 2: RED를 확인한다**

  Run:
  ```powershell
  node --test worker/tests/parentAlertRecipients.test.mjs worker/tests/pendingNotificationOwnership.test.mjs worker/tests/parentAlertRoute.test.mjs worker/tests/childSafetyNotifications.test.mjs worker/tests/registeredPlaceGeofence.test.mjs
  ```
  Expected: quiet recipient/result assertion 실패.

- [ ] **Step 3: 부모·아이 수신자를 pending 전에 분할한다**

  `loadParentAlertRecipients`는 기존 `registered_place_enabled`/`location_enabled` 필터 후 Task 1 분할을 적용한다. `parent-alerts.ts`와 `handleInstantNotification`은 `allowed`만 pending/FCM/Web Push/claim에 넘기고 `suppressed`는 성공 통계로 합친다. `sendChildSafetyNotification`도 대상 아이 한 명을 별도로 분할하며 suppressed이면 `true`를 반환한다.

- [ ] **Step 4: 과거 pending을 생성시각 기준으로 소진한다**

  `loadPendingNotificationsForRecipient`는 대상 검증 뒤 후보를 읽고 data의 `type|action`, `alertType|alert_type`, `created_at`을 Task 1 정책에 넣는다. 일반 알림이 quiet이면 결과에서 제외하고 다음 형태로 완료한다.
  ```sql
  UPDATE pending_notifications
     SET delivered = 1,
         delivered_at = ?,
         delivery_status = json_set(COALESCE(delivery_status, '{}'),
           '$.suppressed', 'quiet_hours', '$.targetUserId', ?)
   WHERE id IN (?)
     AND delivered = 0
  ```
  실제 구현은 억제 id 수만큼 D1 bind marker를 만들고 한 UPDATE로 실행한다. 예외 명령은 기존 display pending 필터를 유지한다.

- [ ] **Step 5: 지오펜스 성공 의미를 고정한다**

  `deliverParentAlert`의 `res.ok && childPushOk` 계약에서 quiet suppression은 둘 다 true로 처리한다. `registered-place-geofence-check.ts`의 기존 `pushOk && alertId`와 Android `/api/parent-alerts` 2xx 후 `saveGeoState`는 quiet 분기로 감싸지 않는다.

- [ ] **Step 6: GREEN을 확인한다**

  Run:
  ```powershell
  node --test worker/tests/parentAlertRecipients.test.mjs worker/tests/pendingNotificationOwnership.test.mjs worker/tests/parentAlertRoute.test.mjs worker/tests/childSafetyNotifications.test.mjs worker/tests/registeredPlaceGeofence.test.mjs
  ```
  Expected: 전체 PASS.

- [ ] **Step 7: 안전 전달 단위를 커밋한다**

  ```powershell
  git add worker/lib/parentAlertRecipients.ts worker/lib/pendingNotificationDelivery.ts worker/routes/parent-alerts.ts worker/routes/push-notify.ts worker/routes/rest-shim-rpc.ts worker/cron/_deliver.ts worker/tests/parentAlertRecipients.test.mjs worker/tests/pendingNotificationOwnership.test.mjs worker/tests/parentAlertRoute.test.mjs worker/tests/childSafetyNotifications.test.mjs worker/tests/registeredPlaceGeofence.test.mjs
  git commit -m "fix: 조용한 시간의 안전 알림 전달을 분리"
  ```

### Task 4: 일정·메모·스티커·놀이·AI·선생님 일반 전달 경로 완결

**Files:**
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\routes\push-notify.ts`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\routes\stickers.ts`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\routes\ai-proactive.ts`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\routes\teacher-notices.ts`
- Create: `C:\Users\TK\Desktop\hyeni-1\worker\tests\notificationQuietHoursWiring.test.mjs`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\tests\scheduleNotificationReliability.test.mjs`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\tests\instantNotificationDurability.test.mjs`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\tests\playdateNotificationRecipients.test.mjs`

**Interfaces:**
- Consumes: Task 1 `partitionNotificationRecipients`와 Task 3 suppression 성공 통계.
- Produces: 모든 표시형 알림이 pending/FCM/Web Push 전에 동일한 user-id 분할을 통과한다.

- [ ] **Step 1: 직접 경로 배선 RED 테스트를 작성한다**

  `notificationQuietHoursWiring.test.mjs`는 다음 source 위치에서 `partitionNotificationRecipients` 호출이 pending/FCM 호출보다 먼저 나타나는지 고정한다.
  ```js
  import test from "node:test";
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";

  const guardedPaths = [
    ["routes/push-notify.ts", "prequeueGenericRecipientPending"],
    ["routes/push-notify.ts", "schedulePendingId"],
    ["routes/push-notify.ts", "handlePlaydateStarted"],
    ["routes/push-notify.ts", "handlePlaydateEnded"],
    ["routes/stickers.ts", "sendFcmToFamily"],
    ["routes/ai-proactive.ts", "INSERT OR IGNORE INTO pending_notifications"],
    ["routes/teacher-notices.ts", "sendFcm"],
  ];

  test("직접 알림 경로는 외부 전달 전에 quiet 분할을 사용한다", () => {
    for (const [relativePath, deliveryMarker] of guardedPaths) {
      const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
      const quietIndex = source.indexOf("partitionNotificationRecipients");
      const deliveryIndex = source.indexOf(deliveryMarker);
      assert.ok(quietIndex >= 0, `${relativePath}: quiet 분할 없음`);
      assert.ok(deliveryIndex > quietIndex, `${relativePath}: quiet 분할보다 전달이 먼저 실행됨`);
    }
  });
  ```
  runtime 테스트는 quiet recipient의 pending/Web/FCM 0건, allowed 공동수신자의 1건, 설정 DB 오류 fail-closed를 검사한다.

- [ ] **Step 2: RED를 확인한다**

  Run:
  ```powershell
  node --test worker/tests/notificationQuietHoursWiring.test.mjs worker/tests/scheduleNotificationReliability.test.mjs worker/tests/instantNotificationDurability.test.mjs worker/tests/playdateNotificationRecipients.test.mjs
  ```
  Expected: 새 wiring assertion 실패.

- [ ] **Step 3: `handleInstantNotification` 공통 gate를 claim·pending 전으로 이동한다**

  `effectiveParentRecipientIds`와 명시 `genericRecipientIds`를 확정한 직후 다음 형태로 분할한다.
  ```ts
  const quietPartition = await partitionNotificationRecipients(db, {
    userIds: resolvedRecipientIds,
    identity: { action, alertType },
    atMs: Date.now(),
  });
  resolvedRecipientIds = Array.from(quietPartition.allowed);
  suppressedQuietHours = suppressedQuietHours.concat(Array.from(quietPartition.suppressed));
  ```
  이 코드는 `prequeueGenericRecipientPending`, parent `insertPending`, idempotency claim, Web Push, FCM보다 앞에 둔다. allowed가 0이면 `200`과 `{webSent:0,fcmSent:0,total:0,suppressedQuietHours:Array.from(quietPartition.suppressed)}`를 반환한다.

- [ ] **Step 4: cron schedule과 not-arrived를 분리한다**

  schedule은 parent/child group의 recipient set을 `schedule_reminder`로 분할하고 allowed만 `schedulePendingId` 루프에 넣는다. 억제 recipient는 이번 occurrence의 실패/재시도 대상으로 만들지 않는다. not-arrived는 alertType `not_arrived`라 Task 1 예외로 그대로 pending·push한다.

- [ ] **Step 5: playdate·sticker·AI·teacher 직접 경로를 연결한다**

  각 경로는 실제 active recipient user id를 계산한 직후 다음 identity로 분할한다.
  ```ts
  const identities = {
    playdate_started: { action: "playdate_started" },
    playdate_ended: { action: "playdate_ended" },
    sticker: { action: "sticker" },
    kkuk: { action: "kkuk" },
    ai_proactive: { action: "ai_proactive" },
    teacher_notice: { action: "teacher_notice" },
  } as const;
  ```
  외부 채널이 없는 recipient라도 quiet이면 pending을 만들지 않는다. 메모 outbox는 기존 interaction lease와 permit을 먼저 검증한 뒤, 외부 전송/pending 직전에 quiet 분할하고 suppressed를 성공으로 닫는다.

- [ ] **Step 6: GREEN과 Worker 전체 회귀를 확인한다**

  Run:
  ```powershell
  node --test worker/tests/notificationQuietHoursWiring.test.mjs worker/tests/scheduleNotificationReliability.test.mjs worker/tests/instantNotificationDurability.test.mjs worker/tests/playdateNotificationRecipients.test.mjs
  node --test worker/tests/*.test.mjs
  Set-Location worker
  npx tsc --noEmit
  Set-Location ..
  ```
  Expected: Worker 전체 PASS, TypeScript exit 0.

- [ ] **Step 7: 일반 전달 단위를 커밋한다**

  ```powershell
  git add worker/routes/push-notify.ts worker/routes/stickers.ts worker/routes/ai-proactive.ts worker/routes/teacher-notices.ts worker/tests/notificationQuietHoursWiring.test.mjs worker/tests/scheduleNotificationReliability.test.mjs worker/tests/instantNotificationDurability.test.mjs worker/tests/playdateNotificationRecipients.test.mjs
  git commit -m "feat: 일반 알림 전달에 조용한 시간을 적용"
  ```

### Task 5: 웹 타입·변환·API·Query 계층

**Files:**
- Create: `src/transform/notificationQuietHours.ts`
- Modify: `src/lib/api/endpoints/notifications.ts`
- Modify: `src/queries/keys.ts`
- Modify: `src/queries/useNotifications.ts`
- Modify: `src/queries/useFamilyRealtime.ts`
- Create: `tests/notificationQuietHours.test.ts`
- Modify: `tests/notificationSettingsReliability.test.ts`

**Interfaces:**
- Consumes: Worker `GET /api/notif-settings`, `GET /api/notif-settings/family`, `PUT /api/notif-settings/quiet-hours`.
- Produces:
  ```ts
  export interface NotificationQuietHours {
    enabled: boolean;
    startMinute: number;
    endMinute: number;
    updatedAt: string | null;
    configured: boolean;
  }
  export interface NotificationQuietHoursDraft {
    enabled: boolean;
    startMinute: number;
    endMinute: number;
  }
  export function minuteOfDayToTimeInput(value: number): string;
  export function timeInputToMinuteOfDay(value: string): number | null;
  export function isValidNotificationQuietHours(value: NotificationQuietHoursDraft): boolean;
  export function notificationQuietHoursRange(value: NotificationQuietHoursDraft): string;
  export interface SavedNotificationQuietHours {
    targetUserId: string;
    quietHours: NotificationQuietHours;
    updatedAt: string;
  }
  export interface SaveNotificationQuietHoursVariables {
    targetUserId: string;
    quietHours: NotificationQuietHoursDraft;
  }
  export function useFamilyNotificationQuietHours(): UseQueryResult<FamilyNotificationQuietHours, Error>;
  export function useSaveNotificationQuietHours(): UseMutationResult<SavedNotificationQuietHours, Error, SaveNotificationQuietHoursVariables>;
  ```

- [ ] **Step 1: 변환·API·세션 소유권 RED 테스트를 작성한다**

  `1320→22:00`, `420→07:00`, `0`, `1439`, 잘못된 HH:MM, 동일 시각 거부, `밤 10시부터 아침 7시까지`를 검사한다. API는 snake_case 검증, parent-only query, `expected_parent_user_id`, 가족 단위 mutation scope, session instance 변경 중단, target 응답 mismatch throw, self POST에 `quiet_hours_*`가 없음을 검사한다.
  ```ts
  import test from "node:test";
  import assert from "node:assert/strict";
  import {
    isValidNotificationQuietHours,
    minuteOfDayToTimeInput,
    notificationQuietHoursRange,
    timeInputToMinuteOfDay,
  } from "../src/transform/notificationQuietHours.ts";

  test("quiet 분과 입력 시간을 손실 없이 변환한다", () => {
    assert.equal(minuteOfDayToTimeInput(1320), "22:00");
    assert.equal(minuteOfDayToTimeInput(420), "07:00");
    assert.equal(timeInputToMinuteOfDay("00:00"), 0);
    assert.equal(timeInputToMinuteOfDay("23:59"), 1439);
    assert.equal(timeInputToMinuteOfDay("24:00"), null);
    assert.equal(timeInputToMinuteOfDay("7:00"), null);
  });

  test("같은 시작과 종료는 저장할 수 없다", () => {
    assert.equal(isValidNotificationQuietHours({ enabled: true, startMinute: 600, endMinute: 600 }), false);
    assert.equal(notificationQuietHoursRange({ enabled: true, startMinute: 1320, endMinute: 420 }), "밤 10시부터 아침 7시까지");
  });
  ```

- [ ] **Step 2: RED를 확인한다**

  Run:
  ```powershell
  node --test tests/notificationQuietHours.test.ts tests/notificationSettingsReliability.test.ts
  ```
  Expected: module/function assertion 실패.

- [ ] **Step 3: transform을 구현한다**

  기본값과 time input 변환은 다음 계약을 사용한다.
  ```ts
  export const DEFAULT_NOTIFICATION_QUIET_HOURS: NotificationQuietHours = {
    enabled: false,
    startMinute: 1320,
    endMinute: 420,
    updatedAt: null,
    configured: false,
  };

  export function minuteOfDayToTimeInput(value: number): string {
    if (!Number.isInteger(value) || value < 0 || value > 1439) return "";
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  }
  ```
  한국어 시간대는 1~5시 `새벽`, 6~9시 `아침`, 10~11시 `오전`, 12시 `낮`, 13~17시 `오후`, 18~20시 `저녁`, 21~23시 `밤`, 0시 `자정`으로 정규화하고 분이 0이 아니면 `N분`을 붙인다.

- [ ] **Step 4: endpoint 타입과 방어적 파서를 구현한다**

  `NotifSettings`에 `quietHours: NotificationQuietHours`를 read-only 의미로 추가하되 `saveNotifSettings` body에는 quiet 필드를 싣지 않는다. family recipient는 다음 camelCase로 정규화한다.
  ```ts
  export interface FamilyNotificationQuietHoursRecipient {
    targetUserId: string;
    role: "parent" | "child";
    quietHours: NotificationQuietHours;
  }
  export interface FamilyNotificationQuietHours {
    familyId: string;
    recipients: FamilyNotificationQuietHoursRecipient[];
  }
  ```
  가족/target/role/boolean/분 범위/updatedAt 타입이 맞지 않으면 한국어 Error를 throw한다.

- [ ] **Step 5: Query와 realtime을 구현한다**

  key:
  ```ts
  familyNotificationQuietHours: (familyId: string) =>
    ["notif-settings", "family-quiet-hours", familyId] as const,
  ```
  mutation scope는 target별 `notif-quiet-hours:${familyId}:${targetUserId}`로 직렬화한다. hook 생성 시 캡처한 parent user id와 `getApiSessionInstanceId()`를 mutation 직전에 다시 비교한다. 성공 시 family cache의 정확한 `targetUserId`만 불변 갱신하고, self target이면 `qk.notifSettings(userId)`의 `quietHours`도 갱신한다. realtime `notification_settings` 이벤트는 family quiet key를 무효화하고 row user id와 self/child-status key를 기존대로 정밀 갱신한다.

- [ ] **Step 6: GREEN과 typecheck를 확인한다**

  Run:
  ```powershell
  node --test tests/notificationQuietHours.test.ts tests/notificationSettingsReliability.test.ts
  npm run typecheck
  ```
  Expected: 전체 PASS, TypeScript exit 0.

- [ ] **Step 7: 웹 데이터 계층을 커밋한다**

  ```powershell
  git add src/transform/notificationQuietHours.ts src/lib/api/endpoints/notifications.ts src/queries/keys.ts src/queries/useNotifications.ts src/queries/useFamilyRealtime.ts tests/notificationQuietHours.test.ts tests/notificationSettingsReliability.test.ts
  git commit -m "feat: 알림 시간 웹 데이터 계층을 추가"
  ```

### Task 6: 부모 편집 UI와 아이 읽기 전용 UI

**Files:**
- Modify: `src/screens/feature/NotificationSettings.tsx`
- Modify: `src/screens/feature/NotificationSettings.css`
- Modify: `src/screens/child/ChildSettings.tsx`
- Modify: `src/screens/child/ChildSettings.css`
- Modify: `tests/notificationUiReliability.test.ts`
- Create: `tests/notificationQuietHoursUi.test.mjs`

**Interfaces:**
- Consumes: Task 5 hooks/transform과 기존 `useMyFamily()`의 `FamilyMember.user_id/name/role`.
- Produces: `/notification-settings` 대상 칩 편집기와 `/child/settings` 본인 read-only summary.

- [ ] **Step 1: UI 계약 RED 테스트를 작성한다**

  다음 source/DOM 계약을 고정한다: `내 알림` 칩, 모든 active child user id 칩, 미연결 아이 disabled 안내, `type="time"`, 명시 `적용`, 동일 시각 오류, 첫 아이 폴백 부재, global active child setter 부재, 아이 화면 quiet save hook 부재, parent/child 문체, localStorage DND 부재, OS 문구에서 방해금지 제거, 44px min-height, 390px 2열, 360px 1열, 가로 overflow 없음.
  ```js
  import test from "node:test";
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";

  const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

  test("부모는 명시 대상을 선택하고 아이는 읽기만 한다", () => {
    const parent = readSource("src/screens/feature/NotificationSettings.tsx");
    const child = readSource("src/screens/child/ChildSettings.tsx");
    assert.match(parent, />내 알림</);
    assert.match(parent, /type="time"/);
    assert.match(parent, />적용</);
    assert.match(parent, /아이 기기 연결이 필요해요/);
    assert.doesNotMatch(parent, /children\[0\]/);
    assert.match(child, /알림 쉬는 시간이 설정되지 않았어/);
    assert.doesNotMatch(child, /useSaveNotificationQuietHours/);
  });

  test("quiet UI는 44px 조작 영역과 작은 화면 1열을 유지한다", () => {
    const css = readSource("src/screens/feature/NotificationSettings.css");
    assert.match(css, /nst-quiet[\s\S]*min-height:\s*44px/);
    assert.match(css, /@media\s*\(max-width:\s*360px\)[\s\S]*grid-template-columns:\s*1fr/);
  });
  ```

- [ ] **Step 2: RED를 확인한다**

  Run:
  ```powershell
  node --test tests/notificationUiReliability.test.ts tests/notificationQuietHoursUi.test.mjs
  ```
  Expected: 새 UI selector/copy assertion 실패.

- [ ] **Step 3: 부모 대상 칩과 단일 draft 편집기를 구현한다**

  대상 목록은 `내 알림`을 먼저 넣고 family 응답의 child recipient를 `useMyFamily().members`의 동일 `user_id`로 이름 결합한다. user id가 없는 child member는 저장 대상이 아니며 별도 안내만 렌더한다. 초기 선택은 부모 본인이고 child 응답 순서나 `children[0]`을 기본값으로 쓰지 않는다.

  편집 상태는 `{targetUserId, enabled, startMinute, endMinute}`로 유지하고 선택 target 또는 그 target의 서버 row가 바뀔 때만 재hydrate한다. 저장 호출 당시 target과 응답 target이 다르면 화면에 반영하지 않는다. 버튼은 `dirty && valid && !isPending`일 때만 활성화한다.

  고정 문구:
  ```text
  조용한 시간에는 일정·메시지·일반 도착·출발 알림을 보내지 않아요.
  SOS·긴급·위험구역 알림은 이 시간에도 항상 전달돼요.
  알림 소리와 진동은 휴대폰 또는 브라우저 설정에서 관리해 주세요.
  ```

- [ ] **Step 4: 부모 UI 오류와 접근성을 구현한다**

  family quiet query loading/error는 기존 유형 토글·OS 설정 전체를 막지 않고 새 그룹 안에서만 skeleton/error/retry로 표시한다. query 실패 시 기본값 seed와 저장을 닫는다. 칩은 `aria-pressed`, switch는 `role="switch"`와 `aria-checked`, time input은 visible label, 저장 결과는 `aria-live="polite"`로 알린다.

- [ ] **Step 5: 아이 본인 읽기 전용 요약을 구현한다**

  기존 `useNotifSettings()`의 `quietHours`를 `부모님이 정한 거` 섹션에 추가한다. 활성은 `${notificationQuietHoursRange(value)} 알림을 쉬어`, 비활성은 `알림 쉬는 시간이 설정되지 않았어`, query 실패는 기존 전체 재시도 화면을 유지한다. 이 행은 button/input이 아니며 `useSaveNotificationQuietHours`를 import하지 않는다. 기존 일정 알림 토글 저장은 quiet 필드를 body에 보내지 않는다.

- [ ] **Step 6: 반응형 CSS를 구현한다**

  `.nst-quiet__time-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); }`, 모든 interactive control `min-height:44px`, 입력 `min-width:0;width:100%`를 적용한다. `@media (max-width: 360px)`에서 time grid를 1열로 바꾸고, 기존 디자인 토큰 외 새 색상 하드코딩을 추가하지 않는다.

- [ ] **Step 7: GREEN과 build를 확인한다**

  Run:
  ```powershell
  node --test tests/notificationUiReliability.test.ts tests/notificationQuietHoursUi.test.mjs
  npm run typecheck
  npm run build
  ```
  Expected: 전체 PASS, build exit 0.

- [ ] **Step 8: UI 단위를 커밋한다**

  ```powershell
  git add src/screens/feature/NotificationSettings.tsx src/screens/feature/NotificationSettings.css src/screens/child/ChildSettings.tsx src/screens/child/ChildSettings.css tests/notificationUiReliability.test.ts tests/notificationQuietHoursUi.test.mjs
  git commit -m "feat: 부모와 아이 알림 시간 화면을 추가"
  ```

### Task 6b: 온보딩·권한 화면 디자인 감사 후속

**Files:**
- Modify: `src/screens/onboarding/Onboarding.tsx`
- Modify: `src/screens/onboarding/Onboarding.css`
- Modify: `src/screens/feature/PermDenied.tsx`
- Modify only if needed: `src/screens/feature/PermDenied.css`
- Modify: `tests/designSystemUsage.test.mjs`
- Verify: `tests/imageLoadingContract.test.mjs`, `tests/globalErrorSafety.test.mjs`, `tests/permissionCopyDensity.test.mjs`, `tests/backgroundLocationDisclosure.test.mjs`

- [ ] 역할 선택의 child/teacher 이미지 `object-fit`과 `object-position:center top` 회귀를 먼저 고정한다.
- [ ] `.ob-role-terms a`를 `inline-flex`, `align-items:center`, `min-height:var(--control-min-size)`로 만들어 실제 44px 조작 영역을 보장한다.
- [ ] `PermDenied` Lucide 26px를 24px로, QR Camera 15px를 16px로 맞춘다.
- [ ] 권한 목록 `예정` 배지의 인라인 typography를 caption size·line-height·weight 토큰 CSS class로 이동한다.
- [ ] `/perm-denied`의 제목+한 문장+설정 경로+두 CTA와 백그라운드 위치 3문단 Play 공개 안내는 축약·삭제하지 않는다.
- [ ] 관련 Node 테스트, typecheck, build, diff-check를 통과한 뒤 `fix: 온보딩과 권한 화면 터치 영역을 정리`로 커밋한다.

### Task 6c: 안전지표 시스템 앱 행 이중 필터

**Files:**
- Modify: `src/transform/deviceAppUsageView.ts`
- Modify: `tests/deviceAppUsageView.test.ts`
- Modify: `android/app/src/main/java/com/hyeni/calendar/DeviceStatusReporter.java`
- Modify: `android/app/src/test/java/com/hyeni/calendar/DeviceStatusReporterTest.java`

- [ ] 합성 `recentApp/appUsage`에 `시스템 자녀 보호 기능`을 넣어 recent/top/most-used 노출 RED를 확인한다.
- [ ] 표시 계층에서 확인된 이름 `시스템 자녀 보호 기능`·공백 변형·`System parental controls`와 기존 settings/systemui/permissioncontroller/packageinstaller/launcher 패키지를 canonical 비교로 제외한다.
- [ ] Android는 기존 명시 시스템 표면·HOME 제외 뒤 `FLAG_SYSTEM|FLAG_UPDATED_SYSTEM_APP`이면서 `getLaunchIntentForPackage(pkg)==null`인 패키지만 추가 제외한다. 조회 실패는 미확인 앱을 숨기지 않는다.
- [ ] 시스템 플래그+런처 없음, updated-system+런처 없음은 제외하고 시스템+런처 있음, 일반 앱+런처 없음은 유지하는 JVM 테스트를 추가한다.
- [ ] Usage Access 권한 판정은 필터 뒤 빈 목록으로 오판하지 않는다. ParentHome·DailySafetyReport/API 계약은 공용 변환을 그대로 사용한다.
- [ ] 관련 Node·Android unit 테스트, typecheck, diff-check를 통과한 뒤 `fix: 안전지표에서 시스템 앱을 제외`로 커밋한다.

### Task 6d: 설명문 상자·줄바꿈 전수 정리

**Files:**
- Modify: `src/styles/components.css`
- Modify: 순수 설명문을 렌더하는 기존 TSX/CSS
- Create: `tests/explanatoryCopyStyle.test.mjs`

- [ ] 공통 `.hy-explain`을 무테두리·무그림자, `type-body-sm`, 행간 1.55, `word-break:keep-all`, `overflow-wrap:anywhere`, `text-wrap:pretty`로 정의한다.
- [ ] `.hy-explain__lines/.hy-explain__line`으로 두 문장 이상 핵심 설명을 4px 간격의 문장별 block으로 나눈다.
- [ ] 최소 필수 대상은 `.nst-safety-note`, `.ra-trust-card`, `.ra-webnote`, `.tt-note`이며 배경·아이콘·정책 내용·독립 버튼은 유지한다.
- [ ] AiSchedule/AiCredit/LocationSettings/LocationStatus/PhoneSetup/PairingWizard/RemoteAudio/RemoteAudioAudit/Subscription/Onboarding/ParentAccount/SocialLinks/TeacherReleaseGate/ChildSettings와 인라인 보조 설명 후보를 명시적으로 공통화한다.
- [ ] `*-note` 전역 치환은 금지한다. 오류·경고·재시도·attention·SOS·차단·권한 정책 모달, 클릭 카드, 데이터 요약, PlaydateAccept 인용문은 제외한다.
- [ ] 정적 회귀, 신뢰 copy, 디자인 시스템, typecheck, build를 통과한 뒤 `style: 설명문을 무테두리로 정리`로 커밋한다.

### Task 7: Android 순수 정책·세션 저장소·공통 표시 receipt

**Files:**
- Create: `android/app/src/main/java/com/hyeni/calendar/NotificationQuietHoursPolicy.java`
- Create: `android/app/src/main/java/com/hyeni/calendar/NotificationQuietHoursStore.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/SessionTokenStore.java`
- Create: `android/app/src/test/java/com/hyeni/calendar/NotificationQuietHoursPolicyTest.java`
- Create: `android/app/src/test/java/com/hyeni/calendar/NotificationQuietHoursStoreTest.java`
- Modify: `android/app/src/test/java/com/hyeni/calendar/NotificationDeliveryReceiptTest.java`
- Modify: `android/app/src/test/java/com/hyeni/calendar/SessionTokenStoreAtomicContextTest.java`

**Interfaces:**
- Consumes: `SessionTokenStore.readContext(prefs).userId`, SharedPreferences `hyeni_location_prefs`.
- Produces:
  ```java
  final class NotificationQuietHoursPolicy {
      enum Decision { ALLOW, SUPPRESS, COMMAND }
      static final class NotificationIdentity {
          final String type;
          final String alertType;
          static NotificationIdentity of(String type, String alertType);
      }
      static boolean isMinuteInsideWindow(boolean enabled, int startMinute, int endMinute, int nowMinute);
      static Decision decide(NotificationQuietHoursStore.Snapshot snapshot,
          NotificationIdentity identity, long nowMs);
  }
  ```
  ```java
  final class NotificationQuietHoursStore {
      enum SaveResult { SAVED, STALE_SESSION, STALE_UPDATE, INVALID_POLICY }
      static final class Snapshot {
          final String userId;
          final boolean enabled;
          final int startMinute;
          final int endMinute;
          final String timeZoneId;
          final long updatedAtMs;
      }
      static synchronized Snapshot read(SharedPreferences prefs);
      static synchronized SaveResult saveIfCurrentSession(SharedPreferences prefs,
          String expectedUserId, boolean enabled, int startMinute, int endMinute,
          String timeZoneId, long updatedAtMs);
      static NotificationQuietHoursPolicy.Decision decide(Context context,
          NotificationQuietHoursPolicy.NotificationIdentity identity, long nowMs);
  }
  ```

- [ ] **Step 1: Java RED 단위 테스트를 작성한다**

  disabled, 같은 날, 자정 횡단, start 포함, end 제외, start=end fail-open, 범위 밖 fail-open, KST 고정, 일반 type suppress, 전체 명시 예외 allow, `kkuk` suppress, 명령 COMMAND, 다른 user 저장 거부, 오래된 updatedAt 거부, logout key 제거를 각각 검사한다.
  ```java
  @Test
  public void overnightWindowIncludesStartAndExcludesEnd() {
      assertTrue(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 1320, 420, 1320));
      assertTrue(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 1320, 420, 0));
      assertFalse(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 1320, 420, 420));
      assertFalse(NotificationQuietHoursPolicy.isMinuteInsideWindow(true, 1320, 420, 900));
  }

  @Test
  public void quietSuppressionAcknowledgesWithoutPosting() {
      NotificationHelper.DeliveryReceipt receipt = NotificationHelper.DeliveryReceipt.forStatus(
          NotificationHelper.DeliveryStatus.QUIET_HOURS_SUPPRESSED
      );
      assertTrue(receipt.shouldAcknowledge());
      assertFalse(receipt.wasPostedNow());
  }
  ```

- [ ] **Step 2: RED를 확인한다**

  Run:
  ```powershell
  Set-Location android
  .\gradlew.bat testDebugUnitTest --tests com.hyeni.calendar.NotificationQuietHoursPolicyTest --tests com.hyeni.calendar.NotificationQuietHoursStoreTest --tests com.hyeni.calendar.NotificationDeliveryReceiptTest --tests com.hyeni.calendar.SessionTokenStoreAtomicContextTest
  Set-Location ..
  ```
  Expected: class/enum 없음으로 compile failure.

- [ ] **Step 3: 순수 정책을 구현한다**

  Java allowlist는 Task 1과 같은 action/alertType 문자열을 정확히 사용한다. `COMMAND`는 `request_location`, `request_device_status`, `notification_quiet_hours_updated`만 반환한다. `force_ring*`과 `remote_listen*`은 직접 경로에서 먼저 실행되며 `decide`에 들어오면 명시 ALLOW다. 정책은 channel이나 `urgent`를 입력으로 받지 않아 `kkuk`가 emergency channel이라는 이유로 우회되지 않게 한다.

- [ ] **Step 4: session-bound 저장소를 구현한다**

  key는 다음 여섯 개로 고정한다.
  ```java
  static final String KEY_USER_ID = "notificationQuietHoursUserId";
  static final String KEY_ENABLED = "notificationQuietHoursEnabled";
  static final String KEY_START_MINUTE = "notificationQuietHoursStartMinute";
  static final String KEY_END_MINUTE = "notificationQuietHoursEndMinute";
  static final String KEY_TIME_ZONE = "notificationQuietHoursTimeZone";
  static final String KEY_UPDATED_AT_MS = "notificationQuietHoursUpdatedAtMs";
  ```
  저장 직전 `SessionTokenStore.readContext(prefs).userId`가 expected user와 같은지 재검사한다. 같은 user의 더 오래된 updatedAt은 거부하며 transient fetch 실패는 기존 snapshot을 지우지 않는다.

- [ ] **Step 5: Helper receipt와 logout 원자 제거를 구현한다**

  `DeliveryStatus`에 `QUIET_HOURS_SUPPRESSED(true, false)`를 추가한다. 새 overload는 기존 인자 뒤에 `NotificationIdentity`를 받고, createChannels 뒤 권한·채널·dedupe·wake lock·`nm.notify`보다 먼저 store decision을 검사한다. SUPPRESS면 receipt만 반환하고 `markPosted`를 호출하지 않는다.

  `SessionTokenStore.clear(SharedPreferences prefs, String requestedRetiringSessionNonce)`의 기존 단일 `SharedPreferences.Editor`에 quiet 여섯 key `.remove(key)`를 추가한다. 별도 editor를 만들지 않는다.

- [ ] **Step 6: GREEN을 확인한다**

  Run:
  ```powershell
  Set-Location android
  .\gradlew.bat testDebugUnitTest --tests com.hyeni.calendar.NotificationQuietHoursPolicyTest --tests com.hyeni.calendar.NotificationQuietHoursStoreTest --tests com.hyeni.calendar.NotificationDeliveryReceiptTest --tests com.hyeni.calendar.SessionTokenStoreAtomicContextTest
  Set-Location ..
  ```
  Expected: 전체 PASS.

- [ ] **Step 7: Android 정책 단위를 커밋한다**

  ```powershell
  git add android/app/src/main/java/com/hyeni/calendar/NotificationQuietHoursPolicy.java android/app/src/main/java/com/hyeni/calendar/NotificationQuietHoursStore.java android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java android/app/src/main/java/com/hyeni/calendar/SessionTokenStore.java android/app/src/test/java/com/hyeni/calendar/NotificationQuietHoursPolicyTest.java android/app/src/test/java/com/hyeni/calendar/NotificationQuietHoursStoreTest.java android/app/src/test/java/com/hyeni/calendar/NotificationDeliveryReceiptTest.java android/app/src/test/java/com/hyeni/calendar/SessionTokenStoreAtomicContextTest.java
  git commit -m "feat: Android 알림 시간 표시 정책을 추가"
  ```

### Task 8: Android 동기화와 모든 일반 표시 진입점 배선

**Files:**
- Create: `src/lib/native/notificationQuietHours.ts`
- Modify: `src/app/NativeBootstrap.tsx`
- Modify: `android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/LocationService.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/NotificationScheduleManager.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/ParentPendingRecoveryWorker.java`
- Create: `tests/androidNotificationQuietHoursWiring.test.mjs`
- Modify: `tests/androidNotificationSafetyWiring.test.mjs`
- Create: `android/app/src/androidTest/java/com/hyeni/calendar/NotificationQuietHoursDeviceTest.java`

**Interfaces:**
- Consumes: Task 5 `fetchNotifSettings()`의 `quietHours`, Task 7 store/policy/helper overload.
- Produces:
  ```ts
  export interface NativeQuietHoursInput {
    userId: string;
    enabled: boolean;
    startMinute: number;
    endMinute: number;
    timeZoneId: "Asia/Seoul";
    updatedAtMs: number;
  }
  export async function syncNativeNotificationQuietHours(input: NativeQuietHoursInput): Promise<boolean>;
  ```

- [ ] **Step 1: TS/Java wiring RED 테스트를 작성한다**

  source 테스트는 Helper gate가 `wasRecentlyPosted`/`nm.notify`보다 앞인지, FCM control command가 display 전에 return하는지, FCM/pending/local/AlarmManager/WorkManager callsite가 exact type+alertType descriptor를 넘기는지, quiet receipt가 ACK되는지, command가 display ACK로 바뀌지 않는지, geofence/sendPlaceAlert가 quiet 조건에 감싸지지 않는지 검사한다.

  instrumentation test는 현재 prefs snapshot을 보존한 뒤 현재 user용 quiet를 활성화하고 일반 `schedule_reminder`가 active notification을 만들지 않으면서 ACK되는지, `parent_alert/not_arrived`가 게시되는지 확인하고 notification과 prefs를 finally에서 원복한다.
  ```js
  import test from "node:test";
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";

  const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

  test("Android 일반 표시 경로는 exact identity를 Helper에 전달한다", () => {
    const fcm = readSource("android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java");
    const service = readSource("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
    const plugin = readSource("android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java");
    assert.match(fcm, /NotificationIdentity\.of\(type, alertType\)/);
    assert.match(service, /NotificationIdentity\.of\(type, alertType\)/);
    assert.match(plugin, /NotificationIdentity\.of\(type, alertType\)/);
    assert.match(fcm, /notification_quiet_hours_updated[\s\S]*saveIfCurrentSession[\s\S]*return/);
  });
  ```

- [ ] **Step 2: RED를 확인한다**

  Run:
  ```powershell
  node --test tests/androidNotificationQuietHoursWiring.test.mjs tests/androidNotificationSafetyWiring.test.mjs
  Set-Location android
  .\gradlew.bat testDebugUnitTest
  Set-Location ..
  ```
  Expected: plugin method/descriptor assertion 실패.

- [ ] **Step 3: Capacitor 동기화 method와 TS adapter를 구현한다**

  `NotificationPlugin.setQuietHours(PluginCall)`은 userId/boolean/분/timeZoneId/updatedAtMs를 검증하고 store에 저장한다. 응답은 `{saved:true,reason:"saved"}` 또는 `{saved:false,reason:"stale_session"|"stale_update"|"invalid_policy"}`다. TS adapter는 native가 아니면 true no-op, plugin 부재/저장 거부는 false를 반환한다.

- [ ] **Step 4: 앱 시작·foreground self 정본 동기화를 구현한다**

  `NativeBootstrap`에서 authenticated parent|child + native일 때 `fetchNotifSettings()`를 호출하고 현재 `getApiUser()?.id`와 effect의 userId, session instance가 모두 같은 경우에만 plugin에 전달한다. `updatedAt`이 null이면 `0`을 전달해 기본 disabled를 현재 user에 바인딩한다. 앱 시작 즉시와 `App.addListener("appStateChange")`의 active 전환에서 실행하고 fetch 실패 시 Android 기존 cache를 지우지 않는다.

- [ ] **Step 5: FCM control과 일반 표시 descriptor를 구현한다**

  `MyFirebaseMessagingService`는 `NotificationTargetPolicy` 통과 직후 `notification_quiet_hours_updated` action/type을 처리한다. target user 일치, `Asia/Seoul`, 분 범위, ISO updatedAt 파싱이 모두 성공할 때만 store 저장 후 return한다. 세션 토큰·endpoint·nonce를 로그에 남기지 않는다.

  일반 FCM helper 호출에는 `NotificationIdentity.of(type, alertType)`를 전달한다. `kkuk`의 full-screen/channel 동작은 quiet가 아닐 때 그대로 유지하지만 quiet policy 예외로 올리지 않는다. `force_ring`, `remote_listen`, `request_location`, `request_device_status`, foreground service 직접 경로는 Helper quiet gate 전에 기존대로 처리한다.

- [ ] **Step 6: local/pending/예약/복구 callsite를 배선한다**

  `LocationService.checkEventTimes`의 2분 network refresh cycle은 이벤트 배열과 독립적으로 인증된 `GET /api/notif-settings`를 호출한다. 응답 `user_id`가 `SessionTokenStore.readContext(prefs).userId`와 같을 때만 quiet row를 store에 저장하고, 401이면 기존 `networkRefreshAccessToken()` single-flight 후 1회 재시도한다. 빈 이벤트 배열·일시 네트워크 실패는 기존 cache를 지우지 않으며 위치 upload/geofence 흐름을 막지 않는다.

  - `LocationService.fireLocalEventReminders`: `event_reminder`, 빈 alertType.
  - `LocationService.showPolledNotification`: JSON의 exact type/alertType.
  - `NotificationPlugin.show`: call의 type 기본 `local_notification`, alertType.
  - `NotificationPlugin.showPending`: pending의 exact type/alertType.
  - `NotificationScheduleManager`: 예약 item의 type/alertType을 Intent extra에 보존하고 기본 `scheduled_notification`.
  - `ParentPendingRecoveryWorker`: pending data의 exact type/alertType.

  모든 SUPPRESS receipt는 `shouldAcknowledge=true`, `wasPostedNow=false`라 local shown set/PolledNotificationStore/server delivered가 완료된다.

- [ ] **Step 7: GREEN, lint, assemble을 확인한다**

  Run:
  ```powershell
  node --test tests/androidNotificationQuietHoursWiring.test.mjs tests/androidNotificationSafetyWiring.test.mjs
  npm run typecheck
  npm run build
  npx cap sync android
  Set-Location android
  .\gradlew.bat testDebugUnitTest
  .\gradlew.bat lintDebug
  .\gradlew.bat assembleDebug
  Set-Location ..
  ```
  Expected: 전부 exit 0, debug APK 생성.

- [ ] **Step 8: Android 배선을 커밋한다**

  ```powershell
  git add src/lib/native/notificationQuietHours.ts src/app/NativeBootstrap.tsx android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java android/app/src/main/java/com/hyeni/calendar/LocationService.java android/app/src/main/java/com/hyeni/calendar/NotificationScheduleManager.java android/app/src/main/java/com/hyeni/calendar/ParentPendingRecoveryWorker.java tests/androidNotificationQuietHoursWiring.test.mjs tests/androidNotificationSafetyWiring.test.mjs android/app/src/androidTest/java/com/hyeni/calendar/NotificationQuietHoursDeviceTest.java android/app/src/main/assets/public
  git commit -m "feat: Android 모든 알림 경로에 조용한 시간을 연결"
  ```

### Task 9: 문서 정본과 전체 로컬 검증

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Verify: 두 저장소의 의도한 변경 파일 전체

**Interfaces:**
- Consumes: Tasks 1–8의 최종 계약.
- Produces: 다음 세션이 구현 상태·예외 목록·배포 순서를 재현할 수 있는 정본 문서.

- [ ] **Step 1: 문서 회귀 RED assertion을 추가한다**

  `tests/notificationQuietHoursUi.test.mjs`에서 AGENTS/CLAUDE에 `notification quiet hours`, user-id 계정 단위, KST, 억제 성공, 안전 예외, migration 파일명이 존재하는지 검사한다.
  ```js
  test("운영 문서는 조용한 시간 정본과 배포 순서를 보존한다", () => {
    const docs = `${readSource("AGENTS.md")}\n${readSource("CLAUDE.md")}`;
    assert.match(docs, /notification-quiet-hours\.sql/);
    assert.match(docs, /Asia\/Seoul/);
    assert.match(docs, /suppressed_quiet_hours/);
    assert.match(docs, /A17[\s\S]*(단독|한 대)/);
    assert.match(docs, /razr[\s\S]*(연결 해제|미조작)/);
  });
  ```

- [ ] **Step 2: RED를 확인한다**

  Run:
  ```powershell
  node --test tests/notificationQuietHoursUi.test.mjs
  ```
  Expected: 문서 계약 assertion 실패.

- [ ] **Step 3: AGENTS.md와 CLAUDE.md를 갱신한다**

  다음 내용을 실제 구현 파일명과 함께 기록한다: 부모 self+active child 계정 단위, `22:00→07:00` disabled 기본, `Asia/Seoul`, pending 전 필터, suppression ACK, 명시 안전 예외, `kkuk` 일반 적용, Android session-bound cache, D1 migration-before-Worker, A17 단독 실기기 검증 및 razr·S25 미조작.

- [ ] **Step 4: 두 저장소 전체 자동 검증을 실행한다**

  Worker:
  ```powershell
  Set-Location C:\Users\TK\Desktop\hyeni-1
  node --test worker/tests/*.test.mjs
  Set-Location worker
  npx tsc --noEmit
  Set-Location C:\Users\TK\Desktop\hyeni-3
  ```
  App:
  ```powershell
  node --test tests/*.test.*
  npm run typecheck
  npm run build
  npx cap sync android
  Set-Location android
  .\gradlew.bat testDebugUnitTest
  .\gradlew.bat lintDebug
  .\gradlew.bat assembleDebug
  Set-Location ..
  ```
  Expected: 모든 명령 exit 0. `git status --short`에 `tsconfig.app.tsbuildinfo`, `output/`, report artifact가 나타나면 stage하지 않는다.

- [ ] **Step 5: 문서와 검증 보정을 커밋한다**

  App:
  ```powershell
  git add AGENTS.md CLAUDE.md tests/notificationQuietHoursUi.test.mjs
  git commit -m "docs: 알림 조용한 시간 운영 계약을 기록"
  ```

### Task 10: 브라우저 UI·D1·Worker·Pages·실기기 배포 검증

**Files:**
- Deploy: `C:\Users\TK\Desktop\hyeni-1\worker\db\notification-quiet-hours.sql`
- Deploy: `C:\Users\TK\Desktop\hyeni-3\dist`
- Install: `C:\Users\TK\Desktop\hyeni-3\android\app\build\outputs\apk\debug\app-debug.apk`
- Verify: A17 `RFKL40DP73J` only; razr와 S25는 미조작

**Interfaces:**
- Consumes: 로컬 전체 PASS와 두 저장소의 clean intended commits.
- Produces: 프로덕션 schema/Worker/Pages와 A17의 최신 빌드 설치·검증 증거.

- [ ] **Step 1: 브라우저에서 부모·아이 UI를 먼저 검수한다**

  `superpowers:verification-before-completion`과 `playwright-interactive`를 읽고 사용한다. `npm run dev -- --host 127.0.0.1`을 실행해 HTTP 200을 확인하고 실제 로그인 세션에서 `/notification-settings`와 아이 설정 화면을 390×844, 360×800, 데스크톱으로 연다. 대상 칩, teacher/child 이미지 clipping 회귀, 텍스트 밀도, 폰트·여백·아이콘·44px 조작 영역, overflow 0, console error 0을 스크린샷과 DOM 측정으로 확인한다.

- [ ] **Step 2: 프로덕션 D1 사전 readback과 additive migration을 적용한다**

  ```powershell
  Set-Location C:\Users\TK\Desktop\hyeni-1\worker
  npx wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_info(notification_settings)"
  npx wrangler d1 execute hyeni-calendar --remote --file db/notification-quiet-hours.sql
  npx wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_info(notification_settings)"
  ```
  Expected: 사전에는 신규 컬럼이 없고, migration 성공 후 다섯 컬럼과 기본값 `0`, `1320`, `420`이 보인다. 이미 컬럼이 있으면 migration을 재실행하지 않고 readback과 적용 이력을 확인한다.

- [ ] **Step 3: Worker를 배포하고 인증 API smoke를 수행한다**

  ```powershell
  npx wrangler deploy
  ```
  Expected: `hyeni-calendar-api.tkisdroid.workers.dev` 새 version 배포 성공. 앱의 실제 로그인 세션을 통해 family GET과 self/child PUT을 실행하고 다른 공동부모가 응답에 없는지 확인한다. access token은 도구 내부 요청 header에만 사용하고 출력·파일 저장하지 않는다.

- [ ] **Step 4: Pages를 `.env` 없는 임시 디렉터리에서 배포한다**

  ```powershell
  Set-Location C:\Users\TK\Desktop\hyeni-3
  npm run build
  $hyeniPagesDir = Join-Path ([System.IO.Path]::GetTempPath()) ("hyeni-pages-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $hyeniPagesDir | Out-Null
  Push-Location $hyeniPagesDir
  npx wrangler pages deploy C:/Users/TK/Desktop/hyeni-3/dist --project-name=hyeni-calendar --branch=main --commit-dirty=true
  Pop-Location
  ```
  Expected: `https://hyeni-calendar.pages.dev` 배포 성공, 새 세션 HTTP 200, console error 0.

- [ ] **Step 5: debug APK를 A17에만 세션 보존 설치한다**

  ```powershell
  Set-Location C:\Users\TK\Desktop\hyeni-3
  adb -s RFKL40DP73J install -r android/app/build/outputs/apk/debug/app-debug.apk
  adb -s RFKL40DP73J shell dumpsys package com.hyeni.calendar | Select-String "versionName|versionCode|lastUpdateTime"
  ```
  Expected: A17 install `Success`, 앱 데이터·부모 계정·세션 삭제 없음. razr와 S25 serial을 사용하는 명령은 실행하지 않는다.

- [ ] **Step 6: A17 instrumentation과 실제 부모 역할 화면을 검증한다**

  ```powershell
  Set-Location android
  $env:ANDROID_SERIAL = "RFKL40DP73J"
  .\gradlew.bat connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.hyeni.calendar.NotificationQuietHoursDeviceTest
  Remove-Item Env:ANDROID_SERIAL
  Set-Location ..
  ```
  Expected: A17 PASS, test가 격리된 test prefs/notification을 finally에서 원복. A17 실제 부모 홈과 대상 칩 저장을 확인하고 역할 선택 화면으로 로그아웃되지 않았는지 확인한다. 아이 홈 읽기 전용 문구와 아이 수신 정책은 브라우저 역할 검증 및 A17 instrumentation으로 확인하며 A17 실제 계정은 전환하지 않는다.

- [ ] **Step 7: 서버 계정 단위 교차 검증과 원복을 수행한다**

  A17 부모 UI에서 현재 KST를 포함하는 quiet 구간을 부모 본인과 활성 아이 계정에 서로 다른 분 값으로 저장한다. A17 앱 재시작 뒤 부모 본인 값과 아이 대상 값을 다시 확인한다. 아이 화면의 읽기 전용 표시와 일반 schedule 미표시·`not_arrived` 예외 표시는 브라우저 역할 검증 및 Step 6 A17 instrumentation으로 확인한다. Worker의 `notificationQuietHours`, `registeredPlaceGeofence`, `pendingNotificationOwnership` runtime 결과로 pending 0·상태 전이·지연 재생 없음을 연결해 기록한다. 프로덕션에 가짜 안전 알림을 생성하지 않는다. 두 quiet 설정은 검증 전 GET snapshot으로 PUT 원복하고 instrumentation notification은 finally에서 취소한다. A17 실제 계정의 로그아웃·역할 전환·재페어링은 하지 않는다.

### Task 11: 최종 fresh review, merge, push, 원격 SHA 확인

**Files:**
- Review: 두 저장소 feature branch 전체 diff
- Merge target: 두 저장소 `main`
- Push target: 두 저장소 `origin/main`

**Interfaces:**
- Consumes: Task 10 운영/기기 검증 PASS와 원복 완료.
- Produces: clean main, 원격 main SHA, 배포·기기 상태 분리 보고.

- [ ] **Step 1: fresh-context 코드 리뷰를 수행한다**

  `superpowers:requesting-code-review`를 읽고 fresh subagent에게 두 저장소 diff를 승인 설계·보안·회귀 기준으로 검토시킨다. 지적은 severity와 파일/line 증거로 받고, 실제 문제는 RED 테스트 추가→수정→전체 relevant test 재실행으로 닫는다.

- [ ] **Step 2: completion 검증을 다시 실행한다**

  `superpowers:verification-before-completion`을 읽고 다음을 재확인한다.
  ```powershell
  Set-Location C:\Users\TK\Desktop\hyeni-1
  node --test worker/tests/*.test.mjs
  Set-Location worker
  npx tsc --noEmit
  Set-Location C:\Users\TK\Desktop\hyeni-3
  node --test tests/*.test.*
  npm run typecheck
  npm run build
  Set-Location android
  .\gradlew.bat testDebugUnitTest lintDebug assembleDebug
  Set-Location ..
  ```
  Expected: 모두 exit 0.

- [ ] **Step 3: 의도한 파일만 커밋됐는지 확인한다**

  ```powershell
  git status --short
  git diff --check
  git log --oneline --decorate -8
  Set-Location C:\Users\TK\Desktop\hyeni-1
  git status --short
  git diff --check
  git log --oneline --decorate -8
  ```
  Expected: 두 worktree clean, whitespace 오류 없음. 생성 artifact와 사용자 기존 변경을 포함하지 않는다.

- [ ] **Step 4: 두 feature branch를 main에 non-destructive merge한다**

  App:
  ```powershell
  Set-Location C:\Users\TK\Desktop\hyeni-3
  git switch main
  git pull --ff-only origin main
  git merge --no-ff codex/notification-quiet-hours -m "merge: 알림 조용한 시간 기능을 반영"
  ```
  Worker:
  ```powershell
  Set-Location C:\Users\TK\Desktop\hyeni-1
  git switch main
  git pull --ff-only origin main
  git merge --no-ff codex/notification-quiet-hours -m "merge: 알림 조용한 시간 서버 기능을 반영"
  ```
  충돌이 발생하면 사용자 변경과 feature 변경을 파일별로 보존한 뒤 relevant test를 다시 실행하고 merge를 완료한다. `reset --hard`와 checkout 기반 폐기는 사용하지 않는다.

- [ ] **Step 5: main을 push하고 원격 SHA를 확인한다**

  ```powershell
  git push origin main
  $hyeniWorkerLocal = git rev-parse HEAD
  $hyeniWorkerRemote = (git ls-remote origin refs/heads/main).Split("`t")[0]
  if ($hyeniWorkerLocal -ne $hyeniWorkerRemote) { throw "Worker origin/main SHA 불일치" }
  Set-Location C:\Users\TK\Desktop\hyeni-3
  git push origin main
  $hyeniAppLocal = git rev-parse HEAD
  $hyeniAppRemote = (git ls-remote origin refs/heads/main).Split("`t")[0]
  if ($hyeniAppLocal -ne $hyeniAppRemote) { throw "App origin/main SHA 불일치" }
  ```
  Expected: 두 push 성공, local/remote SHA 일치.

- [ ] **Step 6: 최종 상태를 분리 보고한다**

  다음 다섯 줄을 실제 값으로 보고한다: 문제 원인, 수정 방식, 자동 검증 결과, Worker/Pages 배포 version 및 commit SHA, A17 단독 설치·부모 화면·계측 교차검증 상태. 테스트 설정 원복 여부와 razr 연결 해제·미조작 및 S25 미조작도 명시한다.

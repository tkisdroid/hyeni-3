# Global Native Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Android 앱별 언어와 Web locale을 동기화하고, Android UI·채널·포그라운드 서비스와 Worker FCM/Web Push/pending 알림을 각 endpoint 언어로 안전하게 표시하며 AI 출력 언어까지 일관되게 전달한다.

**Architecture:** `locales/{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}/android.json`과 `notifications.json`을 공용 정본으로 삼아 Android XML/Java lookup 및 Worker TypeScript catalog를 생성한다. locale은 계정이 아니라 `fcm_tokens`/`push_subscriptions` endpoint 행에 저장한다. 신규 알림은 allowlisted `messageKey/messageVersion/messageArgs`가 정본이고 기존 title/body는 한국어 구버전 호환용이다. Android와 Service Worker는 구조화 payload를 검증한 뒤 자신의 locale로 렌더한다.

**Tech Stack:** Capacitor 8, Java, Android AppCompat per-app locales, Android resources, Firebase Messaging, React/TypeScript bridge, Hono Worker, D1 additive migrations, React Intl/IntlMessageFormat catalog generation, Web Push, Service Worker, Node test runner, JUnit

## Global Constraints

- 이 계획은 `2026-08-15-global-i18n-web.md` Task 1~4 완료 뒤 실행한다.
- 모든 FCM의 `familyId`, `targetUserId`, optional `targetRole` 검증과 `NotificationTargetPolicy`를 유지한다.
- FCM API 200/`delivered_at`은 표시 증거가 아니다. 기존 `acknowledged_at`, native/Web shown ACK 계약을 유지한다.
- quiet hours는 pending 생성과 표시보다 먼저 적용하며 SOS/emergency/위험/미도착/force ring/remote listen/위치·기기 상태 명령 예외를 유지한다.
- `memoDisplayPermit`이 필요한 메모는 서버 재승인 성공 뒤에만 표시·ACK한다.
- 주변소리는 서버 승인 증표·nonce·가족·아이 일치 후 최대 60초만 캡처하며, 아이 화면·알림·감사 기록을 숨기지 않는다.
- 현행 수신자 집합을 넓히지 않는다. 아이 계정에는 위험·emergency·SOS만 전달하고 일상 도착·출발·부모용 일정 알림을 새로 보내지 않는다.
- 기존 endpoint 행은 `ko`로 backfill한다. 사용자/가족 전체 언어 컬럼을 추가하지 않는다.
- `messageArgs`에 token, 좌표, 원문 오류, 자유 JSON, 메모/AI 원문을 넣지 않는다.
- `messageKey`가 없는 payload만 legacy title/body로 표시한다. `messageKey`가 있으나 알 수 없거나 args가 잘못된 payload는 미표시·미ACK한다.
- Android 생성 resource는 수동 수정하지 않는다. `--check`가 diff를 검출해야 한다.
- 운영 migration/Worker 배포는 수행하지 않는다. 로컬 migration dress rehearsal과 dry-run까지만 한다.
- 신규 `worker/tests/*.test.mjs`가 Worker TypeScript를 import하면 파일 첫 부분에서 `./helpers/tsModuleResolve.mjs`를 직접 import한다. 존재하지 않는 root 공용 loader를 CLI `--import`로 가정하지 않는다.

---

## File Structure

### Android locale generation

- `scripts/i18n/generate-android-locales.mjs`
- `scripts/i18n/scan-android-user-strings.mjs`
- `android/app/src/main/res/xml/locales_config.xml`
- `android/app/src/main/res/values/strings.xml`
- `android/app/src/main/res/values-en/strings.xml`
- `android/app/src/main/res/values-ja/strings.xml`
- `android/app/src/main/res/values-b+zh+Hans/strings.xml`
- `android/app/src/main/res/values-b+zh+Hant/strings.xml`
- `android/app/src/main/res/values-vi/strings.xml`
- `android/app/src/main/res/values-th/strings.xml`
- `android/app/src/main/res/values-b+id/strings.xml`
- `android/app/src/main/res/values-ms/strings.xml`
- `android/app/src/main/res/values-b+fil/strings.xml`
- `android/app/src/main/java/com/hyeni/calendar/generated/NotificationMessageResources.java`

### Android locale runtime

- `android/app/src/main/java/com/hyeni/calendar/AppLocalePolicy.java`
- `android/app/src/main/java/com/hyeni/calendar/AppLocalePlugin.java`
- `android/app/src/test/java/com/hyeni/calendar/AppLocalePolicyTest.java`
- `src/lib/native/appLocale.ts`
- `tests/nativeAppLocaleBridge.test.mjs`

### Endpoint locale and notification catalog

- `worker/db/notification-endpoint-locale.sql`
- `worker/lib/notificationLocale.ts`
- `worker/lib/notificationMessage.ts`
- `worker/generated/notificationCatalog.ts`
- `worker/tests/notificationEndpointLocale.test.mjs`
- `worker/tests/notificationMessageCatalog.test.mjs`
- `worker/tests/localizedNotificationDelivery.test.mjs`
- `tests/structuredNotification.test.ts`
- `tests/webPushLocaleHandshake.test.mjs`

### Modified integration files

- `cloudflare/schema_d1.sql`
- `worker/types.ts`, `worker/index.ts`, `worker/lib/healthReadiness.ts`
- `worker/lib/notificationEndpointOwnership.ts`, `worker/lib/fcm.ts`, `worker/lib/webpush.ts`, `worker/lib/pendingNotificationDelivery.ts`
- `worker/routes/rest-shim-rpc.ts`, `worker/routes/push-subscriptions.ts`, `worker/routes/push-notify.ts`, `worker/routes/parent-alerts.ts`
- `worker/cron/push-notify.ts`, `worker/cron/teacher-notification-batch.ts`, `worker/cron/registered-place-geofence-check.ts`, `worker/cron/unregistered-stay-check.ts`
- `worker/routes/ai-child-chat.ts`, `worker/routes/ai-proactive.ts`, `worker/routes/ai.ts`
- `src/lib/native/push.ts`, `src/lib/webPush.ts`, `src/sw.ts`, `src/app/NativeBootstrap.tsx`
- `src/lib/api/endpoints/notifications.ts`, `src/lib/api/endpoints/ai.ts`, `src/lib/api/endpoints/remote.ts`
- `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/java/com/hyeni/calendar/MainActivity.java`
- Android user-facing classes named in Task 3

### Task 1: Android resource 생성 계약

**Files:**
- Create: `scripts/i18n/generate-android-locales.mjs`
- Create: `scripts/i18n/scan-android-user-strings.mjs`
- Create: `android/app/src/main/res/xml/locales_config.xml`
- Modify: `android/app/src/main/res/values/strings.xml`
- Create: `android/app/src/main/res/values-en/strings.xml`
- Create: `android/app/src/main/res/values-ja/strings.xml`
- Create: `android/app/src/main/res/values-b+zh+Hans/strings.xml`
- Create: `android/app/src/main/res/values-b+zh+Hant/strings.xml`
- Create: `android/app/src/main/res/values-vi/strings.xml`
- Create: `android/app/src/main/res/values-th/strings.xml`
- Create: `android/app/src/main/res/values-b+id/strings.xml`
- Create: `android/app/src/main/res/values-ms/strings.xml`
- Create: `android/app/src/main/res/values-b+fil/strings.xml`
- Create: `android/app/src/main/java/com/hyeni/calendar/generated/NotificationMessageResources.java`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Create: `tests/androidLocaleResources.test.mjs`

- [ ] **Step 1: qualifier·key parity 실패 테스트를 작성한다**

Test assertions:

```js
assert.deepEqual(expectedQualifiers, [
  "values", "values-en", "values-ja", "values-b+zh+Hans", "values-b+zh+Hant",
  "values-vi", "values-th", "values-b+id", "values-ms", "values-b+fil",
]);
assert.equal(localeConfig.includes('android:name="zh-Hans"'), true);
assert.equal(localeConfig.includes('android:name="fil"'), true);
assert.equal(manifest.includes('android:localeConfig="@xml/locales_config"'), true);
```

Every generated locale must have the same translatable key set as `values/strings.xml`; `package_name`, URL scheme and icon glyph stay `translatable="false"`.

- [ ] **Step 2: 테스트를 실행해 생성기 부재 실패를 확인한다**

Run: `node --test tests/androidLocaleResources.test.mjs`

Expected: locale config/qualifier files missing FAIL.

- [ ] **Step 3: deterministic generator를 구현한다**

Input mapping:

```js
const qualifierByLocale = {
  ko: "values",
  en: "values-en",
  ja: "values-ja",
  "zh-CN": "values-b+zh+Hans",
  "zh-TW": "values-b+zh+Hant",
  vi: "values-vi",
  th: "values-th",
  id: "values-b+id",
  ms: "values-ms",
  fil: "values-b+fil",
};
```

Generator requirements:

- XML escape apostrophe, ampersand, `<`, `>` and Android `%` placeholders correctly
- ICU plural used by web is converted only when `android.json` supplies an explicit Android plural/resource form
- sorted deterministic output and final newline
- `--check` writes nothing and exits 1 on stale output
- app name uses `혜니캘린더` only for ko, `Hyeni Calendar` for all other locales

- [ ] **Step 4: Java user string scanner를 구현한다**

The scanner parses Java string literals and fails only when a literal reaches a user-facing API (`setText`, notification builder title/body, toast, Activity description, foreground service text). Log tags, stable error codes, URL paths and tests require an explicit allowlist reason.

- [ ] **Step 5: resource generation and Android compile gate를 실행한다**

```powershell
node scripts/i18n/generate-android-locales.mjs
node scripts/i18n/generate-android-locales.mjs --check
node --test tests/androidLocaleResources.test.mjs
Push-Location android
.\gradlew.bat lint assembleDebug
Pop-Location
```

- [ ] **Step 6: 태스크 파일만 커밋한다**

- [ ] 위 Files의 두 script, manifest, test, Java 생성물, `locales_config.xml`, 10개 `strings.xml`만 exact path로 검토한다. `android/app/src/main/res` 디렉터리 인자를 금지하고 `git commit --only --`로 `Android 10개 언어 리소스를 생성한다`를 커밋한다.

### Task 2: Android 앱별 언어 bridge

**Files:**
- Create: `android/app/src/main/java/com/hyeni/calendar/AppLocalePolicy.java`
- Create: `android/app/src/main/java/com/hyeni/calendar/AppLocalePlugin.java`
- Create: `android/app/src/test/java/com/hyeni/calendar/AppLocalePolicyTest.java`
- Create: `src/lib/native/appLocale.ts`
- Modify: `android/app/src/main/java/com/hyeni/calendar/MainActivity.java`
- Modify: `src/i18n/LocaleProvider.tsx`
- Modify: `src/app/NativeBootstrap.tsx`
- Create: `tests/nativeAppLocaleBridge.test.mjs`

- [ ] **Step 1: Android alias와 우선순위 JUnit을 작성한다**

```java
@Test public void canonicalizesAndroidTags() {
    assertEquals("zh-CN", AppLocalePolicy.canonicalize("zh-Hans-SG"));
    assertEquals("zh-TW", AppLocalePolicy.canonicalize("zh-Hant-HK"));
    assertEquals("id", AppLocalePolicy.canonicalize("in-ID"));
    assertEquals("fil", AppLocalePolicy.canonicalize("tl-PH"));
    assertEquals("en", AppLocalePolicy.canonicalize("fr-FR"));
}
```

Test resolution: explicit app locale > legacy WebView locale > system locale > English.

- [ ] **Step 2: JS bridge contract 실패 테스트를 작성하고 실패를 확인한다**

Expected plugin API:

```ts
interface AppLocalePlugin {
  getLocale(): Promise<{ locale: SupportedLocale; source: "app" | "legacy" | "system" | "fallback" }>;
  setLocale(options: { locale: SupportedLocale }): Promise<{ locale: SupportedLocale }>;
}
```

Run:

```powershell
node --test tests/nativeAppLocaleBridge.test.mjs
Push-Location android
.\gradlew.bat test --tests com.hyeni.calendar.AppLocalePolicyTest
Pop-Location
```

Expected: missing classes/modules FAIL.

- [ ] **Step 3: Capacitor plugin을 구현한다**

```java
@CapacitorPlugin(name = "AppLocale")
public final class AppLocalePlugin extends Plugin {
    @PluginMethod
    public void setLocale(PluginCall call) {
        String canonical = AppLocalePolicy.canonicalize(call.getString("locale", "en"));
        AppCompatDelegate.setApplicationLocales(
            LocaleListCompat.forLanguageTags(AppLocalePolicy.androidTag(canonical))
        );
        JSObject result = new JSObject();
        result.put("locale", canonical);
        call.resolve(result);
    }
}
```

`MainActivity.onCreate`에서 `registerPlugin(AppLocalePlugin.class)`를 `super.onCreate` 전에 호출한다. locale 변경은 appcompat Activity 재생성만 허용하며 app data/session prefs를 지우지 않는다.

- [ ] **Step 4: Web locale provider와 시작/foreground sync를 배선한다**

- cold start: native explicit/system → legacy WebView → English
- language selector: catalog load 성공 뒤 native `setLocale`
- foreground: native app locale이 달라졌으면 React locale만 교체
- plugin 오류: Web locale은 유지하고 진단 code `native_locale_sync_failed`만 기록
- session/refresh/pairing storage 함수 호출 금지

- [ ] **Step 5: 검증과 커밋을 수행한다**

```powershell
node --test tests/nativeAppLocaleBridge.test.mjs tests/localeSessionIsolation.test.mjs
npm run typecheck
Push-Location android
.\gradlew.bat test lint assembleDebug
Pop-Location
git add -- android/app/src/main/java/com/hyeni/calendar/AppLocalePolicy.java android/app/src/main/java/com/hyeni/calendar/AppLocalePlugin.java android/app/src/main/java/com/hyeni/calendar/MainActivity.java android/app/src/test/java/com/hyeni/calendar/AppLocalePolicyTest.java src/lib/native/appLocale.ts src/i18n/LocaleProvider.tsx src/app/NativeBootstrap.tsx tests/nativeAppLocaleBridge.test.mjs
git commit --only -- android/app/src/main/java/com/hyeni/calendar/AppLocalePolicy.java android/app/src/main/java/com/hyeni/calendar/AppLocalePlugin.java android/app/src/main/java/com/hyeni/calendar/MainActivity.java android/app/src/test/java/com/hyeni/calendar/AppLocalePolicyTest.java src/lib/native/appLocale.ts src/i18n/LocaleProvider.tsx src/app/NativeBootstrap.tsx tests/nativeAppLocaleBridge.test.mjs -m "Android 앱별 언어와 Web locale을 동기화한다"
```

### Task 3: Android 사용자 문구를 resource로 이동

**Files:**
- Modify: `android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/PushAlertActivity.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/RemoteListenActivity.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/RemoteListenNotification.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/AmbientListenService.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/ForceRingActivity.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/ForceRingService.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/LocationService.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/ScheduledNotificationReceiver.java`
- Modify: `locales/{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}/android.json`
- Create: `tests/androidNativeStringWiring.test.mjs`

- [ ] **Step 1: direct user string 실패 테스트를 작성한다**

Test invokes `scan-android-user-strings.mjs --json` and requires zero violations in the exact classes above. It also requires resource keys for:

- notification channel names/descriptions
- push alert actions
- SOS/emergency/force ring
- remote listen visible Activity and foreground service
- background location foreground service
- memo, schedule, arrival/departure, danger alert fallback

- [ ] **Step 2: 현재 Java literals 때문에 실패함을 확인한다**

Run: `node --test tests/androidNativeStringWiring.test.mjs`

Expected: direct user-visible Java strings reported.

- [ ] **Step 3: resource lookup으로 이동한다**

Rules:

- `context.getString(R.string.key, safeArg)` 사용
- formatted args는 validated primitive only
- notification channel id는 번역하지 않고 channel visible name/description만 번역
- 기존 channel id를 바꾸지 않아 사용자 설정을 보존
- full-screen category/DND/visibility 정책 변경 금지
- child-visible remote listen 문구에 실행 사실과 1분 상한 유지

- [ ] **Step 4: generation과 Android 전체 회귀를 통과시킨다**

```powershell
node scripts/i18n/generate-android-locales.mjs
node scripts/i18n/scan-android-user-strings.mjs
node --test tests/androidNativeStringWiring.test.mjs tests/remoteListenConsentSafety.test.mjs worker/tests/forceRingTargetPayload.test.mjs
Push-Location android
.\gradlew.bat test lint assembleDebug
Pop-Location
```

- [ ] **Step 5: exact Java/resource 범위만 커밋한다**

- [ ] 위 11개 Java, 10개 `android.json`, generator inventory에 기록된 10개 `strings.xml`, test만 exact path로 검토한다. `android/app/src/main/res`, `locales` 디렉터리 인자를 금지하고 `git commit --only --`로 `Android 알림과 서비스 문구를 locale resource로 옮긴다`를 커밋한다.

### Task 4: endpoint별 locale schema와 소유권 upsert

**Files:**
- Create: `worker/db/notification-endpoint-locale.sql`
- Create: `worker/lib/notificationLocale.ts`
- Modify: `cloudflare/schema_d1.sql`
- Modify: `worker/lib/notificationEndpointOwnership.ts`
- Modify: `worker/lib/healthReadiness.ts`
- Modify: `worker/routes/rest-shim-rpc.ts`
- Modify: `worker/routes/push-subscriptions.ts`
- Modify: `src/lib/native/push.ts`
- Modify: `src/lib/webPush.ts`
- Create: `worker/tests/notificationEndpointLocale.test.mjs`
- Modify: `worker/tests/canonicalSchemaBootstrap.test.mjs`

- [ ] **Step 1: migration·ownership 실패 테스트를 작성한다**

Required cases:

- legacy rows become `ko`
- supported locale accepted
- unsupported locale rejected, not silently stored
- exact user+family+registration instance required for locale update
- delayed old session cannot change current endpoint locale
- same account's two endpoints retain `ja` and `vi` separately

- [ ] **Step 2: 테스트가 missing column/module로 실패함을 확인한다**

Run: `node --test worker/tests/notificationEndpointLocale.test.mjs worker/tests/canonicalSchemaBootstrap.test.mjs`

- [ ] **Step 3: additive migration과 canonical schema를 구현한다**

```sql
ALTER TABLE fcm_tokens ADD COLUMN locale TEXT DEFAULT 'ko' NOT NULL
  CHECK (locale IN ('ko','en','ja','zh-CN','zh-TW','vi','th','id','ms','fil'));
ALTER TABLE push_subscriptions ADD COLUMN locale TEXT DEFAULT 'ko' NOT NULL
  CHECK (locale IN ('ko','en','ja','zh-CN','zh-TW','vi','th','id','ms','fil'));

CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user_locale_active
  ON fcm_tokens(user_id, locale) WHERE disabled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_locale_active
  ON push_subscriptions(user_id, locale) WHERE disabled_at IS NULL;
```

Migration file is one-time and not rerun. Fresh bootstrap definitions in `cloudflare/schema_d1.sql` include the columns directly.

- [ ] **Step 4: ownership 함수 입력에 locale을 추가한다**

```ts
export interface FcmTokenOwnershipInput {
  id: string;
  token: string;
  userId: string;
  familyId: string;
  platform: string;
  registrationInstanceId: string;
  locale: SupportedNotificationLocale;
  now: string;
}
```

Update locale only in the same atomic ownership statement that verifies active endpoint owner/session. A standalone unauthenticated locale update route is forbidden.

- [ ] **Step 5: native/Web registration payload에 locale을 포함한다**

- FCM RPC: `p_locale`
- Web Push POST: `locale`
- status/foreground resync repeats current locale
- locale change triggers current endpoint re-registration, not token rotation

- [ ] **Step 6: schema and ownership regressions를 실행한다**

```powershell
node --test worker/tests/notificationEndpointLocale.test.mjs worker/tests/notificationEndpointOwnership.test.mjs worker/tests/fcmTokenOwnership.test.mjs worker/tests/webPushSubscriptionAuthorization.test.mjs worker/tests/canonicalSchemaBootstrap.test.mjs
npm run typecheck
npm run typecheck:worker
```

- [ ] **Step 7: migration/client ownership 범위를 커밋한다**

```powershell
git add -- worker/db/notification-endpoint-locale.sql cloudflare/schema_d1.sql worker/lib/notificationLocale.ts worker/lib/notificationEndpointOwnership.ts worker/lib/healthReadiness.ts worker/routes/rest-shim-rpc.ts worker/routes/push-subscriptions.ts src/lib/native/push.ts src/lib/webPush.ts worker/tests/notificationEndpointLocale.test.mjs worker/tests/canonicalSchemaBootstrap.test.mjs
git commit --only -- worker/db/notification-endpoint-locale.sql cloudflare/schema_d1.sql worker/lib/notificationLocale.ts worker/lib/notificationEndpointOwnership.ts worker/lib/healthReadiness.ts worker/routes/rest-shim-rpc.ts worker/routes/push-subscriptions.ts src/lib/native/push.ts src/lib/webPush.ts worker/tests/notificationEndpointLocale.test.mjs worker/tests/canonicalSchemaBootstrap.test.mjs -m "푸시 endpoint에 소유권 검증 locale을 저장한다"
```

### Task 5: 구조화 notification message 계약과 생성 catalog

**Files:**
- Create: `worker/lib/notificationMessage.ts`
- Create: `worker/generated/notificationCatalog.ts`
- Modify: `scripts/i18n/build-catalogs.mjs`
- Modify: `locales/{ko,en,ja,zh-CN,zh-TW,vi,th,id,ms,fil}/notifications.json`
- Modify: `locales/descriptions.json`
- Create: `worker/tests/notificationMessageCatalog.test.mjs`
- Create: `tests/structuredNotification.test.ts`

- [ ] **Step 1: key/version/args validation 실패 테스트를 작성한다**

```ts
const combined = parseNotificationMessage({
  messageKey: "notification.arrival.combined",
  messageVersion: 1,
  messageArgs: { childName: "Mina", fromPlace: "School", toPlace: "Home" },
});
assert.equal(combined.ok, true);
assert.equal(parseNotificationMessage({ messageKey: "unknown", messageVersion: 1, messageArgs: {} }).ok, false);
assert.equal(parseNotificationMessage({
  messageKey: "notification.arrival.combined",
  messageVersion: 1,
  messageArgs: { childName: "x", token: "forbidden" },
}).ok, false);
```

Also fail values over per-argument lengths and total serialized 2 KiB.

- [ ] **Step 2: missing parser/catalog failure를 확인한다**

Run: `node --test worker/tests/notificationMessageCatalog.test.mjs tests/structuredNotification.test.ts`

- [ ] **Step 3: discriminated message registry를 구현한다**

```ts
export interface NotificationMessageSpecMap {
  "notification.arrival.combined": {
    version: 1;
    args: { childName: string; fromPlace: string; toPlace: string };
  };
  "notification.memo.new": {
    version: 1;
    args: { senderName: string };
  };
  "notification.sos.received": {
    version: 1;
    args: { childName: string };
  };
}
```

Registry entries define exact arg names, max lengths, whether user content is permitted, Android resource id and legacy Korean renderer. Location coordinate, memo body and arbitrary `metadata` are never permitted.

- [ ] **Step 4: Worker and Android generated lookup을 만든다**

- Worker `renderNotificationMessage(locale, message)` returns `{title, body}`
- Android `NotificationMessageResources.resolve(context, key, version, args)` returns nullable rendered value
- JSON args are serialized once with stable ordering
- generated outputs contain no secret/config values

- [ ] **Step 5: catalog and parser tests를 통과시킨다**

```powershell
node scripts/i18n/build-catalogs.mjs
node scripts/i18n/generate-android-locales.mjs
node --test worker/tests/notificationMessageCatalog.test.mjs tests/structuredNotification.test.ts
npm run typecheck:worker
Push-Location android
.\gradlew.bat test
Pop-Location
```

- [ ] **Step 6: message contract를 커밋한다**

- [ ] 위 explicit source/test paths, 10개 `notifications.json`, generator inventory의 TS/Android 산출물만 exact path로 검토한다. `locales`, `src/i18n/generated`, `android/app/src/main/res` 디렉터리 인자를 금지하고 `git commit --only --`로 `구조화 알림 message key와 언어 catalog를 정의한다`를 커밋한다.

### Task 6: Worker 발송과 pending을 endpoint locale로 이관

**Files:**
- Modify: `worker/lib/fcm.ts`
- Modify: `worker/lib/webpush.ts`
- Modify: `worker/lib/pendingNotificationDelivery.ts`
- Modify: `worker/routes/push-notify.ts`
- Modify: `worker/routes/parent-alerts.ts`
- Modify: `worker/cron/push-notify.ts`
- Modify: `worker/cron/teacher-notification-batch.ts`
- Modify: `worker/cron/registered-place-geofence-check.ts`
- Modify: `worker/cron/unregistered-stay-check.ts`
- Create: `scripts/i18n/scan-worker-notification-copy.mjs`
- Create: `worker/tests/localizedNotificationDelivery.test.mjs`
- Modify: `worker/tests/pendingNotificationOwnership.test.mjs`
- Modify: `worker/tests/notificationQuietHours.test.mjs`
- Modify: `worker/tests/forceRingTargetPayload.test.mjs`
- Modify: `worker/tests/childSafetyNotifications.test.mjs`
- Modify: `worker/tests/memoDisplayPermit.test.mjs`

- [ ] **Step 1: multi-endpoint와 legacy pending 실패 테스트를 작성한다**

Fixture: one user with Android `ja`, Web Push `vi`, another parent `en`.

Expected:

- each network payload title/body uses endpoint locale
- FCM structured `data` has same key/version/args and exact target fields
- pending `data` has structured message; title/body remain Korean compatibility copy
- one recipient quiet-hours suppressed creates no pending/network row
- message key present but invalid args sends nothing
- arrival/departure/schedule localization이 child를 새 수신자로 추가하지 않고 기존 parent recipient 집합만 유지

- [ ] **Step 2: current one-title-for-all behavior 때문에 실패함을 확인한다**

Run: `node --test worker/tests/localizedNotificationDelivery.test.mjs`

- [ ] **Step 3: endpoint fetch와 render를 locale-aware로 바꾼다**

```ts
interface NotificationEndpoint {
  id: string;
  userId: string;
  kind: "fcm" | "web_push";
  destination: string;
  platform: string | null;
  locale: SupportedNotificationLocale;
}
```

Quiet-hours partition remains user-level and runs before pending creation. After it passes, render per endpoint locale. Pending is still recipient-level and inserted once before any network send.

- [ ] **Step 4: every direct notification copy callsite를 message factory로 옮긴다**

Required categories:

- schedule reminders
- registered/unregistered arrival/departure
- not-arrived/danger/location stale
- memo/sticker/playdate/teacher notice
- SOS/emergency/force ring/remote listen
- device status and request commands where visible text exists

Command-only payloads retain stable action and target fields; user-visible notification copies use message registry.

- [ ] **Step 5: Worker notification copy scanner를 통과시킨다**

Scanner fails direct user-facing Korean/English title/body in exact Worker sender paths. Explicit legacy Korean renderer lives only in `notificationMessage.ts`/generated catalog.

- [ ] **Step 6: focused and full Worker regression을 실행한다**

```powershell
node scripts/i18n/scan-worker-notification-copy.mjs
node --test worker/tests/localizedNotificationDelivery.test.mjs worker/tests/pendingNotificationOwnership.test.mjs worker/tests/notificationQuietHours.test.mjs worker/tests/forceRingTargetPayload.test.mjs worker/tests/childSafetyNotifications.test.mjs worker/tests/memoDisplayPermit.test.mjs
npm run typecheck:worker
npm run test:worker
```

- [ ] **Step 7: exact Worker sender 범위를 커밋한다**

```powershell
git add -- worker/lib/fcm.ts worker/lib/webpush.ts worker/lib/pendingNotificationDelivery.ts worker/routes/push-notify.ts worker/routes/parent-alerts.ts worker/cron/push-notify.ts worker/cron/teacher-notification-batch.ts worker/cron/registered-place-geofence-check.ts worker/cron/unregistered-stay-check.ts scripts/i18n/scan-worker-notification-copy.mjs worker/tests/localizedNotificationDelivery.test.mjs worker/tests/pendingNotificationOwnership.test.mjs worker/tests/notificationQuietHours.test.mjs worker/tests/forceRingTargetPayload.test.mjs worker/tests/childSafetyNotifications.test.mjs worker/tests/memoDisplayPermit.test.mjs
git commit --only -- worker/lib/fcm.ts worker/lib/webpush.ts worker/lib/pendingNotificationDelivery.ts worker/routes/push-notify.ts worker/routes/parent-alerts.ts worker/cron/push-notify.ts worker/cron/teacher-notification-batch.ts worker/cron/registered-place-geofence-check.ts worker/cron/unregistered-stay-check.ts scripts/i18n/scan-worker-notification-copy.mjs worker/tests/localizedNotificationDelivery.test.mjs worker/tests/pendingNotificationOwnership.test.mjs worker/tests/notificationQuietHours.test.mjs worker/tests/forceRingTargetPayload.test.mjs worker/tests/childSafetyNotifications.test.mjs worker/tests/memoDisplayPermit.test.mjs -m "Worker 알림을 endpoint별 언어로 발송한다"
```

### Task 7: Android·Service Worker 구조화 payload 표시

**Files:**
- Modify: `android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java`
- Modify: `android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java`
- Create: `android/app/src/main/java/com/hyeni/calendar/StructuredNotificationPolicy.java`
- Create: `android/app/src/test/java/com/hyeni/calendar/StructuredNotificationPolicyTest.java`
- Modify: `src/sw.ts`
- Modify: `src/lib/native/parentPendingNotifications.ts`
- Modify: `src/lib/api/endpoints/notifications.ts`
- Create: `tests/webPushLocaleHandshake.test.mjs`
- Create: `tests/pendingNotificationLocalization.test.ts`

- [ ] **Step 1: new/legacy/tampered payload tests를 먼저 작성한다**

Android cases:

- valid structured → resource text
- absent key + legacy title/body → legacy text
- unknown key → no post/no ACK
- unexpected/oversized args → no post/no ACK
- target mismatch → no post/no ACK before localization
- quiet hours/memo permit still run before post

Service Worker cases mirror the same order and use initialized device locale.

- [ ] **Step 2: 실패를 확인한다**

```powershell
node --test tests/webPushLocaleHandshake.test.mjs tests/pendingNotificationLocalization.test.ts
Push-Location android
.\gradlew.bat test --tests com.hyeni.calendar.StructuredNotificationPolicyTest
Pop-Location
```

- [ ] **Step 3: Android validation/localization order를 구현한다**

Required order:

```text
target/role/expiry → pending type → quiet hours → memo permit → structured payload validation
→ native resource render → channel/permission/dedupe → notify → shown ACK
```

Do not change `RemoteListenRequestStore.markNotificationShown` before-notify ordering or full-screen pending intent policy.

- [ ] **Step 4: Service Worker locale handshake와 pending render를 구현한다**

- page sends `{type:"HYENI_LOCALE", locale}` after active worker ready and on locale change
- worker defaults existing sessions to `ko`, first new unsupported session to `en`
- worker cannot read localStorage
- structured message validation shared through a Worker-safe pure module; React/session code is not imported into SW
- message key present-invalid is discarded and not ACKed

- [ ] **Step 5: Android/Web notification regression을 실행한다**

```powershell
node --test tests/webPushLocaleHandshake.test.mjs tests/pendingNotificationLocalization.test.ts tests/webPushWiring.test.mjs tests/androidNotificationSafetyWiring.test.mjs
Push-Location android
.\gradlew.bat test lint assembleDebug
Pop-Location
```

- [ ] **Step 6: client/native display 범위를 커밋한다**

```powershell
git add -- android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java android/app/src/main/java/com/hyeni/calendar/StructuredNotificationPolicy.java android/app/src/test/java/com/hyeni/calendar/StructuredNotificationPolicyTest.java src/sw.ts src/lib/native/parentPendingNotifications.ts src/lib/api/endpoints/notifications.ts tests/webPushLocaleHandshake.test.mjs tests/pendingNotificationLocalization.test.ts
git commit --only -- android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java android/app/src/main/java/com/hyeni/calendar/StructuredNotificationPolicy.java android/app/src/test/java/com/hyeni/calendar/StructuredNotificationPolicyTest.java src/sw.ts src/lib/native/parentPendingNotifications.ts src/lib/api/endpoints/notifications.ts tests/webPushLocaleHandshake.test.mjs tests/pendingNotificationLocalization.test.ts -m "네이티브와 Web Push가 구조화 알림을 현지화한다"
```

### Task 8: AI 요청·proactive 출력 언어

**Files:**
- Create: `worker/lib/aiLocale.ts`
- Modify: `worker/routes/ai-child-chat.ts`
- Modify: `worker/routes/ai-proactive.ts`
- Modify: `worker/routes/ai.ts`
- Modify: `src/lib/api/endpoints/ai.ts`
- Modify: `src/queries/useAi.ts`
- Modify: `src/screens/child/AiFriendChat.tsx`
- Modify: `src/screens/feature/AiSchedule.tsx`
- Create: `worker/tests/aiLocale.test.mjs`
- Create: `tests/aiLocaleRequest.test.ts`

- [ ] **Step 1: locale ownership과 proactive 선택 테스트를 작성한다**

Required behavior:

- client authenticated request locale normalized to supported set
- user request selects its explicit app locale; no endpoint lookup needed
- proactive selects most recently updated active child endpoint locale
- no endpoint → English, catalog unavailable → Korean
- stored prior AI messages are never retranslated
- safety/system prompt remains last authority independent of output language

- [ ] **Step 2: 실패를 확인하고 pure resolver를 구현한다**

```ts
export function resolveAiOutputLocale(input: {
  requested?: string | null;
  endpointLocales?: Array<{ locale: string; updatedAt: string }>;
}): SupportedNotificationLocale {
  if (input.requested) return normalizeNotificationLocale(input.requested, "en");
  const recent = [...(input.endpointLocales ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return normalizeNotificationLocale(recent?.locale, "en");
}
```

- [ ] **Step 3: request contract와 prompts를 배선한다**

Client sends `locale` as a bounded enum field, not Accept-Language alone. Worker appends a language instruction before final safety rules, e.g. `Respond in Vietnamese unless the safety policy requires a fixed emergency label.` Never include user names/content in locale logs.

- [ ] **Step 4: focused AI safety regressions를 실행한다**

```powershell
node --test worker/tests/aiLocale.test.mjs worker/tests/aiRequestLimits.test.mjs worker/tests/openAiLogSafety.test.mjs tests/aiLocaleRequest.test.ts tests/aiScheduleUxCopy.test.mjs
npm run typecheck
npm run typecheck:worker
```

- [ ] **Step 5: AI locale 범위를 커밋한다**

```powershell
git add -- worker/lib/aiLocale.ts worker/routes/ai-child-chat.ts worker/routes/ai-proactive.ts worker/routes/ai.ts src/lib/api/endpoints/ai.ts src/queries/useAi.ts src/screens/child/AiFriendChat.tsx src/screens/feature/AiSchedule.tsx worker/tests/aiLocale.test.mjs tests/aiLocaleRequest.test.ts
git commit --only -- worker/lib/aiLocale.ts worker/routes/ai-child-chat.ts worker/routes/ai-proactive.ts worker/routes/ai.ts src/lib/api/endpoints/ai.ts src/queries/useAi.ts src/screens/child/AiFriendChat.tsx src/screens/feature/AiSchedule.tsx worker/tests/aiLocale.test.mjs tests/aiLocaleRequest.test.ts -m "AI 요청과 선제 메시지에 기기 언어를 적용한다"
```

### Task 9: schema dress rehearsal와 전체 검증

**Files:**
- Modify: `worker/tests/releaseMigrationDressRehearsal.test.mjs`
- Modify: `docs/store/play-release-checklist.md`
- Create: `docs/operations/notification-locale-rollout.md`

- [ ] **Step 1: fresh/existing DB migration rehearsal을 추가한다**

Existing DB sequence:

1. inspect `PRAGMA table_info(fcm_tokens)` and `push_subscriptions`
2. if `locale` absent, apply one-time migration
3. verify all legacy rows `ko`, no NULL/unsupported values
4. deploy new Worker only after readback

Fresh DB uses current `cloudflare/schema_d1.sql` and must not apply additive migration again.

- [ ] **Step 2: full verification을 실행한다**

```powershell
node scripts/i18n/generate-android-locales.mjs --check
node scripts/i18n/scan-android-user-strings.mjs
node scripts/i18n/scan-worker-notification-copy.mjs
npm run typecheck
npm test
npm run build
npm run typecheck:worker
npm run test:worker
Push-Location android
.\gradlew.bat test lint assembleDebug
Pop-Location
```

- [ ] **Step 3: 안전 계약 source audit를 수행한다**

```powershell
rg -n "familyId|targetUserId|targetRole|acknowledged_at|memoDisplayPermit|QUIET_HOURS_SUPPRESSED" worker src android/app/src/main/java
git diff --check
git status --short
```

Expected: target/ACK/permit/quiet-hours guard가 기존 entry points에 유지되고, 사용자 pre-existing 변경이 그대로다.

- [ ] **Step 4: 운영 문서와 rehearsal만 커밋한다**

```powershell
git add -- worker/tests/releaseMigrationDressRehearsal.test.mjs docs/store/play-release-checklist.md docs/operations/notification-locale-rollout.md
git commit --only -- worker/tests/releaseMigrationDressRehearsal.test.mjs docs/store/play-release-checklist.md docs/operations/notification-locale-rollout.md -m "알림 locale migration 배포 순서를 고정한다"
```

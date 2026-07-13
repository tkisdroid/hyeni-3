import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSource(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("부모가 보낸 메모 FCM은 아이 메시지 채널로 heads-up 표시된다", () => {
  const fcm = readSource("android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java");
  const poll = readSource("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
  const policy = readSource("android/app/src/main/java/com/hyeni/calendar/NotificationChannelPolicy.java");

  assert.match(fcm, /boolean isMemo = "new_memo"\.equals\(type\);/);
  assert.match(fcm, /NotificationChannelPolicy\.channelFor\(type, alertType, isEmergency\)/);
  assert.match(policy, /"new_memo"\.equals\(type\)/);
  assert.match(policy, /return "child_message"/);
  assert.match(poll, /"new_memo"\.equals\(type\) \? "child-memo"/);
});

test("부모 메모 알림을 탭하면 아이 메모 화면으로 진입한다", () => {
  const fcm = readSource("android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java");
  const main = readSource("android/app/src/main/java/com/hyeni/calendar/MainActivity.java");
  const policy = readSource("android/app/src/main/java/com/hyeni/calendar/NotificationRoutePolicy.java");

  assert.match(fcm, /String route = data\.get\("route"\);/);
  assert.match(fcm, /isMemo\s*\? \("parent"\.equalsIgnoreCase\(localRole\) \? "\/parent\/memo" : "child-memo"\)/);
  assert.match(policy, /if \("child-memo"\.equals\(route\)\) route = "\/child\/memo";/);
  assert.match(main, /NotificationRoutePolicy\.resolveHashRoute\(route, localRole\)/);
});

test("아이 기기의 로컬 일정 fallback을 탭하면 아이 홈으로 진입한다", () => {
  const service = readSource("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
  const reminder = service.slice(
    service.indexOf("private void fireLocalEventReminders("),
    service.indexOf("private void activateSilentMode("),
  );

  assert.match(
    reminder,
    /NotificationHelper\.showNotification\([\s\S]*?"schedule",\s*false,\s*false,\s*notifId,\s*"\/child\/home"\s*\)/,
  );
});

test("아이 메시지 채널은 다른 일반 알림보다 우선 보이도록 high importance 계약을 유지한다", () => {
  const helper = readSource("android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java");

  assert.match(helper, /CHANNEL_CHILD_MESSAGE = "hyeni_child_message_v2_private"/);
  assert.match(
    helper,
    /CHANNEL_CHILD_MESSAGE,\s*"AI 친구·가족 메시지",\s*legacyImportance\([\s\S]*?NotificationManager\.IMPORTANCE_HIGH\)/s,
  );
  assert.match(helper, /boolean childMessage = "child_message"\.equals\(channel\);/);
  assert.match(helper, /fullScreen \|\| childMessage \|\| safety\) \? NotificationCompat\.PRIORITY_HIGH/);
  assert.match(helper, /kkuk \|\| childMessage\) \? NotificationCompat\.CATEGORY_MESSAGE/);
});

test("같은 위치 요청의 FCM·pending fallback은 GPS를 한 번만 깨운다", () => {
  const fcm = readSource("android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java");
  const service = readSource("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
  const requestLocationBranch = fcm.slice(
    fcm.indexOf('if ("request_location".equals(type))'),
    fcm.indexOf('if ("request_device_status".equals(type))'),
  );

  assert.match(fcm, /PolledNotificationStore\.isAcked\(this, stableId\)/);
  assert.doesNotMatch(requestLocationBranch, /PolledNotificationStore\.markAck/);
  assert.match(requestLocationBranch, /startLocationRefreshService\(data, stableId\)/);
  assert.match(service, /if \(PolledNotificationStore\.isAcked\(this, stableId\)\)/);
  assert.match(service, /data\.optString\("idempotency_key", ""\)/);
  assert.match(service, /data\.optString\("requestId", ""\)/);
  assert.match(service, /immediateFixInFlight\.compareAndSet\(false, true\)/);
  assert.match(service, /immediateFixInFlight\.set\(false\)/);
  assert.match(service, /activeLocationRefreshRequestIds = Collections\.unmodifiableSet/);
  assert.match(service, /completeImmediateLocationFix\(generationToFinish\)/);
  assert.match(service, /PolledNotificationStore\.markAck\(this, requestId\)/);
  assert.match(service, /transitionImmediateLocationFix\(int generation, boolean uploaded\)/);
  assert.match(service, /if \(!completionClaimed\) return;/);
  assert.match(service, /!isImmediateFixGenerationActive\(generationToFinish\)/);
  assert.match(service, /serviceLifecycleEpoch\.incrementAndGet\(\)/);
  assert.match(service, /if \(!isServiceLifecycleActive\(uploadLifecycleEpoch\)\) return;/);
  assert.match(service, /requestImmediateLocationFix\(stableId, id\)/);
  assert.doesNotMatch(
    service.slice(
      service.indexOf('if ("request_location".equals(type))'),
      service.indexOf('if ("request_device_status".equals(type))'),
    ),
    /requestImmediateLocationFix\(stableId, id\);[\s\S]*deliveredIds\.put\(id\)/,
  );
});

test("네이티브 현재 위치는 provider fix 시각을 서버에 전달하고 오래된 cache를 현재로 위장하지 않는다", () => {
  const service = readSource("android/app/src/main/java/com/hyeni/calendar/LocationService.java");

  assert.match(service, /LocationFixPolicy\.resolveCapturedAtMs\(\s*location\.getTime\(\),\s*location\.getElapsedRealtimeNanos\(\),/s);
  assert.match(service, /LocationFixPolicy\.isFreshForLiveRefresh/);
  assert.match(service, /LocationFixPolicy\.isOutOfOrder/);
  assert.match(service, /LocationFixPolicy\.isDuplicateAcceptedFix/);
  assert.match(service, /lastLocationAcceptedElapsedRealtimeNanos/);
  assert.match(service, /body\.put\("p_recorded_at", formatIsoUtc\(capturedAtMs\)\)/);
  assert.match(service, /body\.put\("p_fix_age_ms",/);
  assert.match(service, /\.setMaxUpdateAgeMillis\(0L\)/);
  assert.match(service, /requestBalancedLocationFix\(generation\)/);
  assert.match(service, /IMMEDIATE_FIX_CHAIN_DEADLINE_MS/);
  assert.match(service, /activeImmediateFixGeneration = immediateFixGenerationCounter\.incrementAndGet\(\)/);
  assert.doesNotMatch(service, /long now = System\.currentTimeMillis\(\);\s*lastLocationAcceptedAtMs = now;/s);
});

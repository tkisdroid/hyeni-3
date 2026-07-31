import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("FCM 서비스는 잠금 해제 전 CE 저장소에 접근하지 않고 잠금 해제 뒤 전달된다", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const fcmService = manifest.match(
    /<service\s+[\s\S]*?android:name="\.MyFirebaseMessagingService"[\s\S]*?<\/service>/,
  )?.[0] ?? "";

  assert.notEqual(fcmService, "");
  assert.doesNotMatch(fcmService, /android:directBootAware="true"/);
  assert.match(fcmService, /android:directBootAware="false"/);
  assert.match(manifest, /android:name="\.BootReceiver"[\s\S]*?android:directBootAware="true"/);
  assert.match(manifest, /android:name="android\.intent\.action\.USER_UNLOCKED"/);
});

test("네이티브 세션 clear는 토큰과 푸시 대상 문맥을 한 editor에서 함께 제거한다", () => {
  const store = read("android/app/src/main/java/com/hyeni/calendar/SessionTokenStore.java");
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/LocationPlugin.java");
  const clearBody = store.slice(store.indexOf("static synchronized void clear("), store.indexOf("private static LinkedHashSet"));
  const stopBody = plugin.slice(plugin.indexOf("public void stopService("), plugin.indexOf("public void updateToken("));
  const clearContextBody = plugin.slice(plugin.indexOf("public void clearPushContext("), plugin.indexOf("private void syncCachedFcmToken("));

  for (const key of ["userId", "familyId", "role", "supabaseUrl", "supabaseKey", "accessToken", "refreshToken"]) {
    assert.match(clearBody, new RegExp(`\\.remove\\(\"${key}\"\\)`));
  }
  assert.match(stopBody, /SessionTokenStore\.clear\(/);
  assert.match(clearContextBody, /SessionTokenStore\.clear\(prefs, ""\)/);
  assert.doesNotMatch(clearContextBody, /prefs\s*\.edit\(\)/);
});

test("AI 채팅 알림도 역할 allowlist를 우회하지 않는다", () => {
  const main = read("android/app/src/main/java/com/hyeni/calendar/MainActivity.java");
  const policy = read("android/app/src/main/java/com/hyeni/calendar/NotificationRoutePolicy.java");
  const handler = main.slice(main.indexOf("private void handleRouteLaunch("), main.indexOf("private void handlePushLaunch("));

  assert.doesNotMatch(handler, /if \("ai-chat"\.equals\(route\)\)/);
  assert.match(handler, /NotificationRoutePolicy\.resolveHashRoute\(route, localRole\)/);
  assert.match(policy, /if \("ai-chat"\.equals\(route\)\) route = "\/child\/ai-friend";/);
});

test("알림 상태 진단은 아이 메시지 채널과 NotificationManager 누락을 fail-closed 처리한다", () => {
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java");
  const helper = read("android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java");

  assert.match(helper, /CHANNEL_CHILD_MESSAGE/);
  assert.match(plugin, /boolean notificationsEnabled = nm != null\s*&& nm\.areNotificationsEnabled\(\)/s);
  assert.match(plugin, /boolean channelsEnabled = NotificationHelper\.areRequiredDeliveryChannelsEnabled\(nm\)/);
  assert.match(plugin, /if \(nm == null\) \{\s*call\.resolve\(new JSObject\(\)\.put\("enabled", false\)/s);
  assert.match(helper, /if \(channel == null \|\| channel\.getImportance\(\) == NotificationManager\.IMPORTANCE_NONE\)/);
});

test("동일 stableId의 긴급 FCM과 pending 동시 진입은 한 번만 게시한다", () => {
  const helper = read("android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java");
  const showBody = helper.slice(helper.indexOf("public static DeliveryReceipt showNotification("), helper.indexOf("private static boolean wasRecentlyPosted("));

  assert.doesNotMatch(showBody, /!emergency\s*&&\s*wasRecentlyPosted/);
  assert.equal((showBody.match(/wasRecentlyPosted\(context, requestCode\)/g) ?? []).length, 2);
  assert.match(showBody, /synchronized \(NotificationHelper\.class\)[\s\S]*wasRecentlyPosted\(context, requestCode\)[\s\S]*nm\.notify/s);
  assert.match(showBody, /nm\.notify\(requestCode, builder\.build\(\)\);\s*markPosted\(context, requestCode\);/s);
});

test("push context와 위치 서비스는 토큰 수용 뒤에만 identity를 원자 저장한다", () => {
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/LocationPlugin.java");
  const service = read("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
  const pushContext = plugin.slice(plugin.indexOf("public void setPushContext("), plugin.indexOf("public void getPushContext("));
  const updateToken = plugin.slice(plugin.indexOf("public void updateToken("), plugin.indexOf("public void getSessionTokens("));
  const onStart = service.slice(service.indexOf("public int onStartCommand("), service.indexOf("private void runOnNetworkThread("));

  assert.match(pushContext, /SessionTokenStore\.reconcileContext\(/);
  assert.doesNotMatch(pushContext, /prefs\.edit\(\)/);
  assert.match(pushContext, /if \(!context\.acceptedIncoming\)[\s\S]*ignored_stale/s);
  assert.match(updateToken, /SessionTokenStore\.reconcileContext\(/);
  assert.doesNotMatch(updateToken, /SessionTokenStore\.reconcile\(/);
  assert.match(onStart, /SessionTokenStore\.reconcileContext\(/);
  assert.doesNotMatch(onStart, /putString\("userId"/);
  assert.doesNotMatch(onStart, /putBoolean\("serviceEnabled", true\)/);
  assert.match(onStart, /if \(!context\.acceptedIncoming && !context\.serviceEnabled\)/);
});

test("필수 알림 채널 진단은 앱·기기 상태 모두 공통 fail-closed 정책을 쓴다", () => {
  const helper = read("android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java");
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java");
  const reporter = read("android/app/src/main/java/com/hyeni/calendar/DeviceStatusReporter.java");

  assert.match(helper, /CHANNEL_SAFETY = "hyeni_safety_v2_private"/);
  assert.match(helper, /CHANNEL_CHILD_MESSAGE/);
  assert.match(helper, /areRequiredDeliveryChannelsEnabled/);
  assert.match(plugin, /NotificationHelper\.areRequiredDeliveryChannelsEnabled\(nm\)/);
  assert.match(reporter, /NotificationHelper\.areRequiredDeliveryChannelsEnabled\(nm\)/);
  assert.match(reporter, /boolean notificationsEnabled = nm != null\s*&& nm\.areNotificationsEnabled\(\)/s);
  assert.match(reporter, /\.put\("requiredChannelsEnabled", requiredChannelsEnabled\)/);
  assert.match(reporter, /&& requiredChannelsEnabled/);
});

test("종료 broadcast의 네트워크 처리는 bounded executor에서 실행하고 항상 pending result를 끝낸다", () => {
  const receiver = read("android/app/src/main/java/com/hyeni/calendar/ShutdownReceiver.java");
  const onReceive = receiver.slice(
    receiver.indexOf("public void onReceive("),
    receiver.indexOf("private static void deliverShutdownBestEffort("),
  );
  const delivery = receiver.slice(receiver.indexOf("private static void deliverShutdownBestEffort("));

  assert.match(receiver, /ThreadPoolExecutor/);
  assert.match(receiver, /ArrayBlockingQueue<>\(1\)/);
  assert.match(receiver, /AbortPolicy/);
  assert.match(receiver, /callTimeout\(\s*SHUTDOWN_CALL_TIMEOUT_MS/);
  assert.match(onReceive, /PendingResult pendingResult = goAsync\(\)/);
  assert.match(onReceive, /SHUTDOWN_EXECUTOR\.execute\(\(\) ->/);
  assert.match(onReceive, /finally\s*\{\s*pendingResult\.finish\(\)/s);
  assert.doesNotMatch(onReceive, /newCall\([^)]*\)\.execute\(\)/);
  assert.match(delivery, /best-effort/);
});

test("민감 알림은 private 본문과 일반화한 잠금화면 publicVersion을 사용한다", () => {
  const helper = read("android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java");
  const location = read("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
  const forceRing = read("android/app/src/main/java/com/hyeni/calendar/ForceRingService.java");
  const fcm = read("android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java");

  assert.match(helper, /CHANNEL_SCHEDULE = "hyeni_schedule_v7_private"/);
  assert.match(helper, /CHANNEL_SAFETY = "hyeni_safety_v2_private"/);
  assert.match(helper, /CHANNEL_CHILD_MESSAGE = "hyeni_child_message_v2_private"/);
  assert.match(helper, /CHANNEL_SILENT = "hyeni_silent_v2_private"/);
  assert.match(helper, /CHANNEL_EMERGENCY = "hyeni_alert_v7_private"/);
  assert.match(helper, /CHANNEL_KKUK = "hyeni_kkuk_v7_private"/);
  assert.match(helper, /FORCE_RING_CHANNEL_ID = "force_ring_emergency_v4_private"/);
  assert.match(helper, /buildPublicVersion\(/);
  assert.match(helper, /잠금을 해제해 확인해 주세요/);
  assert.match(helper, /\.setVisibility\(NotificationCompat\.VISIBILITY_PRIVATE\)/);
  assert.match(helper, /\.setPublicVersion\(buildPublicVersion\(/);
  assert.match(helper, /applyLegacyChannelBehavior\(/);
  assert.match(helper, /previous\.getImportance\(\)/);
  assert.match(helper, /previous\.getSound\(\)/);
  assert.match(helper, /previous\.shouldVibrate\(\)/);
  for (const channelVariable of ["schedule", "safety", "emergency", "childMessage", "kkuk", "silent"]) {
    const blockStart = helper.indexOf(`NotificationChannel ${channelVariable} =`);
    const blockEnd = helper.indexOf(`nm.createNotificationChannel(${channelVariable})`, blockStart);
    const block = helper.slice(blockStart, blockEnd);
    assert.ok(blockStart >= 0 && blockEnd > blockStart, `${channelVariable} 채널 생성 계약이 필요합니다`);
    assert.ok(
      block.lastIndexOf(`${channelVariable}.setShowBadge(`) < block.indexOf("applyLegacyChannelBehavior("),
      `${channelVariable} 채널은 사용자 badge 설정을 기본값으로 덮으면 안 됩니다`,
    );
  }
  const lastChannelCreate = helper.indexOf("nm.createNotificationChannel(silent)");
  const legacyDelete = helper.lastIndexOf("for (String legacyChannel : LEGACY_CHANNELS)");
  assert.ok(lastChannelCreate >= 0 && legacyDelete > lastChannelCreate);
  assert.match(forceRing, /\.setVisibility\(NotificationCompat\.VISIBILITY_PRIVATE\)/);
  assert.match(forceRing, /\.setPublicVersion\(NotificationHelper\.buildPublicVersion\(/);
  assert.match(fcm, /\.setVisibility\(NotificationCompat\.VISIBILITY_PRIVATE\)/);
  assert.match(fcm, /\.setPublicVersion\(NotificationHelper\.buildPublicVersion\(/);
  assert.match(location, /CHANNEL_ID = "hyeni_location_v5_private"/);
  assert.match(location, /locationChannel\.setLockscreenVisibility\(NotificationCompat\.VISIBILITY_PRIVATE\)/);
  assert.match(location, /\.setVisibility\(NotificationCompat\.VISIBILITY_PRIVATE\)/);
  assert.match(location, /\.setPublicVersion\(NotificationHelper\.buildPublicVersion\(/);
  for (const legacyId of [
    "hyeni_schedule_v6",
    "hyeni_safety_v1",
    "hyeni_alert_v6",
    "hyeni_kkuk_v6",
    "hyeni_silent_v1",
    "hyeni_child_message_v1",
  ]) {
    assert.match(helper, new RegExp(`"${legacyId}"`));
  }
});

test("전체화면 특별 접근과 주변 소리 요청 채널 상태를 웹 계약과 부모 건강상태가 보존한다", () => {
  const permissions = read("src/lib/native/permissions.ts");
  const family = read("src/lib/api/endpoints/family.ts");
  const screen = read("src/screens/feature/NotificationSettings.tsx");
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java");
  const reporter = read("android/app/src/main/java/com/hyeni/calendar/DeviceStatusReporter.java");

  assert.match(permissions, /fullScreenIntentAllowed\?: boolean/);
  assert.match(permissions, /remoteListenChannelEnabled\?: boolean/);
  assert.match(permissions, /openFullScreenIntentSettings\?\(\)/);
  assert.match(permissions, /readNotificationDeliveryState/);
  assert.match(permissions, /openFullScreenIntentSettings/);
  assert.match(family, /fullScreenIntentAllowed\?: boolean \| null/);
  assert.match(family, /remoteListenChannelEnabled\?: boolean \| null/);
  assert.match(screen, /잠금 화면 전체 표시/);
  assert.match(screen, /화면 상단 팝업/);
  assert.match(screen, /openFullScreenIntentSettings/);
  assert.match(
    plugin,
    /boolean fullScreenIntentAllowed = nm != null\s*&& \(Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.UPSIDE_DOWN_CAKE\s*\|\| nm\.canUseFullScreenIntent\(\)\);/s,
  );
  assert.match(
    reporter,
    /boolean fullScreenIntentAllowed = nm != null\s*&& \(Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.UPSIDE_DOWN_CAKE\s*\|\| nm\.canUseFullScreenIntent\(\)\);/s,
  );
  const fullScreenSettings = plugin.slice(
    plugin.indexOf("public void openFullScreenIntentSettings("),
    plugin.indexOf("public void openAppDetailsSettings("),
  );
  assert.match(fullScreenSettings, /try\s*\{/);
  assert.match(fullScreenSettings, /Settings\.ACTION_APPLICATION_DETAILS_SETTINGS/);
  assert.match(fullScreenSettings, /call\.reject\("잠금화면 전체 표시 설정을 열 수 없습니다"\)/);
});

test("FCM·plugin pending·service pending은 동일 위치·안전 채널 정책을 쓴다", () => {
  const fcm = read("android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java");
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java");
  const service = read("android/app/src/main/java/com/hyeni/calendar/LocationService.java");

  assert.match(fcm, /NotificationChannelPolicy\.channelFor\(/);
  assert.match(plugin, /NotificationChannelPolicy\.channelFor\(/);
  assert.match(service, /NotificationChannelPolicy\.channelFor\(/);
});

test("잠금 해제 뒤 인증된 부모는 만료 필터가 있는 서버 pending을 1회 복구한다", () => {
  const boot = read("android/app/src/main/java/com/hyeni/calendar/BootReceiver.java");
  const worker = read("android/app/src/main/java/com/hyeni/calendar/ParentPendingRecoveryWorker.java");

  assert.match(boot, /Intent\.ACTION_USER_UNLOCKED[\s\S]*ParentPendingRecoveryWorker\.enqueue/s);
  assert.match(worker, /PendingRecoveryPolicy\.shouldRun\(/);
  assert.match(worker, /get_pending_notifications_for_device/);
  assert.match(worker, /mark_notifications_delivered/);
  assert.match(worker, /networkRefreshAccessToken/);
  assert.match(worker, /NotificationTargetPolicy\.evaluate\(/);
  assert.match(worker, /NotificationChannelPolicy\.channelFor\(/);
  assert.doesNotMatch(worker, /expires_at/);
});

test("표시형 pending 판정은 시스템 알림·로컬 ACK보다 먼저 실행한다", () => {
  const worker = read("android/app/src/main/java/com/hyeni/calendar/ParentPendingRecoveryWorker.java");
  const displayPending = worker.slice(
    worker.indexOf("private JSONArray displayPending("),
    worker.indexOf("private boolean markDelivered("),
  );
  const typeGate = displayPending.indexOf("PendingNotificationTypePolicy.isDisplayNotification(type)");
  const systemAck = displayPending.indexOf("isSystemNotificationPresent(stableId)");
  const localAck = displayPending.indexOf("PolledNotificationStore.isAcked(appContext, stableId)");

  assert.ok(typeGate >= 0, "표시형 pending 정책 누락");
  assert.ok(systemAck > typeGate, "native command를 시스템 알림 존재만으로 ACK하면 안 됨");
  assert.ok(localAck > typeGate, "native command를 과거 로컬 ACK만으로 완료하면 안 됨");
});

test("data 없는 pending도 target policy를 우회하지 않는다", () => {
  const service = read("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
  const targetFn = service.slice(service.indexOf("private boolean isPendingTargetedToThisDevice("), service.indexOf("private boolean publishDeviceStatusFromPending("));

  assert.doesNotMatch(targetFn, /if \(data == null\) return true/);
  assert.match(targetFn, /Map<String, String> payload = new HashMap<>\(\)/);
  assert.match(targetFn, /NotificationTargetPolicy\.evaluate\(/);
});

test("quiet policy는 geofence·부모 안전 전송·직접 명령·foreground service를 감싸지 않는다", () => {
  const service = read("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
  const fcm = read("android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java");

  const sendPlaceAlert = service.slice(
    service.indexOf("private boolean sendPlaceAlert("),
    service.indexOf("private void", service.indexOf("private boolean sendPlaceAlert(") + 1),
  );
  const sendParentAlert = service.slice(
    service.indexOf("private void sendParentAlert("),
    service.indexOf("private void refreshNotificationQuietHoursBestEffort()"),
  );
  const foreground = service.slice(
    service.indexOf("private Notification buildForegroundNotification()"),
  );
  const directCommands = fcm.slice(
    fcm.indexOf('if ("force_ring".equals(action))'),
    fcm.indexOf('// Friend playdate session lifecycle'),
  );

  for (const [label, block] of [
    ["sendPlaceAlert", sendPlaceAlert],
    ["sendParentAlert", sendParentAlert],
    ["foreground", foreground],
    ["FCM 직접 명령", directCommands],
  ]) {
    assert.notEqual(block, "", `${label} 소스를 찾을 수 없습니다`);
    assert.doesNotMatch(block, /NotificationQuietHoursStore\.decide|QUIET_HOURS_SUPPRESSED/);
  }
  assert.match(directCommands, /force_ring/);
  assert.match(directCommands, /request_location/);
  assert.match(directCommands, /request_device_status/);
  assert.match(directCommands, /remote_listen/);
});

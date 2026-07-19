import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readMaybe = (path) => {
  try {
    return read(path);
  } catch {
    return "";
  }
};

function helperCalls(source) {
  const marker = "NotificationHelper.showNotification(";
  const calls = [];
  let cursor = 0;
  while (true) {
    const start = source.indexOf(marker, cursor);
    if (start < 0) break;
    let depth = 0;
    let end = start + marker.length - 1;
    for (; end < source.length; end += 1) {
      if (source[end] === "(") depth += 1;
      if (source[end] === ")") {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
    calls.push(source.slice(start, end));
    cursor = end;
  }
  return calls;
}

function methodBody(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  if (start < 0) return "";
  const end = nextSignature ? source.indexOf(nextSignature, start + signature.length) : -1;
  return source.slice(start, end >= 0 ? end : undefined);
}

test("Helper 조용한 시간 gate는 중복·권한·wake·게시보다 먼저 판정하고 억제도 ACK한다", () => {
  const helper = read("android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java");
  const body = helper.slice(
    helper.lastIndexOf("public static DeliveryReceipt showNotification("),
    helper.indexOf("private static boolean wasRecentlyPosted("),
  );
  const quiet = body.indexOf("NotificationQuietHoursStore.decide(");
  const createChannels = body.indexOf("createChannels(context)");
  const channelSetupFailure = body.indexOf("notification channel setup failed");
  assert.ok(quiet >= 0, "Helper의 조용한 시간 gate가 필요합니다");
  assert.ok(createChannels > quiet, "조용한 시간 판정은 채널 생성보다 먼저여야 합니다");
  assert.ok(channelSetupFailure > quiet, "조용한 시간 판정은 채널 생성 실패 처리보다 먼저여야 합니다");
  for (const marker of [
    "POST_NOTIFICATIONS",
    "wasRecentlyPosted(context, requestCode)",
    "if (wakeScreen)",
    "nm.notify(requestCode",
    "markPosted(context, requestCode)",
  ]) {
    assert.ok(body.indexOf(marker) > quiet, `${marker}보다 조용한 시간 판정이 먼저여야 합니다`);
  }
  assert.match(helper, /QUIET_HOURS_SUPPRESSED\(true, false\)/);
});

test("Android 일반 표시 경로 8곳은 exact identity를 9번째 인자로 전달한다", () => {
  const paths = [
    "android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java",
    "android/app/src/main/java/com/hyeni/calendar/LocationService.java",
    "android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java",
    "android/app/src/main/java/com/hyeni/calendar/NotificationScheduleManager.java",
    "android/app/src/main/java/com/hyeni/calendar/ParentPendingRecoveryWorker.java",
  ];
  const sources = paths.map(read);
  const calls = sources.flatMap(helperCalls);
  assert.equal(calls.length, 8, "현재 일반 알림 Helper 호출부는 정확히 8곳이어야 합니다");
  for (const call of calls) {
    assert.match(call, /NotificationQuietHoursPolicy\.NotificationIdentity\.of\(/);
  }

  const [fcm, service, plugin, schedule, worker] = sources;
  assert.match(fcm, /NotificationIdentity\.of\(type, ""\)/);
  assert.match(fcm, /NotificationIdentity\.of\(type, alertType\)/);
  assert.match(service, /NotificationIdentity\.of\("event_reminder", ""\)/);
  assert.match(service, /NotificationIdentity\.of\(type, alertType\)/);
  assert.match(plugin, /NotificationIdentity\.of\(type, alertType\)/);
  assert.match(schedule, /NotificationIdentity\.of\(type, alertType\)/);
  assert.match(worker, /NotificationIdentity\.of\(type, alertType\)/);
});

test("Capacitor adapter는 웹 no-op과 native 저장 거부를 구분한다", () => {
  const adapter = readMaybe("src/lib/native/notificationQuietHours.ts");
  assert.match(adapter, /export interface NativeQuietHoursInput/);
  assert.match(adapter, /timeZoneId: "Asia\/Seoul"/);
  assert.match(adapter, /updatedAtMs: number/);
  assert.match(adapter, /if \(!isNativePlatform\(\)\) return true/);
  assert.match(adapter, /getNativePlugin<[^>]+>\("NativeNotification"\)/s);
  assert.match(adapter, /if \(!plugin\) return false/);
  assert.match(adapter, /await plugin\.setQuietHours\(input\)/);
  assert.match(adapter, /result\.saved === true/);
  assert.match(adapter, /catch[\s\S]*return false/);
});

test("NativeBootstrap은 시작·foreground에서 같은 사용자와 session instance에만 동기화한다", () => {
  const bootstrap = read("src/app/NativeBootstrap.tsx");
  assert.match(bootstrap, /fetchNotifSettings/);
  assert.match(bootstrap, /syncNativeNotificationQuietHours/);
  assert.match(bootstrap, /getApiUser/);
  assert.match(bootstrap, /getApiSessionInstanceId/);
  assert.match(bootstrap, /const expectedUserId = userId/);
  assert.match(bootstrap, /const expectedSessionInstanceId = getApiSessionInstanceId\(\)\?\.trim\(\) \?\? ""/);
  assert.match(bootstrap, /if \(!expectedSessionInstanceId\) return/);
  assert.match(bootstrap, /getApiUser\(\)\?\.id !== expectedUserId/);
  assert.match(bootstrap, /\(getApiSessionInstanceId\(\)\?\.trim\(\) \?\? ""\) !== expectedSessionInstanceId/);
  assert.match(bootstrap, /if \(disposed[\s\S]*return/);
  assert.match(bootstrap, /quietHours\.updatedAt === null[\s\S]*0/);
  assert.match(bootstrap, /App\.addListener\("appStateChange"[\s\S]*state\.isActive[\s\S]*syncQuietHours/s);
});

test("NativeNotification.setQuietHours는 strict payload만 현재 세션 저장소에 반영한다", () => {
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java");
  const body = methodBody(plugin, "public void setQuietHours(", "public void show(");
  assert.notEqual(body, "");
  assert.match(body, /call\.getString\("userId"\)/);
  assert.match(body, /call\.getBoolean\("enabled"\)/);
  assert.match(body, /call\.getInt\("startMinute"\)/);
  assert.match(body, /call\.getInt\("endMinute"\)/);
  assert.match(body, /call\.getString\("timeZoneId"\)/);
  assert.match(body, /updatedAtMs/);
  assert.match(body, /NotificationQuietHoursStore\.saveIfCurrentSession\(/);
  assert.match(plugin, /"saved"/);
  for (const reason of ["stale_session", "stale_update", "invalid_policy"]) {
    assert.match(plugin, new RegExp(`"${reason}"`));
  }
});

test("FCM quiet control은 대상 정책 직후 처리되고 어떤 결과든 표시·ACK 없이 반환한다", () => {
  const fcm = read("android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java");
  const onMessage = methodBody(fcm, "public void onMessageReceived(", "private void showNotification(");
  const targetGate = onMessage.indexOf("targetDecision.allowsDelivery()");
  const quietCommand = onMessage.indexOf('"notification_quiet_hours_updated"');
  const forceRing = onMessage.indexOf('"force_ring"');
  const generalDisplay = onMessage.lastIndexOf("showNotification(title, body");
  assert.ok(targetGate >= 0 && quietCommand > targetGate);
  assert.ok(forceRing > quietCommand, "quiet control은 직접 동작 분기보다 먼저 처리해야 합니다");
  assert.ok(generalDisplay > quietCommand);
  assert.match(onMessage, /notification_quiet_hours_updated[\s\S]*handleNotificationQuietHoursUpdate\([\s\S]*return;/);

  const handler = methodBody(
    fcm,
    "private void handleNotificationQuietHoursUpdate(",
    "private void showNotification(",
  );
  assert.match(handler, /targetContext\.userId/);
  assert.match(handler, /NotificationQuietHoursStore\.SEOUL_TIME_ZONE_ID\.equals\(timeZoneId\)/);
  assert.match(handler, /startMinute[\s\S]*endMinute[\s\S]*updatedAt/);
  assert.match(handler, /NotificationQuietHoursStore\.saveIfCurrentSession\(/);
  assert.doesNotMatch(handler, /NotificationHelper\.showNotification|PolledNotificationStore\.markAck/);
});

test("FCM playdate와 일반 알림은 quiet suppression receipt도 로컬 ACK한다", () => {
  const fcm = read("android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java");
  const playdate = fcm.slice(
    fcm.indexOf('if ("playdate_started".equals(type)'),
    fcm.indexOf("boolean isEmergency", fcm.indexOf('if ("playdate_started".equals(type)')),
  );
  assert.match(playdate, /DeliveryReceipt receipt = NotificationHelper\.showNotification\(/);
  assert.match(playdate, /if \(receipt\.shouldAcknowledge\(\)\)[\s\S]*PolledNotificationStore\.markAck\(this, stableId\)/);

  const general = methodBody(fcm, "private void showNotification(", "private boolean isEmergencyNotification(");
  assert.match(general, /NotificationIdentity\.of\(type, alertType\)/);
  assert.match(general, /if \(receipt\.shouldAcknowledge\(\)\)[\s\S]*PolledNotificationStore\.markAck/);
});

test("LocationService quiet GET은 빈 일정과 독립적이고 401에서만 한 번 갱신 후 재시도한다", () => {
  const service = read("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
  const eventCheck = methodBody(service, "private void checkEventTimes()", "private void sendParentAlert(");
  const refreshCall = eventCheck.indexOf("refreshNotificationQuietHoursBestEffort()");
  const emptyEvents = eventCheck.indexOf("if (events.length() == 0) return");
  assert.ok(refreshCall >= 0 && emptyEvents > refreshCall);
  assert.match(eventCheck, /if \(refreshEvents\)[\s\S]*refreshNotificationQuietHoursBestEffort\(\)/);

  const quietRefresh = methodBody(
    service,
    "private void refreshNotificationQuietHoursBestEffort()",
    "private Response executeNotificationQuietHoursRequest(",
  );
  const quietRequest = methodBody(
    service,
    "private Response executeNotificationQuietHoursRequest(",
    "private void fireLocalEventReminders(",
  );
  assert.match(quietRefresh, /response\.code\(\) == 401/);
  assert.doesNotMatch(quietRefresh, /response\.code\(\) == 403|code == 403/);
  assert.equal((quietRefresh.match(/networkRefreshAccessToken\(\)/g) ?? []).length, 1);
  assert.match(quietRefresh, /responseUserId\.equals\(currentContext\.userId\)/);
  assert.match(quietRefresh, /NotificationQuietHoursStore\.saveIfCurrentSession\(/);
  assert.doesNotMatch(quietRefresh, /NotificationQuietHoursStore\.clear|prefs\.edit\(\)\.clear/);
  assert.match(quietRequest, /\/api\/notif-settings/);
  assert.match(quietRequest, /Authorization/);
});

test("AlarmManager는 type·alertType을 Intent에 보존하고 recovery도 exact identity를 쓴다", () => {
  const schedule = read("android/app/src/main/java/com/hyeni/calendar/NotificationScheduleManager.java");
  const worker = read("android/app/src/main/java/com/hyeni/calendar/ParentPendingRecoveryWorker.java");
  assert.match(schedule, /EXTRA_TYPE/);
  assert.match(schedule, /EXTRA_ALERT_TYPE/);
  assert.match(schedule, /item\.optString\("type", "scheduled_notification"\)/);
  assert.match(schedule, /item\.optString\("alertType", item\.optString\("alert_type", ""\)\)/);
  assert.match(schedule, /intent\.getStringExtra\(EXTRA_TYPE\)/);
  assert.match(schedule, /intent\.getStringExtra\(EXTRA_ALERT_TYPE\)/);
  assert.match(worker, /NotificationIdentity\.of\(type, alertType\)/);
});

test("pending 복구는 Helper의 quiet gate보다 먼저 채널을 만들지 않는다", () => {
  const worker = read("android/app/src/main/java/com/hyeni/calendar/ParentPendingRecoveryWorker.java");
  const doWork = methodBody(worker, "public Result doWork()", "private Response executePendingRequest(");

  assert.notEqual(doWork, "");
  assert.doesNotMatch(doWork, /NotificationHelper\.createChannels\(/);
  assert.match(worker, /NotificationHelper\.showNotification\(/);
});

test("instrumentation은 prefs를 원복하며 일반 억제 ACK와 안전 우회를 검증한다", () => {
  const deviceTest = readMaybe(
    "android/app/src/androidTest/java/com/hyeni/calendar/NotificationQuietHoursDeviceTest.java",
  );
  assert.match(deviceTest, /getAll\(\)/);
  assert.match(deviceTest, /finally\s*\{/);
  assert.match(deviceTest, /NotificationQuietHoursStore\.saveIfCurrentSession\(/);
  assert.match(deviceTest, /NotificationIdentity\.of\(\s*"schedule_reminder",\s*""\s*\)/);
  assert.match(deviceTest, /QUIET_HOURS_SUPPRESSED/);
  assert.match(deviceTest, /shouldAcknowledge\(\)/);
  assert.match(deviceTest, /NotificationIdentity\.of\(\s*"parent_alert",\s*"not_arrived"\s*\)/);
  assert.match(deviceTest, /getActiveNotifications\(\)/);
});

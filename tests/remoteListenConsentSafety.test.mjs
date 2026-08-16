import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => {
  const url = new URL(`../${path}`, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
};
const koNotifications = JSON.parse(read("locales/ko/notifications.json"));

test("원격청취 FCM 수신부는 공용 안내 경로만 호출하고 화면·마이크를 직접 시작하지 않는다", () => {
  const fcm = read("android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java");
  const remoteBlock = fcm.slice(
    fcm.indexOf('if ("remote_listen".equals(type))'),
    fcm.indexOf('if ("remote_listen_stop".equals(type))'),
  );

  assert.match(remoteBlock, /RemoteListenNotification\.show\(/);
  assert.doesNotMatch(remoteBlock, /wakeScreen\(/);
  assert.doesNotMatch(remoteBlock, /launchRemoteListenActivity\(/);
  assert.doesNotMatch(remoteBlock, /startAmbientListenService\(/);
  assert.doesNotMatch(fcm, /private int showRemoteListenLauncher\(/);
  assert.doesNotMatch(fcm, /private boolean launchRemoteListenActivity\(/);
  assert.doesNotMatch(fcm, /private boolean startAmbientListenService\(/);
});

test("pending 수신부도 공용 안내 경로만 호출하고 직접 캡처·Activity 실행을 하지 않는다", () => {
  const service = read("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
  const remoteBlock = service.slice(
    service.indexOf('if ("remote_listen".equals(type))'),
    service.indexOf('if ("remote_listen_stop".equals(type))'),
  );

  assert.match(remoteBlock, /RemoteListenNotification\.show\(/);
  assert.doesNotMatch(remoteBlock, /startAmbientListenFromPending\(/);
  assert.doesNotMatch(service, /private boolean startAmbientListenFromPending\(/);
  assert.doesNotMatch(service, /private void showRemoteListenLauncher\(/);
  assert.doesNotMatch(service, /remoteListenSendOptions\(/);
});

test("위급 주변소리 알림은 잠금화면까지 닿는 전체화면 인텐트를 쓰되 CALL·무음·DND 우회는 쓰지 않는다", () => {
  const notification = read("android/app/src/main/java/com/hyeni/calendar/RemoteListenNotification.java");
  const helper = read("android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java");

  assert.notEqual(notification, "");
  assert.match(notification, /PRIORITY_HIGH/);
  assert.match(notification, /setTimeoutAfter\(/);
  // 아이 탭이 필요 없으므로 알림은 "요청" 대신 "지금 듣고 있다"는 사실을 알린다.
  assert.match(notification, /부모님이 주변 소리를 확인하고 있어요/);
  assert.match(notification, /따로 누르지 않아도 돼요/);
  assert.doesNotMatch(notification, /addAction\(/);
  // 잠금·꺼짐 화면에서도 아이가 청취 사실을 볼 수 있어야 하므로 전체화면 인텐트를 쓴다.
  assert.match(notification, /setFullScreenIntent\(consentIntent, true\)/);
  // 통화로 위장하거나 소리를 죽여 몰래 열지는 않는다.
  assert.doesNotMatch(notification, /CATEGORY_CALL/);
  assert.doesNotMatch(notification, /setSilent\(true\)/);
  assert.doesNotMatch(notification, /VISIBILITY_SECRET/);
  assert.doesNotMatch(notification, /\.send\s*\(/);
  assert.match(helper, /hyeni_remote_listen_v6_consent/);
  const channelBody = helper.slice(
    helper.indexOf("ensureRemoteListenConsentChannel"),
    helper.indexOf("public static int stableRequestCode"),
  );
  assert.match(channelBody, /IMPORTANCE_HIGH/);
  assert.match(channelBody, /주변 소리 알림/);
  assert.match(channelBody, /아이 화면과 알림에 표시/);
  assert.doesNotMatch(channelBody, /동의 요청|직접 허용|확인과 수락/);
  assert.doesNotMatch(channelBody, /setBypassDnd\(true\)/);
  assert.doesNotMatch(channelBody, /setSound\(null/);
});

test("위급 주변소리 화면은 아이 탭 없이 즉시 연결하되 청취 사실을 숨기지 않는다", () => {
  const activity = read("android/app/src/main/java/com/hyeni/calendar/RemoteListenActivity.java");
  const readyBranch = activity.slice(
    activity.indexOf("if (status == RemoteListenRequestStore.PendingStatus.READY)"),
    activity.indexOf("if (status == RemoteListenRequestStore.PendingStatus.EXPIRED)"),
  );

  // 아이 동의 탭(허용/거절 버튼)은 받지 않는다.
  assert.doesNotMatch(activity, /공유할게|거절할게|setDecisionButtonsEnabled|acceptButton|declineButton/);
  // READY 면 곧바로 연결한다.
  assert.notEqual(readyBranch, "");
  assert.match(readyBranch, /acceptRequest\(\);/);
  // 숨기지 않는다: 아이 화면에 무엇이 일어나는지 항상 문장으로 알린다.
  assert.match(activity, /부모님이 위급 상황을 확인하려고/);
  assert.match(activity, /부모님께 주변 소리를 연결하고 있어요/);
  // 잠금·꺼짐 화면에서도 안내가 보이게 하되 기기 잠금은 열지 않는다.
  assert.match(activity, /private void wakeOverLockScreen\(\)/);
  assert.match(activity, /setShowWhenLocked\(true\)/);
  assert.match(activity, /setTurnScreenOn\(true\)/);
  assert.doesNotMatch(activity, /requestDismissKeyguard/);
  // 세션·만료·권한 안전장치는 그대로 유지한다.
  assert.match(activity, /RemoteListenRequestStore\.inspectPending/);
  assert.match(activity, /RemoteListenRequestStore\.accept/);
  assert.match(activity, /markDeclined/);
  assert.match(activity, /markExpired/);
  assert.match(activity, /permission_denied/);
  assert.match(activity, /not_child_role/);
  assert.match(activity, /session_changed_before_start/);
  assert.match(activity, /session_changed_after_consent/);
  // 서버 승인 확인 없이 마이크를 켜지는 않는다.
  assert.match(activity, /RemoteListenConsentClient\.confirm\(/);
  const acceptBody = activity.slice(
    activity.indexOf("private void acceptRequest("),
    activity.indexOf("private void declineRequest("),
  );
  assert.doesNotMatch(acceptBody, /startForegroundService|startService/);
});

test("캡처 서비스는 승인 증표를 1회 소비하고 1분 뒤 종료하며 알림 중지 액션을 제공한다", () => {
  const service = read("android/app/src/main/java/com/hyeni/calendar/AmbientListenService.java");
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/AmbientListenPlugin.java");
  const locationPlugin = read("android/app/src/main/java/com/hyeni/calendar/LocationPlugin.java");

  assert.match(service, /RemoteListenRequestStore\.consumeAcceptance/);
  assert.match(service, /EXTRA_CONSENT_TOKEN/);
  assert.match(service, /RemoteListenRequestPolicy\.normalizeDurationSec/);
  assert.match(service, /RemoteListenRequestPolicy\.matchesStop/);
  assert.match(service, /주변 소리를 보호자에게 공유 중/);
  assert.match(service, /addAction\(/);
  assert.doesNotMatch(service, /START_REDELIVER_INTENT/);
  assert.match(plugin, /remote_listen_requires_child_consent_notification/);
  assert.doesNotMatch(plugin, /startForegroundService\(/);
  assert.match(locationPlugin, /AmbientListenService\.stopForRetiringSession/);
});

test("원격청취 요청·중지는 requestId·대상·60초 만료를 서버 명령에 함께 보낸다", () => {
  const endpoint = read("src/lib/api/endpoints/remote.ts");
  const queries = read("src/queries/useRemote.ts");
  const screen = read("src/screens/feature/RemoteAudio.tsx");

  assert.match(endpoint, /remote_listen_target_required/);
  assert.match(endpoint, /requestedAt/);
  assert.match(endpoint, /expiresAt/);
  assert.match(endpoint, /action:\s*"remote_listen_stop"[\s\S]*requestId/);
  assert.match(queries, /requestId:\s*string/);
  assert.match(screen, /const requestId = auditSession\.id/);
  assert.doesNotMatch(screen, /const makeRequestId/);
  assert.match(screen, /request_timeout/);
  assert.match(screen, /sessionTiming\.phase === "request_expired"[\s\S]*state: "requestExpired"/);
  assert.match(
    koNotifications["notifications.remoteAudio.toast"],
    /requestExpired \{아이 기기가 1분 안에 연결되지 않아 요청을 종료했어요\}/,
  );
  assert.doesNotMatch(screen, /아이 기기가 1분 안에 연결되지 않아 요청을 종료했어요/);
});

test("오디오 업로드는 access JWT만 쓰고 부모는 audit session과 대상 아이가 모두 정확한 청크만 재생한다", () => {
  const service = read("android/app/src/main/java/com/hyeni/calendar/AmbientListenService.java");
  const screen = read("src/screens/feature/RemoteAudio.tsx");

  assert.match(service, /&& notBlank\(accessToken\)/);
  assert.match(service, /postBroadcast\(body, accessToken/);
  assert.doesNotMatch(service, /shouldFallbackToAnon|postBroadcast\(body, supabaseKey|Bearer " \+ supabaseKey/);
  assert.match(screen, /if \(!payload\?\.childUserId \|\| payload\.childUserId !== childUserId\) return;/);
  assert.match(screen, /if \(!payload\?\.requestId \|\| payload\.requestId !== activeRequestId\) return;/);
});

test("위급 주변소리 Activity는 잠금화면 표시 속성을 갖고 SOS 전체화면 경로도 유지한다", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const remoteActivity = manifest.match(
    /<activity(?=[^>]*android:name="\.RemoteListenActivity")[^>]*\/>/s,
  )?.[0] ?? "";

  assert.notEqual(remoteActivity, "");
  assert.match(remoteActivity, /android:showWhenLocked="true"/);
  assert.match(remoteActivity, /android:turnScreenOn="true"/);
  assert.match(remoteActivity, /android:exported="false"/);
  assert.match(manifest, /android:name="\.PushAlertActivity"[\s\S]*?android:showWhenLocked="true"/);
  assert.match(manifest, /android:name="\.ForceRingActivity"[\s\S]*?android:turnScreenOn="true"/);
});

test("동의 API 401은 현재 세션을 보존해 한 번만 갱신·재시도하고 토큰을 삭제하지 않는다", () => {
  const client = read("android/app/src/main/java/com/hyeni/calendar/RemoteListenConsentClient.java");

  assert.match(client, /REFRESH_LOCK/);
  assert.match(client, /SessionTokenStore\.generation\(\)/);
  assert.match(client, /reconcileIfGeneration/);
  assert.match(client, /sessionNonce/);
  assert.match(client, /auth\/refresh/);
  assert.match(client, /shouldRetryAfterUnauthorized/);
  assert.doesNotMatch(client, /remove\("accessToken"\)|remove\("refreshToken"\)/);
});

test("Android 16 회전을 허용하면서 동의 처리 중 Activity 재생성을 막는다", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const mainActivity = manifest.match(
    /<activity(?=[^>]*android:name="\.MainActivity")[^>]*>/s,
  )?.[0] ?? "";
  const remoteActivity = manifest.match(
    /<activity(?=[^>]*android:name="\.RemoteListenActivity")[^>]*\/>/s,
  )?.[0] ?? "";

  assert.notEqual(mainActivity, "");
  assert.notEqual(remoteActivity, "");
  assert.doesNotMatch(mainActivity, /android:screenOrientation=/);
  assert.doesNotMatch(remoteActivity, /android:screenOrientation=/);
  assert.match(mainActivity, /android:configChanges="[^"]*orientation[^"]*screenSize[^"]*"/);
  assert.match(remoteActivity, /android:configChanges="[^"]*orientation[^"]*screenSize[^"]*"/);
});

test("위급 주변소리 요청은 Activity보다 먼저 저장하고 보이는 앱에서만 연결 화면을 직접 연다", () => {
  const notification = read("android/app/src/main/java/com/hyeni/calendar/RemoteListenNotification.java");
  const storeIndex = notification.indexOf("RemoteListenRequestStore.markNotificationShown(");
  const notifyIndex = notification.indexOf("manager.notify(notificationId, notification)");

  assert.ok(storeIndex >= 0 && notifyIndex > storeIndex, "full-screen Activity보다 요청 상태를 먼저 저장해야 합니다");
  assert.match(
    notification,
    /MainActivity\.isAppForegroundForMicrophone\(\)[\s\S]*context\.startActivity\(launchIntent\)/,
  );
  assert.match(notification, /catch \(RuntimeException error\) \{\s*RemoteListenRequestStore\.discardPendingNotification/s);
  assert.doesNotMatch(notification, /startForegroundService|startService/);
});

test("Android 15+ 긴급 전체화면 PendingIntent는 creator BAL 권한을 명시한다", () => {
  const factory = read("android/app/src/main/java/com/hyeni/calendar/UrgentActivityPendingIntent.java");
  const notification = read("android/app/src/main/java/com/hyeni/calendar/RemoteListenNotification.java");
  const helper = read("android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java");
  const fcm = read("android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java");

  assert.match(factory, /setPendingIntentCreatorBackgroundActivityStartMode/);
  assert.match(factory, /MODE_BACKGROUND_ACTIVITY_START_ALLOW_ALWAYS/);
  assert.match(factory, /MODE_BACKGROUND_ACTIVITY_START_ALLOWED/);
  assert.match(notification, /UrgentActivityPendingIntent\.getActivity\(/);
  assert.match(helper, /UrgentActivityPendingIntent\.getActivity\(/);
  assert.match(fcm, /UrgentActivityPendingIntent\.getActivity\(/);
});

test("동의 전 access JWT 수명을 확인하고 오디오 전송 실패를 서버 감사 상태에 반영한다", () => {
  const client = read("android/app/src/main/java/com/hyeni/calendar/RemoteListenConsentClient.java");
  const service = read("android/app/src/main/java/com/hyeni/calendar/AmbientListenService.java");
  const security = read("worker/lib/remoteListenSecurity.ts");

  assert.match(client, /requiresRefreshForCapture/);
  assert.match(client, /CAPTURE_AUTH_SAFETY_MS/);
  assert.match(service, /audio_auth_failed/);
  assert.match(service, /audio_upload_failed/);
  assert.match(service, /reportCaptureFailure/);
  assert.match(service, /addPathSegments\("api\/remote-listen\/sessions"\)/);
  assert.match(service, /MAX_AUDIO_UPLOAD_ATTEMPTS/);
  assert.match(service, /BroadcastResult/);
  assert.match(security, /"audio_auth_failed"/);
  assert.match(security, /"audio_upload_failed"/);
});

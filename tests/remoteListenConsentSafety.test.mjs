import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => {
  const url = new URL(`../${path}`, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
};

test("원격청취 FCM은 일반 동의 알림만 게시하고 화면·마이크를 자동 시작하지 않는다", () => {
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

test("pending 원격청취도 동의 알림만 게시하고 직접 캡처·Activity 자동 실행을 하지 않는다", () => {
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

test("원격청취 알림은 high-priority 일반 알림이며 full-screen·CALL·무음·DND 우회를 쓰지 않는다", () => {
  const notification = read("android/app/src/main/java/com/hyeni/calendar/RemoteListenNotification.java");
  const helper = read("android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java");

  assert.notEqual(notification, "");
  assert.match(notification, /PRIORITY_HIGH/);
  assert.match(notification, /setTimeoutAfter\(/);
  assert.match(notification, /부모님이 주변 소리 듣기를 요청했어/);
  assert.doesNotMatch(notification, /setFullScreenIntent/);
  assert.doesNotMatch(notification, /CATEGORY_CALL/);
  assert.doesNotMatch(notification, /setSilent\(true\)/);
  assert.doesNotMatch(notification, /\.send\s*\(/);
  assert.match(helper, /hyeni_remote_listen_v6_consent/);
  const channelBody = helper.slice(
    helper.indexOf("ensureRemoteListenConsentChannel"),
    helper.indexOf("public static int stableRequestCode"),
  );
  assert.match(channelBody, /IMPORTANCE_HIGH/);
  assert.doesNotMatch(channelBody, /setBypassDnd\(true\)/);
  assert.doesNotMatch(channelBody, /setSound\(null/);
});

test("아이 동의 화면은 매 요청 수락·거절·만료·권한 거부를 처리하고 자동 시작하지 않는다", () => {
  const activity = read("android/app/src/main/java/com/hyeni/calendar/RemoteListenActivity.java");
  const handler = activity.slice(
    activity.indexOf("private void handleRemoteListenIntent("),
    activity.indexOf("private void acceptRequest("),
  );

  assert.match(activity, /공유할게/);
  assert.match(activity, /거절할게/);
  assert.match(activity, /RemoteListenRequestStore\.inspectPending/);
  assert.match(activity, /RemoteListenRequestStore\.accept/);
  assert.match(activity, /markDeclined/);
  assert.match(activity, /markExpired/);
  assert.match(activity, /permission_denied/);
  assert.doesNotMatch(handler, /startAmbientListen/);
  assert.doesNotMatch(activity, /wakeOverLockScreen|setTurnScreenOn|requestDismissKeyguard/);
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
  assert.match(screen, /아이 기기에서 1분 안에 허용하지 않아 요청을 종료했어요/);
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

test("원격청취 Activity는 잠금화면 자동 표시 속성을 갖지 않고 SOS 전체화면 경로는 유지한다", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const remoteActivity = manifest.match(
    /<activity(?=[^>]*android:name="\.RemoteListenActivity")[^>]*\/>/s,
  )?.[0] ?? "";

  assert.notEqual(remoteActivity, "");
  assert.doesNotMatch(remoteActivity, /showWhenLocked|turnScreenOn/);
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

test("동의 처리 중 화면 회전으로 Activity가 재생성되지 않도록 세로 방향을 고정한다", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const remoteActivity = manifest.match(
    /<activity(?=[^>]*android:name="\.RemoteListenActivity")[^>]*\/>/s,
  )?.[0] ?? "";

  assert.match(remoteActivity, /android:screenOrientation="portrait"/);
});

test("동의 전 access JWT 수명을 확인하고 오디오 전송 실패를 서버 감사 상태에 반영한다", () => {
  const client = read("android/app/src/main/java/com/hyeni/calendar/RemoteListenConsentClient.java");
  const service = read("android/app/src/main/java/com/hyeni/calendar/AmbientListenService.java");
  const security = read("../hyeni-1/worker/lib/remoteListenSecurity.ts");

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

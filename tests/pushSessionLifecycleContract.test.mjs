import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("로그아웃 정리는 진행 중 등록을 멈춘 뒤 취소 신호를 전달하고 완료까지 새 등록을 막는다", () => {
  const auth = read("src/auth/AuthProvider.tsx");
  const nativePush = read("src/lib/native/push.ts");
  const webPush = read("src/lib/webPush.ts");

  assert.match(auth, /const cleanup = beginPushSessionCleanup\(\)/);
  assert.match(auth, /const registrationInstanceId = getApiSessionInstanceId\(\)\?\.trim\(\) \?\? ""/);
  assert.match(auth, /await cleanup\.waitForRegistrations\(\)/);
  assert.match(auth, /unregisterPushBeforeLogout\(userId, \{[\s\S]{0,120}signal: cleanup\.signal,[\s\S]{0,120}registrationInstanceId/);
  assert.match(auth, /unsubscribeWebPush\(\{[\s\S]{0,120}signal: cleanup\.signal,[\s\S]{0,120}registrationInstanceId/);
  assert.match(auth, /cleanup\.abort\(\)/);
  assert.match(auth, /\.finally\(\(\) => cleanup\.finish\(\)\)/);

  assert.match(nativePush, /const permit = await acquirePushRegistrationPermit\(\)/);
  assert.match(nativePush, /p_registration_instance_id:\s*registrationInstanceId/);
  assert.match(nativePush, /lastRegisteredRegistrationInstanceId/);
  assert.match(nativePush, /signal: options\.signal/);
  assert.match(nativePush, /options\.registrationInstanceId/);
  assert.match(nativePush, /permit\.release\(\)/);

  assert.match(webPush, /const permit = await acquirePushRegistrationPermit\(\)/);
  assert.match(webPush, /registration_instance_id:\s*registrationInstanceId/);
  assert.match(webPush, /registration_instance_id=\$\{encodeURIComponent\(registrationInstanceId\)\}/);
  assert.match(webPush, /export async function unsubscribeWebPush\([\s\S]*signal\?: AbortSignal/);
  assert.match(webPush, /registrationInstanceId\?: string/);
  assert.match(webPush, /if \(options\.signal\?\.aborted\) return false/);
});

test("FCM 등록과 해제는 작업 시작 시 캡처한 현재 session instance를 exact key로 전달한다", () => {
  const nativePush = read("src/lib/native/push.ts");

  assert.match(nativePush, /getApiSessionInstanceId\(\)\?\.trim\(\)/);
  assert.match(nativePush, /registrationInstanceId/);
  assert.match(nativePush, /p_registration_instance_id:\s*registrationInstanceId/);
  assert.match(nativePush, /token === lastRegisteredToken[\s\S]{0,160}registrationInstanceId === lastRegisteredRegistrationInstanceId/);
});

test("네이티브 FCM 등록은 access 401에서만 refresh를 single-flight로 1회 수행하고 세션을 지우지 않는다", () => {
  const source = read("android/app/src/main/java/com/hyeni/calendar/NativePushTokenSync.java");

  assert.match(source, /private static final Object REFRESH_LOCK/);
  assert.match(source, /synchronized \(REFRESH_LOCK\)/);
  assert.match(source, /\/auth\/refresh/);
  assert.match(source, /device_install_id/);
  assert.match(source, /SessionTokenStore\.generation\(\)/);
  assert.match(source, /SessionTokenStore\.reconcileIfGeneration\(/);
  assert.match(source, /isRefreshRetryEligible\(/);
  assert.match(source, /refreshRetryUsed/);
  assert.doesNotMatch(source, /SessionTokenStore\.clear\(/);
  assert.doesNotMatch(source, /remove\("(?:accessToken|refreshToken)"\)/);
});

test("현재 Android 로그인은 FCM ownership 409에서만 token을 1회 교체한 뒤 exact 세션으로 재등록한다", () => {
  const bridge = read("src/lib/native/push.ts");
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/LocationPlugin.java");

  assert.match(bridge, /isApiError\(error\) && error\.status === 409/);
  assert.match(bridge, /rotateFcmToken/);
  assert.match(bridge, /currentPushIdentityMatches\(params, registrationInstanceId\)/);
  assert.match(bridge, /rotatedToken !== token/);
  assert.match(bridge, /conflictRecoveryUsed/);

  assert.match(plugin, /public void rotateFcmToken\(PluginCall call\)/);
  assert.match(plugin, /FcmTokenConflictRecoveryPolicy\.canStart/);
  assert.match(plugin, /FirebaseMessaging\.getInstance\(\)\.deleteToken\(\)/);
  assert.match(plugin, /FirebaseMessaging\.getInstance\(\)\.getToken\(\)/);
  assert.match(plugin, /NativePushTokenSync\.isSameRegistrationContext/);
  assert.match(plugin, /LAST_FCM_CONFLICT_ROTATION_NONCE/);
  assert.doesNotMatch(plugin, /rotateFcmToken[\s\S]{0,3000}SessionTokenStore\.clear\(/);
});

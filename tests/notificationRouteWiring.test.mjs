import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("FCM과 pending의 서버 route가 Android 알림 탭까지 보존된다", () => {
  const fcm = read("android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java");
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java");
  const pending = read("src/lib/native/parentPendingNotifications.ts");
  assert.match(fcm, /data\.get\("route"\)/);
  assert.match(plugin, /call\.getString\("route"/);
  assert.match(pending, /route:\s*firstText\(data\.route\)/);
});

test("MainActivity는 역할별 allowlist 정책을 통과한 hash route만 연다", () => {
  const main = read("android/app/src/main/java/com/hyeni/calendar/MainActivity.java");
  assert.match(main, /NotificationRoutePolicy\.resolveHashRoute/);
  assert.match(main, /injectHashRoute/);
});

test("전체화면 알림도 검증된 route를 PushAlertActivity에서 MainActivity까지 보존한다", () => {
  const helper = read("android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java");
  const alert = read("android/app/src/main/java/com/hyeni/calendar/PushAlertActivity.java");

  assert.match(helper, /NotificationRoutePolicy\.resolveHashRoute\(/);
  assert.match(helper, /contentIntent\.putExtra\("route", validatedRoute\)/);
  assert.match(helper, /alertIntent\.putExtra\("route", validatedRoute\)/);
  assert.match(alert, /getIntent\(\)\.getStringExtra\("route"\)/);
  assert.match(alert, /intent\.putExtra\("route", route\)/);
});

test("Android route 정책은 허용된 안전 식별자 query만 명시한다", () => {
  const policy = read("android/app/src/main/java/com/hyeni/calendar/NotificationRoutePolicy.java");

  assert.match(policy, /SAFE_IDENTIFIER/);
  assert.ok(policy.includes('^/parent/memo\\\\?child='));
  assert.ok(policy.includes('^/sos-receive\\\\?alert='));
  assert.match(policy, /&child=/);
  assert.ok(policy.includes('^/notifications\\\\?alert='));
});

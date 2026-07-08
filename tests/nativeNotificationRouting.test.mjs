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

  assert.match(fcm, /boolean isMemo = "new_memo"\.equals\(type\);/);
  assert.match(fcm, /isChildMessage = "ai_proactive"\.equals\(type\) \|\| isMemo \|\| isSticker/);
  assert.match(fcm, /isChildMessage \? "child_message" : "schedule"/);
  assert.match(poll, /"new_memo"\.equals\(type\) \? "child-memo"/);
});

test("부모 메모 알림을 탭하면 아이 메모 화면으로 진입한다", () => {
  const fcm = readSource("android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java");
  const main = readSource("android/app/src/main/java/com/hyeni/calendar/MainActivity.java");

  assert.match(fcm, /isMemo \? "child-memo"/);
  assert.match(main, /"child-memo"\.equals\(route\)/);
  assert.match(main, /injectHashRoute\("#\/child\/memo", 1000\)/);
});

test("아이 메시지 채널은 다른 일반 알림보다 우선 보이도록 high importance 계약을 유지한다", () => {
  const helper = readSource("android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java");

  assert.match(helper, /CHANNEL_CHILD_MESSAGE = "hyeni_child_message_v1"/);
  assert.match(helper, /CHANNEL_CHILD_MESSAGE,\s*"AI 친구·가족 메시지",\s*NotificationManager\.IMPORTANCE_HIGH/s);
  assert.match(helper, /boolean childMessage = "child_message"\.equals\(channel\);/);
  assert.match(helper, /fullScreen \|\| childMessage\) \? NotificationCompat\.PRIORITY_HIGH/);
  assert.match(helper, /kkuk \|\| childMessage\) \? NotificationCompat\.CATEGORY_MESSAGE/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workerStickers = readFileSync(
  "C:/Users/TK/Desktop/hyeni-3/worker/routes/stickers.ts",
  "utf8",
);
const fcmService = readFileSync(
  "android/app/src/main/java/com/hyeni/calendar/MyFirebaseMessagingService.java",
  "utf8",
);
const mainActivity = readFileSync(
  "android/app/src/main/java/com/hyeni/calendar/MainActivity.java",
  "utf8",
);
const locationService = readFileSync(
  "android/app/src/main/java/com/hyeni/calendar/LocationService.java",
  "utf8",
);

assert.ok(
  workerStickers.includes("sendFcmToFamily"),
  "부모가 보낸 칭찬 스티커는 realtime 외에 FCM도 발송해야 한다",
);
assert.ok(
  workerStickers.includes('"sticker"'),
  "스티커 FCM data.type 은 Android 수신부가 구분할 수 있게 sticker 여야 한다",
);
assert.ok(
  workerStickers.includes('targetRole: "child"') && workerStickers.includes("new Set([targetUserId])"),
  "스티커 FCM 은 부모 전체가 아니라 대상 아이 user_id 로만 제한해야 한다",
);
assert.ok(
  workerStickers.includes("stickerId") && workerStickers.includes("stickerTitle"),
  "스티커 FCM 에는 중복 방지와 화면 표시용 sticker metadata 가 포함되어야 한다",
);

assert.ok(
  fcmService.includes('"sticker".equals(type)'),
  "Android FCM 수신부는 sticker 타입을 별도 메시지 알림으로 처리해야 한다",
);
assert.ok(
  fcmService.includes('"child-sticker"'),
  "스티커 알림을 탭하면 아이 스티커북 route 로 이동해야 한다",
);
assert.ok(
  mainActivity.includes('"child-sticker"'),
  "MainActivity 는 child-sticker route extra 를 처리해야 한다",
);
assert.ok(
  mainActivity.includes("#/child/sticker"),
  "child-sticker route 는 HashRouter 의 /child/sticker 로 이동해야 한다",
);
assert.ok(
  locationService.includes('"sticker".equals(type)') && locationService.includes('"child-sticker"'),
  "pending 알림 폴링 경로도 sticker 타입을 스티커북 route 로 처리해야 한다",
);

console.log("stickerBackgroundPush contract ok");

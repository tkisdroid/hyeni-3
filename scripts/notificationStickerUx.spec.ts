import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const androidLocation = readFileSync(
  "android/app/src/main/java/com/hyeni/calendar/LocationService.java",
  "utf8",
);
const serverGeofence = readFileSync(
  "C:/Users/TK/Desktop/hyeni-3/worker/shared/registeredPlaceGeofence.js",
  "utf8",
);
const arbitraryArrival = readFileSync(
  "C:/Users/TK/Desktop/hyeni-3/worker/lib/arrivalDetect.ts",
  "utf8",
);
const realtime = readFileSync("src/queries/useFamilyRealtime.ts", "utf8");
const app = readFileSync("src/app/App.tsx", "utf8");
const celebration = readFileSync("src/components/ui/StickerCelebration.tsx", "utf8");
const stickerHooks = readFileSync("src/queries/useStickers.ts", "utf8");

for (const [label, source] of [
  ["android registered place", androidLocation],
  ["server registered place", serverGeofence],
  ["server arbitrary arrival", arbitraryArrival],
] as const) {
  assert.ok(!source.includes("반경 안에"), `${label} 알림은 반경 판정 방식을 설명하면 안 된다`);
  assert.ok(!source.includes("머무른 뒤 확인"), `${label} 알림은 체류 판정 방식을 설명하면 안 된다`);
  assert.ok(!source.includes("장소 밖에 있어"), `${label} 알림은 이탈 판정 방식을 설명하면 안 된다`);
  assert.ok(!source.includes("분째 머물고"), `${label} 알림은 체류 시간을 설명하면 안 된다`);
}

assert.ok(
  realtime.includes("maybeCelebrateSticker"),
  "스티커 INSERT realtime 은 아이 수신자에게 축하 이벤트를 연결해야 한다",
);
assert.ok(
  realtime.includes("hy:sticker-celebration"),
  "스티커 수신 축하 이벤트 이름은 전역 호스트와 일치해야 한다",
);
assert.ok(
  app.includes("StickerCelebrationHost"),
  "앱 최상단에 스티커 축하 오버레이 호스트가 있어야 한다",
);
assert.ok(
  celebration.includes("useReceivedStickers"),
  "아이 앱이 꺼져 있던 동안 받은 부모 스티커도 다음 진입 때 감지해야 한다",
);
assert.ok(
  celebration.includes("hy_last_celebrated_sticker_"),
  "이미 축하한 스티커는 앱 재시작 후 중복 재생하지 않아야 한다",
);
assert.ok(
  stickerHooks.includes("userId === undefined ? myId : userId"),
  "전역 스티커 축하 호스트가 부모 계정에서는 받은 스티커 조회를 비활성화할 수 있어야 한다",
);

console.log("notificationStickerUx contract ok");

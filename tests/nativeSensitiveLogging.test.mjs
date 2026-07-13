import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mainActivity = readFileSync(
  new URL("../android/app/src/main/java/com/hyeni/calendar/MainActivity.java", import.meta.url),
  "utf8",
);

test("릴리스 네이티브 로그는 FCM 토큰 원문이나 prefix를 출력하지 않는다", () => {
  assert.doesNotMatch(mainActivity, /token\.substring\s*\(/);
  assert.doesNotMatch(mainActivity, /FCM token primed:\s*"\s*\+/);
  assert.match(mainActivity, /Log\.i\("MainActivity",\s*"FCM token primed"\)/);
});

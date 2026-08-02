import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fcm = readFileSync(new URL("../lib/fcm.ts", import.meta.url), "utf8");
const manifest = readFileSync(
  new URL("../../../hyeni-3/android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);

test("FCM direct boot 설정은 CE 세션을 쓰는 수신 서비스와 모순되지 않는다", () => {
  assert.match(manifest, /android:name="\.MyFirebaseMessagingService"[\s\S]{0,120}android:directBootAware="false"/);
  assert.doesNotMatch(fcm, /direct_boot_ok:\s*true/);
  assert.match(fcm, /direct_boot_ok:\s*false/);
});

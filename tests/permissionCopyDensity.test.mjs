import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/feature/PermDenied.tsx"), "utf8");
const locationSettings = readFileSync(resolve(rootDir, "src/screens/feature/LocationSettings.tsx"), "utf8");
const childLocation = readFileSync(resolve(rootDir, "src/screens/child/ChildLocationStatus.tsx"), "utf8");
const notificationSettings = readFileSync(resolve(rootDir, "src/screens/feature/NotificationSettings.tsx"), "utf8");

test("권한 복구 화면은 이유·설정 경로·핵심 행동만 짧게 안내한다", () => {
  assert.match(source, /아이 위치와 도착·출발 알림에 사용해요/);
  assert.match(source, /설정 → 앱 → 혜니캘린더 → 권한/);
  assert.match(source, /주소창 자물쇠 → 사이트 설정 → 허용/);
  assert.match(source, /\{busy \? "확인 중…" : isNativePlatform\(\) \? "설정 열기" : "권한 요청"\}/);
  assert.match(source, />\s*다시 확인\s*</);
  assert.doesNotMatch(source, /우리 아이가 어디서 안전한지 확인하려면 위치 접근을 허용해 주세요/);
  assert.doesNotMatch(source, /휴대폰 설정 → 앱 → 혜니캘린더 → 권한 에서 허용으로 바꿔 주세요/);
});

test("권한 복구 화면은 실제 권한을 사용하는 기기에서만 연결된다", () => {
  assert.doesNotMatch(locationSettings, /navigate\("\/perm-denied",\s*\{ state: \{ kind: "loc" \} \}\)/);
  assert.match(locationSettings, /deviceLocationHealthView\(activeChild\?\.device_health\)/);
  assert.match(locationSettings, /아이 기기의 권한·배터리 예외는 아이 앱에서 직접 허용해야 해요/);
  assert.doesNotMatch(childLocation, /navigate\("\/perm-denied",\s*\{ state: \{ kind: "loc" \} \}\)/);
  assert.match(childLocation, /readPermissionState\("loc"\)/);
  assert.match(childLocation, /<ChildLocationPermissionDialog[\s\S]*copyMode="child"/);
  assert.match(notificationSettings, /navigate\("\/perm-denied",\s*\{ state: \{ kind: "noti" \} \}\)/);
});

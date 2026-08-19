import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

test("Android foreground는 FCM·위치 서비스와 무관하게 전체 기기 상태를 현재 세션으로 저장한다", () => {
  const reporter = read("android/app/src/main/java/com/hyeni/calendar/DeviceStatusReporter.java");
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/LocationPlugin.java");
  const nativeStatus = read("src/lib/native/deviceStatus.ts");
  const bootstrap = read("src/app/NativeBootstrap.tsx");

  assert.match(reporter, /static JSONObject buildPayload\(/);
  assert.match(plugin, /void getDeviceHealthSnapshot\(PluginCall call\)/);
  assert.match(plugin, /DeviceStatusReporter\.buildPayload\(/);
  assert.match(nativeStatus, /collectNativeDeviceHealth/);
  assert.match(nativeStatus, /getDeviceHealthSnapshot\(\{ familyId, userId \}\)/);
  assert.match(bootstrap, /collectNativeDeviceHealth\(familyId, userId\)/);
  assert.match(bootstrap, /await reportDeviceStatus\(familyId, health\)/);
  assert.match(bootstrap, /appStateChange[\s\S]{0,180}state\.isActive[\s\S]{0,80}send\(\)/);
  assert.doesNotMatch(bootstrap, /if \(isNativePlatform\(\)\) return; \/\/ 네이티브는 LocationService/);
});

test("부모 홈은 활성 아이에게 상태를 요청하고 WS 누락 시 저장값을 재조회한다", () => {
  const home = read("src/screens/parent/ParentHome.tsx");

  assert.match(home, /requestDeviceStatus\(familyId, childUserId\)/);
  assert.match(home, /\[1200, 3500, 8000\]/);
  assert.match(home, /familyQuery\.refetch\(\)/);
  assert.match(home, /requestDeviceStatus\(familyId, activeChild\?\.user_id \?\? null\)/);
});

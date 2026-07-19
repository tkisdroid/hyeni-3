import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/screens/onboarding/Onboarding.tsx", import.meta.url), "utf8");

test("아이 백그라운드 위치 권한 전 눈에 띄는 별도 안내를 제공한다", () => {
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /아이 위치 공유 안내/);
  assert.match(source, /앱을 닫거나 사용하지 않을 때도 위치를 수집/);
  assert.match(source, /연결된 보호자에게 공유/);
  assert.match(source, /집·학교·학원 도착·출발, 일정 미도착, 위험장소 알림/);
  assert.match(source, /Android의 지속 알림이 표시/);
  assert.match(source, /위치 설정에서 언제든지 권한을 끌 수 있습니다/);
  assert.match(source, /동의하고 계속/);
});

test("위치 안내 뒤 전경과 백그라운드 권한을 서로 다른 사용자 동작으로 요청한다", () => {
  assert.match(source, /<PermsStep[\s\S]*role=\{role\}[\s\S]*onDone=\{\(\) => navigate/);
  assert.match(source, /requestForegroundLocationPermission\(\)/);
  assert.match(source, /setLocationStage\("backgroundEducation"\)/);
  assert.match(source, /requestBackgroundLocationPermission\(\)/);
  assert.match(source, /‘항상 허용’ 설정 열기/);
  assert.match(source, /권한 없이 시작/);
  assert.match(source, /role === "child" \? CHILD_PERM_ITEMS : GUARDIAN_PERM_ITEMS/);
});

const nativeSource = await readFile(
  new URL("../android/app/src/main/java/com/hyeni/calendar/LocationPlugin.java", import.meta.url),
  "utf8",
);
const locationServiceSource = await readFile(
  new URL("../android/app/src/main/java/com/hyeni/calendar/LocationService.java", import.meta.url),
  "utf8",
);
const notificationPluginSource = await readFile(
  new URL("../android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java", import.meta.url),
  "utf8",
);
const permissionScreenSource = await readFile(
  new URL("../src/screens/feature/PermDenied.tsx", import.meta.url),
  "utf8",
);

test("백그라운드 서비스 자동 시작은 권한창을 띄우지 않고 명시적 설정만 기다린다", () => {
  const startService = nativeSource.slice(
    nativeSource.indexOf("public void startService"),
    nativeSource.indexOf("public void requestCurrentLocation"),
  );
  assert.match(startService, /status", "permission_required"/);
  assert.doesNotMatch(startService, /requestPermissionForAliases|requestPermissions\(/);
  assert.match(nativeSource, /public void requestForegroundLocation/);
  assert.match(nativeSource, /public void requestBackgroundLocation/);
});

test("위치 서비스는 배터리 예외 화면을 자동으로 띄우지 않고 사용자 버튼 경로만 제공한다", () => {
  assert.doesNotMatch(locationServiceSource, /requestBatteryOptimizationExemption/);
  assert.doesNotMatch(locationServiceSource, /ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
  assert.match(notificationPluginSource, /public void openBatteryOptimizationSettings/);
  assert.doesNotMatch(notificationPluginSource, /ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
  assert.match(notificationPluginSource, /ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS/);
  assert.match(permissionScreenSource, /혜니캘린더 → 제한 없음\(또는 최적화 안 함\)/);
});

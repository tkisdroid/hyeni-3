import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const onboardingSource = await readFile(new URL("../src/screens/onboarding/Onboarding.tsx", import.meta.url), "utf8");
const dialogSource = await readFile(new URL("../src/components/ChildLocationPermissionDialog.tsx", import.meta.url), "utf8");
const childLocationSource = await readFile(new URL("../src/screens/child/ChildLocationStatus.tsx", import.meta.url), "utf8");
const koShared = JSON.parse(await readFile(new URL("../locales/ko/shared.json", import.meta.url), "utf8"));

test("아이 백그라운드 위치 권한 전 눈에 띄는 별도 안내를 제공한다", () => {
  assert.match(dialogSource, /role="dialog"/);
  assert.match(dialogSource, /aria-modal="true"/);
  assert.match(dialogSource, /아이 위치 공유 안내/);
  assert.match(dialogSource, /앱을 닫거나 사용하지 않을 때도 위치를 수집/);
  assert.match(dialogSource, /연결된 보호자에게 공유/);
  assert.match(dialogSource, /집·학교·학원 도착·출발, 일정 미도착, 위험구역 알림/);
  assert.match(dialogSource, /Android의 지속 알림이 표시/);
  assert.match(dialogSource, /위치 설정에서 언제든지 권한을 끌 수 있습니다/);
  assert.match(dialogSource, /동의하고 계속/);
});

test("위치 안내 뒤 전경과 백그라운드 권한을 서로 다른 사용자 동작으로 요청한다", () => {
  assert.match(onboardingSource, /<PermsStep[\s\S]*role=\{role\}[\s\S]*onDone=\{finishPermissionSetup\}/);
  assert.match(onboardingSource, /<ChildLocationPermissionDialog[\s\S]*copyMode="formal"/);
  assert.match(dialogSource, /requestForegroundLocationPermission\(\)/);
  assert.match(dialogSource, /type: "foregroundResult"/);
  assert.match(dialogSource, /requestBackgroundLocationPermission\(\)/);
  assert.match(dialogSource, /‘항상 허용’ 설정 열기/);
  assert.match(dialogSource, /권한 없이 시작/);
  assert.match(onboardingSource, /role === "child" \? CHILD_PERM_ITEMS : GUARDIAN_PERM_ITEMS/);
});

test("아이 위치 화면에서 다시 켤 때도 같은 고지 흐름을 먼저 연다", () => {
  assert.match(childLocationSource, /readPermissionState\("loc"\)/);
  assert.match(childLocationSource, /setPermissionDialogOpen\(true\)/);
  assert.match(childLocationSource, /<ChildLocationPermissionDialog[\s\S]*copyMode="child"/);
  assert.match(dialogSource, /stage === "foregroundDenied"[\s\S]*onClick=\{retry\}/);
  assert.match(dialogSource, /deniedEyebrow: "위치 권한이 필요해"/);
  assert.match(dialogSource, /deniedEyebrow: "위치 권한이 필요해요"/);
  assert.doesNotMatch(dialogSource, /<span className="clp-dialog__eyebrow">위치 권한이 필요해요<\/span>/);
});

test("아이 위치 상태의 최근 갱신 문구를 중복해서 붙이지 않는다", () => {
  assert.doesNotMatch(childLocationSource, /fresh\?\.label \?\? "방금 전"\}\s*업데이트/);
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
  assert.match(permissionScreenSource, /shared\.permDenied\.steps\.batteryNative/);
  assert.equal(
    koShared["shared.permDenied.steps.batteryNative"],
    "혜니캘린더 → 제한 없음(또는 최적화 안 함)",
  );
});

test("위치 포그라운드 서비스 알림은 위치 공유 사실을 명확히 표시한다", () => {
  assert.match(locationServiceSource, /setContentTitle\("위치 공유 중"\)/);
  assert.match(locationServiceSource, /보호자에게 위치를 공유하고 있어요/);
  assert.doesNotMatch(locationServiceSource, /부모님이 함께하고 있어요/);
});

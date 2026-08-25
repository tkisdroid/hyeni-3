import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const onboardingSource = await readFile(new URL("../src/screens/onboarding/Onboarding.tsx", import.meta.url), "utf8");
const dialogSource = await readFile(new URL("../src/components/ChildLocationPermissionDialog.tsx", import.meta.url), "utf8");
const childLocationSource = await readFile(new URL("../src/screens/child/ChildLocationStatus.tsx", import.meta.url), "utf8");
const koShared = JSON.parse(await readFile(new URL("../locales/ko/shared.json", import.meta.url), "utf8"));
const LOCALES = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];
const sharedCatalogs = Object.fromEntries(await Promise.all(LOCALES.map(async (locale) => [
  locale,
  JSON.parse(await readFile(new URL(`../locales/${locale}/shared.json`, import.meta.url), "utf8")),
])));

/** 고지 문구는 컴포넌트가 아니라 locale catalog 가 정본이다. */
const disclosureId = (key, tone) => `shared.locationPermission.${key}.${tone}`;

test("아이 백그라운드 위치 권한 전 눈에 띄는 별도 안내를 제공한다", () => {
  assert.match(dialogSource, /role="dialog"/);
  assert.match(dialogSource, /aria-modal="true"/);
  // 다이얼로그는 원문을 들고 있지 않고 톤별 message id 로만 문구를 읽는다.
  assert.match(dialogSource, /shared\.locationPermission\.\$\{key\}\.\$\{copyMode === "child" \? "child" : "formal"\}/);
  for (const key of ["disclosure.eyebrow", "disclosure.collection", "disclosure.purpose", "disclosure.control"]) {
    assert.ok(dialogSource.includes(`"${key}"`), `${key} 렌더 누락`);
  }

  assert.equal(koShared[disclosureId("disclosure.eyebrow", "formal")], "아이 위치 공유 안내");
  assert.match(koShared[disclosureId("disclosure.collection", "formal")], /앱을 닫거나 사용하지 않을 때도 위치를 수집/);
  assert.match(koShared[disclosureId("disclosure.collection", "formal")], /연결된 보호자에게 공유/);
  assert.match(koShared[disclosureId("disclosure.purpose", "formal")], /집·학교·학원 도착·출발, 일정 미도착, 위험구역 알림/);
  assert.match(koShared[disclosureId("disclosure.control", "formal")], /Android의 지속 알림이 표시/);
  assert.match(koShared[disclosureId("disclosure.control", "formal")], /위치 설정에서 언제든지 권한을 끌 수 있습니다/);
  assert.equal(koShared[disclosureId("action.continue", "formal")], "동의하고 계속");
});

test("prominent disclosure 3문장은 10개 언어 모두 실제로 번역돼 있다", () => {
  const keys = ["disclosure.collection", "disclosure.purpose", "disclosure.control"];
  for (const tone of ["child", "formal"]) {
    for (const key of keys) {
      const korean = sharedCatalogs.ko[disclosureId(key, tone)];
      assert.ok(korean && korean.trim().length > 0, `ko:${key}.${tone}`);
      for (const locale of LOCALES.filter((code) => code !== "ko")) {
        const value = sharedCatalogs[locale][disclosureId(key, tone)];
        assert.ok(value && value.trim().length > 0, `${locale}:${key}.${tone} 누락`);
        // 한국어 원문이 그대로 남아 있으면 그 언어에서 고지가 읽히지 않는다.
        assert.notEqual(value, korean, `${locale}:${key}.${tone} 미번역`);
        assert.doesNotMatch(value, /[가-힣]/, `${locale}:${key}.${tone} 한국어 잔존`);
      }
      // 수집 고지는 어느 언어에서도 브랜드를 밝혀야 한다(누가 수집하는지).
      if (key === "disclosure.collection") {
        for (const locale of LOCALES.filter((code) => code !== "ko")) {
          assert.match(sharedCatalogs[locale][disclosureId(key, tone)], /Hyeni Calendar/, `${locale}:${tone} 브랜드`);
        }
      }
    }
  }
});

test("위치 안내 뒤 전경과 백그라운드 권한을 서로 다른 사용자 동작으로 요청한다", () => {
  assert.match(onboardingSource, /<PermsStep[\s\S]*role=\{role\}[\s\S]*onDone=\{finishPermissionSetup\}/);
  assert.match(onboardingSource, /<ChildLocationPermissionDialog[\s\S]*copyMode="formal"/);
  assert.match(dialogSource, /requestForegroundLocationPermission\(\)/);
  assert.match(dialogSource, /type: "foregroundResult"/);
  assert.match(dialogSource, /requestBackgroundLocationPermission\(\)/);
  assert.equal(koShared[disclosureId("action.openSettings", "formal")], "‘항상 허용’ 설정 열기");
  assert.equal(koShared[disclosureId("action.withoutPermission", "formal")], "권한 없이 시작");
  assert.match(onboardingSource, /role === "child" \? CHILD_PERM_ITEMS : GUARDIAN_PERM_ITEMS/);
});

test("아이 위치 화면에서 다시 켤 때도 같은 고지 흐름을 먼저 연다", () => {
  assert.match(childLocationSource, /readPermissionState\("loc"\)/);
  assert.match(childLocationSource, /setPermissionDialogOpen\(true\)/);
  assert.match(childLocationSource, /<ChildLocationPermissionDialog[\s\S]*copyMode="child"/);
  assert.match(dialogSource, /stage === "foregroundDenied"[\s\S]*onClick=\{retry\}/);
  // 같은 화면이 아이에게는 반말, 보호자에게는 존댓말을 쓴다.
  assert.equal(koShared[disclosureId("denied.eyebrow", "child")], "위치 권한이 필요해");
  assert.equal(koShared[disclosureId("denied.eyebrow", "formal")], "위치 권한이 필요해요");
  assert.doesNotMatch(dialogSource, /<span className="clp-dialog__eyebrow">위치 권한이 필요해요<\/span>/);
  // 원문 표가 다시 들어오면 다국어에서 한국어가 새어 나온다.
  assert.doesNotMatch(dialogSource, /const (?:FORMAL|CHILD)_COPY/);
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

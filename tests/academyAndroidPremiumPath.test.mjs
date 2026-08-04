import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../android/app/src/main/java/com/hyeni/calendar/LocationService.java", import.meta.url),
  "utf8",
);

test("아이 Android는 Premium·장소 알림 설정 확인 뒤 academy 위치를 PostgREST로 읽는다", () => {
  const masterGate = source.indexOf(
    "placeAlertsEnabled = TierAlertTargetPolicy.isServerRegisteredPlaceAlertsEnabled(fam)",
  );
  const entitlementGate = source.indexOf(
    "boolean premium = TierAlertTargetPolicy.isServerPremiumEntitlement(entitlement)",
    masterGate,
  );
  const premiumBranch = source.indexOf("if (premium)", entitlementGate);
  const academyFetch = source.indexOf("/rest/v1/academies?family_id=eq.", premiumBranch);
  assert.ok(masterGate >= 0, "Android 장소 알림 master switch 게이트가 필요합니다");
  assert.ok(entitlementGate > masterGate, "서버 Premium 정본 게이트가 필요합니다");
  assert.ok(premiumBranch > entitlementGate, "academy 조회는 Premium 분기 안에 있어야 합니다");
  assert.ok(academyFetch > premiumBranch, "Premium 게이트 뒤 academy 위치 조회 경로가 유지돼야 합니다");
});

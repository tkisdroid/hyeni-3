import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../android/app/src/main/java/com/hyeni/calendar/LocationService.java", import.meta.url),
  "utf8",
);

test("Android 등록장소는 Premium 전체 게이트 대신 서버가 확정한 저장 장소 대상을 사용한다", () => {
  assert.doesNotMatch(source, /placeAlertsEnabled\s*=\s*premium\s*&&\s*settingOn/);
  assert.doesNotMatch(source, /boolean\s+settingOn\s*=\s*true/);
  assert.match(
    source,
    /placeAlertsEnabled\s*=\s*TierAlertTargetPolicy\.isServerRegisteredPlaceAlertsEnabled\(fam\)/,
  );
  assert.match(source, /tier_alert_active/);
  assert.match(source, /tier_alert_inactive_reason/);
  assert.match(source, /TierAlertTargetPolicy\.isServerAlertTarget\(r\)/);
});

test("학원은 서버 Premium gate를 유지하고 위험구역은 네이티브 중복 평가하지 않는다", () => {
  assert.match(source, /\/api\/entitlement\?family_id=/);
  assert.match(source, /TierAlertTargetPolicy\.isServerPremiumEntitlement/);
  assert.match(source, /if \(premium\)[\s\S]{0,500}rest\/v1\/academies/);
  assert.doesNotMatch(source, /rest\/v1\/family_subscription/);
  assert.match(source, /rest\/v1\/academies/);
  assert.doesNotMatch(source, /rest\/v1\/danger_zones/);
});

test("entitlement 또는 장소 정본 조회 실패 시 stale 알림 캐시를 유지하지 않는다", () => {
  assert.match(
    source,
    /boolean premium = TierAlertTargetPolicy\.isServerPremiumEntitlement\(entitlement\)/,
  );
  assert.match(source, /if \(premium\)[\s\S]{0,500}rest\/v1\/academies/);
  assert.match(
    source,
    /synchronized \(cachedPlaces\) \{ cachedPlaces\.clear\(\); cachedPlaces\.addAll\(next\); \}/,
  );
  assert.doesNotMatch(source, /if \(entitlement == null\)[\s\S]{0,200}return/);
  assert.match(
    source,
    /catch \(Exception e\) \{\s*disablePlaceAlertsAndClearCache\(\);\s*Log\.w\(TAG, "refreshPlacesAndGates failed", e\)/,
  );
  assert.match(
    source,
    /private void disablePlaceAlertsAndClearCache\(\) \{\s*placeAlertsEnabled = false;\s*synchronized \(cachedPlaces\) \{ cachedPlaces\.clear\(\); \}/,
  );
});

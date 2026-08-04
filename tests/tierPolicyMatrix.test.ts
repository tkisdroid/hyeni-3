import test from "node:test";
import assert from "node:assert/strict";
import {
  FEATURES,
  TIERS,
  aiFriendDailyBaseFor,
  aiScheduleDailyLimitFor,
  canAddChild,
  canUse,
  dangerZoneLimitFor,
  forceRingDailyLimitFor,
  getTierLabel,
  historyDaysFor,
  isLocationVisible,
  isRealtimeLocation,
  locationModeFor,
  manualLocationRequestDailyLimitFor,
  maxChildrenFor,
  placeLimitFor,
  scheduleLimitFor,
} from "../src/transform/tierPolicy.ts";

test("구독 티어별 아이·일정·장소 제한은 단일 정책으로 명확하게 구분된다", () => {
  assert.equal(maxChildrenFor(TIERS.FREE), 1);
  assert.equal(maxChildrenFor(TIERS.REVIEWED), 1);
  assert.equal(maxChildrenFor(TIERS.PREMIUM), 2);

  assert.equal(scheduleLimitFor(TIERS.UNKNOWN), Infinity);
  assert.equal(scheduleLimitFor(TIERS.FREE), Infinity);
  assert.equal(scheduleLimitFor(TIERS.REVIEWED), Infinity);
  assert.equal(scheduleLimitFor(TIERS.PREMIUM), Infinity);

  assert.equal(placeLimitFor(TIERS.FREE), 2);
  assert.equal(placeLimitFor(TIERS.REVIEWED), 3);
  assert.equal(placeLimitFor(TIERS.PREMIUM), Infinity);

  assert.equal(canAddChild(TIERS.FREE, 1), false);
  assert.equal(canAddChild(TIERS.PREMIUM, 1), true);
});

test("위치와 프리미엄 기능은 무료·기존 혜택·프리미엄 티어를 혼동하지 않는다", () => {
  assert.equal(locationModeFor(TIERS.UNKNOWN), "locked");
  assert.equal(locationModeFor(TIERS.FREE), "standard");
  assert.equal(locationModeFor(TIERS.REVIEWED), "standard");
  assert.equal(locationModeFor(TIERS.PREMIUM), "realtime");
  assert.equal(isLocationVisible(TIERS.FREE), true);
  assert.equal(isLocationVisible(TIERS.REVIEWED), true);
  assert.equal(isRealtimeLocation(TIERS.REVIEWED), false);
  assert.equal(isRealtimeLocation(TIERS.PREMIUM), true);

  for (const feature of [
    FEATURES.REALTIME_LOCATION,
    FEATURES.REMOTE_AUDIO,
    FEATURES.AI_ANALYSIS,
    FEATURES.WEEKLY_REPORT,
    FEATURES.ACADEMY_SCHEDULE,
    FEATURES.SAFETY_INSIGHTS,
    FEATURES.MULTI_GEOFENCE,
    FEATURES.EXTENDED_HISTORY,
  ]) {
    assert.equal(canUse(TIERS.FREE, feature), false, `${feature} must be locked on free`);
    assert.equal(canUse(TIERS.REVIEWED, feature), false, `${feature} must be locked on reviewed`);
    assert.equal(canUse(TIERS.PREMIUM, feature), true, `${feature} must be premium`);
  }

  assert.equal(canUse(TIERS.FREE, FEATURES.MULTI_SCHEDULE), true);
  assert.equal(canUse(TIERS.REVIEWED, FEATURES.MULTI_SCHEDULE), true);
  assert.equal(canUse(TIERS.FREE, FEATURES.SAVED_PLACES), true);
  assert.equal(canUse(TIERS.REVIEWED, FEATURES.SAVED_PLACES), true);
});

test("초기 출시 사용량 정책은 Free와 Premium의 가치를 수치로 구분한다", () => {
  assert.equal(historyDaysFor(TIERS.FREE), 1);
  assert.equal(historyDaysFor(TIERS.REVIEWED), 1);
  assert.equal(historyDaysFor(TIERS.PREMIUM), 30);

  assert.equal(manualLocationRequestDailyLimitFor(TIERS.FREE), 5);
  assert.equal(manualLocationRequestDailyLimitFor(TIERS.REVIEWED), 5);
  assert.equal(manualLocationRequestDailyLimitFor(TIERS.PREMIUM), Infinity);

  assert.equal(dangerZoneLimitFor(TIERS.FREE), 1);
  assert.equal(dangerZoneLimitFor(TIERS.REVIEWED), 1);
  assert.equal(dangerZoneLimitFor(TIERS.PREMIUM), Infinity);

  assert.equal(forceRingDailyLimitFor(TIERS.FREE), 1);
  assert.equal(forceRingDailyLimitFor(TIERS.REVIEWED), 1);
  assert.equal(forceRingDailyLimitFor(TIERS.PREMIUM), 10);

  assert.equal(aiFriendDailyBaseFor(TIERS.FREE), 5);
  assert.equal(aiFriendDailyBaseFor(TIERS.REVIEWED), 5);
  assert.equal(aiFriendDailyBaseFor(TIERS.PREMIUM), 20);

  assert.equal(aiScheduleDailyLimitFor(TIERS.FREE), 5);
  assert.equal(aiScheduleDailyLimitFor(TIERS.REVIEWED), 5);
  assert.equal(aiScheduleDailyLimitFor(TIERS.PREMIUM), Infinity);
});

test("기존 reviewed 행은 기능을 잃지 않되 사용자에게 별도 상업 티어로 노출하지 않는다", () => {
  assert.equal(getTierLabel(TIERS.FREE), "무료");
  assert.equal(getTierLabel(TIERS.REVIEWED), "무료");
  assert.equal(placeLimitFor(TIERS.REVIEWED), 3);
});

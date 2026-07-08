import test from "node:test";
import assert from "node:assert/strict";
import {
  FEATURES,
  TIERS,
  canAddChild,
  canUse,
  isLocationVisible,
  isRealtimeLocation,
  locationModeFor,
  maxChildrenFor,
  placeLimitFor,
  scheduleLimitFor,
} from "../src/transform/tierPolicy.ts";

test("구독 티어별 아이·일정·장소 제한은 단일 정책으로 명확하게 구분된다", () => {
  assert.equal(maxChildrenFor(TIERS.FREE), 1);
  assert.equal(maxChildrenFor(TIERS.REVIEWED), 1);
  assert.equal(maxChildrenFor(TIERS.PREMIUM), 2);

  assert.equal(scheduleLimitFor(TIERS.FREE), 1);
  assert.equal(scheduleLimitFor(TIERS.REVIEWED), 3);
  assert.equal(scheduleLimitFor(TIERS.PREMIUM), Infinity);

  assert.equal(placeLimitFor(TIERS.FREE), 1);
  assert.equal(placeLimitFor(TIERS.REVIEWED), 3);
  assert.equal(placeLimitFor(TIERS.PREMIUM), Infinity);

  assert.equal(canAddChild(TIERS.FREE, 1), false);
  assert.equal(canAddChild(TIERS.PREMIUM, 1), true);
});

test("위치와 프리미엄 기능은 무료·리뷰·프리미엄 티어를 혼동하지 않는다", () => {
  assert.equal(locationModeFor(TIERS.FREE), "locked");
  assert.equal(locationModeFor(TIERS.REVIEWED), "delayed");
  assert.equal(locationModeFor(TIERS.PREMIUM), "realtime");
  assert.equal(isLocationVisible(TIERS.FREE), false);
  assert.equal(isLocationVisible(TIERS.REVIEWED), true);
  assert.equal(isRealtimeLocation(TIERS.REVIEWED), false);
  assert.equal(isRealtimeLocation(TIERS.PREMIUM), true);

  for (const feature of [
    FEATURES.REALTIME_LOCATION,
    FEATURES.REMOTE_AUDIO,
    FEATURES.AI_ANALYSIS,
    FEATURES.WEEKLY_REPORT,
    FEATURES.MULTI_GEOFENCE,
    FEATURES.EXTENDED_HISTORY,
  ]) {
    assert.equal(canUse(TIERS.FREE, feature), false, `${feature} must be locked on free`);
    assert.equal(canUse(TIERS.REVIEWED, feature), false, `${feature} must be locked on reviewed`);
    assert.equal(canUse(TIERS.PREMIUM, feature), true, `${feature} must be premium`);
  }

  assert.equal(canUse(TIERS.FREE, FEATURES.MULTI_SCHEDULE), false);
  assert.equal(canUse(TIERS.REVIEWED, FEATURES.MULTI_SCHEDULE), true);
  assert.equal(canUse(TIERS.FREE, FEATURES.SAVED_PLACES), false);
  assert.equal(canUse(TIERS.REVIEWED, FEATURES.SAVED_PLACES), true);
});

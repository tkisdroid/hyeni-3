import test from "node:test";
import assert from "node:assert/strict";

import { deriveEntitlement } from "../src/transform/entitlement.ts";

test("결제 체험은 미래 trial_ends_at 증거가 있을 때만 프리미엄이다", () => {
  const future = deriveEntitlement({
    subscription: { status: "trial", trial_ends_at: "2099-01-01T00:00:00.000Z" },
    family: null,
  });
  assert.equal(future.isPremium, true);
  assert.equal(future.isTrial, true);

  for (const trialEndsAt of [null, "2000-01-01T00:00:00.000Z", "invalid-date"]) {
    const invalid = deriveEntitlement({
      subscription: { status: "trial", trial_ends_at: trialEndsAt },
      family: null,
    });
    assert.equal(invalid.isPremium, false);
    assert.equal(invalid.isTrial, false);
    assert.equal(invalid.status, "expired");
    assert.equal(invalid.planLabel, "무료 플랜");
  }
});

test("active와 grace는 미래 current_period_end 증거가 있을 때만 프리미엄이다", () => {
  for (const status of ["active", "grace"]) {
    const current = deriveEntitlement({
      subscription: {
        status,
        current_period_end: "2099-01-01T00:00:00.000Z",
        trial_ends_at: "2000-01-01T00:00:00.000Z",
      },
      family: null,
    });
    assert.equal(current.isPremium, true);
    assert.equal(current.status, status);

    for (const periodEnd of [null, "2000-01-01T00:00:00.000Z", "invalid-date"]) {
      const stale = deriveEntitlement({
        subscription: { status, current_period_end: periodEnd },
        family: null,
      });
      assert.equal(stale.isPremium, false);
      assert.equal(stale.status, "expired");
      assert.equal(stale.planLabel, "무료 플랜");
    }
  }
});

test("해지한 구독도 이미 결제한 current_period_end까지는 프리미엄을 유지한다", () => {
  const future = deriveEntitlement({
    subscription: { status: "cancelled", current_period_end: "2099-01-01T00:00:00.000Z" },
    family: null,
  });
  assert.equal(future.isPremium, true);
  assert.equal(future.status, "cancelled");

  const expired = deriveEntitlement({
    subscription: { status: "cancelled", current_period_end: "2000-01-01T00:00:00.000Z" },
    family: null,
  });
  assert.equal(expired.isPremium, false);
  assert.equal(expired.status, "expired");
});

test("종료일 증거가 없는 legacy trial은 프리미엄으로 인정하지 않는다", () => {
  const view = deriveEntitlement({
    subscription: null,
    family: { user_tier: "trial" },
  });
  assert.equal(view.isPremium, false);
  assert.equal(view.status, "free");
});

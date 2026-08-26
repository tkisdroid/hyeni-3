import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveEntitlement,
  resolveEntitlementResponse,
} from "../src/transform/entitlement.ts";
import { getTierLabel, tierFrom, TIERS } from "../src/transform/tierPolicy.ts";

test("effective premium은 서로 모순되는 raw 무료 행보다 항상 우선한다", () => {
  const response = {
    effective: {
      tier: "premium",
      is_premium: true,
      source: "child_subscription",
      has_grandfathered_review_limits: false,
    },
    subscription: {
      status: "expired",
      current_period_end: "2000-01-01T00:00:00.000Z",
    },
    family: { user_tier: "free" },
  } as const;

  const resolution = resolveEntitlementResponse(response);
  const view = deriveEntitlement(response);

  assert.equal(resolution.contract, "effective");
  assert.equal(resolution.effectiveTier, "premium");
  assert.equal(resolution.effectiveSource, "child_subscription");
  assert.equal(resolution.view?.isPremium, true);
  assert.equal(view?.isPremium, true);
});

test("effective free는 미래 active raw 행도 프리미엄으로 되살리지 않는다", () => {
  const response = {
    effective: {
      tier: "free",
      is_premium: false,
      source: "free",
      has_grandfathered_review_limits: false,
    },
    subscription: {
      status: "active",
      current_period_end: "2099-01-01T00:00:00.000Z",
    },
    family: { user_tier: "premium" },
  } as const;

  const resolution = resolveEntitlementResponse(response);

  assert.equal(resolution.contract, "effective");
  assert.equal(resolution.effectiveTier, "free");
  assert.equal(resolution.view?.isPremium, false);
  assert.equal(resolution.view?.planLabelId, "billing.subscription.plan.free");
});

test("grandfather는 상업 티어 free를 바꾸지 않고 기존 reviewed 한도만 보존한다", () => {
  const resolution = resolveEntitlementResponse({
    effective: {
      tier: "free",
      is_premium: false,
      source: "free",
      has_grandfathered_review_limits: true,
    },
    subscription: null,
    family: { user_tier: "free" },
  });
  const tier = tierFrom({
    ready: resolution.view !== null,
    isPremium: resolution.view?.isPremium === true,
    reviewed: resolution.hasGrandfatheredReviewLimits,
  });

  assert.equal(resolution.effectiveTier, "free");
  assert.equal(tier, TIERS.REVIEWED);
  assert.equal(getTierLabel(tier), "무료");
});

test("effective가 존재하지만 훼손됐으면 raw premium으로 폴백하지 않고 invalid로 닫는다", () => {
  const malformedEffectiveValues = [
    null,
    {
      tier: "premium",
      is_premium: false,
      source: "family_subscription",
      has_grandfathered_review_limits: false,
    },
    {
      tier: "premium",
      is_premium: true,
      source: "unknown_source",
      has_grandfathered_review_limits: false,
    },
    {
      tier: "free",
      is_premium: false,
      source: "free",
      has_grandfathered_review_limits: "true",
    },
  ];

  for (const effective of malformedEffectiveValues) {
    const response = {
      effective,
      subscription: {
        status: "active",
        current_period_end: "2099-01-01T00:00:00.000Z",
      },
      family: { user_tier: "premium" },
    };
    const resolution = resolveEntitlementResponse(response);

    assert.equal(resolution.contract, "invalid");
    assert.equal(resolution.view, null);
    assert.equal(resolution.hasGrandfatheredReviewLimits, false);
    assert.equal(deriveEntitlement(response), null);
  }
});

test("effective 필드가 없는 구버전 Worker 응답만 raw 호환 판정을 사용한다", () => {
  const resolution = resolveEntitlementResponse({
    subscription: {
      status: "active",
      current_period_end: "2099-01-01T00:00:00.000Z",
    },
    family: { user_tier: "free" },
  });

  assert.equal(resolution.contract, "legacy");
  assert.equal(resolution.effectiveTier, null);
  assert.equal(resolution.view?.isPremium, true);
  assert.equal(resolution.hasGrandfatheredReviewLimits, false);
});

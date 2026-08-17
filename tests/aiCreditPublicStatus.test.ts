import test from "node:test";
import assert from "node:assert/strict";

import {
  aiIncludedDailyLimitForExplicitTier,
  normalizeAiCreditPublicStatusPayload,
  resolveAiLimitExhaustionReason,
} from "../src/transform/aiCreditPublicStatus.ts";

test("AI 공개 사용량은 서버의 Free/Premium 포함량과 실제 잔여 횟수를 그대로 정규화한다", () => {
  assert.deepEqual(
    normalizeAiCreditPublicStatusPayload({
      is_premium: false,
      daily_included_limit: 5,
      daily_included_used: 2,
      daily_reset_date: "2026-08-01",
      purchased_credits: 0,
      parent_daily_used: 2,
      parent_daily_limit: 5,
      available_remaining: 3,
    }),
    {
      isPremium: false,
      dailyIncludedLimit: 5,
      dailyIncludedUsed: 2,
      dailyResetDate: "2026-08-01",
      hasPurchasedCredits: false,
      parentDailyUsed: 2,
      parentDailyLimit: 5,
      availableRemaining: 3,
      // 구버전 Worker 응답에는 unlimited 가 없다 — 한도 적용(false)으로 닫는다.
      unlimited: false,
    },
  );

  assert.deepEqual(
    normalizeAiCreditPublicStatusPayload({
      is_premium: true,
      daily_included_limit: 20,
      daily_included_used: 3,
      daily_reset_date: "2026-08-01",
      purchased_credits: 1,
      parent_daily_used: 4,
      parent_daily_limit: 30,
      available_remaining: 26,
    }),
    {
      isPremium: true,
      dailyIncludedLimit: 20,
      dailyIncludedUsed: 3,
      dailyResetDate: "2026-08-01",
      hasPurchasedCredits: true,
      parentDailyUsed: 4,
      parentDailyLimit: 30,
      availableRemaining: 26,
      unlimited: false,
    },
  );
});

test("AI 공개 사용량은 숫자 문자열·누락·잘못된 마스크·모순된 잔여 횟수를 신뢰하지 않는다", () => {
  const valid = {
    is_premium: false,
    daily_included_limit: 5,
    daily_included_used: 2,
    daily_reset_date: "2026-08-01",
    purchased_credits: 0,
    parent_daily_used: 2,
    parent_daily_limit: 5,
    available_remaining: 3,
  };

  assert.equal(normalizeAiCreditPublicStatusPayload({ ...valid, daily_included_limit: "5" }), null);
  assert.equal(normalizeAiCreditPublicStatusPayload({ ...valid, daily_included_used: 6 }), null);
  assert.equal(normalizeAiCreditPublicStatusPayload({ ...valid, purchased_credits: 2 }), null);
  assert.equal(normalizeAiCreditPublicStatusPayload({ ...valid, available_remaining: 4 }), null);
  assert.equal(normalizeAiCreditPublicStatusPayload({ ...valid, daily_reset_date: "2026-02-30" }), null);
  assert.equal(normalizeAiCreditPublicStatusPayload({ ...valid, parent_daily_limit: -1 }), null);
  assert.equal(normalizeAiCreditPublicStatusPayload({ ...valid, is_premium: 0 }), null);
  assert.equal(normalizeAiCreditPublicStatusPayload(null), null);

  assert.deepEqual(
    normalizeAiCreditPublicStatusPayload({
      ...valid,
      parent_daily_used: 0,
      parent_daily_limit: 0,
      available_remaining: 0,
    })?.availableRemaining,
    0,
  );
});

test("서버 포함량이 없을 때는 티어가 명시된 경우에만 Free 5회/Premium 20회를 사용한다", () => {
  assert.equal(aiIncludedDailyLimitForExplicitTier(false), 5);
  assert.equal(aiIncludedDailyLimitForExplicitTier(true), 20);
  assert.equal(aiIncludedDailyLimitForExplicitTier(null), null);
  assert.equal(aiIncludedDailyLimitForExplicitTier(undefined), null);
});

test("AI 소진 원인은 부모 안전 상한과 Free·Premium 상업 포함량을 구분한다", () => {
  assert.equal(resolveAiLimitExhaustionReason({
    isPremium: false,
    dailyIncludedLimit: 5,
    parentDailyLimit: 3,
  }), "parent_safety_limit");
  assert.equal(resolveAiLimitExhaustionReason({
    isPremium: false,
    dailyIncludedLimit: 5,
    parentDailyLimit: 5,
  }), "free_included_limit");
  assert.equal(resolveAiLimitExhaustionReason({
    isPremium: true,
    dailyIncludedLimit: 20,
    parentDailyLimit: 20,
  }), "premium_allowance_limit");
  assert.equal(resolveAiLimitExhaustionReason(null), "unknown");
});

test("unlimited 는 additive 필드이며 정확히 true 일 때만 무제한으로 읽는다", () => {
  const base = {
    is_premium: true,
    daily_included_limit: 20,
    daily_included_used: 14,
    daily_reset_date: "2026-08-17",
    purchased_credits: 0,
    parent_daily_used: 14,
    parent_daily_limit: 10,
    available_remaining: 0,
  };
  // 운영자 본인 가족: 한도가 0이어도 무제한으로 표시된다.
  assert.equal(normalizeAiCreditPublicStatusPayload({ ...base, unlimited: true })?.unlimited, true);
  // 없거나 truthy 흉내(문자열 "true"·1)는 무제한으로 보지 않는다(fail-closed).
  assert.equal(normalizeAiCreditPublicStatusPayload(base)?.unlimited, false);
  for (const bad of ["true", 1, "1", {}, []]) {
    assert.equal(normalizeAiCreditPublicStatusPayload({ ...base, unlimited: bad })?.unlimited, false);
  }
});

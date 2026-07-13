import test from "node:test";
import assert from "node:assert/strict";

import { resolveReviewRewardQueryScope } from "../src/transform/reviewRewardScope.ts";

test("리뷰 보상 조회는 부모 세션에서만 서버 호출을 켠다", () => {
  assert.deepEqual(
    resolveReviewRewardQueryScope({
      status: "authenticated",
      role: "parent",
      familyId: "family-1",
    }),
    { enabled: true, readyWithoutFetch: false },
  );
});

test("아이 세션은 부모 전용 리뷰 보상 API를 호출하지 않고 false로 확정한다", () => {
  assert.deepEqual(
    resolveReviewRewardQueryScope({
      status: "authenticated",
      role: "child",
      familyId: "family-1",
    }),
    { enabled: false, readyWithoutFetch: true },
  );
});

test("비로그인이나 가족 미확정 상태는 리뷰 보상 판정을 보류한다", () => {
  assert.deepEqual(
    resolveReviewRewardQueryScope({
      status: "unauthenticated",
      role: null,
      familyId: null,
    }),
    { enabled: false, readyWithoutFetch: false },
  );
  assert.deepEqual(
    resolveReviewRewardQueryScope({
      status: "authenticated",
      role: "parent",
      familyId: null,
    }),
    { enabled: false, readyWithoutFetch: false },
  );
});

test("리뷰 혜택 지급은 인증된 부모의 확정된 무료 티어에서만 허용한다", async () => {
  const scopeModule = await import("../src/transform/reviewRewardScope.ts");
  assert.equal(typeof scopeModule.resolveReviewRewardClaimScope, "function");
  const resolveClaimScope = scopeModule.resolveReviewRewardClaimScope;

  assert.equal(
    resolveClaimScope({
      status: "authenticated",
      role: "parent",
      familyId: "family-1",
      ready: true,
      tier: "free",
    }).enabled,
    true,
  );

  for (const input of [
    { status: "unauthenticated", role: null, familyId: null, ready: true, tier: "free" },
    { status: "authenticated", role: "parent", familyId: null, ready: true, tier: "free" },
    { status: "authenticated", role: "child", familyId: "family-1", ready: true, tier: "free" },
    { status: "authenticated", role: "teacher", familyId: "family-1", ready: true, tier: "free" },
    { status: "authenticated", role: "parent", familyId: "family-1", ready: false, tier: "unknown" },
    { status: "authenticated", role: "parent", familyId: "family-1", ready: true, tier: "reviewed" },
    { status: "authenticated", role: "parent", familyId: "family-1", ready: true, tier: "premium" },
  ] as const) {
    assert.equal(resolveClaimScope(input).enabled, false, JSON.stringify(input));
  }
});

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

test("리뷰 보상 scope는 기존 상태 조회 전용이며 신규 지급 판정을 노출하지 않는다", async () => {
  const scopeModule = await import("../src/transform/reviewRewardScope.ts");
  assert.equal("resolveReviewRewardClaimScope" in scopeModule, false);
});

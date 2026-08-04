import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("API 타입과 useEntitlement는 effective 정본을 사용하고 legacy일 때만 리뷰 조회를 연다", () => {
  const endpoint = read("src/lib/api/endpoints/subscription.ts");
  const hook = read("src/queries/useEntitlement.ts");

  assert.match(endpoint, /effective\?: EffectiveEntitlementRow \| null/);
  assert.match(hook, /resolveEntitlementResponse\(query\.data\)/);
  assert.match(hook, /resolution\.contract === "legacy"/);
  assert.match(hook, /useReviewReward\(\{ enabled: legacyReviewRequired \}\)/);
  assert.match(hook, /resolution\.hasGrandfatheredReviewLimits/);
  assert.match(hook, /resolution\.contract === "invalid"/);
});

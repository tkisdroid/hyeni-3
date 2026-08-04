import test from "node:test";
import assert from "node:assert/strict";

import { validateAiCreditGrantImpact } from "../src/transform/aiCreditGrant.ts";

test("AI 크레딧 결제 결과는 상계량과 사용 가능 증가량의 합이 팩 총량일 때만 받는다", () => {
  assert.deepEqual(validateAiCreditGrantImpact({
    debtApplied: 25,
    availableCreditsAdded: 5,
  }, 30), { debtApplied: 25, availableCreditsAdded: 5 });
  assert.throws(
    () => validateAiCreditGrantImpact({ debtApplied: 25, availableCreditsAdded: 30 }, 30),
    /invalid_ai_credit_grant_impact/,
  );
  assert.throws(
    () => validateAiCreditGrantImpact({ debtApplied: -1, availableCreditsAdded: 31 }, 30),
    /invalid_ai_credit_grant_impact/,
  );
});

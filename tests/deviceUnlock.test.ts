import test from "node:test";
import assert from "node:assert/strict";

import { unlockCountLabel } from "../src/transform/deviceUnlock.ts";

test("화면잠금 해제 수는 정수값만 정확히 표시한다", () => {
  assert.equal(unlockCountLabel(0), "0회");
  assert.equal(unlockCountLabel(7), "7회");
  assert.equal(unlockCountLabel(3.5), "—");
});

test("미보고 또는 잘못된 잠금해제 수는 가짜 숫자로 바꾸지 않는다", () => {
  assert.equal(unlockCountLabel(null), "—");
  assert.equal(unlockCountLabel(undefined), "—");
  assert.equal(unlockCountLabel(-1), "—");
  assert.equal(unlockCountLabel(Number.NaN), "—");
});

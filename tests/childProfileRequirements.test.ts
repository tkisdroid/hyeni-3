import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRequiredChildBirthdate,
  validateChildDraftRequirements,
} from "../src/transform/childProfileRequirements.ts";

test("페어링 아이 정보는 이름과 생년월일을 모두 요구한다", () => {
  const result = validateChildDraftRequirements([
    { name: "테스티", birthdate: "2018-05-10" },
    { name: "둘째", birthdate: "" },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.index, 1);
  assert.equal(result.message, "아이 2의 생년월일을 입력해 주세요");
});

test("생년월일은 YYYY-MM-DD 유효 날짜만 저장값으로 통과한다", () => {
  assert.equal(normalizeRequiredChildBirthdate("2018-05-10"), "2018-05-10");
  assert.equal(normalizeRequiredChildBirthdate("2018-02-31"), "");
  assert.equal(normalizeRequiredChildBirthdate(""), "");
});

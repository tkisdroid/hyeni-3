import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/tsModuleResolve.mjs";

const {
  LearningGradeUnavailableError,
  academicYearAtSeoul,
  resolveLearningGrade,
} = await import("../lib/learningGrade.ts");

test("서울 3월 1일에만 학사연도가 바뀐다", () => {
  assert.equal(resolveLearningGrade({ birthdate: "2016-08-10", overrideGrade: null }, new Date("2026-02-28T14:59:59.999Z")).grade, 3);
  assert.equal(resolveLearningGrade({ birthdate: "2016-08-10", overrideGrade: null }, new Date("2026-02-28T15:00:00.000Z")).grade, 4);
  assert.equal(academicYearAtSeoul(new Date("2028-02-29T14:59:59.999Z")), 2027);
  assert.equal(academicYearAtSeoul(new Date("2028-02-29T15:00:00.000Z")), 2028);
});

test("부모 지정 학년이 생년 계산보다 우선한다", () => {
  assert.deepEqual(resolveLearningGrade({ birthdate: "2016-08-10", overrideGrade: 5 }, new Date("2026-03-01T00:00:00Z")), {
    grade: 5,
    source: "parent_override",
    academicYear: 2026,
  });
});

for (const row of [
  { name: "생년월일 누락", birthdate: null },
  { name: "형식이 잘못된 생년월일", birthdate: "2016-02-30" },
  { name: "미래 생년월일", birthdate: "2026-03-02" },
  { name: "초등 학년 범위보다 어린 생년월일", birthdate: "2018-08-10" },
  { name: "초등 학년 범위를 지난 생년월일", birthdate: "2013-08-10" },
]) {
  test(`${row.name}은 학년 미확정 오류로 닫는다`, () => {
    assert.throws(
      () => resolveLearningGrade({ birthdate: row.birthdate, overrideGrade: null }, new Date("2026-03-01T00:00:00Z")),
      LearningGradeUnavailableError,
    );
  });
}

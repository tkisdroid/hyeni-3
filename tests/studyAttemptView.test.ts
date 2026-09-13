import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
const { studyAttemptAnswerText } = await import("../src/features/study/studyAttemptView.ts");
const labels = { missing: "기록 없음", skipped: "제출 안 함", true: "참", false: "거짓" };
const problem = { choices: [{ id: "a", text: "사과" }, { id: "b", text: "배" }], input: { kind: "self_check", items: [{ id: "c", text: "비교했어요" }] } };

test("부모는 선택지 ID 대신 아이가 선택한 문구와 모든 구조 답안을 본다", () => {
  const cases = [
    [{ kind: "single_choice", value: "a" }, "사과"],
    [{ kind: "multiple_choice", values: ["a", "b"] }, "사과, 배"],
    [{ kind: "integer", value: "-12" }, "-12"],
    [{ kind: "decimal", value: "1.25" }, "1.25"],
    [{ kind: "fraction", numerator: "2", denominator: "3" }, "2/3"],
    [{ kind: "measurement", value: "12", unit: "cm" }, "12 cm"],
    [{ kind: "ordering", values: ["3", "2", "1"] }, "3 → 2 → 1"],
    [{ kind: "coordinate", x: "-2", y: "3" }, "(-2, 3)"],
    [{ kind: "boolean", value: false }, "거짓"],
    [{ kind: "text", value: "둘 다 네 변이 있어요" }, "둘 다 네 변이 있어요"],
    [{ kind: "self_check", selections: ["c"] }, "비교했어요"],
  ] as const;
  for (const [answer, expected] of cases) {
    assert.equal(studyAttemptAnswerText({ answer, problem, skipped: false }, labels), expected);
  }
  assert.equal(studyAttemptAnswerText({ answer: null, problem, skipped: true }, labels), "제출 안 함");
  assert.equal(studyAttemptAnswerText({ answer: null, problem: null, skipped: false }, labels), "기록 없음");
  assert.equal(studyAttemptAnswerText({ answer: { kind: "single_choice", value: "unknown" }, problem, skipped: false }, labels), "기록 없음");
});

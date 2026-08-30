import "./helpers/appModuleResolve.mjs";

import assert from "node:assert/strict";
import test from "node:test";

const parentStudy = await import("../src/features/study/parentStudyModel.ts");

const children = [
  { id: "child-a", role: "child", name: "가" },
  { id: "child-b", role: "child", name: "나" },
];

test("활성 자녀가 없으면 첫 자녀로 대체하지 않는다", () => {
  assert.deepEqual(parentStudy.resolveParentStudyTarget(children, null, null), { kind: "select" });
});

test("deep link는 정확한 활성 자녀만 선택하고 외부·비활성 id를 거부한다", () => {
  assert.deepEqual(parentStudy.resolveParentStudyTarget(children, "child-a", "child-b"), {
    kind: "ready",
    child: children[1],
    fromDeepLink: true,
  });
  assert.deepEqual(parentStudy.resolveParentStudyTarget(children, "child-a", "foreign"), {
    kind: "invalid",
    requestedId: "foreign",
  });
});

test("부모 지정 학년을 자동 계산으로 되돌리는 command를 만든다", () => {
  assert.deepEqual(parentStudy.buildStudyGradeCommand({
    memberId: "child-a",
    grade: null,
    rowVersion: 3,
    requestId: "grade-key-0000001",
  }), {
    memberId: "child-a",
    grade: null,
    rowVersion: 3,
    requestId: "grade-key-0000001",
  });
});

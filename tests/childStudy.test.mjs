import "./helpers/appModuleResolve.mjs";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const childStudy = await import("../src/features/study/childStudyModel.ts");

test("새로고침 뒤 서버의 활성 미션을 시작 호출 없이 이어서 푼다", () => {
  assert.deepEqual(childStudy.resolveChildStudyEntry({
    status: "available",
    activeMissionId: "mission-1",
  }), { kind: "resume", missionId: "mission-1" });
});

test("활성 미션이 없으면 학습자 선택 학년은 다시 고르게 하고 보호자 학년만 바로 시작한다", () => {
  assert.deepEqual(childStudy.resolveChildStudyEntry({
    status: "available",
    profile: { grade: null },
    activeMissionId: null,
  }), { kind: "select_grade" });
  assert.deepEqual(childStudy.resolveChildStudyEntry({
    status: "available",
    profile: { grade: { grade: 4, source: "learner_selected" } },
    activeMissionId: null,
  }), { kind: "select_grade" });
  assert.deepEqual(childStudy.resolveChildStudyEntry({
    status: "available",
    profile: { grade: { grade: 4, source: "parent_override" } },
    activeMissionId: null,
  }), { kind: "start" });
  assert.deepEqual(childStudy.resolveChildStudyEntry({
    status: "inactive_or_missing",
    profile: { grade: null },
    activeMissionId: null,
  }), { kind: "unavailable" });
  assert.deepEqual(childStudy.STUDY_GRADE_CHOICES, [3, 4, 5, 6]);
});

test("일시 오류만 동일 command 재시도를 허용하고 권한 오류는 종료한다", () => {
  assert.equal(childStudy.isRetryableStudyFailure({ status: 503 }), true);
  assert.equal(childStudy.isRetryableStudyFailure(new TypeError("network")), true);
  assert.equal(childStudy.isRetryableStudyFailure({ status: 401 }), false);
  assert.equal(childStudy.isRetryableStudyFailure({ status: 403 }), false);
});

test("아이 화면은 family/member를 받지 않고 학년 선택만 허용한다", async () => {
  const source = await readFile(new URL("../src/screens/study/ChildStudy.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /type=["'](?:text|number)["'][^>]*(?:family|member)|<select[^>]*(?:family|member)/i);
  assert.doesNotMatch(source, /query.*(?:family|member)|searchParams.*(?:family|member)/i);
  assert.doesNotMatch(source, /study\.child\.askGuardian/);
});

test("완료 화면은 같은 학년의 다음 묶음과 학년 다시 고르기를 모두 제공한다", async () => {
  const source = await readFile(new URL("../src/features/study/StudyMissionResult.tsx", import.meta.url), "utf8");
  assert.match(source, /onContinue/);
  assert.match(source, /onChooseGrade/);
  assert.match(source, /study\.child\.start\.button/);
  assert.match(source, /study\.child\.gradeHelp/);
});

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

test("8문제 묶음 완료는 완료 화면을 노출하지 않고 같은 주제를 자동으로 이어 간다", async () => {
  const source = await readFile(new URL("../src/features/study/StudyMissionPlayer.tsx", import.meta.url), "utf8");
  assert.match(source, /state\.phase !== ["']completed["']/);
  assert.match(source, /void onContinue\(\)/);
  assert.match(source, /STUDY_TOPIC_COPY\.nextLoading/);
  assert.doesNotMatch(source, /<StudyMissionResult/);
  assert.doesNotMatch(source, /study\.child\.progress/);
});

test("완료된 캐시 미션은 새 화면의 learner 재조회 전에 복원하지 않는다", async () => {
  assert.equal(typeof childStudy.activeMissionToRestore, "function");
  assert.equal(childStudy.activeMissionToRestore({
    localMissionId: null,
    choosingGrade: false,
    learnerFetchedAfterMount: false,
    activeMissionId: "completed-cache-mission",
  }), null);
  assert.equal(childStudy.activeMissionToRestore({
    localMissionId: null,
    choosingGrade: false,
    learnerFetchedAfterMount: true,
    activeMissionId: "server-active-mission",
  }), "server-active-mission");

  const querySource = await readFile(new URL("../src/queries/useStudy.ts", import.meta.url), "utf8");
  const screenSource = await readFile(new URL("../src/screens/study/ChildStudy.tsx", import.meta.url), "utf8");
  assert.match(querySource, /refetchOnMount:\s*["']always["']/);
  assert.match(screenSource, /learner\.isFetchedAfterMount/);
});

test("세부 개념은 서버 순서를 유지하며 단원별로 묶고 골고루 풀기를 별도 선택한다", () => {
  const groups = childStudy.groupStudyConcepts([
    { conceptId: "c1", unitKey: "수와 연산", title: "곱셈", problemCount: 36 },
    { conceptId: "c2", unitKey: "수와 연산", title: "나눗셈", problemCount: 36 },
    { conceptId: "c3", unitKey: "도형", title: "삼각형", problemCount: 36 },
  ]);
  assert.deepEqual(groups, [
    { unitKey: "수와 연산", concepts: [
      { conceptId: "c1", unitKey: "수와 연산", title: "곱셈", problemCount: 36 },
      { conceptId: "c2", unitKey: "수와 연산", title: "나눗셈", problemCount: 36 },
    ] },
    { unitKey: "도형", concepts: [
      { conceptId: "c3", unitKey: "도형", title: "삼각형", problemCount: 36 },
    ] },
  ]);
  assert.deepEqual(childStudy.startInputForSelection(4, { kind: "adaptive" }), { grade: 4 });
  assert.deepEqual(childStudy.startInputForSelection(4, { kind: "concept", conceptId: "c2" }), {
    grade: 4,
    conceptId: "c2",
  });
});

test("학년 로딩 표시는 실제로 누른 학년에만 켜진다", () => {
  assert.equal(childStudy.isSelectedGradeLoading(4, 4, true), true);
  assert.equal(childStudy.isSelectedGradeLoading(3, 4, true), false);
  assert.equal(childStudy.isSelectedGradeLoading(4, 4, false), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { mockApi } from "../scripts/final-browser-qa.mjs";

test("브라우저 QA는 부모 Study 상태·리포트·학년 변경 fixture를 제공한다", () => {
  const scenario = { role: "parent", tier: "free", studyState: "enabled" };
  assert.deepEqual(mockApi("/api/study/status", scenario), {
    state: "enabled",
    market: "KR",
    role: "parent",
    managementEnabled: true,
    learnerEnabled: false,
  });
  const family = mockApi("/api/family/mine", scenario);
  const child = family.members.find((member) => member.id === "qa-child-member");
  assert.equal(child.learning_grade_row_version, 1);

  const report = mockApi("/api/study/children/qa-child-member/report", scenario);
  assert.equal(report.apiVersion, "2026-08-27");
  assert.equal(report.grade.grade, 4);

  const changed = mockApi(
    "/api/study/children/qa-child-member/grade",
    scenario,
    "PUT",
    { grade: 5, rowVersion: 1, requestId: "qa-request-123456" },
  );
  assert.equal(changed.grade.grade, 5);
  assert.equal(changed.grade.source, "parent_override");
  assert.equal(changed.rowVersion, 2);
});

test("브라우저 QA는 아이 미션과 같은 idempotency key 재전송을 기록한다", () => {
  const scenario = { role: "child", tier: "free", studyState: "enabled", studyTransientSubmit: true };
  const learner = mockApi("/api/study/learner/me", scenario);
  assert.equal(learner.activeMissionId, null);
  const mission = mockApi("/api/study/learner/missions", scenario, "POST", { mode: "daily" });
  assert.equal(mission.items[0].type, "integer_input");

  const headers = { "idempotency-key": "qa-answer-key-123456" };
  assert.deepEqual(
    mockApi("/api/study/learner/missions/qa-mission/submissions", scenario, "POST", { problemId: "qa-problem", answer: "12" }, headers),
    { error: "study_temporarily_unavailable" },
  );
  assert.equal(scenario.lastResponseCode, 503);
  const accepted = mockApi("/api/study/learner/missions/qa-mission/submissions", scenario, "POST", { problemId: "qa-problem", answer: "12" }, headers);
  assert.equal(accepted.result, "accepted");
  assert.deepEqual(scenario.studySubmissionKeys, ["qa-answer-key-123456", "qa-answer-key-123456"]);
});

test("브라우저 QA는 완료 뒤 재진입과 다음 학습 묶음을 서로 다른 미션으로 검증한다", () => {
  const scenario = {
    role: "child",
    tier: "free",
    studyState: "enabled",
    studyLearnerSelected: true,
  };
  const first = mockApi("/api/study/learner/missions", scenario, "POST", { mode: "daily", grade: 4 });
  mockApi(
    `/api/study/learner/missions/${first.missionId}/submissions`,
    scenario,
    "POST",
    { problemId: first.items[0].problemId, answer: "12" },
    { "idempotency-key": "qa-first-answer" },
  );
  const completed = mockApi("/api/study/learner/me", scenario);
  assert.equal(completed.activeMissionId, null);
  assert.equal(completed.profile.grade.source, "learner_selected");

  const next = mockApi("/api/study/learner/missions", scenario, "POST", { mode: "daily", grade: 5 });
  assert.notEqual(next.missionId, first.missionId);
  assert.equal(next.grade, 5);
  assert.equal(next.status, "started");
});

test("브라우저 QA는 국외·미확정·장애 상태를 서로 구분한다", () => {
  assert.deepEqual(mockApi("/api/study/status", { role: "parent", studyState: "outside_market" }), { state: "outside_market" });
  assert.deepEqual(mockApi("/api/study/status", { role: "parent", studyState: "unavailable" }), { state: "unavailable" });
  assert.deepEqual(mockApi("/api/study/status", { role: "parent", studyState: "not_confirmed" }), {
    state: "not_confirmed",
    inferredCountry: "KR",
    canConfirm: true,
  });
});

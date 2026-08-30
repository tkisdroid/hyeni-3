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

test("활성 미션이 없을 때만 하루 미션 시작을 제안한다", () => {
  assert.deepEqual(childStudy.resolveChildStudyEntry({ status: "available", activeMissionId: null }), { kind: "start" });
  assert.deepEqual(childStudy.resolveChildStudyEntry({ status: "inactive_or_missing", activeMissionId: null }), { kind: "unavailable" });
});

test("일시 오류만 동일 command 재시도를 허용하고 권한 오류는 종료한다", () => {
  assert.equal(childStudy.isRetryableStudyFailure({ status: 503 }), true);
  assert.equal(childStudy.isRetryableStudyFailure(new TypeError("network")), true);
  assert.equal(childStudy.isRetryableStudyFailure({ status: 401 }), false);
  assert.equal(childStudy.isRetryableStudyFailure({ status: 403 }), false);
});

test("학년 미설정 응답은 일반 장애가 아니라 보호자 확인 상태로 분류한다", () => {
  assert.equal(childStudy.isLearningGradeUnavailable({ status: 422, code: "learning_grade_unavailable" }), true);
  assert.equal(childStudy.isLearningGradeUnavailable({ status: 422, code: "invalid_request" }), false);
  assert.equal(childStudy.isLearningGradeUnavailable({ status: 503, code: "learning_grade_unavailable" }), false);
  assert.equal(childStudy.isLearningGradeUnavailable(null), false);
});

test("아이 화면에는 family/member/grade 선택 입력이 없다", async () => {
  const source = await readFile(new URL("../src/screens/study/ChildStudy.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /type=["'](?:text|number)["'][^>]*(?:family|member|grade)|<select[^>]*(?:family|member|grade)/i);
  assert.doesNotMatch(source, /query.*(?:family|member|grade)|searchParams.*(?:family|member|grade)/i);
});

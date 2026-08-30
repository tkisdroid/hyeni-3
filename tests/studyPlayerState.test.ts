import "./helpers/appModuleResolve.mjs";

import assert from "node:assert/strict";
import test from "node:test";

const player = await import("../src/features/study/player/studyPlayerState.ts");

const mission = {
  apiVersion: "2026-08-27",
  missionId: "mission-1",
  status: "started",
  grade: 4,
  items: [
    { problemId: "p1", resolved: false },
    { problemId: "p2", resolved: false },
  ],
  progress: { completed: 0, total: 2 },
};

test("pending 중 중복 제출을 막고 실패 시 같은 command로 재시도한다", () => {
  const ready = player.createStudyPlayerState(mission);
  const command = {
    missionId: "mission-1",
    problemId: "p1",
    answer: "4",
    idempotencyKey: "submit-key-000001",
  };
  const pending = player.reduceStudyPlayer(ready, { type: "SUBMIT", command });
  assert.equal(pending.phase, "submitting");
  assert.equal(player.reduceStudyPlayer(pending, { type: "SUBMIT", command }).effects.length, 0);
  const failed = player.reduceStudyPlayer(pending, { type: "FAILED", retryable: true });
  assert.deepEqual(player.reduceStudyPlayer(failed, { type: "RETRY" }).effects[0]?.command, command);
});

test("빈 답은 제출하지 않고 숫자와 한글 자유 입력을 정규화한다", () => {
  const ready = player.createStudyPlayerState(mission);
  const empty = player.reduceStudyPlayer(ready, {
    type: "SUBMIT",
    command: { missionId: "mission-1", problemId: "p1", answer: "", idempotencyKey: "submit-key-000001" },
  });
  assert.equal(empty.effects.length, 0);
  assert.equal(player.normalizeStudyInteger("  +0042 "), "42");
  assert.equal(player.normalizeStudyDecimal(" -0012.3400 "), "-12.34");
  assert.equal(player.normalizeStudyFreeText("  \u1112\u1168니가 좋아요  "), "혜니가 좋아요");
});

test("선택·분수·좌표 답을 서버 직렬화 계약으로 만든다", () => {
  assert.equal(player.serializeStudyAnswer({ kind: "single_choice", choiceId: "choice-a" }), "choice-a");
  assert.equal(
    player.serializeStudyAnswer({ kind: "fraction_input", numerator: "2", denominator: "03" }),
    JSON.stringify({ numerator: "2", denominator: "3" }),
  );
  assert.equal(
    player.serializeStudyAnswer({ kind: "coordinate_input", x: "-01", y: "2" }),
    JSON.stringify({ x: "-1", y: "2" }),
  );
});

test("결과를 공개한 뒤 다음 문제로 이동하고 마지막에는 완료한다", () => {
  const command = { missionId: "mission-1", problemId: "p1", answer: "4", idempotencyKey: "submit-key-000001" };
  let state = player.reduceStudyPlayer(player.createStudyPlayerState(mission), { type: "SUBMIT", command });
  state = player.reduceStudyPlayer(state, { type: "SUCCEEDED", result: { result: "accepted" } });
  assert.equal(state.phase, "revealed");
  state = player.reduceStudyPlayer(state, { type: "NEXT" });
  assert.equal(state.problemId, "p2");
  assert.equal(state.phase, "ready");
  state = player.reduceStudyPlayer(state, {
    type: "SUBMIT",
    command: { ...command, problemId: "p2", idempotencyKey: "submit-key-000002" },
  });
  state = player.reduceStudyPlayer(state, { type: "SUCCEEDED", result: { result: "accepted" } });
  assert.equal(player.reduceStudyPlayer(state, { type: "NEXT" }).phase, "completed");
});

test("재개는 첫 미해결 문제를 고르고 완료 미션은 완료 상태다", () => {
  const resumed = player.createStudyPlayerState({
    ...mission,
    items: [{ problemId: "p1", resolved: true }, { problemId: "p2", resolved: false }],
    progress: { completed: 1, total: 2 },
  });
  assert.equal(resumed.problemId, "p2");
  assert.equal(player.createStudyPlayerState({ ...mission, status: "completed" }).phase, "completed");
});

import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
const { vocabularyLearningReducer, initialVocabularyLearningState } = await import("../src/features/study/vocabularyLearning.ts");
const { qk } = await import("../src/queries/keys.ts");

test("뒤집은 카드만 평가하고 실패 재시도는 같은 요청을 보존한다", () => {
  const command = { wordId: "apple", level: 1 as const, catalogVersion: "v1", rating: "again" as const, requestId: "same-request" };
  let state = initialVocabularyLearningState;
  assert.equal(vocabularyLearningReducer(state, { type: "submit", command }), state);
  state = vocabularyLearningReducer(state, { type: "flip" });
  state = vocabularyLearningReducer(state, { type: "submit", command });
  assert.equal(state.status, "saving");
  assert.equal(vocabularyLearningReducer(state, { type: "flip" }), state);
  state = vocabularyLearningReducer(state, { type: "failed", requestId: command.requestId });
  assert.equal(state.index, 0);
  assert.deepEqual(state.pending, command);
  state = vocabularyLearningReducer(state, { type: "retry" });
  assert.deepEqual(state.pending, command);
  assert.equal(vocabularyLearningReducer(state, { type: "saved", requestId: "old-request" }), state);
  state = vocabularyLearningReducer(state, { type: "saved", requestId: command.requestId });
  assert.equal(state.index, 1);
  assert.equal(state.flipped, false);
  assert.equal(state.pending, null);
});

test("학습 캐시는 가족, 사용자, 아이, 단계와 학습 실행별로 나뉜다", () => {
  const a = qk.study.vocabulary("family", "user-a", "child-a", 1, "new", "run");
  for (const key of [
    qk.study.vocabulary("other", "user-a", "child-a", 1, "new", "run"),
    qk.study.vocabulary("family", "user-b", "child-a", 1, "new", "run"),
    qk.study.vocabulary("family", "user-a", "child-b", 1, "new", "run"),
    qk.study.vocabulary("family", "user-a", "child-a", 2, "new", "run"),
    qk.study.vocabulary("family", "user-a", "child-a", 1, "review", "run"),
    qk.study.vocabulary("family", "user-a", "child-a", 1, "new", "another"),
  ]) assert.notDeepEqual(a, key);
});

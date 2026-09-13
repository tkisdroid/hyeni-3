import "./helpers/appModuleResolve.mjs";
import assert from "node:assert/strict";
import test from "node:test";
const api = await import("../src/lib/api/endpoints/studyLearning.ts");
const { ApiError } = await import("../src/lib/api/errors.ts");
const { clearApiSession, setApiTokens } = await import("../src/lib/api/session.ts");
const invalid = (error: unknown) => error instanceof ApiError && error.code === "invalid_study_response";
const levels = [1, 2, 3, 4, 5].map(level => ({ level, total: 100, studied: 2, known: 1, again: 1 }));
const card = { id: "apple", word: "apple", meaning: "사과", partOfSpeech: "noun", level: 1, sourceUrl: "https://ko.wiktionary.org/wiki/apple", lastRating: "again" };
const deck = { apiVersion: "2026-08-27", catalogVersion: "en-ko-v1", memberId: "child-a", levels, level: 1, mode: "new", cards: [card], nextCursor: null };
const history = { apiVersion: "2026-08-27", memberId: "child-a", range: "30d", items: [{
  id: "attempt-a", missionId: "mission-a", problemId: "problem-a", studiedAt: "2026-09-12T00:00:00.000Z",
  detailsStatus: "details_unavailable", problem: null, answer: { kind: "fraction", numerator: "1", denominator: "2" },
  explanation: null, isCorrect: false, skipped: false, isScored: true, hintLevel: 1, responseTimeSeconds: 18, attemptOrdinal: 1,
}], nextCursor: null };

test("응답의 단계 수, 집계 일관성과 원문 누락을 검증한다", () => {
  assert.deepEqual(api.parseVocabularyDeck(deck), deck);
  assert.deepEqual(api.parseChildProblemHistory(history), history);
  for (const mutation of [
    { levels: levels.slice(1) }, { levels: [...levels.slice(0, 4), levels[0]] },
    { levels: [{ ...levels[0], studied: 0 }, ...levels.slice(1)] },
    { cards: [{ ...card, level: 6 }] }, { cards: [{ ...card, sourceUrl: "javascript:alert(1)" }] },
    { profileId: "private-profile" }, { mode: "unknown" },
  ]) assert.throws(() => api.parseVocabularyDeck({ ...deck, ...mutation }), invalid);
  assert.throws(() => api.parseChildProblemHistory({ ...history, items: [{ ...history.items[0], answer: { kind: "boolean", value: "false" } }] }), invalid);
  assert.throws(() => api.parseChildProblemHistory({ ...history, items: [{ ...history.items[0], detailsStatus: "available" }] }), invalid);
});

test("수학의 다른 풀이 순서를 배열 그대로 읽고 잘못된 형식은 거부한다", () => {
  const explanation = {
    question: "계산 방법을 설명해 보세요.", concept: "묶어서 계산하기", steps: ["먼저 같은 수끼리 묶어요."],
    answer: "20", commonMistake: "남은 수도 더해야 해요.", alternative: ["차례로 더할 수도 있어요.", "합이 같은지 확인해요."],
  };
  const fixture = { ...history, items: [{ ...history.items[0], explanation }] };
  assert.deepEqual(api.parseChildProblemHistory(fixture).items[0].explanation, explanation);
  assert.throws(() => api.parseChildProblemHistory({ ...fixture, items: [{ ...fixture.items[0], explanation: { ...explanation, alternative: "한 문장" } }] }), invalid);
});

test("부모 API는 다른 아이의 응답을 표시하지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  setApiTokens("test-access", "test-refresh");
  globalThis.fetch = async () => new Response(JSON.stringify(history), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    await assert.rejects(api.fetchChildProblemHistory("child-b", "30d"), invalid);
    assert.deepEqual(await api.fetchChildProblemHistory("child-a", "30d"), history);
  } finally { globalThis.fetch = originalFetch; clearApiSession(); }
});

test("단어 저장은 재시도 키를 유지하고 가족과 아이 ID를 본문에 싣지 않는다", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  const receipt = { apiVersion: "2026-08-27", memberId: "child-a", requestId: "11111111-1111-4111-8111-111111111111", wordId: "apple", level: 1, rating: "known", reviewedAt: "2026-09-12T00:00:00.000Z" };
  setApiTokens("test-access", "test-refresh");
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(receipt), { status: 201, headers: { "Content-Type": "application/json" } }); };
  const command = { requestId: receipt.requestId, wordId: "apple", level: 1 as const, catalogVersion: "en-ko-v1", rating: "known" as const };
  try {
    await api.saveVocabularyReview(command, "child-a");
    await api.saveVocabularyReview(command, "child-a");
    assert.equal(new Headers(calls[0].init?.headers).get("Idempotency-Key"), receipt.requestId);
    assert.deepEqual(calls[0], calls[1]);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { catalogVersion: "en-ko-v1", wordId: "apple", level: 1, rating: "known" });
    await assert.rejects(api.saveVocabularyReview(command, "child-b"), invalid);
  } finally { globalThis.fetch = originalFetch; clearApiSession(); }
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  clampJourneyScrubMs,
  getJourneyRecordedRange,
  resolveJourneyContentState,
} from "../src/transform/locationJourneyView.ts";

test("경로 기록 범위는 유효 시각을 정렬해 첫 확인과 마지막 확인을 반환한다", () => {
  assert.deepEqual(
    getJourneyRecordedRange([{ ms: 30 }, { ms: Number.NaN }, { ms: 10 }, { ms: 20 }]),
    { startMs: 10, endMs: 30 },
  );
  assert.equal(getJourneyRecordedRange([]), null);
});

test("시간 막대 시각은 실제 첫 기록과 마지막 기록 사이에서만 움직인다", () => {
  const range = { startMs: 1_000, endMs: 9_000 };

  assert.equal(clampJourneyScrubMs(-1, range), 1_000);
  assert.equal(clampJourneyScrubMs(4_500, range), 4_500);
  assert.equal(clampJourneyScrubMs(12_000, range), 9_000);
  assert.equal(clampJourneyScrubMs(Number.NaN, range), 9_000);
});

test("패널 상태는 오류·로딩·빈 기록·이동만·머문 곳 순서로 구분한다", () => {
  assert.equal(resolveJourneyContentState({ isFetching: false, isError: true, pointCount: 0, stayCount: 0 }), "error");
  assert.equal(resolveJourneyContentState({ isFetching: false, isError: true, pointCount: 4, stayCount: 1 }), "error");
  assert.equal(resolveJourneyContentState({ isFetching: true, isError: false, pointCount: 0, stayCount: 0 }), "loading");
  assert.equal(resolveJourneyContentState({ isFetching: false, isError: false, pointCount: 0, stayCount: 0 }), "empty");
  assert.equal(resolveJourneyContentState({ isFetching: false, isError: false, pointCount: 4, stayCount: 0 }), "moving_only");
  assert.equal(resolveJourneyContentState({ isFetching: true, isError: false, pointCount: 4, stayCount: 1 }), "ready");
});

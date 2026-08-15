import test from "node:test";
import assert from "node:assert/strict";

import {
  clampHistoryDayKey,
  getHistoryDayKeyRange,
  getHistoryDayKey,
  getHistoryDayWindow,
  getHistoryDayWindowForKey,
  HISTORY_DAY_START_HOUR,
} from "../src/transform/locationHistoryWindow.ts";

test("오늘경로 윈도우는 host가 아니라 명시한 서울 오전 8시에 시작한다", () => {
  const now = new Date("2026-07-08T06:30:00.000Z"); // 서울 15:30
  const win = getHistoryDayWindow(now, "Asia/Seoul");

  assert.equal(HISTORY_DAY_START_HOUR, 8);
  assert.equal(win.start.toISOString(), "2026-07-07T23:00:00.000Z");
  assert.equal(win.queryEnd.toISOString(), "2026-07-08T23:00:00.000Z");
  assert.equal(win.maxOffsetMinutes, 450);
});

test("새벽 시간은 전날 오전 8시부터 이어지는 하루로 본다", () => {
  const now = new Date("2026-07-07T17:15:00.000Z"); // 서울 7월 8일 02:15
  const win = getHistoryDayWindow(now, "Asia/Seoul");

  assert.equal(win.start.toISOString(), "2026-07-06T23:00:00.000Z");
  assert.equal(win.maxOffsetMinutes, 1095);
  assert.equal(getHistoryDayKey(now, "Asia/Seoul"), "2026-6-7");
});

test("선택한 이력 날짜는 서울 오전 8시부터 다음 날 오전 8시까지 조회한다", () => {
  const now = new Date("2026-07-08T06:30:00.000Z");
  const past = getHistoryDayWindowForKey("2026-5-9", now, "Asia/Seoul");
  const today = getHistoryDayWindowForKey("2026-6-8", now, "Asia/Seoul");

  assert.ok(past);
  assert.equal(past.start.toISOString(), "2026-06-08T23:00:00.000Z");
  assert.equal(past.queryEnd.toISOString(), "2026-06-09T23:00:00.000Z");
  assert.equal(past.maxOffsetMinutes, 24 * 60);

  assert.ok(today);
  assert.equal(today.maxOffsetMinutes, 450);
  assert.equal(today.queryEnd.toISOString(), "2026-07-08T23:00:00.000Z");
});

test("DST 전환일도 명시한 지역의 다음 오전 8시를 queryEnd로 사용한다", () => {
  const now = new Date("2026-03-09T18:00:00.000Z");
  const win = getHistoryDayWindowForKey("2026-2-7", now, "America/New_York");

  assert.ok(win);
  assert.equal(win.start.toISOString(), "2026-03-07T13:00:00.000Z");
  assert.equal(win.queryEnd.toISOString(), "2026-03-08T12:00:00.000Z");
  assert.equal(win.maxOffsetMinutes, 23 * 60);
});

test("최근 30일 날짜 범위는 오늘 포함 30개이고 범위 밖 요청을 안전하게 clamp한다", () => {
  const now = new Date("2026-07-08T06:30:00.000Z");
  assert.deepEqual(getHistoryDayKeyRange(now, 30, "Asia/Seoul"), {
    minDateKey: "2026-5-9",
    maxDateKey: "2026-6-8",
  });
  assert.equal(clampHistoryDayKey("2026-5-9", now, 30, "Asia/Seoul"), "2026-5-9");
  assert.equal(clampHistoryDayKey("2026-4-1", now, 30, "Asia/Seoul"), "2026-5-9");
  assert.equal(clampHistoryDayKey("2026-7-1", now, 30, "Asia/Seoul"), "2026-6-8");
  assert.equal(clampHistoryDayKey("invalid", now, 30, "Asia/Seoul"), "2026-6-8");
});

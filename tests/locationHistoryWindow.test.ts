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

test("오늘경로 윈도우는 오전 8시에 시작한다", () => {
  const now = new Date(2026, 6, 8, 15, 30);
  const win = getHistoryDayWindow(now);

  assert.equal(HISTORY_DAY_START_HOUR, 8);
  assert.equal(win.start.getFullYear(), 2026);
  assert.equal(win.start.getMonth(), 6);
  assert.equal(win.start.getDate(), 8);
  assert.equal(win.start.getHours(), 8);
  assert.equal(win.maxOffsetMinutes, 450);
});

test("새벽 시간은 전날 오전 8시부터 이어지는 하루로 본다", () => {
  const now = new Date(2026, 6, 8, 2, 15);
  const win = getHistoryDayWindow(now);

  assert.equal(win.start.getFullYear(), 2026);
  assert.equal(win.start.getMonth(), 6);
  assert.equal(win.start.getDate(), 7);
  assert.equal(win.start.getHours(), 8);
  assert.equal(win.maxOffsetMinutes, 1095);
  assert.equal(getHistoryDayKey(now), "2026-6-7");
});

test("선택한 이력 날짜는 오전 8시부터 다음 날 오전 8시까지 24시간을 조회한다", () => {
  const now = new Date(2026, 6, 8, 15, 30);
  const past = getHistoryDayWindowForKey("2026-5-9", now);
  const today = getHistoryDayWindowForKey("2026-6-8", now);

  assert.ok(past);
  assert.equal(past.start.getFullYear(), 2026);
  assert.equal(past.start.getMonth(), 5);
  assert.equal(past.start.getDate(), 9);
  assert.equal(past.start.getHours(), 8);
  assert.equal(past.queryEnd.getDate(), 10);
  assert.equal(past.queryEnd.getHours(), 8);
  assert.equal(past.maxOffsetMinutes, 24 * 60);

  assert.ok(today);
  assert.equal(today.maxOffsetMinutes, 450);
  assert.equal(today.queryEnd.getDate(), 9);
  assert.equal(today.queryEnd.getHours(), 8);
});

test("최근 30일 날짜 범위는 오늘 포함 30개이고 범위 밖 요청을 안전하게 clamp한다", () => {
  const now = new Date(2026, 6, 8, 15, 30);
  assert.deepEqual(getHistoryDayKeyRange(now, 30), {
    minDateKey: "2026-5-9",
    maxDateKey: "2026-6-8",
  });
  assert.equal(clampHistoryDayKey("2026-5-9", now, 30), "2026-5-9");
  assert.equal(clampHistoryDayKey("2026-4-1", now, 30), "2026-5-9");
  assert.equal(clampHistoryDayKey("2026-7-1", now, 30), "2026-6-8");
  assert.equal(clampHistoryDayKey("invalid", now, 30), "2026-6-8");
});

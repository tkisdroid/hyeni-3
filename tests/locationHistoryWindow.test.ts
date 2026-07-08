import test from "node:test";
import assert from "node:assert/strict";

import {
  getHistoryDayKey,
  getHistoryDayWindow,
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

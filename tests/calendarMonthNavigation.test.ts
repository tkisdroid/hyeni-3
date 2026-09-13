import test from "node:test";
import assert from "node:assert/strict";
import { addMonthsToDateKey, dateKeyToDateInputValue, ymdToDateKey } from "../src/transform/dateKey.ts";

test("다음 달의 선택일과 일정 입력 날짜는 같은 달로 이동한다", () => {
  const next = addMonthsToDateKey(ymdToDateKey(2026, 9, 13), 1);
  assert.equal(next, ymdToDateKey(2026, 10, 13));
  assert.equal(dateKeyToDateInputValue(next), "2026-10-13");
});

test("31일이 없는 달로 이동하면 그 달의 말일을 선택한다", () => {
  assert.equal(dateKeyToDateInputValue(addMonthsToDateKey(ymdToDateKey(2026, 1, 31), 1)), "2026-02-28");
  assert.equal(dateKeyToDateInputValue(addMonthsToDateKey(ymdToDateKey(2026, 3, 31), -1)), "2026-02-28");
  assert.equal(dateKeyToDateInputValue(addMonthsToDateKey(ymdToDateKey(2026, 5, 31), -1)), "2026-04-30");
});

test("윤년의 2월과 연도 경계를 올바르게 이동한다", () => {
  assert.equal(dateKeyToDateInputValue(addMonthsToDateKey(ymdToDateKey(2028, 1, 31), 1)), "2028-02-29");
  assert.equal(dateKeyToDateInputValue(addMonthsToDateKey(ymdToDateKey(2028, 2, 29), 12)), "2029-02-28");
  assert.equal(dateKeyToDateInputValue(addMonthsToDateKey(ymdToDateKey(2026, 12, 31), 1)), "2027-01-31");
  assert.equal(dateKeyToDateInputValue(addMonthsToDateKey(ymdToDateKey(2026, 1, 1), -1)), "2025-12-01");
});

test("유효하지 않은 입력은 임의의 날짜로 바꾸지 않는다", () => {
  assert.equal(addMonthsToDateKey("2026-1-31", 1), "2026-1-31");
  assert.equal(addMonthsToDateKey("잘못된 날짜", 1), "잘못된 날짜");
  for (const offset of [NaN, Infinity, 0.5]) {
    assert.equal(addMonthsToDateKey("2026-8-13", offset), "2026-8-13");
  }
});

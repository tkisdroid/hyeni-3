import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/tsModuleResolve.mjs";
const { addUtcCalendarYears } = await import("../lib/time.ts");
test("금융 보존 5년은 1825일 상수가 아니라 윤일을 포함한 UTC 달력 연산이다", () => {
  assert.equal(
    addUtcCalendarYears(new Date("2026-08-01T00:00:00.000Z"), 5).toISOString(),
    "2031-08-01T00:00:00.000Z",
  );
  assert.equal(
    addUtcCalendarYears(new Date("2024-02-29T00:00:00.000Z"), 5).toISOString(),
    "2029-03-01T00:00:00.000Z",
  );
});

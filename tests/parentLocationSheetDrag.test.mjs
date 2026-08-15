import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.tsx"), "utf8");
const css = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.css"), "utf8");

test("오늘 머문 곳 시트는 드래그 다운으로 접히고 pointer capture 실패를 삼킨다", () => {
  assert.match(source, /setStaysCollapsed\(true\)/);
  assert.match(source, /e\.currentTarget\.setPointerCapture\(e\.pointerId\)/);
  assert.match(source, /catch\s*\{\s*\/\/ 일부 합성\/비표준 pointer 이벤트/);
  assert.doesNotMatch(source, /pointerType === "touch"\)\s*return/);
  assert.match(css, /\.pl-stays--collapsed\s*\{[^}]*transform:\s*translateY\(calc\(100% \+ 28px\)\)/s);
  assert.match(source, /className="pl-stays-reopen hy-press"/);
});

test("오늘 경로 시간대 바는 오전 8시 기준 윈도우를 사용하고 아이 칩을 숨긴다", () => {
  assert.match(source, /getHistoryDayWindowForKey\(historyDayKey, now, LEGACY_FAMILY_TIME_ZONE\)/);
  assert.match(source, /formatClockHM\(historyWindow\.startMs, locale, LEGACY_FAMILY_TIME_ZONE\)/);
  assert.match(source, /activeView === "live" && selected/);
  assert.doesNotMatch(source, /activeView === "history" && selected &&/);
});

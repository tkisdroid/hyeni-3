import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.tsx"), "utf8");
const css = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.css"), "utf8");

test("오늘 경로 패널은 드래그 없이 명시적 버튼으로 펼치고 접는다", () => {
  assert.match(source, /const \[historyPanelExpanded, setHistoryPanelExpanded\] = useState\(true\)/);
  assert.match(source, /onToggleExpanded=\{\(\) => setHistoryPanelExpanded\(\(value\) => !value\)\}/);
  assert.doesNotMatch(source, /setPointerCapture|STAYS_DRAG_|onStaysPointer|onStaysTouch/);
  assert.match(source, /<LocationJourneyPanel/);
  assert.match(css, /\.pl-journey__toggle\s*\{[^}]*min-height:\s*var\(--control-min-size\)/s);
});

test("오늘 경로는 오전 8시 기준 윈도우와 아이·날짜 도구막대를 함께 사용한다", () => {
  assert.match(source, /getHistoryDayWindowForKey\(historyDayKey, now\)/);
  assert.match(source, /sliderMax=\{historyMaxOffsetMinute\}/);
  assert.match(source, /getJourneyRecordedRange\(timedTrail\)/);
  assert.match(source, /<LocationHistoryToolbar/);
  assert.match(source, /childName=\{selected\.name \|\| "아이"\}/);
});

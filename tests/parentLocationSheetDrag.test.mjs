import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.tsx"), "utf8");
const css = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.css"), "utf8");
const journey = readFileSync(resolve(rootDir, "src/screens/parent/LocationJourneyPanel.tsx"), "utf8");

test("오늘 경로는 플로팅 시트와 시간 막대 없이 지도 아래 목록으로 이어진다", () => {
  assert.doesNotMatch(source, /setPointerCapture|STAYS_DRAG_|onStaysPointer|onStaysTouch/);
  assert.match(source, /<LocationJourneyPanel/);
  assert.match(source, /pl-root\$\{activeView === "history" \? " pl-root--history" : ""\}/);
  assert.match(journey, /className="pl-visited"/);
  assert.doesNotMatch(journey, /type="range"|pl-journey__range|location-journey-stays/);
  assert.match(css, /\.pl-root--history \.pl-map\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.pl-visited\s*\{[^}]*position:\s*relative/s);
});

test("오늘 경로는 오전 8시 기준 윈도우와 아이·날짜 도구막대를 함께 사용한다", () => {
  assert.match(source, /getHistoryDayWindowForKey\(historyDayKey, now, LEGACY_FAMILY_TIME_ZONE\)/);
  assert.match(source, /const timedHistoryPoints = useMemo\(/);
  assert.match(source, /getJourneyRecordedRange\(timedHistoryPoints\)/);
  assert.doesNotMatch(source, /getJourneyRecordedRange\(timedTrail\)/);
  assert.match(source, /<LocationHistoryToolbar/);
  assert.match(source, /childName=\{selected\.name \|\| intl\.formatMessage\(\{ id: "parent\.location\.childFallback" \}\)\}/);
  assert.match(source, /timeLabel: `\$\{formatClockHM\(stay\.arrivalMs/);
  assert.match(source, /placeLabel: stayLabels\[index\]/);
});

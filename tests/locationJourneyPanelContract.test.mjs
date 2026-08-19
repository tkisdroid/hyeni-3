import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const toolbar = readFileSync(new URL("../src/screens/parent/LocationHistoryToolbar.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/screens/parent/LocationJourneyPanel.tsx", import.meta.url), "utf8");

test("경로 도구막대는 아이와 날짜를 한 그룹에서 명시한다", () => {
  assert.match(toolbar, /parent.location.history.pickDay/);
  assert.match(toolbar, /childName/);
  assert.match(toolbar, /onPrevious/);
  assert.match(toolbar, /onNext/);
});

test("이동 이력은 시간·장소 목록만 표시하고 모든 상태를 정직하게 표시한다", () => {
  assert.match(panel, /className="pl-visited"/);
  assert.match(panel, /parent.location.history.visitedPlaces/);
  assert.match(panel, /<time>\{stay\.timeLabel\}<\/time>/);
  assert.match(panel, /<strong>\{stay\.placeLabel\}<\/strong>/);
  assert.match(panel, /parent.location.history.noStay/);
  assert.match(panel, /parent.location.history.emptyDay/);
  assert.match(panel, /role=\{state === "error" \? "alert" : "status"\}/);
  assert.doesNotMatch(panel, /type="range"|pl-journey__replay|pl-journey__toggle/);
  assert.doesNotMatch(panel, /stay\.dwellLabel|stay\.order/);
});

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

test("타임라인 패널은 드래그 없이 명시적으로 펼치고 모든 상태를 정직하게 표시한다", () => {
  assert.match(panel, /aria-expanded=\{expanded\}/);
  assert.match(panel, /aria-controls="location-journey-stays"/);
  assert.match(panel, /id="location-journey-stays"/);
  assert.match(panel, /className="pl-journey__stays" hidden=\{!expanded\}/);
  assert.match(panel, /<div className="pl-journey__body">/);
  assert.doesNotMatch(panel, /className="pl-journey__body" hidden=\{!expanded\}/);
  assert.match(panel, /parent.location.history.noStay/);
  assert.match(panel, /parent.location.history.emptyDay/);
  assert.match(panel, /role=\{state === "error" \? "alert" : "status"\}/);
  assert.match(panel, /min=\{sliderMin\}/);
  assert.match(panel, /max=\{sliderMax\}/);
  assert.match(panel, /disabled=\{sliderMax <= sliderMin\}/);
  assert.match(panel, /aria-valuetext=\{`\$\{currentTimeLabel\} · \$\{currentWhere\}`\}/);
  assert.doesNotMatch(panel, /onPointerDown|onPointerMove|onPointerUp|onTouchMove|onTouchEnd|setPointerCapture/);
});

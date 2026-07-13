import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../scripts/final-a17-cdp-smoke.mjs", import.meta.url),
  "utf8",
);

test("A17 CDP 최종 점검은 refresh token을 읽거나 출력하지 않는다", () => {
  assert.match(source, /localStorage\.getItem\("hyeni-api-session-v1"\)/);
  assert.match(source, /const accessToken = session\?\.access/);
  assert.doesNotMatch(source, /session\?\.(?:refresh|refresh_token)/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:accessToken|raw|localFamilyId)/);
  assert.match(source, /familyMineStatus/);
  assert.match(source, /familyMatches/);
});

test("A17 CDP 최종 점검은 부모 주요 화면과 지도 실패를 모두 게이트한다", () => {
  for (const route of [
    "#/parent/home",
    "#/parent/calendar",
    "#/parent/location",
    "#/parent/location?view=history",
    "#/parent/memo",
    "#/notifications",
    "#/notification-settings",
    "#/parent/settings",
  ]) {
    assert.match(source, new RegExp(route.replace(/[?]/g, "\\?")));
  }
  assert.match(source, /지도를 불러오지 못했어요/);
  assert.match(source, /mapReady/);
  assert.match(source, /horizontalOverflowPx/);
  assert.match(source, /newConsoleOrRuntimeErrors/);
});

test("A17 CDP 최종 점검은 각 화면의 실제 루트 선택자로 표시 여부를 판정한다", () => {
  assert.match(source, /const requiredSelectorVisible = isElementVisible\(required\)/);
  assert.match(source, /visible: requiredSelectorVisible/);
  assert.doesNotMatch(source, /querySelectorAll\("main, section, article, \[role='main'\]"\)/);
});

test("A17 CDP 최종 점검은 새로고침부터 실패 응답의 경로만 안전하게 수집한다", () => {
  assert.match(source, /await send\("Network\.enable"\)/);
  assert.match(source, /message\.method === "Network\.responseReceived"/);
  assert.match(source, /networkErrors/);
  assert.match(source, /parsed\.origin.*parsed\.pathname/);
  assert.match(source, /setTimeout\(\(\) => location\.reload\(\), 0\)/);
  assert.match(source, /await send\("Log\.clear"\)/);
  assert.match(source, /consoleErrors\.length = 0/);
  assert.doesNotMatch(source, /parsed\.search/);
});

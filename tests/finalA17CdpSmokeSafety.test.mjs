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

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("직접 일정 저장은 Free에서도 개수·엔타이틀먼트 조회로 막지 않고 AI 정리 한도와 분리한다", () => {
  const eventForm = read("src/screens/parent/EventForm.tsx");
  const aiSchedule = read("src/screens/feature/AiSchedule.tsx");
  const koParent = JSON.parse(read("locales/ko/parent.json"));

  assert.doesNotMatch(eventForm, /scheduleLimitFor|scheduleLimitMessage|현재 플랜에서는 일정|useEntitlement/);
  assert.doesNotMatch(aiSchedule, /scheduleLimitFor|scheduleLimitMessage|현재 플랜에서는 일정/);
  assert.match(aiSchedule, /academyMode && !academyAllowed/);
  assert.match(aiSchedule, /parent\.aiSchedule\.supplyLimit/);
  assert.match(aiSchedule, /daily_limit_reached/);
  assert.match(aiSchedule, /MAX_SUPPLY_ITEMS_PER_KIND/);
  assert.match(aiSchedule, /limit:\s*intl\.formatNumber\(MAX_SUPPLY_ITEMS_PER_KIND\)/);
  assert.equal(
    koParent["parent.aiSchedule.supplyLimit"],
    "일정 추가는 무료도 제한 없어요. 준비물·숙제는 아이별 하루 각각 {limit}개까지예요.",
  );

  assert.match(eventForm, /useEvents\(\)/);
  assert.match(aiSchedule, /useSaveEventsWithChildrenBatch\(\)/);
});

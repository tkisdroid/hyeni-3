import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("직접 일정 저장은 Free에서도 개수·엔타이틀먼트 조회로 막지 않고 AI 정리 한도와 분리한다", () => {
  const eventForm = read("src/screens/parent/EventForm.tsx");
  const aiSchedule = read("src/screens/feature/AiSchedule.tsx");

  assert.doesNotMatch(eventForm, /scheduleLimitFor|scheduleLimitMessage|현재 플랜에서는 일정|useEntitlement/);
  assert.doesNotMatch(aiSchedule, /scheduleLimitFor|scheduleLimitMessage|현재 플랜에서는 일정/);
  assert.match(aiSchedule, /academyMode && !academyAllowed/);
  assert.match(aiSchedule, /직접 일정 추가와 기존 일정 관리는 무료에서도 제한 없이 사용할 수 있어요/);
  assert.match(aiSchedule, /daily_limit_reached/);
  assert.match(aiSchedule, /MAX_SUPPLY_ITEMS_PER_KIND/);
  assert.match(aiSchedule, /준비물과 숙제는 모든 플랜에서 아이별 하루 각각 \{MAX_SUPPLY_ITEMS_PER_KIND\}개까지 저장할 수 있어요/);

  assert.match(eventForm, /useEvents\(\)/);
  assert.match(aiSchedule, /useSaveEventsWithChildrenBatch\(\)/);
});

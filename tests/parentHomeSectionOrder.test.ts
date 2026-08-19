import test from "node:test";
import assert from "node:assert/strict";
import {
  PARENT_HOME_SECTION_IDS,
  moveParentHomeSection,
  normalizeParentHomeSectionOrder,
  parentHomeSectionOrderStorageKey,
} from "../src/transform/parentHomeSectionOrder.ts";

test("부모 홈 섹션 순서는 중복·알 수 없는 저장값을 제거하고 신규 섹션을 보충한다", () => {
  assert.deepEqual(
    normalizeParentHomeSectionOrder(["memo", "memo", "unknown", "schedule"]),
    [
      "memo",
      "schedule",
      "ai_schedule",
      "children",
      "safety",
      "supplies",
      "shortcuts",
      "membership",
    ],
  );
  assert.deepEqual(normalizeParentHomeSectionOrder(null), [...PARENT_HOME_SECTION_IDS]);
});

test("부모 홈 섹션을 목표 위치로 옮기며 나머지 상대 순서를 보존한다", () => {
  assert.deepEqual(
    moveParentHomeSection(PARENT_HOME_SECTION_IDS, "memo", "schedule"),
    [
      "memo",
      "schedule",
      "ai_schedule",
      "children",
      "safety",
      "supplies",
      "shortcuts",
      "membership",
    ],
  );
});

test("부모 홈 섹션 저장 키는 가족별로 분리된다", () => {
  assert.notEqual(
    parentHomeSectionOrderStorageKey("family-a"),
    parentHomeSectionOrderStorageKey("family-b"),
  );
});

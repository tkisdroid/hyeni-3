import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PARENT_HOME_SECTION_IDS,
  moveParentHomeSection,
  normalizeParentHomeSectionOrder,
  parentHomeReorderHintStorageKey,
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
  assert.notEqual(
    parentHomeReorderHintStorageKey("family-a"),
    parentHomeReorderHintStorageKey("family-b"),
  );
});

test("부모 홈은 별도 순서 편집 카드 없이 길게 누른 섹션 복제본을 띄워 옮긴다", () => {
  const source = readFileSync(new URL("../src/screens/parent/ParentHome.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/screens/parent/ParentHome.css", import.meta.url), "utf8");

  assert.doesNotMatch(source, /ph-reorder-toolbar/);
  assert.doesNotMatch(css, /\.ph-reorder-toolbar/);
  assert.match(source, /SECTION_LONG_PRESS_MS = 380/);
  assert.match(source, /cloneNode\(true\)/);
  assert.match(source, /ph-section-drag-preview/);
  assert.match(source, /navigator\.vibrate\?\.\(12\)/);
  assert.match(source, /suppressedSectionClickRef/);
  assert.match(source, /parentHomeReorderHintStorageKey\(familyId\)/);
  assert.match(source, /localStorage\.getItem\(storageKey\) === "shown"/);
  assert.match(source, /localStorage\.setItem\(storageKey, "shown"\)/);
  assert.match(source, /show\(intl\.formatMessage\(\{ id: "parent\.home\.reorder\.hint" \}\)\)/);
  assert.match(css, /\.ph-home-section--dragging[\s\S]*?opacity: 0\.18/);
  assert.match(css, /\.ph-section-drag-preview[\s\S]*?position: fixed !important/);
});

test("부모 홈 핵심 섹션과 바로가기는 제목 왼쪽 장식 아이콘을 두지 않고 아이 사진을 크게 채운다", () => {
  const source = readFileSync(new URL("../src/screens/parent/ParentHome.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/screens/parent/ParentHome.css", import.meta.url), "utf8");
  const ranges = [
    ["{/* 오늘의 일정 */}", "{/* AI로 일정 추가"],
    ["{/* AI로 일정 추가", "{/* 아이 현황 */}"],
    ["{/* 아이 현황 */}", "{/* 안전 지표 */}"],
    ["{/* 안전 지표 */}", "{/* 준비물 · 숙제 */}"],
    ["{/* 준비물 · 숙제 */}", "{/* 대화 프리뷰 */}"],
    ["{/* 바로가기 */}", "{renderHomeSection(\"membership\""],
  ] as const;

  for (const [start, end] of ranges) {
    const block = source.slice(source.indexOf(start), source.indexOf(end));
    assert.ok(block.length > 0, `${start} 섹션을 찾지 못했습니다`);
    assert.doesNotMatch(block, /ph-ai__icon|iconBg=|<SectionHeader[\s\S]*?\bicon=\{/);
  }
  assert.match(source, /className="ph-child__avatar"[\s\S]{0,120}data-photo=/);
  assert.match(css, /\.ph-child__avatar\s*\{[\s\S]*?width: 72px;[\s\S]*?height: 72px;/);
  assert.match(css, /\.ph-child__avatar\[data-photo="true"\] img[\s\S]*?width: 100%;[\s\S]*?object-fit: cover;/);
});

test("부모 홈 주요 기능은 얼음 유리 섹션으로 묶고 조작 버튼과 텍스트 위계를 분명히 한다", () => {
  const source = readFileSync(new URL("../src/screens/parent/ParentHome.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/screens/parent/ParentHome.css", import.meta.url), "utf8");
  const ko = JSON.parse(readFileSync(new URL("../locales/ko/parent.json", import.meta.url), "utf8"));

  assert.ok((source.match(/className="ph-section-shell(?: ph-ai)? ph-glass"/g) ?? []).length >= 6);
  assert.match(css, /\.ph-section-shell\s*\{[\s\S]*?backdrop-filter: var\(--liquid-glass-blur\)/);
  assert.match(css, /\.ph-section-shell::after\s*\{[\s\S]*?inset: 4px;[\s\S]*?box-shadow: var\(--liquid-glass-inner-rim\)/);
  assert.match(css, /\.ph-inner-surface\s*\{[\s\S]*?background: var\(--liquid-glass-tile\)/);
  assert.match(css, /\.ph-ai__btn\s*\{[\s\S]*?background: color-mix[\s\S]*?box-shadow: var\(--neu-raised-soft\)/);
  assert.match(css, /\.ph-shortcut\s*\{[\s\S]*?background: color-mix[\s\S]*?box-shadow: var\(--neu-raised-soft\)/);
  assert.match(css, /\.ph-app-summary__v\s*\{[\s\S]*?font-weight: var\(--type-body-lg-weight\)/);
  assert.match(css, /\.ph-recent-row__time\s*\{[\s\S]*?font-weight: var\(--type-label-weight\)/);

  const memo = source.slice(source.indexOf("{/* 대화 프리뷰 */}"), source.indexOf("{/* 바로가기 */}"));
  assert.doesNotMatch(memo, /copy059|ph-memo__time|childName/);
  assert.equal(ko["parent.home.sendMessageTo"], "메시지 보내기");
});

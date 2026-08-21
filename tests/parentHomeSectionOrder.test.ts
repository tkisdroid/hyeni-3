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
  assert.doesNotMatch(source, /ChevronRight|ph-child__now|ph-child__more/);
  assert.doesNotMatch(source.slice(source.indexOf("{/* 오늘의 일정 */}"), source.indexOf("{/* AI로 일정 추가")), /ChevronRight/);
});

test("부모 홈 주요 기능은 유리 섹션으로 묶고 조작·문구 계약을 지킨다", () => {
  const source = readFileSync(new URL("../src/screens/parent/ParentHome.tsx", import.meta.url), "utf8");
  const redesignCss = readFileSync(new URL("../src/screens/parent/ParentHome.redesign.css", import.meta.url), "utf8");
  const appShell = readFileSync(new URL("../src/app/AppShell.tsx", import.meta.url), "utf8");
  const tabBar = readFileSync(new URL("../src/app/TabBar.tsx", import.meta.url), "utf8");
  const ko = JSON.parse(readFileSync(new URL("../locales/ko/parent.json", import.meta.url), "utf8"));

  // 주요 섹션은 모두 같은 유리 판이다.
  assert.ok((source.match(/className="ph-section-shell(?: ph-ai)? ph-glass"/g) ?? []).length >= 6);

  // 재질 정본은 glass.css 이고, 화면 파일은 그 위에 화면 고유 요소만 얹는다.
  // (2026-08-21 전환 전 스펙이던 --liquid-glass-*·--neu-control-* 는 폐기됐다.)
  assert.doesNotMatch(redesignCss, /--liquid-glass-|--neu-control-/);
  assert.match(redesignCss, /\.ph-page \.ph-section-shell,[\s\S]*?backdrop-filter: var\(--ph-glass-blur\)/);

  // 부모 탭은 라벨 없는 아이콘 전용이고 이름은 aria-label 로만 남는다.
  assert.match(appShell, /<TabBar tabs=\{tabs\} iconOnly \/>/);
  assert.match(tabBar, /aria-label=\{t\.label\}/);
  assert.match(tabBar, /\{!iconOnly && <span className="hy-tab__label">\{t\.label\}<\/span>\}/);

  // 화면 파일은 공용 파일보다 뒤에 로드돼 마지막 발언권을 갖는다.
  assert.ok(
    source.indexOf('import "./ParentHome.css";') < source.indexOf('import "./ParentHome.redesign.css";'),
    "부모 홈 리디자인 파일의 실제 후행 cascade를 검사해야 합니다",
  );

  const memo = source.slice(source.indexOf("{/* 대화 프리뷰 */}"), source.indexOf("{/* 바로가기 */}"));
  assert.doesNotMatch(memo, /copy059|ph-memo__time|childName/);
  assert.equal(ko["parent.home.sendMessageTo"], "메시지 보내기");
});

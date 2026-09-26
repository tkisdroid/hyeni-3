import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readCss(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

function selectorBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s").exec(css);
  assert.ok(match, `${selector} 규칙을 찾지 못했어요`);
  return match[1];
}

function assertPrettyKoreanWrap(block, selector) {
  assert.match(block, /word-break:\s*keep-all\s*;/, `${selector}는 한국어 단어를 중간에서 끊지 않아야 해요`);
  assert.match(block, /overflow-wrap:\s*anywhere\s*;/, `${selector}는 긴 동적 문구가 화면을 넘지 않아야 해요`);
  assert.match(block, /text-wrap:\s*pretty\s*;/, `${selector}는 마지막 조사·어미 고립을 줄여야 해요`);
}

test("장소 등록 헤더와 필드 라벨은 가족 화면의 동명 전역 클래스와 격리한다", () => {
  const css = readCss("src/screens/feature/PlaceForm.css");
  const header = selectorBlock(css, ".pf-screen > .pf-header");
  const label = selectorBlock(css, ".pf-screen .pf-label");
  const typeLabel = selectorBlock(css, ".pf-screen .pf-label--types");

  assert.match(header, /justify-content:\s*flex-start\s*;/);
  assert.match(label, /margin-bottom:\s*8px\s*;/);
  assert.match(typeLabel, /margin-bottom:\s*12px\s*;/);
  assert.doesNotMatch(css, /(?:^|\n)\.pf-header\s*\{/);
  assert.doesNotMatch(css, /(?:^|\n)\.pf-label(?:--types)?\s*\{/);
});

test("부모·연결 화면의 긴 한국어 문구는 의미 단위 줄바꿈을 유지한다", () => {
  const family = readCss("src/screens/parent/ParentFamily.css");
  const location = readCss("src/screens/parent/ParentLocation.css");
  const arrival = readCss("src/screens/feature/ArrivalAlerts.css");
  const pairing = readCss("src/screens/feature/PairingWizard.css");

  assertPrettyKoreanWrap(selectorBlock(family, ".pf-paircode__target-sub"), ".pf-paircode__target-sub");
  assertPrettyKoreanWrap(selectorBlock(location, ".pl-lock__sub"), ".pl-lock__sub");
  assertPrettyKoreanWrap(selectorBlock(arrival, ".aa-item__title"), ".aa-item__title");
  assertPrettyKoreanWrap(selectorBlock(arrival, ".aa-item__detail"), ".aa-item__detail");
  assertPrettyKoreanWrap(selectorBlock(pairing, ".pw-note"), ".pw-note");
});

test("가족 연결과 위치 잠금 안내는 강제 줄바꿈 없이 폭에 맞춰 흐른다", () => {
  const family = readFileSync(resolve(rootDir, "src/screens/parent/ParentFamily.tsx"), "utf8");
  const location = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.tsx"), "utf8");
  const koParent = JSON.parse(readFileSync(resolve(rootDir, "locales/ko/parent.json"), "utf8"));

  // 2026-09-26: 소개 문단 대신 각 선택 카드가 역할 전용 QR임을 짧게 말한다.
  assert.ok(!family.includes("parent.parentFamily.connectionTargetDescription"));
  assert.ok(family.includes("parent.parentFamily.connectChildDescription"));
  assert.match(koParent["parent.parentFamily.connectChildDescription"], /아이로만 등록하는 QR/);
  assert.doesNotMatch(location, /<br\s*\/?>/);
});

test("플랜 비교표는 열 폭을 먼저 고정하고 한국어를 어절 단위로만 접는다", () => {
  // 2026-08-17 TK 제보 "플랜 비교 줄바꿈이 난잡하다": 항목 이름 nowrap 때문에 표가
  // 화면보다 넓어지고, 남은 폭에 밀린 값 칸이 글자 중간에서 끊겼다.
  const css = readCss("src/screens/feature/Subscription.css");
  const table = selectorBlock(css, ".sub-table");
  const rowhead = selectorBlock(css, ".sub-table__rowhead");
  const cell = selectorBlock(css, ".sub-table__cell");

  assert.match(table, /table-layout:\s*fixed\s*;/, "열 폭이 내용 길이에 흔들리면 안 돼요");
  assert.match(rowhead, /width:\s*44%\s*;/);
  assert.match(selectorBlock(css, ".sub-table__col"), /width:\s*28%\s*;/);
  assert.doesNotMatch(rowhead, /white-space:\s*nowrap\s*;/, "항목 이름은 접혀도 되고 표는 화면 폭을 지켜야 해요");
  assertPrettyKoreanWrap(rowhead, ".sub-table__rowhead");
  assertPrettyKoreanWrap(cell, ".sub-table__cell");
  // 넓은 표는 그래도 자기 컨테이너 안에서만 가로 스크롤한다(문서 본문은 넘치지 않는다).
  assert.match(selectorBlock(css, ".sub-compare__scroll"), /overflow-x:\s*auto\s*;/);
});

test("도착 알림 카드는 동적 본문 길이에 맞춰 늘어나며 고정 높이를 강제하지 않는다", () => {
  const css = readCss("src/screens/feature/ArrivalAlerts.css");
  const item = selectorBlock(css, ".aa-item");

  assert.doesNotMatch(item, /(?:^|;)\s*height\s*:/, "동적 알림 본문을 고정 높이로 잘라서는 안 돼요");
});

test("장소 저장과 아이 연결 CTA는 공용 primary 높이를 유지한다", () => {
  const place = selectorBlock(readCss("src/screens/feature/PlaceForm.css"), ".pf-save");
  const pairing = selectorBlock(readCss("src/screens/feature/PairingWizard.css"), ".pw-cta");

  for (const [selector, block] of [[".pf-save", place], [".pw-cta", pairing]]) {
    assert.match(block, /height:\s*var\(--control-height-primary\)\s*;/, `${selector} 높이가 공용 CTA와 달라졌어요`);
    assert.match(block, /flex:\s*none\s*;/, `${selector}가 좁은 화면에서 눌리면 안 돼요`);
  }
});

test("아이 연결 요금 안내는 390px에서 마지막 어절만 고립되지 않도록 짧게 유지한다", () => {
  const source = readFileSync(resolve(rootDir, "src/screens/feature/PairingWizard.tsx"), "utf8");
  const koParent = JSON.parse(readFileSync(resolve(rootDir, "locales/ko/parent.json"), "utf8"));

  assert.ok(source.includes("parent.pairingWizard.firstFree"));
  assert.equal(koParent["parent.pairingWizard.firstFree"], "첫째 아이는 무료, 둘째부터는 프리미엄이에요.");
  assert.notEqual(
    koParent["parent.pairingWizard.firstFree"],
    "아이 1명은 무료예요. 두 번째 아이는 프리미엄에서 연결할 수 있어요.",
  );
});

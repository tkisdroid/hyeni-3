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

  assertPrettyKoreanWrap(selectorBlock(family, ".pf-invite-card__sub"), ".pf-invite-card__sub");
  assertPrettyKoreanWrap(selectorBlock(family, ".pf-paircode__hint"), ".pf-paircode__hint");
  assertPrettyKoreanWrap(selectorBlock(location, ".pl-lock__sub"), ".pl-lock__sub");
  assertPrettyKoreanWrap(selectorBlock(arrival, ".aa-item__title"), ".aa-item__title");
  assertPrettyKoreanWrap(selectorBlock(arrival, ".aa-item__detail"), ".aa-item__detail");
  assertPrettyKoreanWrap(selectorBlock(pairing, ".pw-note"), ".pw-note");
});

test("가족 연결과 위치 잠금 안내는 강제 줄바꿈 없이 폭에 맞춰 흐른다", () => {
  const family = readFileSync(resolve(rootDir, "src/screens/parent/ParentFamily.tsx"), "utf8");
  const location = readFileSync(resolve(rootDir, "src/screens/parent/ParentLocation.tsx"), "utf8");

  assert.ok(family.includes("이 코드나 QR로 다시 연결해요."));
  assert.doesNotMatch(location, /<br\s*\/?>/);
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

  assert.ok(source.includes("첫째 아이는 무료, 둘째부터는 프리미엄이에요."));
  assert.ok(!source.includes("아이 1명은 무료예요. 두 번째 아이는 프리미엄에서 연결할 수 있어요."));
});

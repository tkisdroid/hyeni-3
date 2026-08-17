import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/feature/AiCredit.tsx"), "utf8");
const koBilling = JSON.parse(readFileSync(resolve(rootDir, "locales/ko/billing.json"), "utf8"));

test("AI 크레딧 화면은 혜니와 대화가 아니라 일정·안전 지원을 설명한다", () => {
  assert.match(source, /billing\.aiCredit\.hero\.badge/);
  assert.match(source, /billing\.aiCredit\.creditUse/);
  assert.equal(koBilling["billing.aiCredit.hero.badge"], "AI가 아이의 일정·안전 대화를 도와요");
  assert.equal(
    koBilling["billing.aiCredit.creditUse"],
    "AI가 도울 때 크레딧 1회를 써요.",
  );
  assert.doesNotMatch(source, /AI 친구 혜니와 한 번 대화/);
  assert.doesNotMatch(source, /혜니와 대화할 수 있어요/);
});

test("AI 상세 제어는 현재 아이의 서버 설정이 폼에 반영된 뒤에만 수정·저장할 수 있다", () => {
  assert.match(source, /formHydration\?\.childUserId === childUserId/);
  assert.match(source, /formHydration\.source === friendSettings/);
  assert.match(source, /if \(!advancedSettingsReady \|\| !childUserId \|\| dailyLimit == null \|\| saveSettings\.isPending\) return/);
  assert.match(source, /disabled=\{!advancedSettingsReady \|\| saveSettings\.isPending\}/);
});

test("신규 AI 설정과 Free 5회 소진은 Premium 20회 기본 제공 계약으로 연결된다", () => {
  assert.match(source, /friendSettings === null && dailyLimit != null/);
  assert.match(source, /patch: \{ ai_enabled: !aiEnabled, \.\.\.initialDailyLimitPatch \}/);
  assert.match(source, /billing\.aiCredit\.premium\.comparison/);
  assert.equal(koBilling["billing.aiCredit.premium.comparison"], "무료 하루 5회 · 프리미엄 하루 20회");
  assert.match(source, /source="ai_friend_limit"/);
  assert.match(source, /returnTo="\/ai-credit"/);
  assert.match(source, /billing\.aiCredit\.settings\.premiumDefault/);
  assert.equal(koBilling["billing.aiCredit.settings.premiumDefault"], "프리미엄 기본 20회로 설정");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/onboarding/Onboarding.tsx"), "utf8");
const koCatalog = JSON.parse(readFileSync(resolve(rootDir, "locales/ko/onboarding.json"), "utf8"));

test("가입 전 설문은 첫 단계에서 20% 진행률로 시작한다", () => {
  assert.match(source, /type Step = .*"survey"/);
  assert.match(source, /id: "onboarding\.survey\.title"/);
  assert.equal(koCatalog["onboarding.survey.title"], "가입 전에 한 가지만 알려 주세요");
  assert.match(source, /percent=\{20\}/);
});

test("설문은 아이에게 필요한 기능을 복수 선택할 수 있게 안내한다", () => {
  assert.match(source, /<FormattedMessage id="onboarding\.survey\.subtitle"/);
  assert.match(source, /titleId: "onboarding\.survey\.schedule\.title"/);
  assert.match(source, /titleId: "onboarding\.survey\.location\.title"/);
  assert.match(koCatalog["onboarding.survey.subtitle"], /우리 아이에게 가장 필요한 기능/);
  assert.equal(koCatalog["onboarding.survey.schedule.title"], "일정 관리");
  assert.equal(koCatalog["onboarding.survey.location.title"], "실시간 위치");
  assert.match(koCatalog["onboarding.survey.subtitle"], /복수 선택/);
});

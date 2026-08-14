import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/onboarding/Onboarding.tsx"), "utf8");

test("가입 전 설문은 첫 단계에서 20% 진행률로 시작한다", () => {
  assert.match(source, /type Step = .*"survey"/);
  assert.match(source, /가입 전에 필요한 기능을 알려 주세요/);
  assert.doesNotMatch(source, /가입 전에 한 가지만 알려 주세요/);
  assert.match(source, /percent=\{20\}/);
});

test("설문은 아이에게 필요한 기능을 복수 선택할 수 있게 안내한다", () => {
  assert.match(source, /우리 아이에게 필요한 기능을 골라 주세요/);
  assert.match(source, /일정 관리/);
  assert.match(source, /실시간 위치/);
  assert.match(source, /여러 개 선택할 수 있어요/);
  assert.match(source, /선택하지 않아도 계속할 수 있어요/);
  assert.match(source, /selected\.length > 0 \? "다음" : "선택 안 하고 계속"/);
});

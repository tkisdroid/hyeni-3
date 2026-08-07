import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/feature/PairingWizard.tsx"), "utf8");

test("페어링 위저드는 가족·구독 정보 확정 전 다자녀 선택과 코드 생성을 막는다", () => {
  assert.match(source, /const pairingQueryState = resolveQueryTruthState/);
  assert.match(source, /const gatesReady = pairingQueryState === "ready" && ready && !entitlementQuery\.isError && !!family/);
  assert.match(source, /pairingQueryState === "error" \|\| pairingDataMissing/);
  assert.match(source, /void retryPairingWizard\(\)/);
  assert.match(source, /resolveChildAddGate\(\{/);
  assert.match(source, /status === "unavailable"/);
  assert.match(source, /확인 중/);
});

test("페어링 코드 생성 직전에도 현재 티어의 아이 수 상한을 다시 검사한다", () => {
  assert.match(source, /const addDecision = resolveAddition\(children\.length\)/);
  assert.match(source, /if \(!handleBlockedAddition\(addDecision\)\) return/);
  assert.doesNotMatch(source, /existingChildCount \+ children\.length > maxChildren/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, rootUrl), "utf8");

test("가족 연결 상태는 실제 user_id 유무와 서버 정본 역할로 분리한다", () => {
  const source = read("src/screens/feature/FamilyConnection.tsx");

  assert.match(source, /members\.filter\(\(m\) => m\.role === "child"\)/);
  assert.match(source, /children\.filter\(\(c\) => c\.user_id\)/);
  assert.match(source, /children\.filter\(\(c\) => !c\.user_id\)/);
  assert.match(source, /m\.role === "parent" && m\.user_id && m\.user_id !== family\?\.primaryParentId/);
  assert.match(source, /unpair\.mutate\(confirm\.userId/);
});

test("페어링은 기존 아이를 밀지 않는 한도 게이트와 같은 아이 계정 복구 힌트를 유지한다", () => {
  const wizard = read("src/screens/feature/PairingWizard.tsx");
  const onboarding = read("src/screens/onboarding/Onboarding.tsx");
  const familyEndpoint = read("src/lib/api/endpoints/family.ts");

  assert.match(wizard, /resolveAddition\(children\.length\)[\s\S]{0,140}handleBlockedAddition/);
  assert.match(wizard, /plannedChildCount: existingChildCount \+ validChildren\.length/);
  assert.match(wizard, /startOrder: existingChildCount/);
  assert.match(onboarding, /const nextHint = await readChildDeviceIdentityHint\(\)/);
  assert.match(onboarding, /joinFamily\(code, childJoinHint \?\? nextHint\)/);
  assert.match(familyEndpoint, /if \(previousUserId\) payload\.previous_user_id = previousUserId/);
});

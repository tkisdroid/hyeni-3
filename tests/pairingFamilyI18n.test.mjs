import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, rootUrl), "utf8");

test("가족 연결 아이 주어는 0명 fallback과 한국어 받침을 순수하게 계산한다", async () => {
  const moduleUrl = new URL("src/transform/familyConnectionSubject.ts", rootUrl);
  assert.equal(existsSync(moduleUrl), true, "가족 연결 주어 resolver가 필요합니다.");
  const { resolveFamilyConnectionChildSubject } = await import(moduleUrl);
  const base = {
    locale: "ko",
    childFallback: "아이",
    particleConsonant: "은",
    particleVowel: "는",
  };

  assert.equal(resolveFamilyConnectionChildSubject({ ...base, childName: undefined }), "아이는");
  assert.equal(resolveFamilyConnectionChildSubject({ ...base, childName: "민준" }), "민준은");
  assert.equal(resolveFamilyConnectionChildSubject({ ...base, childName: "하나" }), "하나는");
  assert.equal(resolveFamilyConnectionChildSubject({ ...base, locale: "en", childName: "Mina" }), "Mina");
});

test("가족 연결 상태는 실제 user_id 유무와 서버 정본 역할로 분리한다", () => {
  const source = read("src/screens/feature/FamilyConnection.tsx");

  assert.match(source, /members\.filter\(\(m\) => m\.role === "child"\)/);
  assert.match(source, /children\.filter\(\(c\) => c\.user_id\)/);
  assert.match(source, /children\.filter\(\(c\) => !c\.user_id\)/);
  assert.match(source, /const \{ userId \} = useAuth\(\)/);
  assert.match(source, /m\.role === "parent" && m\.user_id && m\.user_id !== userId/);
  assert.match(source, /p\.user_id === family\?\.primaryParentId[\s\S]{0,180}parent\.parentAccount\.copy001/);
  assert.match(source, /isPrimary && p\.user_id !== family\?\.primaryParentId/);
  assert.match(source, /const disconnectMutation = confirm\?\.kind === "coparent" \? removeCoParent : unpair/);
  assert.match(source, /disconnectMutation\.mutate\(confirm\.userId/);
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

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const parentFamily = readFileSync(resolve(rootDir, "src/screens/parent/ParentFamily.tsx"), "utf8");
const pairingWizard = readFileSync(resolve(rootDir, "src/screens/feature/PairingWizard.tsx"), "utf8");

for (const [name, source] of [
  ["가족 화면", parentFamily],
  ["페어링 위저드", pairingWizard],
]) {
  test(`${name}의 둘째 아이 시도는 공용 프리미엄 업셀과 안전한 복귀 경로를 사용한다`, () => {
    assert.match(source, /import \{ PremiumUpsell \} from "@\/components\/PremiumUpsell"/);
    assert.match(source, /source="second_child"/);
    assert.match(source, /returnTo="\/pairing-wizard"/);
    assert.match(source, /onClose=\{\(\) => setUpsellOpen\(false\)\}/);
    assert.match(source, /savePremiumReturnIntent\(storage, \{/);
    assert.match(source, /navigate\("\/subscription"\)/);
  });
}

test("가족 화면의 코드·QR·공동 보호자 초대는 둘째 아이 업셀과 분리된다", () => {
  const inviteStart = parentFamily.indexOf("const invite = () =>");
  const inviteEnd = parentFamily.indexOf("const addChild", inviteStart);
  assert.ok(inviteStart >= 0 && inviteEnd > inviteStart);
  const inviteBody = parentFamily.slice(inviteStart, inviteEnd);
  assert.match(inviteBody, /navigate\("\/child-invite"\)/);
  assert.doesNotMatch(inviteBody, /resolveChildAddGate|setUpsellOpen|\/subscription/);
});

test("코드 발급은 현재 아이 수 게이트를 검증한 뒤에만 입력 검증과 서버 mutation을 시작한다", () => {
  const makeCodeStart = pairingWizard.indexOf("const makeCode = () =>");
  const makeCodeEnd = pairingWizard.indexOf("if (pairingQueryState", makeCodeStart);
  assert.ok(makeCodeStart >= 0 && makeCodeEnd > makeCodeStart);
  const makeCodeBody = pairingWizard.slice(makeCodeStart, makeCodeEnd);
  const gateIndex = makeCodeBody.indexOf("resolveAddition(children.length)");
  const validationIndex = makeCodeBody.indexOf("validateChildDraftRequirements(children)");
  const mutationIndex = makeCodeBody.indexOf("createChildren.mutate");
  assert.ok(gateIndex >= 0, "코드 발급 직전 아이 추가 게이트가 필요합니다");
  assert.ok(gateIndex < validationIndex, "게이트가 입력 검증보다 먼저 실행되어야 합니다");
  assert.ok(gateIndex < mutationIndex, "게이트가 서버 mutation보다 먼저 실행되어야 합니다");
  assert.doesNotMatch(makeCodeBody, /navigate\("\/subscription"\)/);
});

test("업그레이드 CTA는 복귀 정보와 구독 이동만 처리하고 아이 생성·코드 발급을 자동 재시도하지 않는다", () => {
  const modalStart = pairingWizard.lastIndexOf("<PremiumUpsell");
  assert.ok(modalStart >= 0);
  const modalBody = pairingWizard.slice(modalStart);
  assert.match(modalBody, /savePremiumReturnIntent/);
  assert.match(modalBody, /navigate\("\/subscription"\)/);
  assert.doesNotMatch(modalBody, /createChildren\.mutate|regen\.mutate|issueCode\(|makeCode\(/);
});

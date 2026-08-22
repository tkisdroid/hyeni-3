import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const onboarding = readFileSync(new URL("../src/screens/onboarding/Onboarding.tsx", import.meta.url), "utf8");
const childInvite = readFileSync(new URL("../src/screens/feature/ChildInvite.tsx", import.meta.url), "utf8");
const familyConnection = readFileSync(new URL("../src/screens/feature/FamilyConnection.tsx", import.meta.url), "utf8");
const parentFamily = readFileSync(new URL("../src/screens/parent/ParentFamily.tsx", import.meta.url), "utf8");
const webkitSmoke = readFileSync(new URL("../scripts/privacy-safe-webkit-pwa-smoke.mjs", import.meta.url), "utf8");
const koParent = JSON.parse(readFileSync(new URL("../locales/ko/parent.json", import.meta.url), "utf8"));
const koOnboarding = JSON.parse(readFileSync(new URL("../locales/ko/onboarding.json", import.meta.url), "utf8"));

test("소셜 회원가입은 선택한 provider를 설문 뒤 OAuth 실행까지 유지한다", () => {
  assert.match(onboarding, /onSignup\(\{ kind: "oauth", provider \}\)/);
  assert.match(onboarding, /resolveSignupContinuation\(signupMethod\)/);
  assert.match(onboarding, /startSignupOAuth\(continuation\.provider\)/);
  assert.match(onboarding, /onboardingInterests: callbackDraft\?\.signupMethod\?\.kind === "oauth"/);
});

test("기존 소셜 회원 안내는 서버가 existing 또는 linked를 확정한 때만 표시한다", () => {
  assert.match(onboarding, /result\.account_status === "existing"\s*\|\|\s*result\.account_status === "linked"/);
  assert.doesNotMatch(onboarding, /result\.account_status !== "created"/);
});

test("공동 보호자와 아이 초대 CTA는 서로 다른 역할 링크를 만든다", () => {
  assert.match(childInvite, /buildPairLink\(pairCode, inviteRole\)/);
  assert.match(familyConnection, /navigate\("\/child-invite\?role=parent"\)/);
  assert.match(parentFamily, /navigate\("\/child-invite\?role=child"\)/);
  assert.match(parentFamily, /const inviteCoParent = \(\) => \{\s*navigate\("\/child-invite\?role=parent"\)/);
  assert.match(parentFamily, /const canInviteCoParent = Boolean\(/);
  assert.match(parentFamily, /parent\.parentFamily\.connectChild/);
});

test("아이관리는 역할 선택 전에 QR·코드·공유 링크를 발급하지 않는다", () => {
  assert.doesNotMatch(parentFamily, /buildPairRoleChoiceLink|<QrCode|pairCode|copyCode/);
  assert.doesNotMatch(childInvite, /buildPairRoleChoiceLink/);
  assert.match(childInvite, /requestedRole !== "child" && requestedRole !== "parent"/);
  assert.match(childInvite, /if \(roleChoiceInvite\) return <InviteRoleChoice \/>/);
  assert.match(childInvite, /buildPairLink\(pairCode, inviteRole\)/);
});

test("연결 문구는 역할 결과와 공동 보호자 교체 방법을 명확히 안내한다", () => {
  assert.equal(koParent["parent.parentFamily.connectionTargetTitle"], "누구를 연결할까요?");
  assert.match(koParent["parent.parentFamily.connectionTargetDescription"], /먼저 선택.*전용 QR/);
  assert.match(koParent["parent.familyInvite.choice.childDescription"], /아이로만 등록/);
  assert.match(koParent["parent.familyInvite.choice.parentDescription"], /공동 보호자로만 연결/);
  assert.match(koParent["parent.parentFamily.guardianSlotOccupiedDescription"], /기존 보호자.*해제/);
  assert.match(koParent["parent.familyConnection.coParentReplacementHint"], /기존 보호자.*해제/);
  assert.doesNotMatch(koOnboarding["onboarding.invite.legacyChoice"], /예전에 만든/);
  assert.match(koOnboarding["onboarding.invite.legacyChoice"], /다른 보호자.*학부모.*아이.*자녀 기기/);
  assert.match(childInvite, /parent\.familyInvite\.choice\.childDescription/);
  assert.match(childInvite, /parent\.familyInvite\.choice\.parentDescription/);
});

test("주 보호자는 연결된 공동 보호자를 아이 연결 해제와 구분해 교체할 수 있다", () => {
  assert.match(familyConnection, /useRemoveCoParent/);
  assert.match(familyConnection, /const disconnectMutation = confirm\?\.kind === "coparent" \? removeCoParent : unpair/);
  assert.match(familyConnection, /disconnectMutation\.mutate\(confirm\.userId/);
  assert.match(familyConnection, /className="fc-unpair fc-unpair--coparent hy-press"/);
  assert.match(familyConnection, /kind: "coparent"[\s\S]{0,180}userId: p\.user_id/);
  assert.match(familyConnection, /parent\.familyConnection\.removeCoParentConfirmTitle/);
});

test("iPhone WebKit 스모크는 역할 없는 구형 링크에서 역할 선택이 인증보다 먼저 보이는지 검증한다", () => {
  assert.match(webkitSmoke, /#\/onboarding\?pair=KID-QA123456/);
  assert.match(webkitSmoke, /roleChoiceInvite\.inviteContext/);
  assert.match(webkitSmoke, /roleChoiceInvite\.anonymousRequested/);
  assert.match(webkitSmoke, /assert\.equal\(roleChoiceInvite\.anonymousRequested, false/);
});

test("명시적 공동 보호자 링크는 익명 아이 로그인을 거치지 않는다", () => {
  const pairEffect = onboarding.slice(
    onboarding.indexOf("const invite = readPairInvite()"),
    onboarding.indexOf("const back ="),
  );
  const parentAuth = pairEffect.slice(
    pairEffect.indexOf('if (action === "parent-auth")'),
    pairEffect.indexOf('if (action === "parent-pair")'),
  );
  assert.match(parentAuth, /setAuthIntent\("login"\)/);
  assert.match(parentAuth, /setStep\("login"\)/);
  assert.doesNotMatch(parentAuth, /anonymousLogin/);
});

test("역할 없는 기존 초대 링크는 역할 선택 전 익명 아이 로그인을 시작하지 않는다", () => {
  const pairEffect = onboarding.slice(
    onboarding.indexOf("const invite = readPairInvite()"),
    onboarding.indexOf("const back ="),
  );
  const chooseRole = pairEffect.slice(
    pairEffect.indexOf('if (action === "choose-role")'),
    pairEffect.indexOf('if (action === "parent-auth")'),
  );
  assert.match(chooseRole, /persistOnboardingDraft/);
  assert.match(chooseRole, /setStep\("role"\)/);
  assert.doesNotMatch(chooseRole, /anonymousLogin/);
  assert.match(onboarding, /legacyInvite=\{Boolean\(pendingPairInvite && !pendingPairInvite\.roleExplicit\)\}/);
});

test("페어링 제출은 화면의 초대 역할을 세션 역할로 조용히 재해석하지 않는다", () => {
  const pairingStep = onboarding.slice(onboarding.indexOf("function PairingStep("));

  assert.doesNotMatch(pairingStep, /effectiveMode/);
  assert.match(pairingStep, /if \(mode === "child"\)[\s\S]{0,320}await joinFamily\(code,[\s\S]{0,220}else \{[\s\S]{0,220}await joinFamilyAsParent\(code\)/);
  assert.match(pairingStep, /localizeApiError\(e, intl, mode === "child" \? "child" : "formal"\)/);
  assert.match(pairingStep, /isPairingMembershipConfirmed/);
  assert.match(pairingStep, /pairing_confirmation_failed/);
  assert.ok(pairingStep.indexOf("isPairingMembershipConfirmed") < pairingStep.indexOf("onPaired()"));
});

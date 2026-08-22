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
  assert.match(parentFamily, /const inviteRoleChoice = \(\) => \{\s*navigate\("\/child-invite\?role=choose"\)/);
  assert.match(parentFamily, /const inviteCoParent = \(\) => \{\s*navigate\("\/child-invite\?role=parent"\)/);
  assert.match(parentFamily, /const canInviteCoParent = Boolean\(/);
  assert.match(parentFamily, /\{canInviteCoParent && \(\s*<button type="button" className="pf-invite-card/);
});

test("아이관리 공용 연결 QR은 Safari에서 역할을 자녀로 고정하지 않는다", () => {
  assert.match(parentFamily, /buildPairRoleChoiceLink\(pairCode\)/);
  assert.match(parentFamily, /navigate\("\/child-invite\?role=choose"\)/);
  assert.doesNotMatch(parentFamily, /buildPairLink\(pairCode\)(?!,)/);
  assert.match(childInvite, /requestedRole === "choose"/);
  assert.match(childInvite, /buildPairRoleChoiceLink\(pairCode\)/);
});

test("공용 QR 문구는 보호자와 아이 역할 선택을 명확히 안내한다", () => {
  assert.equal(koParent["parent.parentFamily.copy016"], "가족 연결 코드 · QR");
  assert.match(koParent["parent.parentFamily.copy022"], /학부모.*아이.*먼저 선택/);
  assert.equal(koParent["parent.familyInvite.choice.headline"], "QR을 읽는 사람이 역할을 선택해요");
  assert.match(koParent["parent.familyInvite.choice.waiting"], /역할 선택을 기다리고/);
  assert.match(koParent["parent.parentFamily.copy024"], /보호자 전용 QR.*로그인·가입.*공동 보호자/);
  assert.doesNotMatch(koOnboarding["onboarding.invite.legacyChoice"], /예전에 만든/);
  assert.match(koOnboarding["onboarding.invite.legacyChoice"], /학부모.*아이.*선택/);
  assert.match(childInvite, /parent\.familyInvite\.choice\.headline/);
  assert.match(childInvite, /parent\.familyInvite\.choice\.waiting/);
});

test("iPhone WebKit 스모크는 공용 QR에서 역할 선택이 인증보다 먼저 보이는지 검증한다", () => {
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
});

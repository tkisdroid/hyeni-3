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

test("네이티브 OAuth 성공은 설문을 교환에 포함하고 온보딩의 가족·초대 후속 처리로 넘긴다", () => {
  const deepLink = readFileSync(new URL("../src/lib/native/oauthDeepLink.ts", import.meta.url), "utf8");
  const finishStart = deepLink.indexOf("async function finishLoginWithRecovery");
  const finishBranch = deepLink.slice(finishStart, deepLink.indexOf("async function recoverOrRetryUnclaimed", finishStart));
  assert.match(finishBranch, /callbackDraft\?\.signupMethod\?\.provider === cb\.provider/);
  assert.match(finishBranch, /finishOAuthLogin\(\{ \.\.\.cb, recoveryId: pending\.id \}, \{[\s\S]{0,160}sessionAdoption: "deferred"[\s\S]{0,260}onboardingInterests:/);
  const finalizeStart = deepLink.indexOf("function finalizeLogin");
  const finalizeBranch = deepLink.slice(finalizeStart, deepLink.indexOf("async function attemptPendingRecovery", finalizeStart));
  const stageAt = finalizeBranch.indexOf("stageNativeOAuthLoginCompletion");
  const adoptAt = finalizeBranch.indexOf("adoptAuthResult(result, { loginGenerationId })");
  const bindAt = finalizeBranch.indexOf("bindNativeOAuthLoginCompletion");
  const publishAt = finalizeBranch.indexOf("publishNativeOAuthLoginCompletion");
  assert.ok(stageAt >= 0 && stageAt < adoptAt && adoptAt < bindAt && bindAt < publishAt,
    "교환/복구 결과는 stage → adopt → bind → publish 순서를 지켜야 합니다");
  assert.match(finalizeBranch, /expectedAccessTokenJti: accessTokenJti\(result\.session\.access_token\)/);
  assert.match(finalizeBranch, /expectedLoginGenerationId: loginGenerationId/);
  assert.match(finalizeBranch, /void acknowledgeCompletion\(pending\)/);
  assert.doesNotMatch(finalizeBranch, /routeToHomeAfterLogin|completeOnboardingAuthDraft/);

  assert.match(onboarding, /subscribeNativeOAuthLoginCompletion/);
  assert.match(onboarding, /readNativeOAuthLoginCompletionForSession/);
  assert.match(onboarding, /authTransitionActive: authTransitionActive \|\| nativeOAuthRecoveryPending/);
  assert.match(onboarding, /const \[busy, setBusy\] = useState\(\(\) => nativeOAuthRecoveryPending\)/);
  assert.match(onboarding, /await routeAfterParentLogin\(transitionToken, completion\.pairInvite\)/);
  assert.match(onboarding, /if \(completed\) \{[\s\S]{0,120}clearNativeOAuthLoginCompletion\(completion\.id\)/);
  assert.match(onboarding, /clearNativeOAuthLoginCompletion\(completion\.id\)/);
});

test("세션에 묶인 네이티브 OAuth 후속 처리는 루트에서 온보딩으로 회수되고 게스트 가드가 한 번 허용한다", () => {
  const app = readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8");
  const requireGuest = readFileSync(new URL("../src/auth/RequireGuest.tsx", import.meta.url), "utf8");

  assert.match(app, /readNativeOAuthLoginCompletionForSession/);
  assert.match(app, /getApiAccessTokenJti\(\)/);
  assert.match(app, /getApiLoginGenerationId\(\)/);
  assert.match(app, /nativeOAuthCompletion[\s\S]{0,500}<Navigate to="\/onboarding" replace/);
  assert.match(requireGuest, /readNativeOAuthLoginCompletionForSession/);
  assert.match(requireGuest, /getApiLoginGenerationId\(\)/);
  assert.match(requireGuest, /!nativeOAuthCompletion[\s\S]{0,220}auth\.status === "authenticated"/);
});

test("네이티브 OAuth 가족 조회의 일시 실패는 한 번 재시도하고 StrictMode cleanup에도 gate를 끝낸다", () => {
  const consumer = onboarding.slice(
    onboarding.indexOf("const continueNativeOAuth = () =>"),
    onboarding.indexOf("const startSignupOAuth = async"),
  );
  assert.match(onboarding, /const nativeOAuthCompletionRetryRef = useRef/);
  assert.match(consumer, /publishNativeOAuthLoginCompletion\(completion\.id\)/);
  assert.match(consumer, /nativeOAuthCompletionRetryRef\.current/);
  assert.match(
    consumer,
    /if \(isOnboardingAuthTransitionActive\(transitionToken\)\) \{[\s\S]{0,180}endOnboardingAuthTransition\(transitionToken\)/,
  );
});

test("네이티브 로그인 callback 실패·취소는 공통 결과 이벤트로 온보딩 gate를 해제한다", () => {
  const deepLink = readFileSync(new URL("../src/lib/native/oauthDeepLink.ts", import.meta.url), "utf8");
  assert.match(deepLink, /export const OAUTH_DEEP_LINK_ACTIVITY_EVENT/);
  assert.match(deepLink, /export const OAUTH_DEEP_LINK_RESULT_EVENT/);
  const handler = deepLink.slice(
    deepLink.indexOf("async function handleUrl"),
    deepLink.indexOf("// 리스너는 앱 전체", deepLink.indexOf("async function handleUrl")),
  );
  assert.match(handler, /peekMatchingOAuthFlowMode/);
  assert.match(handler, /dispatchActivity\(cb\.provider, mode\)/);
  assert.match(deepLink, /function dispatchActivity[\s\S]{0,300}dispatchEvent\(new CustomEvent\(OAUTH_DEEP_LINK_ACTIVITY_EVENT/);
  const notifier = deepLink.slice(
    deepLink.indexOf("function notifyResult"),
    deepLink.indexOf("function hasListenerRefs"),
  );
  assert.match(notifier, /dispatchEvent\(new CustomEvent\(OAUTH_DEEP_LINK_RESULT_EVENT/);

  assert.match(onboarding, /OAUTH_DEEP_LINK_RESULT_EVENT/);
  assert.match(onboarding, /OAUTH_DEEP_LINK_ACTIVITY_EVENT/);
  assert.match(onboarding, /OAUTH_CALLBACK_DELIVERY_GRACE_MS/);
  const recoveryStart = onboarding.indexOf("const onNativeOAuthResult");
  const recovery = onboarding.slice(
    recoveryStart,
    onboarding.indexOf("// QR 딥링크", recoveryStart),
  );
  assert.match(recovery, /detail\.mode !== "login" \|\| detail\.ok/);
  assert.match(recovery, /clearOAuthExternalBusy\(\)/);
  assert.match(recovery, /cancelOnboardingAuthTransitions\(\)/);
  assert.match(recovery, /setBusy\(false\)/);
});

test("네이티브 OAuth는 consumed 기록보다 recovery ID를 먼저 남기고 20초 안에 복구를 끝낸다", () => {
  const deepLink = readFileSync(new URL("../src/lib/native/oauthDeepLink.ts", import.meta.url), "utf8");
  const handlerStart = deepLink.indexOf("async function handleUrl");
  const handler = deepLink.slice(handlerStart, deepLink.indexOf("// 리스너는 앱 전체", handlerStart));
  const stageAt = handler.indexOf("stageNativeOAuthPendingExchange(cb.provider)");
  const runAt = handler.indexOf("once.run(key");
  assert.ok(stageAt >= 0 && stageAt < runAt, "process kill 창을 닫으려면 pending이 consumed보다 먼저 저장돼야 합니다");
  assert.match(handler, /mode === "login" && !once\.consumed\(key\)/,
    "consumed stale launch가 새 recovery grant를 만들면 안 됩니다");

  const recoveryStart = deepLink.indexOf("async function attemptPendingRecovery");
  const recovery = deepLink.slice(recoveryStart, deepLink.indexOf("async function finishLoginWithRecovery", recoveryStart));
  assert.match(recovery, /while \(Date\.now\(\) < deadlineMs\)/);
  assert.match(deepLink, /const deadlineMs = Date\.now\(\) \+ 20_000/);
  assert.match(deepLink, /getBoundedOAuthDeviceDescriptor\(Math\.min\(4_000, deadlineMs - Date\.now\(\)\)\)/);
  assert.match(recovery, /recoverOAuthLogin\(pending, \{ timeoutMs: remainingMs, device \}\)/);
  assert.match(deepLink, /withOperationDeadline\([\s\S]{0,100}CapApp\.getLaunchUrl\(\)[\s\S]{0,120}timeoutMs: 2_000/);
  assert.match(deepLink, /const recovered = await resumePendingExchange\(launchUrl, notifyResult\)/,
    "launch URL 조회 실패와 무관하게 local pending을 복구해야 합니다");
});

test("네이티브 OAuth 교환·복구의 늦은 성공은 새 인증 intent 세션을 덮지 않는다", () => {
  const deepLink = readFileSync(new URL("../src/lib/native/oauthDeepLink.ts", import.meta.url), "utf8");
  const exchangeStart = deepLink.indexOf("async function exchange");
  const exchange = deepLink.slice(exchangeStart, deepLink.indexOf("async function cancel", exchangeStart));
  const directFinalize = exchange.indexOf("finalizeLogin(result, cb.provider, pending)");
  const directOwnerCheck = exchange.lastIndexOf(
    "readNativeOAuthPendingExchange()?.id !== pending.id",
    directFinalize,
  );
  assert.ok(directOwnerCheck >= 0 && directOwnerCheck < directFinalize,
    "code exchange 응답 채택 직전 pending intent 소유권을 다시 확인해야 합니다");

  const recoveredFinalize = exchange.indexOf("finalizeLogin(recovered, cb.provider, pending)");
  const recoveredOwnerCheck = exchange.lastIndexOf(
    "readNativeOAuthPendingExchange()?.id !== pending.id",
    recoveredFinalize,
  );
  assert.ok(recoveredOwnerCheck > directFinalize && recoveredOwnerCheck < recoveredFinalize,
    "reconciliation 응답도 채택 직전 pending intent 소유권을 다시 확인해야 합니다");
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

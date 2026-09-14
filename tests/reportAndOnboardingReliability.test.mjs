import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [weeklyReport, onboarding, requireGuest, authEndpoint, familyEndpoint] = await Promise.all([
  readFile(new URL("../src/screens/feature/WeeklyFamilyReport.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/onboarding/Onboarding.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/auth/RequireGuest.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/api/endpoints/auth.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/api/endpoints/family.ts", import.meta.url), "utf8"),
]);
const koReports = JSON.parse(
  await readFile(new URL("../locales/ko/reports.json", import.meta.url), "utf8"),
);
const koOnboarding = JSON.parse(
  await readFile(new URL("../locales/ko/onboarding.json", import.meta.url), "utf8"),
);

test("주간 리포트는 네 조회의 오류를 로딩보다 먼저 분기한다", () => {
  assert.match(weeklyReport, /resolveQueryTruthState/);
  assert.match(weeklyReport, /eventsQuery\.isError/);
  assert.match(weeklyReport, /suppliesQuery\.isError/);
  assert.match(weeklyReport, /memoThread\.isError/);
  assert.match(weeklyReport, /alertsQuery\.isError/);

  const errorBranch = weeklyReport.indexOf('queryState === "error"');
  const loadingBranch = weeklyReport.indexOf('queryState === "loading"');
  assert.ok(errorBranch >= 0, "조회 오류 분기가 필요합니다");
  assert.ok(loadingBranch > errorBranch, "오류 분기는 로딩 분기보다 먼저 렌더해야 합니다");
});

test("주간 리포트는 ready에서만 집계하고 오류 카드에서 네 조회를 함께 재시도한다", () => {
  assert.match(
    weeklyReport,
    /const summary = useMemo\([\s\S]*if \(queryState !== "ready"\) return null;[\s\S]*summarizeWeeklyReport\(/,
  );
  assert.match(weeklyReport, /reports\.weekly\.errorTitle/);
  assert.equal(koReports["reports.weekly.errorTitle"], "주간 리포트를 불러오지 못했어요");
  assert.match(
    weeklyReport,
    /Promise\.all\(\[\s*eventsQuery\.refetch\(\),\s*suppliesQuery\.refetch\(\),\s*memoThread\.refetch\(\),\s*alertsQuery\.refetch\(\),?\s*\]\)/,
  );
});

test("가족 조회가 null로 성공한 경우에만 신규 가족 연결 단계로 이동한다", () => {
  const start = onboarding.indexOf("const routeAfterParentLogin = useCallback(async (");
  const end = onboarding.indexOf("const routeAfterChildSession", start);
  const route = onboarding.slice(start, end);

  assert.ok(start >= 0 && end > start, "부모 로그인 후 라우팅 함수가 필요합니다");
  assert.match(route, /const fam = await getMyFamily\(\)/);
  assert.match(route, /familyExists: fam !== null/);
  assert.match(route, /if \(action === "parent-connect"\) \{[\s\S]*setStep\("connect"\)/);
  assert.match(route, /navigate\(homePathForRole\(current\.role\)\)/);
});

test("가족 조회 실패는 연결 단계로 보내지 않고 기존 로그인 오류 처리로 전달한다", () => {
  const start = onboarding.indexOf("const routeAfterParentLogin = useCallback(async (");
  const end = onboarding.indexOf("const routeAfterChildSession", start);
  const route = onboarding.slice(start, end);
  const connectIndex = route.indexOf('setStep("connect")');
  const catchIndex = route.indexOf("catch");

  assert.ok(connectIndex >= 0 && catchIndex > connectIndex, "connect 이동은 null 성공 분기 안에 있어야 합니다");
  assert.match(
    route,
    /catch[\s\S]*throw new Error\("family_lookup_failed"\)/,
  );
  assert.match(
    onboarding,
    /await onLoggedIn\(transitionToken\);[\s\S]{0,120}catch \(e\) \{[\s\S]{0,240}const message = localizeApiError\(e, intl, "formal"\);[\s\S]{0,160}onAuthError\(message\);/,
  );
  assert.doesNotMatch(onboarding, /show\([^\n]*e\.message/);
});

test("RequireGuest와 온보딩 자체 리다이렉트는 명시적 인증 전환 중 역할 홈 이동을 보류한다", () => {
  assert.match(requireGuest, /useSyncExternalStore/);
  assert.match(requireGuest, /subscribeOnboardingAuthTransition/);
  assert.match(requireGuest, /getOnboardingAuthTransitionSnapshot/);
  assert.match(
    requireGuest,
    /!authTransitionActive\s*&&\s*auth\.status === "authenticated"\s*&&\s*auth\.familyId/,
  );
  assert.match(onboarding, /authTransitionActive:\s*authTransitionActive/);
});

test("ID 로그인과 OAuth callback은 gate 시작 뒤 deferred 응답만 요청한다", () => {
  const loginStart = onboarding.indexOf("const loginIdPw = async (");
  const loginEnd = onboarding.indexOf("return (", loginStart);
  const login = onboarding.slice(loginStart, loginEnd);
  const loginBegin = login.indexOf("const transitionToken = beginOnboardingAuthTransition()");
  const signIn = login.indexOf("signInWithLoginId(");

  const callbackStart = onboarding.indexOf("const cb = readOAuthCallback();");
  const callbackEnd = onboarding.indexOf("// eslint-disable-next-line", callbackStart);
  const callback = onboarding.slice(callbackStart, callbackEnd);
  const callbackBegin = callback.indexOf("const transitionToken = beginOnboardingAuthTransition()");
  const finishOAuth = callback.indexOf("finishOAuthLogin(cb, {");

  assert.ok(loginBegin >= 0 && signIn > loginBegin, "ID 로그인 전에 gate를 시작해야 합니다");
  assert.ok(callbackBegin >= 0 && finishOAuth > callbackBegin, "OAuth 교환 전에 gate를 시작해야 합니다");
  assert.match(login, /signInWithLoginId\([\s\S]*sessionAdoption: "deferred"/);
});

test("OAuth 브라우저 취소 뒤 ID 로그인은 네트워크 전에 이전 transaction을 포기한다", () => {
  const loginStart = onboarding.indexOf("const loginIdPw = async (");
  const loginEnd = onboarding.indexOf("return (", loginStart);
  const login = onboarding.slice(loginStart, loginEnd);
  const abandon = login.indexOf("abandonPendingOAuth()");
  const signIn = login.indexOf("signInWithLoginId(");

  assert.ok(abandon >= 0 && abandon < signIn, "ID/자동완성 로그인 요청 전에 stale OAuth context를 지워야 합니다");
});

test("로그인 화면은 새 기기가 활성 설치가 되고 다른 기기는 자동 종료됨을 미리 안내한다", () => {
  assert.match(onboarding, /onboarding\.login\.deviceTransferNote/);
  assert.equal(
    koOnboarding["onboarding.login.deviceTransferNote"],
    "로그인하면 이 기기가 활성 기기가 되고, 다른 기기에서는 자동으로 로그아웃됩니다.",
  );
});

test("인증 endpoint 기본값은 immediate이고 온보딩은 explicit adopt만 사용한다", () => {
  assert.match(authEndpoint, /export function adoptAuthResult\(data: AuthResult, context\?: AuthResultAdoptionContext\): boolean/);
  assert.match(authEndpoint, /returnAuthResultWithAdoption\(data, options, adoptAuthResult\)/);
  assert.match(onboarding, /commitOnboardingAuthResult\(transitionToken, result, adoptAuthResult\)/);
});

test("가족 조회 보정은 요청 시작 session instance와 user 소유권이 유지될 때만 적용한다", () => {
  assert.match(familyEndpoint, /requestWithSessionOwnership/);
  assert.match(familyEndpoint, /sessionInstanceId: getApiSessionInstanceId\(\)/);
  assert.match(familyEndpoint, /userId: getApiUser\(\)\?\.id \?\? null/);
});

test("가족 판정 성공과 null은 active token 완료가 확인된 뒤에만 UI를 바꾼다", () => {
  const start = onboarding.indexOf("const routeAfterParentLogin = useCallback(async (");
  const end = onboarding.indexOf("const routeAfterChildSession", start);
  const route = onboarding.slice(start, end);
  const catchBlock = route.match(/catch\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
  const completeCalls = route.match(/completeOnboardingAuthTransitionsThrough\(transitionToken\)/g) ?? [];

  assert.match(route, /routeAfterParentLogin = useCallback\(async \([\s\S]{0,100}transitionToken: OnboardingAuthTransitionToken/);
  assert.equal(completeCalls.length, 2, "역할 홈과 부모 가족 판정은 각 분기에서 현재 token을 완료해야 합니다");
  assert.match(route, /if \(!isOnboardingAuthTransitionActive\(transitionToken\)\) return false;[\s\S]*syncFromSession\(\)/);
  assert.match(route, /const completed = completeOnboardingAuthTransitionsThrough\(transitionToken\);\s*if \(!completed\) return false;/);
  assert.match(route, /if \(!completed\) return false;[\s\S]*setBusy\(false\)[\s\S]*if \(action === "parent-connect"\)[\s\S]*setStep\("connect"\)/);
  assert.match(route, /if \(!completed\) return false;[\s\S]*navigate\(homePathForRole\(current\.role\)\)/);
  assert.doesNotMatch(catchBlock, /OnboardingAuthTransition/);
});

test("부모 로그인에서 back·signup·인증 시작 실패로 이탈하면 gate를 해제한다", () => {
  assert.match(onboarding, /onBack=\{\(\) => \{[\s\S]{0,320}cancelOnboardingAuthTransitions\(\)[\s\S]{0,320}back\(\)/);
  assert.match(onboarding, /onSignup=\{\(method\) => \{[\s\S]{0,200}cancelOnboardingAuthTransitions\(\)/);
  assert.match(
    onboarding,
    /catch \(e\) \{\s*loginActionGateRef\.current\.end\(\);\s*if \(!isOnboardingAuthTransitionActive\(transitionToken\)\) return;[\s\S]{0,240}const message = localizeApiError\(e, intl, "formal"\);[\s\S]{0,180}show\(message, "⚠️"\)[\s\S]{0,180}setBusy\(false\);[\s\S]{0,120}endOnboardingAuthTransition\(transitionToken\)/,
  );
});

test("인증 채택 전 실패는 자신의 pending token만 끝내고 명시적 OAuth 취소는 전체 pending gate를 취소한다", () => {
  assert.match(onboarding, /catch \(e\)[\s\S]*endOnboardingAuthTransition\(transitionToken\)/);
  assert.match(
    onboarding,
    /finishOAuthCancellation\(cancellation\)[\s\S]{0,420}cancelOnboardingAuthTransitions\(\)/,
  );
  assert.match(onboarding, /await routeAfterParentLogin\(transitionToken\)/);
  assert.match(onboarding, /await onLoggedIn\(transitionToken\)/);
});

test("stale OAuth·ID continuation은 채택하지 않고 StrictMode cleanup은 pending token만 끝낸다", () => {
  const callbackStart = onboarding.indexOf("const cb = readOAuthCallback();");
  const callbackEnd = onboarding.indexOf("// eslint-disable-next-line", callbackStart);
  const callback = onboarding.slice(callbackStart, callbackEnd);
  const loginStart = onboarding.indexOf("const loginIdPw = async (");
  const loginEnd = onboarding.indexOf("return (", loginStart);
  const login = onboarding.slice(loginStart, loginEnd);

  assert.match(callback, /commitOnboardingAuthResult\(transitionToken, result, adoptAuthResult\)/);
  assert.match(callback, /if \(commitResult === "stale"\) return;/);
  assert.match(callback, /catch\(\(e\) => \{[\s\S]*isOnboardingAuthTransitionActive\(transitionToken\)[\s\S]*if \(!canApplySideEffects\) return;/);
  assert.match(callback, /finally\(\(\) => \{\s*if \(isOnboardingAuthTransitionActive\(transitionToken\)\) setBusy\(false\);\s*\}\)/);
  assert.match(callback, /return \(\) => endOnboardingAuthTransition\(transitionToken\)/);
  assert.match(
    onboarding,
    /const oauthLoginPromiseRef = useRef<ReturnType<typeof finishOAuthLogin> \| null>\(null\)/,
  );
  assert.match(
    callback,
    /const oauthLoginPromise = oauthLoginPromiseRef\.current\s*\?\? finishOAuthLogin\(cb, \{[\s\S]{0,320}sessionAdoption: "deferred",[\s\S]{0,320}onboardingInterests:[\s\S]{0,320}\}\);\s*oauthLoginPromiseRef\.current = oauthLoginPromise;\s*oauthLoginPromise\s*\.then/,
  );
  assert.match(login, /catch \(e\) \{\s*if \(!isOnboardingAuthTransitionActive\(transitionToken\)\) return;/);
  assert.match(login, /finally \{\s*loginActionGateRef\.current\.end\(\);\s*if \(isOnboardingAuthTransitionActive\(transitionToken\)\) \{/);
  assert.match(
    login,
    /const result = await signInWithLoginId\([\s\S]*sessionAdoption: "deferred"[\s\S]*commitOnboardingAuthResult\(transitionToken, result, adoptAuthResult\)[\s\S]*if \(commitResult === "stale"\) return;[\s\S]*await onLoggedIn\(transitionToken\)/,
  );
});

test("로그인 요청과 세션 commit boundary 동안 back과 signup은 비활성화된다", () => {
  assert.match(onboarding, /getOnboardingAuthCommitSnapshot/);
  assert.match(onboarding, /if \(authCommitBoundaryActive\) return;[\s\S]*cancelOnboardingAuthTransitions\(\)/);
  assert.match(onboarding, /<RoleStep[\s\S]{0,120}busy=\{busy \|\| authCommitBoundaryActive\}/);
  assert.match(onboarding, /const loginNavigationLocked = isLoginNavigationLocked\(\{ busy, commitBoundaryActive \}\)/);
  assert.match(onboarding, /<BackButton onBack=\{onBack\} disabled=\{loginNavigationLocked\} \/>/);
  assert.match(onboarding, /onClick=\{\(\) => onSignup\(\{ kind: "phone" \}\)\}[\s\S]{0,120}disabled=\{loginNavigationLocked\}/);
});

test("세션 commit 전 역할을 다시 고르면 이전 pending 인증을 먼저 취소한다", () => {
  const roleStepStart = onboarding.indexOf("<RoleStep");
  const roleStepEnd = onboarding.indexOf("/>", roleStepStart);
  const roleStep = onboarding.slice(roleStepStart, roleStepEnd);

  assert.match(roleStep, /onParent=\{\(\) => \{[\s\S]*cancelOnboardingAuthTransitions\(\)/);
  assert.match(roleStep, /onChild=\{\(\) => \{[\s\S]*cancelOnboardingAuthTransitions\(\)/);
});

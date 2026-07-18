import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [weeklyReport, onboarding, requireGuest] = await Promise.all([
  readFile(new URL("../src/screens/feature/WeeklyFamilyReport.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/onboarding/Onboarding.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/auth/RequireGuest.tsx", import.meta.url), "utf8"),
]);

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
  assert.match(weeklyReport, /주간 리포트를 불러오지 못했어요/);
  assert.match(
    weeklyReport,
    /Promise\.all\(\[\s*eventsQuery\.refetch\(\),\s*suppliesQuery\.refetch\(\),\s*memoThread\.refetch\(\),\s*alertsQuery\.refetch\(\),?\s*\]\)/,
  );
});

test("가족 조회가 null로 성공한 경우에만 신규 가족 연결 단계로 이동한다", () => {
  const start = onboarding.indexOf("const routeAfterParentLogin = async (");
  const end = onboarding.indexOf("const routeAfterChildSession", start);
  const route = onboarding.slice(start, end);

  assert.ok(start >= 0 && end > start, "부모 로그인 후 라우팅 함수가 필요합니다");
  assert.match(route, /const fam = await getMyFamily\(\)/);
  assert.match(route, /if \(fam === null\) \{[\s\S]*setStep\("connect"\)/);
  assert.match(route, /navigate\("\/parent\/home"\)/);
});

test("가족 조회 실패는 연결 단계로 보내지 않고 기존 로그인 오류 처리로 전달한다", () => {
  const start = onboarding.indexOf("const routeAfterParentLogin = async (");
  const end = onboarding.indexOf("const routeAfterChildSession", start);
  const route = onboarding.slice(start, end);
  const connectIndex = route.indexOf('setStep("connect")');
  const catchIndex = route.indexOf("catch");

  assert.ok(connectIndex >= 0 && catchIndex > connectIndex, "connect 이동은 null 성공 분기 안에 있어야 합니다");
  assert.match(
    route,
    /catch[\s\S]*throw new Error\("가족 정보를 확인하지 못했어요\. 다시 시도해 주세요\."\)/,
  );
  assert.match(
    onboarding,
    /await onLoggedIn\(transitionToken\);[\s\S]{0,120}catch \(e\) \{[\s\S]{0,120}show\(errMsg\(e\), "⚠️"\)/,
  );
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

test("ID 로그인과 OAuth callback은 세션 채택 전에 인증 전환 gate를 시작한다", () => {
  const loginStart = onboarding.indexOf("const loginIdPw = async () => {");
  const loginEnd = onboarding.indexOf("return (", loginStart);
  const login = onboarding.slice(loginStart, loginEnd);
  const loginBegin = login.indexOf("const transitionToken = beginOnboardingAuthTransition()");
  const signIn = login.indexOf("signInWithLoginId(");

  const callbackStart = onboarding.indexOf("const cb = readOAuthCallback();");
  const callbackEnd = onboarding.indexOf("// eslint-disable-next-line", callbackStart);
  const callback = onboarding.slice(callbackStart, callbackEnd);
  const callbackBegin = callback.indexOf("const transitionToken = beginOnboardingAuthTransition()");
  const finishOAuth = callback.indexOf("finishOAuthLogin(cb)");

  assert.ok(loginBegin >= 0 && signIn > loginBegin, "ID 로그인 전에 gate를 시작해야 합니다");
  assert.ok(callbackBegin >= 0 && finishOAuth > callbackBegin, "OAuth 교환 전에 gate를 시작해야 합니다");
});

test("가족 판정 성공과 null은 active token 완료가 확인된 뒤에만 UI를 바꾼다", () => {
  const start = onboarding.indexOf("const routeAfterParentLogin = async (");
  const end = onboarding.indexOf("const routeAfterChildSession", start);
  const route = onboarding.slice(start, end);
  const catchBlock = route.match(/catch\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
  const completeCalls = route.match(/completeOnboardingAuthTransitionsThrough\(transitionToken\)/g) ?? [];

  assert.match(route, /routeAfterParentLogin = async \(transitionToken: OnboardingAuthTransitionToken\)/);
  assert.equal(completeCalls.length, 1, "가족 응답 뒤 현재 token 완료를 한 번만 판정해야 합니다");
  assert.match(route, /if \(!isOnboardingAuthTransitionActive\(transitionToken\)\) return;[\s\S]*syncFromSession\(\)/);
  assert.match(route, /const completed = completeOnboardingAuthTransitionsThrough\(transitionToken\);\s*if \(!completed\) return;/);
  assert.match(route, /if \(!completed\) return;[\s\S]*setBusy\(false\)[\s\S]*if \(fam === null\)[\s\S]*setStep\("connect"\)/);
  assert.match(route, /if \(!completed\) return;[\s\S]*navigate\("\/parent\/home"\)/);
  assert.doesNotMatch(catchBlock, /OnboardingAuthTransition/);
});

test("부모 로그인에서 back·signup·인증 시작 실패로 이탈하면 gate를 해제한다", () => {
  assert.match(onboarding, /onBack=\{\(\) => \{[\s\S]{0,160}cancelOnboardingAuthTransitions\(\)[\s\S]{0,160}back\(\)/);
  assert.match(onboarding, /onSignup=\{\(\) => \{[\s\S]{0,200}cancelOnboardingAuthTransitions\(\)/);
  assert.match(
    onboarding,
    /catch \(e\) \{\s*if \(!isOnboardingAuthTransitionActive\(transitionToken\)\) return;[\s\S]{0,180}show\(errMsg\(e\), "⚠️"\)[\s\S]{0,180}setBusy\(false\);[\s\S]{0,120}endOnboardingAuthTransition\(transitionToken\)/,
  );
});

test("인증 채택 전 실패는 자신이 시작한 token만 끝내고 명시적 OAuth 취소는 전체 gate를 취소한다", () => {
  assert.match(
    onboarding,
    /if \(!sessionAdopted\) endOnboardingAuthTransition\(transitionToken\)/,
  );
  assert.match(
    onboarding,
    /finishOAuthCancellation\(cancellation\)[\s\S]{0,240}cancelOnboardingAuthTransitions\(\)/,
  );
  assert.match(onboarding, /await routeAfterParentLogin\(transitionToken\)/);
  assert.match(onboarding, /await onLoggedIn\(transitionToken\)/);
});

test("stale OAuth·ID continuation은 toast·step·busy를 바꾸지 않고 StrictMode cleanup이 token을 끝낸다", () => {
  const callbackStart = onboarding.indexOf("const cb = readOAuthCallback();");
  const callbackEnd = onboarding.indexOf("// eslint-disable-next-line", callbackStart);
  const callback = onboarding.slice(callbackStart, callbackEnd);
  const loginStart = onboarding.indexOf("const loginIdPw = async () => {");
  const loginEnd = onboarding.indexOf("return (", loginStart);
  const login = onboarding.slice(loginStart, loginEnd);

  assert.match(callback, /if \(!isOnboardingAuthTransitionActive\(transitionToken\)\) \{[\s\S]*return;[\s\S]*\}/);
  assert.match(callback, /catch\(\(e\) => \{[\s\S]*isOnboardingAuthTransitionActive\(transitionToken\)[\s\S]*if \(!canApplySideEffects\) return;/);
  assert.match(callback, /finally\(\(\) => \{\s*if \(isOnboardingAuthTransitionActive\(transitionToken\)\) setBusy\(false\);\s*\}\)/);
  assert.match(callback, /return \(\) => endOnboardingAuthTransition\(transitionToken\)/);
  assert.match(
    onboarding,
    /const oauthLoginPromiseRef = useRef<ReturnType<typeof finishOAuthLogin> \| null>\(null\)/,
  );
  assert.match(
    callback,
    /const oauthLoginPromise = oauthLoginPromiseRef\.current \?\? finishOAuthLogin\(cb\);\s*oauthLoginPromiseRef\.current = oauthLoginPromise;\s*oauthLoginPromise\s*\.then/,
  );
  assert.match(login, /catch \(e\) \{\s*if \(!isOnboardingAuthTransitionActive\(transitionToken\)\) return;/);
  assert.match(login, /finally \{\s*if \(isOnboardingAuthTransitionActive\(transitionToken\)\) \{/);
  assert.match(
    login,
    /await signInWithLoginId\(\{ loginId, password \}\);\s*if \(!isOnboardingAuthTransitionActive\(transitionToken\)\) return;\s*sessionAdopted = true;\s*await onLoggedIn\(transitionToken\)/,
  );
});

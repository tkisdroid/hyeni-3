import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const readOptional = (relativePath) => {
  const url = new URL(relativePath, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
};

const onboarding = readOptional("../src/screens/onboarding/Onboarding.tsx");
const onboardingCss = readOptional("../src/screens/onboarding/Onboarding.css");
const busyLabel = readOptional("../src/components/ui/BusyLabel.tsx");
const busyLabelCss = readOptional("../src/components/ui/BusyLabel.css");
const loadingCss = readOptional("../src/components/ui/Loading.css");
const globalCss = readOptional("../src/styles/global.css");
const dangerZone = readOptional("../src/screens/feature/DangerZoneForm.tsx");
const authEndpoint = readOptional("../src/lib/api/endpoints/auth.ts");
const koOnboarding = JSON.parse(readOptional("../locales/ko/onboarding.json"));

test("로그인 오류는 각 입력과 연결되고 첫 오류 필드로 초점을 옮긴다", () => {
  assert.match(onboarding, /validateLoginForm/);
  assert.match(onboarding, /loginIdInputRef/);
  assert.match(onboarding, /passwordInputRef/);
  assert.match(onboarding, /aria-invalid=\{Boolean\(errors\.loginId\)\}/);
  assert.match(onboarding, /aria-describedby=\{errors\.loginId \? "ob-login-id-error" : undefined\}/);
  assert.match(onboarding, /id="ob-login-id-error"[\s\S]{0,120}role="alert"/);
  assert.match(onboarding, /aria-invalid=\{Boolean\(errors\.password\)\}/);
  assert.match(onboarding, /aria-describedby=\{errors\.password \? "ob-login-password-error" : undefined\}/);
  assert.match(onboarding, /id="ob-login-password-error"[\s\S]{0,120}role="alert"/);
  assert.match(onboarding, /validationErrors\.loginId[\s\S]{0,180}loginIdInputRef\.current\?\.focus\(\)/);
  assert.match(onboarding, /validationErrors\.password[\s\S]{0,180}passwordInputRef\.current\?\.focus\(\)/);
  assert.match(onboardingCss, /\.ob-field-error\s*\{/);
});

test("유효하지 않은 로그인은 busy 전환과 API 호출 전에 종료한다", () => {
  const start = onboarding.indexOf("const loginIdPw = async () => {");
  const end = onboarding.indexOf("return (", start);
  assert.ok(start >= 0 && end > start, "ID 로그인 핸들러가 필요합니다");
  const handler = onboarding.slice(start, end);
  const validation = handler.indexOf("validateLoginForm(");
  const earlyReturn = handler.indexOf("return;", validation);
  const busy = handler.indexOf("setBusy(true)");
  const request = handler.indexOf("signInWithLoginId(");

  assert.ok(validation >= 0, "API 전 로그인 폼 검증이 필요합니다");
  assert.ok(earlyReturn > validation, "유효하지 않은 폼은 즉시 종료해야 합니다");
  assert.ok(busy > earlyReturn, "폼 검증 전 busy 전환을 시작하면 안 됩니다");
  assert.ok(request > earlyReturn, "폼 검증 전 로그인 API를 호출하면 안 됩니다");
});

test("BusyLabel은 장식 스피너를 숨기고 진행 문구를 보조기기에 전달한다", () => {
  assert.match(busyLabel, /busy: boolean/);
  assert.match(busyLabel, /idle: string/);
  assert.match(busyLabel, /pending: string/);
  assert.match(busyLabel, /aria-live="polite"/);
  assert.match(busyLabel, /aria-hidden="true"/);
  assert.match(busyLabel, /\{pending\}/);
  assert.match(busyLabelCss, /@keyframes hy-busy-label-spin/);
  assert.match(busyLabelCss, /prefers-reduced-motion: reduce/);
});

test("ID·소셜·가입 확인 버튼은 중복 실행을 막은 채 BusyLabel을 사용한다", () => {
  assert.match(onboarding, /import \{ BusyLabel \} from "@\/components\/ui\/BusyLabel"/);
  for (const [idleId, pendingId, idleText, pendingText] of [
    ["onboarding.login.submit", "onboarding.login.pending", "로그인", "로그인 중…"],
    // 소셜 버튼은 탭(intent)에 따라 로그인/가입 라벨을 바꿔 쓴다 — 화면의 조건부 id를 함께 고정한다.
    ["onboarding.login.kakao", "onboarding.login.kakaoPending", "카카오로 계속하기", "카카오 로그인 중…"],
    ["onboarding.login.google", "onboarding.login.googlePending", "Google로 계속하기", "Google 로그인 중…"],
    ["onboarding.login.naver", "onboarding.login.naverPending", "네이버로 계속하기", "네이버 로그인 중…"],
    ["onboarding.signup.kakao", null, "카카오로 가입하기", null],
    ["onboarding.signup.google", null, "Google로 가입하기", null],
    ["onboarding.signup.naver", null, "네이버로 가입하기", null],
    ["onboarding.signup.verify", "onboarding.signup.verifying", "인증하고 가입 완료", "가입 확인 중…"],
  ]) {
    assert.match(onboarding, new RegExp(`"${idleId.replaceAll(".", "\\.")}"`));
    assert.equal(koOnboarding[idleId], idleText);
    if (pendingId) {
      assert.match(onboarding, new RegExp(`idle=\\{intl\\.formatMessage\\(\\{[\\s\\S]{0,200}id: "${pendingId.replaceAll(".", "\\.")}" \\}\\)\\}`));
      assert.equal(koOnboarding[pendingId], pendingText);
    }
  }
  // 소셜 버튼은 signingUp 조건으로 로그인/가입 idle 문구를 갈아끼운다.
  for (const provider of ["kakao", "google", "naver"]) {
    const pattern = new RegExp(`id: signingUp \\? "onboarding\\.signup\\.${provider}" : "onboarding\\.login\\.${provider}"`);
    assert.match(onboarding, pattern);
  }
  assert.match(onboarding, /<form[\s\S]{0,180}onSubmit=\{\(event\) => \{[\s\S]{0,120}void loginIdPw\(\)/);
  assert.match(onboarding, /type="submit"[\s\S]{0,80}disabled=\{busy\}/);
  assert.match(onboarding, /onSubmit=\{\(event\) => \{[\s\S]{0,120}void verify\(\)/);
  assert.match(onboarding, /type="submit"[\s\S]{0,120}disabled=\{busy \|\| otpNeedsResend\}/);
});

test("로그인 요청 중에는 뒤로가기를 잠가 취소된 요청의 busy가 역할 화면에 남지 않는다", () => {
  const start = onboarding.indexOf("function LoginStep(");
  const end = onboarding.indexOf("/* ── STEP: SIGNUP", start);
  assert.ok(start >= 0 && end > start, "로그인 단계 구현이 필요합니다");
  const login = onboarding.slice(start, end);

  assert.match(login, /const loginNavigationLocked = isLoginNavigationLocked\(\{ busy, commitBoundaryActive \}\)/);
  assert.match(login, /<BackButton onBack=\{onBack\} disabled=\{loginNavigationLocked\} \/>/);
  assert.match(onboarding, /aria-disabled=\{disabled\}/);
  assert.match(onboardingCss, /\.ob-back:disabled\s*\{[\s\S]*opacity:/);
});

test("가입 발송·재전송·완료 확인은 각자 소유한 진행 문구만 표시한다", () => {
  const start = onboarding.indexOf("function SignupStep(");
  const end = onboarding.indexOf("/* ── STEP: CONNECT", start);
  assert.ok(start >= 0 && end > start, "가입 단계 구현이 필요합니다");
  const signup = onboarding.slice(start, end);

  assert.match(signup, /useState<AsyncActionToken<SignupPendingAction> \| null>\(null\)/);
  assert.match(signup, /createAsyncActionController<SignupPendingAction>\(\)/);
  assert.match(signup, /const beginSignupAction = \(action: SignupPendingAction\): AsyncActionToken<SignupPendingAction>[\s\S]{0,300}return token/);
  assert.match(signup, /const requestToken = beginSignupAction\("request-code"\)/);
  assert.match(signup, /const requestToken = beginSignupAction\("verify"\)/);
  assert.equal((signup.match(/runOwnedAsyncAction\(\{/g) ?? []).length, 2);
  assert.match(signup, /<BackButton onBack=\{\(\) => setPhase\("form"\)\} disabled=\{busy\} \/>/);
  assert.match(signup, /<BackButton onBack=\{onBack\} disabled=\{busy\} \/>/);
  assert.match(signup, /id: "onboarding\.signup\.requestOtp"[\s\S]{0,120}id: "onboarding\.signup\.requestingOtp"/);
  assert.match(signup, /id: "onboarding\.signup\.resend"[\s\S]{0,120}id: "onboarding\.signup\.resending"/);
  assert.match(signup, /id: "onboarding\.signup\.verify"[\s\S]{0,120}id: "onboarding\.signup\.verifying"/);
  assert.match(signup, /isAsyncActionTokenFor\(pendingSignupAction, "request-code"\)/);
  assert.match(signup, /isAsyncActionTokenFor\(pendingSignupAction, "verify"\)/);
});

test("가입 성공·오류·finally와 세션 채택은 모두 고유 request token 경계 안에 있다", () => {
  const start = onboarding.indexOf("function SignupStep(");
  const end = onboarding.indexOf("/* ── STEP: CONNECT", start);
  const signup = onboarding.slice(start, end);

  assert.match(signup, /runOwnedAsyncAction\(\{[\s\S]*token: requestToken[\s\S]*onSuccess: \(result\) => \{[\s\S]*setPending\(result\)[\s\S]*setPhase\("otp"\)[\s\S]*show\(intl\.formatMessage\(\{ id: "onboarding\.toast\.otpSent" \}\)/);
  assert.match(signup, /verifyPhoneSignupCode\([\s\S]*\{ sessionAdoption: "deferred" \}[\s\S]*onSuccess: \(result\) => \{[\s\S]*adoptAuthResult\(result\)[\s\S]*show\(intl\.formatMessage\(\{ id: "onboarding\.toast\.signupComplete" \}\)[\s\S]*onDone\(name\)/);
  assert.match(signup, /onError: handleRequestCodeError/);
  assert.match(signup, /const handleRequestCodeError = \(error: unknown\) => \{[\s\S]{0,900}setFormError\(message\)[\s\S]{0,120}show\(message, "⚠️"\)/);
  assert.match(signup, /onError: \(error\) => \{[\s\S]{0,900}setOtpError\(message\)[\s\S]{0,900}show\(message, "⚠️"\)/);
  assert.equal(koOnboarding["onboarding.toast.otpSent"], "인증번호를 보냈어요");
  assert.equal(koOnboarding["onboarding.toast.signupComplete"], "가입이 완료됐어요");
  assert.equal((signup.match(/onFinally: \(\) => finishSignupAction\(requestToken\)/g) ?? []).length, 2);
});

test("전화 가입 endpoint는 기본 즉시 채택을 유지하고 SignupStep만 deferred로 받는다", () => {
  const start = authEndpoint.indexOf("export async function verifyPhoneSignupCode");
  const end = authEndpoint.indexOf("/** 로그아웃", start);
  assert.ok(start >= 0 && end > start, "전화 가입 검증 endpoint가 필요합니다");
  const verifyEndpoint = authEndpoint.slice(start, end);

  assert.match(verifyEndpoint, /options\?: AuthResultAdoptionOptions/);
  assert.match(verifyEndpoint, /returnAuthResultWithAdoption\(data, options, adoptAuthResult\)/);
  assert.doesNotMatch(verifyEndpoint, /\badoptAuthResult\(data\)/);
});

test("잘못된 비밀번호는 입력을 지우지 않고 고정 오류를 보여준 뒤 비밀번호 칸에 초점을 돌린다", () => {
  const start = onboarding.indexOf("function LoginStep(");
  const end = onboarding.indexOf("/* ── STEP: SIGNUP", start);
  const login = onboarding.slice(start, end);

  assert.match(login, /if \(isApiError\(e\) && e\.code === "invalid_credentials"\) \{\s*passwordInputRef\.current\?\.focus\(\)/);
  assert.match(login, /onAuthError\(message\)/);
  assert.match(login, /\{authError && \([\s\S]{0,100}<div className="ob-auth-alert" role="alert">/);
  assert.match(login, /value=\{loginId\}/);
  assert.match(login, /value=\{password\}/);
  assert.doesNotMatch(login, /catch \(e\)[\s\S]{0,500}setLoginId\(""\)/);
  assert.doesNotMatch(login, /catch \(e\)[\s\S]{0,500}setPassword\(""\)/);
});

test("ID 중복 확인 통신 실패는 사용 중 상태로 오인하지 않는다", () => {
  const start = onboarding.indexOf("const checkLoginId = async () => {");
  const end = onboarding.indexOf("const handleRequestCodeError", start);
  const check = onboarding.slice(start, end);

  assert.match(check, /catch \(error\) \{[\s\S]{0,250}setLoginIdAvailability\("error"\)/);
  assert.doesNotMatch(check, /catch \(error\) \{[\s\S]{0,250}setLoginIdAvailability\("taken"\)/);
  assert.match(onboarding, /error\.code === "login_id_taken"[\s\S]{0,180}setLoginIdAvailability\("taken"\)/);
});

test("visibility·pageshow는 외부 OAuth가 실제 열린 경우에만 busy를 해제한다", () => {
  const start = onboarding.indexOf("// OAuth/외부 브라우저에서 복귀 시 busy 잠금 자동 해제");
  const end = onboarding.indexOf("// QR 딥링크", start);
  assert.ok(start >= 0 && end > start, "OAuth 복귀 해제 effect가 필요합니다");
  const resumeEffect = onboarding.slice(start, end);

  assert.match(onboarding, /const oauthExternalBusyRef = useRef\(false\)/);
  assert.match(onboarding, /const \[oauthExternalBusy, setOAuthExternalBusy\] = useState\(false\)/);
  assert.match(onboarding, /const markOAuthExternalBusy = \(\) =>/);
  assert.match(onboarding, /const clearOAuthExternalBusy = \(\) =>/);
  assert.match(resumeEffect, /shouldReleaseOAuthBusyOnResume\(/);
  assert.match(resumeEffect, /oauthExternalBusyRef\.current/);
  assert.doesNotMatch(resumeEffect, /if \(document\.visibilityState === "visible"\) setBusy\(false\)/);

  const socialStart = onboarding.indexOf("const social = async");
  const socialEnd = onboarding.indexOf("const loginIdPw", socialStart);
  const social = onboarding.slice(socialStart, socialEnd);
  assert.match(social, /startWorkerOAuth\(provider, "login", \{ onExternalOpen: onOAuthExternalOpen \}\)/);
  assert.match(social, /onOAuthExternalEnd\(\)/);

  const endpointStart = authEndpoint.indexOf("export async function startWorkerOAuth");
  const endpointEnd = authEndpoint.indexOf("/** OAuth 콜백", endpointStart);
  const oauthStart = authEndpoint.slice(endpointStart, endpointEnd);
  assert.match(oauthStart, /options\?: OAuthStartOptions/);
  const callback = oauthStart.indexOf("options?.onExternalOpen?.()");
  const nativeOpen = oauthStart.indexOf("openExternal(startUrl)");
  const webOpen = oauthStart.indexOf("window.location.assign(startUrl)");
  assert.ok(callback >= 0 && nativeOpen > callback && webOpen > callback, "외부 열기 직전에 owner를 표시해야 합니다");
});

test("전역 키보드 초점과 로딩 문구는 눈으로 구분할 수 있다", () => {
  assert.match(globalCss, /:where\([^)]+\):focus-visible\s*\{/);
  assert.match(globalCss, /outline:\s*var\(--focus-ring-width\) solid var\(--focus-ring-color\)/);
  assert.match(globalCss, /outline-offset:\s*3px/);
  assert.match(loadingCss, /\.hy-loading__label\s*\{[\s\S]*font-size:\s*var\(--type-label\)/);
  assert.match(loadingCss, /\.hy-loading__label\s*\{[\s\S]*color:\s*var\(--fg-tertiary\)/);
});

test("위험구역 알림 switch는 보이는 라벨을 accessible name으로 사용한다", () => {
  assert.match(dangerZone, /id="danger-zone-entry-alert-label"[^>]*>\s*진입 시 알림/);
  assert.match(dangerZone, /aria-labelledby="danger-zone-entry-alert-label"/);
  assert.match(dangerZone, /id="danger-zone-exit-alert-label"[^>]*>\s*이탈 시 알림/);
  assert.match(dangerZone, /aria-labelledby="danger-zone-exit-alert-label"/);
});

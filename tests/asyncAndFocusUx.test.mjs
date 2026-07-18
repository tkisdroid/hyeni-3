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
  assert.match(onboarding, /idle="로그인" pending="로그인 중…"/);
  assert.match(onboarding, /idle="카카오로 계속하기" pending="카카오 로그인 중…"/);
  assert.match(onboarding, /idle="Google로 계속하기" pending="Google 로그인 중…"/);
  assert.match(onboarding, /idle="네이버로 계속하기" pending="네이버 로그인 중…"/);
  assert.match(onboarding, /idle="인증하고 가입 완료"[\s\S]{0,80}pending="가입 확인 중…"/);
  assert.match(onboarding, /onClick=\{loginIdPw\} disabled=\{busy\}/);
  assert.match(onboarding, /onClick=\{verify\} disabled=\{busy\}/);
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

  assert.match(signup, /useState<SignupPendingAction \| null>\(null\)/);
  assert.match(signup, /const beginSignupAction = \(action: SignupPendingAction\)[\s\S]{0,240}setBusy\(true\)/);
  assert.match(signup, /const finishSignupAction = \(action: SignupPendingAction\)[\s\S]{0,360}completeSignupPendingAction/);
  assert.match(signup, /beginSignupAction\("request-code"\)/);
  assert.match(signup, /beginSignupAction\("verify"\)/);
  assert.match(signup, /finally \{\s*finishSignupAction\("request-code"\)/);
  assert.match(signup, /finally \{\s*finishSignupAction\("verify"\)/);
  assert.match(signup, /<BackButton onBack=\{\(\) => setPhase\("form"\)\} disabled=\{busy\} \/>/);
  assert.match(signup, /<BackButton onBack=\{onBack\} disabled=\{busy\} \/>/);
  assert.match(signup, /idle="인증번호 받기"[\s\S]{0,80}pending="인증번호 전송 중…"/);
  assert.match(signup, /idle="재전송"[\s\S]{0,80}pending="재전송 중…"/);
  assert.match(signup, /idle="인증하고 가입 완료"[\s\S]{0,80}pending="가입 확인 중…"/);
  assert.match(signup, /isSignupActionPending\(pendingSignupAction, "request-code"\)/);
  assert.match(signup, /isSignupActionPending\(pendingSignupAction, "verify"\)/);
});

test("전역 키보드 초점과 로딩 문구는 눈으로 구분할 수 있다", () => {
  assert.match(globalCss, /:where\([^)]+\):focus-visible\s*\{/);
  assert.match(globalCss, /outline:\s*3px solid var\(--blue-500\)/);
  assert.match(globalCss, /outline-offset:\s*3px/);
  assert.match(loadingCss, /\.hy-loading__label\s*\{[\s\S]*font-size:\s*13px/);
  assert.match(loadingCss, /\.hy-loading__label\s*\{[\s\S]*color:\s*var\(--fg-tertiary\)/);
});

test("위험구역 알림 switch는 보이는 라벨을 accessible name으로 사용한다", () => {
  assert.match(dangerZone, /id="danger-zone-entry-alert-label"[^>]*>\s*진입 시 알림/);
  assert.match(dangerZone, /aria-labelledby="danger-zone-entry-alert-label"/);
  assert.match(dangerZone, /id="danger-zone-exit-alert-label"[^>]*>\s*이탈 시 알림/);
  assert.match(dangerZone, /aria-labelledby="danger-zone-exit-alert-label"/);
});

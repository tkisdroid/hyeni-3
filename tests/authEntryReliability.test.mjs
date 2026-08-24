import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const authClient = source("src/lib/api/endpoints/auth.ts");
const onboarding = source("src/screens/onboarding/Onboarding.tsx");
const onboardingCss = source("src/screens/onboarding/Onboarding.css");
const authWorker = source("worker/routes/auth.ts");
const phoneOtp = source("worker/lib/phoneOtp.ts");
const migration = source("worker/db/auth-entry-uniqueness.sql");

test("OAuth 웹 콜백은 정적 호스트에서 항상 SPA 엔트리로 복귀하고 캐시하지 않는다", () => {
  const redirects = source("public/_redirects");
  const headers = source("public/_headers");
  const packageJson = source("package.json");
  const callbackWriter = source("scripts/write-oauth-callback-entry.mjs");

  assert.doesNotMatch(redirects, /^\/oauth\/callback/m);
  assert.match(headers, /^\/oauth\/callback\s*\r?\n\s+Cache-Control: no-store$/m);
  assert.match(packageJson, /write-oauth-callback-entry\.mjs/);
  assert.match(callbackWriter, /distDir, "oauth", "callback\.html"/);
  assert.match(callbackWriter, /<base href="\/" \/>/);
  assert.match(callbackWriter, /replaceAll\('\="\.\/\', '\="\/\'\)/);
  assert.doesNotMatch(`${redirects}\n${authClient}`, /vercel/i);
});

test("인증 응답이 깨지면 성공으로 오인하지 않고 같은 화면에서 복구 가능한 오류로 닫는다", () => {
  assert.match(authClient, /typeof data\?\.available !== "boolean"[\s\S]{0,100}login_id_check_invalid/);
  assert.match(authClient, /sent\?\.ok !== true[\s\S]{0,100}signup_response_invalid/);
  assert.match(authClient, /!data\?\.user \|\| !data\?\.session\?\.access_token[\s\S]{0,100}login_response_invalid/);
  assert.match(authClient, /error\.code !== "signup_created_login_required"[\s\S]{0,250}signInWithLoginId/);
});

test("브라우저 저장소 하나만 허용돼도 OAuth transaction을 유지한다", () => {
  const start = authClient.indexOf("function writeOAuthContext");
  const end = authClient.indexOf("function takeOAuthContext", start);
  const writeContext = authClient.slice(start, end);

  assert.match(writeContext, /let written = 0/);
  assert.match(writeContext, /written \+= 1/);
  assert.match(writeContext, /if \(written === 0\)/);
  assert.doesNotMatch(writeContext, /written !== 2/);
});

test("회원가입과 로그인은 첫 화면에서 별도 탭과 명시적 전화 가입 동선으로 구분된다", () => {
  assert.match(onboarding, /role="tablist"/);
  assert.match(onboarding, /aria-selected=\{!signingUp\}/);
  assert.match(onboarding, /aria-selected=\{signingUp\}/);
  assert.match(onboarding, /id: "onboarding\.signup\.withPhone"/);
  assert.match(onboarding, /id: "onboarding\.login\.haveAccount"/);
});

test("휴대폰 번호 가입은 아이콘·보라색 없이 로즈 텍스트 CTA로 표시된다", () => {
  const buttonStart = onboarding.indexOf('className="ob-phone-signup');
  const buttonEnd = onboarding.indexOf("</button>", buttonStart);
  const button = onboarding.slice(buttonStart, buttonEnd);
  const styleStart = onboardingCss.indexOf(".ob-phone-signup {");
  const styleEnd = onboardingCss.indexOf("}", styleStart);
  const style = onboardingCss.slice(styleStart, styleEnd);

  assert.ok(buttonStart >= 0 && buttonEnd > buttonStart);
  assert.match(button, /id: "onboarding\.signup\.withPhone"/);
  assert.doesNotMatch(button, /<\w+/);
  assert.match(style, /height: var\(--control-height-primary\)/);
  assert.match(style, /background: var\(--rose-soft\)/);
  assert.match(style, /color: var\(--rose-text\)/);
  assert.doesNotMatch(style, /lav|purple|cta-grad-lavender/i);
  assert.doesNotMatch(onboardingCss, /\.ob-social--phone/);
});

test("가입 OTP는 설치·중복 검사를 통과한 뒤 user 생성과 같은 batch에서만 소비된다", () => {
  const routeStart = authWorker.indexOf('auth.post("/signup/verify"');
  const routeEnd = authWorker.indexOf("// POST /auth/anonymous", routeStart);
  const route = authWorker.slice(routeStart, routeEnd > routeStart ? routeEnd : undefined);
  const deviceCheck = route.indexOf('if (!signupDeviceId)');
  const phoneCheck = route.indexOf("isPhoneTaken");
  const loginIdCheck = route.indexOf("isLoginIdAvailable");
  const otpValidation = route.indexOf("validatePhoneOtp");
  const batch = route.indexOf("db.batch");
  const otpDelete = route.indexOf('DELETE FROM phone_otp WHERE phone=? AND code_hash=?');

  assert.ok(deviceCheck >= 0 && phoneCheck > deviceCheck && loginIdCheck > phoneCheck);
  assert.ok(otpValidation > loginIdCheck && batch > otpValidation && otpDelete > batch);
});

test("전화 OTP 발송과 계정 식별자는 UNIQUE 인덱스로 동시 요청을 선형화한다", () => {
  assert.match(authWorker, /auth\.use\("\*"[\s\S]{0,150}Cache-Control", "no-store"/);
  assert.match(authWorker, /LOWER\(TRIM\(login_id\)\) = \?/);
  assert.match(phoneOtp, /INSERT INTO phone_otp[\s\S]{0,350}ON CONFLICT\(phone\) DO UPDATE/);
  assert.match(phoneOtp, /WHERE phone_otp\.created_at<=\?/);
  for (const index of [
    "idx_users_phone_unique_nonempty",
    "idx_user_profiles_phone_unique_nonempty",
    "idx_user_profiles_login_id_unique_normalized",
    "idx_phone_otp_phone_unique",
  ]) {
    assert.match(migration, new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS ${index}`));
  }
});

test("앱이 아닌 브라우저에 떨어진 네이티브 OAuth 콜백은 교환 대신 앱 복귀 안내로 닫는다", () => {
  // 로컬 context가 없는 웹에서 code를 네트워크로 보내지 않는다 — 서버 트랜잭션은 소비되지 않고
  // 사용자는 앱에서 다시 시도하게 안내된다.
  const guardAt = onboarding.indexOf("if (!isNativePlatform() && !hasLocalOAuthContext())");
  assert.ok(guardAt > -1, "브라우저 낙하 콜백 가드가 없습니다");
  const cbAt = onboarding.indexOf("const cb = readOAuthCallback();");
  assert.ok(cbAt > -1 && guardAt > cbAt, "콜백 감지 직후 가드가 있어야 합니다");
  const guardBlock = onboarding.slice(guardAt, onboarding.indexOf("}", guardAt));
  assert.match(guardBlock, /id: "onboarding\.oauth\.returnToApp"/);
  assert.match(guardBlock, /clearOAuthCallbackUrl\(\)/);
  assert.doesNotMatch(guardBlock, /finishOAuthLogin/);
  // 가드가 finishOAuthLogin 호출보다 앞서야 한다.
  const exchangeAt = onboarding.indexOf("finishOAuthLogin(cb");
  assert.ok(exchangeAt > guardAt);
  // auth.ts 는 소비하지 않는 읽기 전용 peek 을 노출한다.
  assert.match(authClient, /export function hasLocalOAuthContext\(\): boolean \{[\s\S]{0,80}readOAuthContext\(\) !== null/);
});

test("Android 기기 식별자는 콜드 스타트 브리지 경합을 짧게 재시도해 흡수한다", () => {
  const identity = source("src/lib/native/deviceIdentity.ts");
  assert.match(identity, /async function resolveAndroidDeviceInstallId\(\): Promise<string \| null> \{/);
  const fnStart = identity.indexOf("async function resolveAndroidDeviceInstallId");
  const fnEnd = identity.indexOf("async function readNativePushContext", fnStart);
  assert.ok(fnStart > -1 && fnEnd > fnStart, "helper 함수 경계를 찾지 못했습니다");
  const fn = identity.slice(fnStart, fnEnd);
  // 루프로 재시도하며, 실패해도 null로 끝나는 fail-closed를 유지한다.
  assert.match(fn, /for \(const delayMs of \[0, 150, 400\] as const\) \{[\s\S]{0,200}readNativePushContext\(\)[\s\S]{0,120}if \(id\) return id;/s);
  assert.match(fn, /return null;/, "실패는 여전히 fail-closed여야 합니다");
});
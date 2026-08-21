import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const authClient = source("src/lib/api/endpoints/auth.ts");
const onboarding = source("src/screens/onboarding/Onboarding.tsx");
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

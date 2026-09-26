import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `${selector} CSS 블록을 찾지 못했습니다`);
  return match[1];
}

test("역할 선택 약관 링크는 문장 안에서도 44px 터치 영역을 제공한다", () => {
  const css = source("src/screens/onboarding/Onboarding.css");
  const link = cssBlock(css, ".ob-role-terms a");

  assert.match(link, /display:\s*inline-flex\s*;/);
  assert.match(link, /align-items:\s*center\s*;/);
  assert.match(link, /min-width:\s*var\(--control-min-size\)\s*;/);
  assert.match(link, /min-height:\s*var\(--control-min-size\)\s*;/);
});

test("온보딩과 권한 안내의 작은 아이콘은 승인된 16px·24px 척도를 쓴다", () => {
  const onboarding = source("src/screens/onboarding/Onboarding.tsx");
  const denied = source("src/screens/feature/PermDenied.tsx");

  assert.match(onboarding, /<Camera\s+size=\{16\}\s+strokeWidth=\{2\.4\}/);
  assert.doesNotMatch(onboarding, /<Camera\s+size=\{15\}/);
  assert.equal((denied.match(/size=\{24\}/g) ?? []).length, 4);
  assert.doesNotMatch(denied, /size=\{26\}/);
});

test("권한 예정 배지는 인라인 스타일 없이 caption 토큰 묶음을 쓴다", () => {
  const onboarding = source("src/screens/onboarding/Onboarding.tsx");
  const css = source("src/screens/onboarding/Onboarding.css");
  const badge = cssBlock(css, ".ob-perm-check");
  const badgeTag = /<span\s+className="ob-perm-check"[^>]*>/s.exec(onboarding)?.[0] ?? "";

  assert.ok(badgeTag, "권한 예정 배지를 찾지 못했습니다");
  assert.doesNotMatch(badgeTag, /style=\{/);
  assert.match(badge, /font-size:\s*var\(--type-caption\)\s*;/);
  assert.match(badge, /line-height:\s*var\(--type-caption-line-height\)\s*;/);
  assert.match(badge, /font-weight:\s*var\(--type-caption-weight\)\s*;/);
  assert.match(badge, /background:\s*var\(--bg-page\)\s*;/);
  assert.match(badge, /color:\s*var\(--fg-muted\)\s*;/);
});

test("로그인 폼은 Android 비밀번호 관리자가 인식하는 표준 자동완성 계약을 제공한다", () => {
  const onboarding = source("src/screens/onboarding/Onboarding.tsx");
  const main = source("android/app/src/main/java/com/hyeni/calendar/MainActivity.java");
  const login = onboarding.slice(
    onboarding.indexOf("function LoginStep("),
    onboarding.indexOf("function SignupStep("),
  );

  assert.match(login, /<form[\s\S]*?className="ob-login-form"[\s\S]*?autoComplete="on"[\s\S]*?onSubmit=/);
  assert.match(login, /name="username"[\s\S]*?autoComplete="username"/);
  assert.match(login, /name="password"[\s\S]*?autoComplete="current-password"/);
  assert.match(login, /<button type="submit" className="ob-loginbtn/);
  assert.doesNotMatch(login, /<button type="button" className="ob-loginbtn/);
  assert.match(main, /configureWebViewAutofill\(\);/);
  assert.match(main, /setImportantForAutofill\(View\.IMPORTANT_FOR_AUTOFILL_YES\)/);
  assert.match(main, /setSaveFormData\(true\)/);
});

test("온보딩은 Safari 가로 끌림을 잠그고 브라우저·Android safe area를 같은 규칙으로 계산한다", () => {
  const global = source("src/styles/global.css");
  const css = source("src/screens/onboarding/Onboarding.css");

  assert.match(global, /html,\s*\nbody\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(global, /#root\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /\.ob-step\s*\{[^}]*padding:\s*calc\(env\(safe-area-inset-top, 0px\) \+ 16px\) 16px/s);
  assert.match(css, /\.ob-role\s*\{[^}]*padding-top:\s*calc\(env\(safe-area-inset-top, 0px\) \+ 24px\)/s);
  assert.match(css, /\.ob-role\s*\{[^}]*padding-right:\s*24px[^}]*padding-left:\s*24px/s);
  assert.match(css, /\.ob-step\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /\.ob-step\s*\{[^}]*animation:\s*hy-fadeup/s);
  assert.doesNotMatch(css, /\.ob-(?:login|survey|signup|connect|pairing|perms)\s*\{[^}]*hy-slidein/s);
});

test("가입 전 단계는 같은 헤더·밝은 표면을 쓰고 QR 실행 영역만 어둡게 남긴다", () => {
  const onboarding = source("src/screens/onboarding/Onboarding.tsx");
  const css = source("src/screens/onboarding/Onboarding.css");

  for (const className of ["ob-login-head", "ob-survey-head", "ob-signup-head", "ob-connect-head", "ob-pair-head", "ob-perms-head"]) {
    assert.match(onboarding, new RegExp(`className="${className} ob-step-head"`), `${className}: 공통 헤더 누락`);
  }
  assert.match(css, /\.ob-step-head\s*\{[^}]*grid-template-columns:\s*56px minmax\(0, 1fr\)/s);
  // 2026-09-26: 가족 연결 단계의 시간대·이용 국가 판도 같은 유리로 칠한다.
  assert.match(css, /:is\(\.ob-role-card, \.ob-survey-card, \.ob-connect-card, \.ob-perm, \.ob-referral-notice, \.ob-connect \.hy-tz, \.ob-connect \.study-country-card\)/);
  assert.match(css, /\.ob-qr\s*\{[^}]*background:\s*#0c0a0a/s);
  assert.match(onboarding, /className="ob-input ob-pair-code-input"/);
  assert.doesNotMatch(onboarding, /ob-pair-code-input[^>]*style=\{/s);
});

test("좁은 화면의 온보딩 설문 제목은 한국어 어절을 보존하고 긴 번역만 안전하게 접는다", () => {
  const css = source("src/screens/onboarding/Onboarding.css");
  const title = cssBlock(css, ".ob-survey-head .ob-signup-title");

  assert.match(title, /word-break:\s*keep-all\s*;/);
  assert.match(title, /overflow-wrap:\s*anywhere\s*;/);
});

test("역할 카드의 의미 색상은 인라인 값이 아니라 공용 디자인 토큰으로 관리한다", () => {
  const onboarding = source("src/screens/onboarding/Onboarding.tsx");
  const css = source("src/screens/onboarding/Onboarding.css");
  const roleStep = onboarding.slice(
    onboarding.indexOf("function RoleStep("),
    onboarding.indexOf("function TeacherStep("),
  );

  assert.doesNotMatch(roleStep, /className="ob-role-(?:name|desc)"\s+style=/);
  assert.doesNotMatch(roleStep, /<ChevronRight[^>]*\bcolor=/);
  assert.match(css, /\.ob-role-card--parent\s*\{[^}]*--ob-role-title:\s*var\(--blue-text\)/s);
  assert.match(css, /\.ob-role-card--child\s*\{[^}]*--ob-role-title:\s*var\(--lav-text\)/s);
  assert.match(css, /\.ob-role-card--teacher\s*\{[^}]*--ob-role-title:\s*var\(--mint-text\)/s);
  assert.match(css, /\.ob-role-card\s*>\s*svg\s*\{[^}]*color:\s*var\(--ob-role-chevron\)/s);
});

test("기존 가족 연결 실패는 화면 안에 남고 입력을 고치면 즉시 해제된다", () => {
  const onboarding = source("src/screens/onboarding/Onboarding.tsx");

  assert.match(onboarding, /const \[pairingError, setPairingError\] = useState<string \| null>\(null\)/);
  assert.match(onboarding, /className="ob-auth-alert" role="alert"/);
  assert.match(onboarding, /onChange=\{\(e\) => \{[\s\S]{0,160}setPairingError\(null\)/);
  assert.match(onboarding, /const message = localizeApiError\(e, intl, mode === "child" \? "child" : "formal"\)[\s\S]{0,120}setPairingError\(message\)/);
});

test("첫 화면 언어 판은 판 하나이고 빈 생년월일 칸은 안내 문구를 보인다", () => {
  // 2026-09-26 제보: 흰 카드 안 회색 알약 + 흰 목록 카드가 겹쳐 "깨져 보였다". 빈 date 칸은 빈 상자로만 보였다.
  const languageCss = source("src/components/LanguageSelector.css");
  const languageTsx = source("src/components/LanguageSelector.tsx");
  const onboarding = source("src/screens/onboarding/Onboarding.tsx");
  const wizard = source("src/screens/feature/PairingWizard.tsx");
  assert.match(languageCss, /\.hy-language--collapse-others\s*\{[^}]*background:\s*var\(--ph-glass-fill/s);
  assert.match(languageCss, /\.hy-language--collapse-others \.hy-language__options--list\s*\{[^}]*background:\s*none;[^}]*box-shadow:\s*none/s);
  assert.match(languageTsx, /scrollIntoView\(\{ block: "nearest", behavior: "smooth" \}\)/);
  assert.match(onboarding, /<DateField inputRef=\{birthdateInputRef\} placeholder=\{intl\.formatMessage\(\{ id: "onboarding\.field\.birthdatePlaceholder" \}\)\}/);
  assert.match(wizard, /<DateField[\s\S]{0,120}parent\.pairingWizard\.birthdatePlaceholder/);
  assert.doesNotMatch(onboarding, /className="ob-input" type="date"/);
});

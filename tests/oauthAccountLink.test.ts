import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const auth = readFileSync(new URL("../src/lib/api/endpoints/auth.ts", import.meta.url), "utf8");
const deepLink = readFileSync(new URL("../src/lib/native/oauthDeepLink.ts", import.meta.url), "utf8");
const screen = readFileSync(new URL("../src/screens/parent/SocialLinks.tsx", import.meta.url), "utf8");

test("OAuth 시작 시 흐름(login/link)을 저장하고, 콜백에서 그대로 읽는다", () => {
  assert.match(auth, /startWorkerOAuth\(provider: OAuthProvider, mode: OAuthFlowMode = "login"\)/);
  assert.match(auth, /writeOAuthNonce\(nonce, provider, mode\)/);
  assert.match(auth, /export function peekOAuthFlowMode\(\): OAuthFlowMode/);
  assert.match(deepLink, /const mode = peekOAuthFlowMode\(\)/);
});

test("link 모드는 세션을 바꾸지 않는다(로그인 교환·홈 이동 금지)", () => {
  const linkBranch = deepLink.slice(deepLink.indexOf('if (mode === "link")'), deepLink.indexOf("await finishOAuthLogin(cb)"));
  assert.match(linkBranch, /await linkOAuthAccount\(cb\)/);
  assert.ok(!linkBranch.includes("routeToHomeAfterLogin"), "연결 흐름은 홈으로 이동하면 안 된다");
  assert.ok(!linkBranch.includes("finishOAuthLogin"), "연결 흐름은 세션을 교체하면 안 된다");
});

test("연결 API 는 인증된 /link 엔드포인트를 부르고 nonce 를 대조한다", () => {
  assert.match(auth, /apiRequest\(`\/api\/auth\/oauth\/\$\{input\.provider\}\/link`/);
  const fn = auth.slice(auth.indexOf("export async function linkOAuthAccount"), auth.indexOf("/** 현재 URL 쿼리에서 OAuth 콜백"));
  assert.match(fn, /const savedNonce = takeOAuthNonce\(\)/);
  assert.match(fn, /savedNonce !== input\.state[\s\S]{0,120}throw new Error/);
});

test("서버가 지원하지 않는 provider 연결은 시작하지 않는다(네이버는 로그인만)", () => {
  assert.match(auth, /export const LINKABLE_PROVIDERS: readonly OAuthProvider\[\] = \["kakao", "google"\]/);
  assert.match(auth, /if \(!LINKABLE_PROVIDERS\.includes\(input\.provider\)\)[\s\S]{0,120}throw new Error/);
});

test("연결 화면은 네이티브에서만 활성화되고, 연결된 provider 도 다른 계정을 추가할 수 있다", () => {
  assert.match(screen, /const native = isNativePlatform\(\)/);
  assert.match(screen, /disabled=\{!native \|\| isLoading \|\| busy === provider\}/);
  assert.ok(!screen.includes("isLinked || busy === provider"), "연결됨이라고 잠그면 다른 계정을 못 붙인다");
  assert.match(screen, /소셜 계정 연결은 안드로이드 앱에서 할 수 있어요/);
  assert.match(screen, /다른 소셜 계정을 추가로 연결합니다/);
});

test("연결 결과는 이벤트로 화면에 전달된다(딥링크 복귀 시 화면을 모른다)", () => {
  assert.match(deepLink, /export const OAUTH_LINK_EVENT = "hyeni:oauth-link"/);
  assert.match(deepLink, /window\.dispatchEvent\(\s*new CustomEvent\(OAUTH_LINK_EVENT/);
  assert.match(screen, /window\.addEventListener\(OAUTH_LINK_EVENT, onLinked\)/);
  assert.match(screen, /window\.removeEventListener\(OAUTH_LINK_EVENT, onLinked\)/);
});

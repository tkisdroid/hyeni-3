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
  assert.match(screen, /소셜 계정 연결은 안드로이드 앱에서 할 수 있어요/);
  assert.match(screen, /hasAny \? "다른 계정 연결" : "연결하기"/);
});

test("연결된 계정은 provider 가 아니라 계정 단위로 보여준다(구글 2개 등)", () => {
  assert.match(screen, /links\.map\(\(link, index\)/);
  assert.match(screen, /function linkKey\(link: OAuthLink\)[\s\S]{0,120}\$\{link\.provider\}:\$\{link\.providerId\}/);
});

test("마지막 로그인 수단이면 해제 버튼을 잠근다", () => {
  assert.match(screen, /const canUnlink = \(data\?\.hasPasswordLogin \?\? false\) \|\| links\.length > 1/);
  assert.match(screen, /disabled=\{!canUnlink \|\| busy === key\}/);
  assert.match(screen, /유일한 로그인 수단이라 해제할 수 없어요/);
});

test("해제는 한 번 더 확인받는다(오탭 방지)", () => {
  assert.match(screen, /if \(confirming !== key\) \{\s*setConfirming\(key\);\s*return;/);
  assert.match(screen, /정말 해제할까요\?/);
});

test("해제 API 는 provider_id 로 대상 연결을 특정한다", () => {
  assert.match(auth, /export function unlinkOAuthAccount/);
  assert.match(auth, /apiRequest\(`\/api\/auth\/oauth\/\$\{input\.provider\}\/unlink`/);
  assert.match(auth, /body: JSON\.stringify\(\{ provider_id: input\.providerId \}\)/);
});

test("연결 결과는 이벤트로 화면에 전달된다(딥링크 복귀 시 화면을 모른다)", () => {
  assert.match(deepLink, /export const OAUTH_LINK_EVENT = "hyeni:oauth-link"/);
  assert.match(deepLink, /window\.dispatchEvent\(\s*new CustomEvent\(OAUTH_LINK_EVENT/);
  assert.match(screen, /window\.addEventListener\(OAUTH_LINK_EVENT, onLinked\)/);
  assert.match(screen, /window\.removeEventListener\(OAUTH_LINK_EVENT, onLinked\)/);
});

test("계정 화면 안내문이 실제 동작과 맞는다(해제 가능한데 '해당 서비스에서 관리' 금지)", () => {
  const account = readFileSync(new URL("../src/screens/parent/ParentAccount.tsx", import.meta.url), "utf8");
  assert.ok(!account.includes("연동된 소셜 계정은 해당 서비스에서 관리돼요"));
  assert.match(account, /소셜 로그인은 아래에서 연결하거나 해제할 수 있어요/);
});

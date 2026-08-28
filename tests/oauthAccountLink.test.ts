import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const auth = readFileSync(new URL("../src/lib/api/endpoints/auth.ts", import.meta.url), "utf8");
const deepLink = readFileSync(new URL("../src/lib/native/oauthDeepLink.ts", import.meta.url), "utf8");
const screen = readFileSync(new URL("../src/screens/parent/SocialLinks.tsx", import.meta.url), "utf8");
const koParent = JSON.parse(readFileSync(new URL("../locales/ko/parent.json", import.meta.url), "utf8"));

test("OAuth 시작 시 흐름(login/link)을 저장하고, 콜백에서 그대로 읽는다", () => {
  assert.match(auth, /export async function startWorkerOAuth\([\s\S]{0,120}provider: OAuthProvider,[\s\S]{0,120}mode: OAuthFlowMode = "login"/);
  assert.match(auth, /writeOAuthContext\(\{[\s\S]{0,160}provider,[\s\S]{0,160}mode,[\s\S]{0,160}transactionSecret/);
  assert.match(auth, /export function peekMatchingOAuthFlowMode/);
  assert.match(deepLink, /const mode = peekMatchingOAuthFlowMode\(cb\)/);
});

test("link 모드는 세션을 바꾸지 않는다(로그인 교환·홈 이동 금지)", () => {
  const linkStart = deepLink.indexOf('if (mode === "link")');
  const linkBranch = deepLink.slice(linkStart, deepLink.indexOf("if (!pending)", linkStart));
  assert.match(linkBranch, /await linkOAuthAccount\(cb\)/);
  assert.ok(!linkBranch.includes("routeToHomeAfterLogin"), "연결 흐름은 홈으로 이동하면 안 된다");
  assert.ok(!linkBranch.includes("finishOAuthLogin"), "연결 흐름은 세션을 교체하면 안 된다");
});

test("연결 API는 인증된 /link를 부르고 서버 state·secret·mode를 모두 대조한다", () => {
  assert.match(auth, /apiRequest\(`\/api\/auth\/oauth\/\$\{input\.provider\}\/link`/);
  const fn = auth.slice(auth.indexOf("export async function linkOAuthAccount"), auth.indexOf("/** 현재 URL 쿼리에서 OAuth 콜백"));
  assert.match(fn, /const context = takeMatchingOAuthContext\(\{/);
  assert.match(fn, /mode: "link"[\s\S]{0,120}state: input\.state/);
  assert.match(fn, /transactionSecret: context\.transactionSecret/);
});

test("서버가 지원하지 않는 provider 연결은 시작하지 않는다(네이버는 로그인만)", () => {
  assert.match(auth, /export const LINKABLE_PROVIDERS: readonly OAuthProvider\[\] = \["kakao", "google"\]/);
  assert.match(auth, /if \(!LINKABLE_PROVIDERS\.includes\(input\.provider\)\)[\s\S]{0,120}throw new Error/);
});

test("연결 화면은 네이티브에서만 활성화되고, 연결된 provider 도 다른 계정을 추가할 수 있다", () => {
  assert.match(screen, /const native = isNativePlatform\(\)/);
  assert.match(screen, /disabled=\{!native \|\| isLoading \|\| busy !== null\}/);
  assert.match(screen, /parent\.socialLinks\.copy021/);
  assert.match(screen, /hasAny \? intl\.formatMessage\(\{ id: "parent\.socialLinks\.copy015" \}\) : intl\.formatMessage\(\{ id: "parent\.socialLinks\.copy016" \}\)/);
  assert.equal(koParent["parent.socialLinks.copy021"], "소셜 계정 연결은 안드로이드 앱에서 할 수 있어요.");
  assert.equal(koParent["parent.socialLinks.copy015"], "다른 계정 연결");
});

test("연결된 계정은 provider 가 아니라 계정 단위로 보여준다(구글 2개 등)", () => {
  assert.match(screen, /links\.map\(\(link, index\)/);
  assert.match(screen, /function linkKey\(link: OAuthLink\)[\s\S]{0,120}\$\{link\.provider\}:\$\{link\.providerId\}/);
});

test("마지막 로그인 수단이면 해제 버튼을 잠근다", () => {
  assert.match(screen, /const canUnlink = \(data\?\.hasPasswordLogin \?\? false\) \|\| links\.length > 1/);
  assert.match(screen, /disabled=\{!canUnlink \|\| busy !== null\}/);
  assert.match(screen, /parent\.socialLinks\.copy019/);
  assert.match(koParent["parent.socialLinks.copy019"], /유일한 로그인 수단이라 해제할 수 없어요/);
});

test("해제는 한 번 더 확인받는다(오탭 방지)", () => {
  assert.match(screen, /if \(confirming !== key\) \{\s*setConfirming\(key\);\s*return;/);
  assert.match(screen, /parent\.socialLinks\.copy009/);
  assert.equal(koParent["parent.socialLinks.copy009"], "정말 해제할까요?");
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

test("소셜 연결 브라우저를 뒤로 닫으면 앱 복귀 시 연결 중 잠금을 해제한다", () => {
  assert.match(screen, /const oauthExternalPendingRef = useRef\(false\)/);
  assert.match(screen, /const oauthResumeReleaseTimerRef = useRef/);
  assert.match(screen, /shouldReleaseOAuthBusyOnResume\(/);
  assert.match(screen, /window\.setTimeout/);
  assert.match(screen, /OAUTH_CALLBACK_DELIVERY_GRACE_MS/);
  assert.match(screen, /hasLocalOAuthContext\(\)/);
  assert.match(screen, /abandonPendingOAuth\(\)/);
  assert.match(screen, /OAUTH_DEEP_LINK_ACTIVITY_EVENT/);
  assert.match(screen, /detail\?\.mode !== "link"/);
  assert.match(screen, /document\.addEventListener\("visibilitychange", releaseOAuthBusy\)/);
  assert.match(screen, /window\.addEventListener\("pageshow", releaseOAuthBusy\)/);
  assert.match(screen, /startWorkerOAuth\(provider, "link", \{\s*onExternalOpen:/);
  assert.match(screen, /oauthExternalPendingRef\.current = false;[\s\S]{0,100}setBusy\(null\)/);
});

test("소셜 연결 재시도는 이전 transaction을 버리고 모든 연결 동작을 단일 gate로 직렬화한다", () => {
  assert.match(screen, /const actionPendingRef = useRef\(false\)/);
  const start = screen.slice(screen.indexOf("const startLink = async"), screen.indexOf("const unlink = async"));
  assert.match(start, /if \(actionPendingRef\.current\) return/);
  assert.match(start, /actionPendingRef\.current = true/);
  assert.match(start, /abandonPendingOAuth\(\)/);
  assert.ok(start.indexOf("abandonPendingOAuth()") < start.indexOf("startWorkerOAuth("));
  assert.match(screen, /disabled=\{!native \|\| isLoading \|\| busy !== null\}/);
  assert.match(screen, /disabled=\{!canUnlink \|\| busy !== null\}/);
});

test("OAuth 취소도 context를 검증·폐기하고 연결 화면 잠금을 해제한다", () => {
  assert.match(auth, /export function finishOAuthCancellation/);
  assert.match(auth, /const context = takeMatchingOAuthContext\(\{/);
  assert.match(deepLink, /parseOAuthCancellationUrl/);
  assert.match(deepLink, /finishOAuthCancellation/);
  assert.match(deepLink, /errorCode: "oauth_cancelled"/);
  assert.match(deepLink, /detail: \{ provider: cb\.provider, cancelled: true \}/);
  assert.match(deepLink, /errorCode: "oauth_cancellation_failed"/);
  assert.doesNotMatch(deepLink, /new Error\("소셜 로그인을 취소했어요/);
});

test("과거 callback은 현재 link transaction의 실패 이벤트로 전파하지 않는다", () => {
  assert.match(auth, /export function peekMatchingOAuthFlowMode/);
  const exchange = deepLink.slice(deepLink.indexOf("async function exchange"), deepLink.indexOf("async function cancel"));
  const cancel = deepLink.slice(deepLink.indexOf("async function cancel"), deepLink.indexOf("async function handleUrl"));
  assert.match(exchange, /const mode = peekMatchingOAuthFlowMode\(cb\);\s*if \(!mode\) return false;/);
  assert.match(cancel, /const matchedMode = peekMatchingOAuthFlowMode\(cb\);\s*if \(!matchedMode\) return false;/);
});

test("계정 화면 안내문이 실제 동작과 맞는다(해제 가능한데 '해당 서비스에서 관리' 금지)", () => {
  const account = readFileSync(new URL("../src/screens/parent/ParentAccount.tsx", import.meta.url), "utf8");
  assert.ok(!Object.values(koParent).includes("연동된 소셜 계정은 해당 서비스에서 관리돼요"));
  assert.match(account, /parent\.parentAccount\.copy022/);
  assert.equal(koParent["parent.parentAccount.copy022"], "소셜 로그인은 아래에서 연결하거나 해제할 수 있어요.");
});

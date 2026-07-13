import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n?/g, "\n");

function functionBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} 함수를 찾지 못했습니다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${startMarker} 함수의 끝을 찾지 못했습니다`);
  return source.slice(start, end);
}

test("앱 resume push context는 네이티브 최신 세션을 먼저 채택한 뒤 토큰을 쓴다", () => {
  const source = read("src/lib/native/push.ts");
  const fn = functionBody(source, "async function setNativePushContext", "/** FCM 토큰 취득");
  const reconcileAt = fn.indexOf("await adoptNativeLocationSessionTokens()");
  const writeAt = fn.indexOf("await plugin.setPushContext(");

  assert.ok(reconcileAt >= 0, "push context 쓰기 전 네이티브 세션 조정이 없습니다");
  assert.ok(writeAt > reconcileAt, "stale WebView 토큰을 먼저 쓰면 네이티브 최신 refresh가 유실됩니다");
});

test("위치 서비스 시작·즉시 요청·토큰 동기화는 모두 native-first 순서를 지킨다", () => {
  const source = read("src/lib/native/location.ts");
  const cases = [
    ["export async function startLocationTracking", "/**\n * 백그라운드 위치 서비스 중지", "await plugin.startService("],
    ["export async function requestImmediateLocation", "/**\n * WebView 가 access token", "await plugin.requestCurrentLocation("],
    ["export async function syncNativeLocationToken", "interface NativeRefreshResponse", "await plugin.updateToken("],
  ];

  for (const [start, end, write] of cases) {
    const fn = functionBody(source, start, end);
    const reconcileAt = fn.indexOf("await adoptNativeLocationSessionTokens()");
    const writeAt = fn.indexOf(write);
    assert.ok(reconcileAt >= 0, `${start}에 네이티브 세션 조정이 없습니다`);
    assert.ok(writeAt > reconcileAt, `${start}가 native-first 순서를 어겼습니다`);
  }
});

test("네이티브 세션 복구는 single-flight로 중복 refresh 회전을 막는다", () => {
  const source = read("src/lib/native/location.ts");
  assert.match(source, /let nativeSessionAdoptionInFlight: Promise<boolean> \| null = null;/);
  assert.match(source, /if \(nativeSessionAdoptionInFlight\) return nativeSessionAdoptionInFlight;/);
  assert.match(source, /nativeSessionAdoptionInFlight = .*\.finally\(/s);
});

test("직접 native 토큰 채택은 /family/mine으로 보정된 user 정본을 덮지 않는다", () => {
  const source = read("src/lib/native/location.ts");
  const start = source.indexOf("shouldAdoptNativeSessionTokens({");
  const end = source.indexOf("shouldRestoreNativeRefreshOnlySession({", start);
  assert.ok(start >= 0 && end > start, "direct adoption 분기를 찾지 못했습니다");
  const directAdoption = source.slice(start, end);
  assert.match(directAdoption, /setApiTokens\(\{ access: nativeAccess, refresh: nativeRefresh \}\)/);
  assert.doesNotMatch(directAdoption, /setApiUser\(/);
});

test("refresh 성공 뒤 개별 API가 401이어도 전체 세션을 삭제하지 않는다", () => {
  const source = read("src/lib/api/client.ts");
  const okBranch = source.slice(
    source.indexOf('if (result === "ok")'),
    source.indexOf('} else if (result === "rejected")'),
  );
  assert.doesNotMatch(okBranch, /clearApiSession\(\)/);
});

test("네이티브 기기 ID를 일시적으로 못 읽으면 refresh를 거절로 오판하지 않는다", () => {
  const source = read("src/lib/api/client.ts");
  assert.match(source, /if \(isNativePlatform\(\) && !deviceInstallId\) return "error";/);
});

test("WebView refresh 성공 토큰은 native 재채택 없이 먼저 저장한 뒤 구독자에게 알린다", () => {
  const source = read("src/lib/api/client.ts");
  const fn = functionBody(source, "async function doRefreshAccess", "/**\n * 저수준 요청");
  const setAt = fn.indexOf("setApiTokens({ access: nextAccess, refresh: nextRefresh })");
  const nativeAt = fn.indexOf(
    "await syncNativeLocationToken({ nativeFirst: false, authoritativeServerRefresh: true })",
  );
  const notifyAt = fn.indexOf("notifyTokens()");
  assert.ok(setAt >= 0 && nativeAt > setAt, "새 WebView 토큰을 native에 먼저 확정하지 않았습니다");
  assert.ok(notifyAt > nativeAt, "AuthProvider 구독자가 stale native를 재채택하기 전에 native write가 끝나야 합니다");
});

test("동일 iat 예외는 서버 refresh 응답을 네이티브에 확정하는 경로에만 전달한다", () => {
  const location = read("src/lib/native/location.ts");
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/LocationPlugin.java");
  const store = read("android/app/src/main/java/com/hyeni/calendar/SessionTokenStore.java");
  assert.match(location, /authoritative: authoritativeServerRefresh/);
  assert.match(plugin, /call\.getBoolean\("authoritative"\)/);
  assert.match(plugin, /SessionTokenStore\.reconcileContext\(\s*prefs,\s*newToken,\s*newRefresh,\s*authoritative,/s);
  assert.match(store, /shouldReplaceStored\(\s*stored\.accessToken,\s*nextAccess,\s*authoritative\s*\)/s);
});

test("Android 토큰 비교와 저장은 공통 원자 helper를 거치고 서비스 도착 시 다시 검증한다", () => {
  const store = read("android/app/src/main/java/com/hyeni/calendar/SessionTokenStore.java");
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/LocationPlugin.java");
  const service = read("android/app/src/main/java/com/hyeni/calendar/LocationService.java");

  assert.match(store, /static synchronized Snapshot reconcile\(/);
  assert.match(store, /SessionTokenFreshness\.shouldReplaceStored\(/);
  assert.match(store, /prefs\.edit\(\)\s*\.putString\("accessToken", nextAccess\)/s);
  assert.doesNotMatch(plugin, /putString\("accessToken"/);
  assert.doesNotMatch(plugin, /putString\("refreshToken"/);
  assert.doesNotMatch(service, /putString\("accessToken"/);
  assert.doesNotMatch(service, /putString\("refreshToken"/);

  const onStart = functionBody(service, "public int onStartCommand", "private void createNotificationChannels");
  assert.match(onStart, /SessionTokenStore\.reconcileContext\(/);
  const refresh = functionBody(service, "private String networkRefreshAccessToken", "// ── Kalman Filter");
  assert.match(refresh, /SessionTokenStore\.reconcileIfGeneration\(\s*prefs,\s*newAccess,\s*newRefresh,\s*true,/s);
});

test("명시적 로그아웃 뒤 늦게 도착한 native refresh 응답은 세션을 되살리지 않는다", () => {
  const store = read("android/app/src/main/java/com/hyeni/calendar/SessionTokenStore.java");
  const service = read("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
  assert.match(store, /private static long generation = 0L;/);
  assert.match(store, /static synchronized long generation\(\)/);
  assert.match(store, /static synchronized Snapshot reconcileIfGeneration\(/);
  assert.match(store, /if \(generation != expectedGeneration\)/);
  assert.match(store, /generation\+\+;/);

  const refresh = functionBody(service, "private String networkRefreshAccessToken", "// ── Kalman Filter");
  assert.match(refresh, /long refreshGeneration = SessionTokenStore\.generation\(\);/);
  assert.match(refresh, /SessionTokenStore\.reconcileIfGeneration\(/);
});

test("로그아웃한 session nonce의 지연 start/push/update writer는 native tombstone이 거부한다", () => {
  const store = read("android/app/src/main/java/com/hyeni/calendar/SessionTokenStore.java");
  const plugin = read("android/app/src/main/java/com/hyeni/calendar/LocationPlugin.java");
  const service = read("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
  const location = read("src/lib/native/location.ts");
  const push = read("src/lib/native/push.ts");

  assert.match(store, /BLOCKED_SESSION_NONCES/);
  assert.match(store, /MAX_BLOCKED_SESSION_NONCES = 16/);
  assert.match(store, /blockedSessionNonces\.contains\(clean\(sessionNonce\)\)/);
  assert.match(store, /blockedSessionNonces\.add\(retiringSessionNonce\)/);
  assert.match(store, /putString\(BLOCKED_SESSION_NONCES, String\.join\("\|", blockedSessionNonces\)\)/);
  assert.doesNotMatch(store, /remove\(BLOCKED_SESSION_NONCES\)/);
  assert.match(plugin, /call\.getString\("sessionNonce", ""\)/);
  assert.match(service, /intent\.getStringExtra\("sessionNonce"\)/);
  assert.match(location, /sessionNonce: getApiSessionInstanceId\(\) \?\? ""/);
  assert.match(push, /sessionNonce: getApiSessionInstanceId\(\) \?\? ""/);
});

test("진행 중 Web refresh는 logout 또는 새 로그인으로 nonce가 바뀌면 응답을 적용하지 않는다", () => {
  const client = read("src/lib/api/client.ts");
  const fn = functionBody(client, "async function doRefreshAccess", "/**\n * 저수준 요청");
  assert.match(fn, /const refreshSessionNonce = getApiSessionInstanceId\(\);/);
  assert.match(fn, /if \(getApiSessionInstanceId\(\) !== refreshSessionNonce\) return "error";/);
});

test("아이모드 시작은 복구 대기 후 세션을 다시 확인하고 익명 로그인 여부를 결정한다", () => {
  const source = read("src/screens/onboarding/Onboarding.tsx");
  const pairEffect = source.slice(source.indexOf("const code = readPairParam();"), source.indexOf("const back ="));
  const startChild = source.slice(source.indexOf("const startChildMode = async"), source.indexOf("return (", source.indexOf("const startChildMode = async")));

  for (const block of [pairEffect, startChild]) {
    const adoptAt = block.indexOf("await adoptNativeLocationSessionTokens()");
    const recheckAt = block.indexOf("deriveAuthState()", adoptAt);
    const anonymousAt = block.indexOf("anonymousLogin()", adoptAt);
    assert.ok(adoptAt >= 0 && recheckAt > adoptAt, "복구 대기 후 인증 상태 재확인이 없습니다");
    assert.ok(anonymousAt > recheckAt, "인증 상태 재확인 전에 익명 세션으로 덮어씁니다");
  }
});

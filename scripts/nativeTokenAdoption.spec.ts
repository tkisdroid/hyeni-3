import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { shouldAdoptNativeSessionTokens } from "../src/transform/nativeTokenSync.ts";

function token(sub: string, iat: number): string {
  const payload = Buffer.from(JSON.stringify({ sub, iat }), "utf8")
    .toString("base64url");
  return `x.${payload}.y`;
}

const oldWeb = token("child-user", 100);
const newNative = token("child-user", 200);
const olderNative = token("child-user", 50);

assert.equal(
  shouldAdoptNativeSessionTokens({
    currentAccessToken: oldWeb,
    currentRefreshToken: "refresh-web-old",
    nativeAccessToken: newNative,
    nativeRefreshToken: "refresh-native-new",
  }),
  true,
  "네이티브가 더 새 access/refresh를 갖고 있으면 WebView가 채택해야 합니다",
);

assert.equal(
  shouldAdoptNativeSessionTokens({
    currentAccessToken: oldWeb,
    currentRefreshToken: "refresh-web",
    nativeAccessToken: olderNative,
    nativeRefreshToken: "refresh-native-old",
  }),
  false,
  "네이티브 access가 더 오래됐으면 WebView 토큰을 덮어쓰면 안 됩니다",
);

assert.equal(
  shouldAdoptNativeSessionTokens({
    currentAccessToken: null,
    currentRefreshToken: null,
    nativeAccessToken: null,
    nativeRefreshToken: null,
  }),
  false,
  "명시적으로 로그아웃되어 네이티브 토큰까지 지워졌으면 세션을 되살리면 안 됩니다",
);

assert.equal(
  shouldAdoptNativeSessionTokens({
    currentAccessToken: null,
    currentRefreshToken: null,
    nativeAccessToken: newNative,
    nativeRefreshToken: "refresh-native-new",
  }),
  true,
  "WebView 세션만 유실되고 네이티브 토큰이 남아 있으면 네이티브 토큰으로 복구해야 합니다",
);

assert.equal(
  shouldAdoptNativeSessionTokens({
    currentAccessToken: oldWeb,
    currentRefreshToken: "same-refresh",
    nativeAccessToken: newNative,
    nativeRefreshToken: "same-refresh",
  }),
  false,
  "refresh token이 같으면 회전 불일치가 아니므로 채택할 필요가 없습니다",
);

const clientSource = readFileSync("src/lib/api/client.ts", "utf8");
const locationSource = readFileSync("src/lib/native/location.ts", "utf8");
const adoptCall = clientSource.indexOf("await adoptNativeLocationSessionTokens()");
const refreshRead = clientSource.indexOf("const refreshToken = getApiRefreshToken()");

assert.ok(adoptCall >= 0, "API refresh 전에 네이티브 토큰 채택을 호출해야 합니다");
assert.ok(refreshRead > adoptCall, "refresh token 읽기보다 네이티브 토큰 채택이 먼저 실행되어야 합니다");
assert.ok(
  clientSource.includes("void syncNativeLocationToken()"),
  "WebView refresh 성공 후 새 토큰을 네이티브에 다시 써야 합니다",
);
assert.ok(
  locationSource.includes("getSessionTokens"),
  "네이티브 SharedPreferences 최신 토큰을 읽는 브리지 메서드를 사용해야 합니다",
);
assert.ok(
  locationSource.includes("nativeServiceEnabled"),
  "네이티브 세션 상태를 함께 읽어 WebView 세션 유실을 복구해야 합니다",
);
assert.ok(
  locationSource.includes("clearSession"),
  "명시적 로그아웃 때는 네이티브 잔여 토큰까지 지워야 합니다",
);

console.log("nativeTokenAdoption contract ok");

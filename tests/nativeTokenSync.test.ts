import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldAdoptNativeSessionTokens,
  shouldRestoreNativeRefreshOnlySession,
} from "../src/transform/nativeTokenSync.ts";

function jwt(sub: string, iat: number): string {
  const payload = Buffer.from(JSON.stringify({ sub, iat })).toString("base64url");
  return `header.${payload}.sig`;
}

test("네이티브 refresh-only 세션 복구는 WebView 세션이 없고 push context가 완전할 때만 허용한다", () => {
  assert.equal(
    shouldRestoreNativeRefreshOnlySession({
      currentAccessToken: null,
      currentRefreshToken: null,
      nativeAccessToken: "",
      nativeRefreshToken: "native-refresh",
      nativeUserId: "child-user",
      nativeFamilyId: "family-1",
      nativeRole: "child",
    }),
    true,
  );
});

test("네이티브 refresh-only 세션 복구는 기존 WebView 세션이나 context 누락 시 차단한다", () => {
  assert.equal(
    shouldRestoreNativeRefreshOnlySession({
      currentAccessToken: "web-access",
      currentRefreshToken: "web-refresh",
      nativeAccessToken: "",
      nativeRefreshToken: "native-refresh",
      nativeUserId: "child-user",
      nativeFamilyId: "family-1",
      nativeRole: "child",
    }),
    false,
  );
  assert.equal(
    shouldRestoreNativeRefreshOnlySession({
      currentAccessToken: null,
      currentRefreshToken: null,
      nativeAccessToken: "",
      nativeRefreshToken: "native-refresh",
      nativeUserId: "",
      nativeFamilyId: "family-1",
      nativeRole: "child",
    }),
    false,
  );
  assert.equal(
    shouldRestoreNativeRefreshOnlySession({
      currentAccessToken: null,
      currentRefreshToken: null,
      nativeAccessToken: "",
      nativeRefreshToken: "native-refresh",
      nativeUserId: "child-user",
      nativeFamilyId: "family-1",
      nativeRole: "guest",
    }),
    false,
  );
});

test("WebView 세션이 없으면 네이티브 access token을 직접 채택하지 않는다", () => {
  assert.equal(
    shouldAdoptNativeSessionTokens({
      currentAccessToken: null,
      currentRefreshToken: null,
      nativeAccessToken: jwt("child-user", 100),
      nativeRefreshToken: "native-refresh",
    }),
    false,
  );
});

test("WebView 세션이 없고 네이티브 access token이 남아 있어도 refresh 검증 복구는 허용한다", () => {
  assert.equal(
    shouldRestoreNativeRefreshOnlySession({
      currentAccessToken: null,
      currentRefreshToken: null,
      nativeAccessToken: jwt("child-user", 100),
      nativeRefreshToken: "native-refresh",
      nativeUserId: "child-user",
      nativeFamilyId: "family-1",
      nativeRole: "child",
    }),
    true,
  );
});

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

function jwtWithClaims(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
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

test("같은 초에 발급된 서로 다른 토큰은 최신 순서를 증명할 수 없어 채택하지 않는다", () => {
  assert.equal(
    shouldAdoptNativeSessionTokens({
      currentAccessToken: jwtWithClaims({ sub: "child-user", iat: 100, marker: "web" }),
      currentRefreshToken: "web-refresh",
      nativeAccessToken: jwtWithClaims({ sub: "child-user", iat: 100, marker: "native" }),
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

test("가족 미연결 anonymous QR 세션은 네이티브의 기존 child 세션으로 무손실 복구할 수 있다", () => {
  assert.equal(
    shouldRestoreNativeRefreshOnlySession({
      currentAccessToken: jwtWithClaims({
        sub: "temporary-anonymous",
        iat: 300,
        is_anonymous: true,
        role: "anonymous",
        family_id: null,
      }),
      currentRefreshToken: "temporary-anonymous-refresh",
      nativeAccessToken: jwt("child-user", 100),
      nativeRefreshToken: "native-child-refresh",
      nativeUserId: "child-user",
      nativeFamilyId: "family-1",
      nativeRole: "child",
    }),
    true,
  );
});

test("가족이 연결된 정상 WebView 세션은 anonymous 복구 예외로 덮지 않는다", () => {
  assert.equal(
    shouldRestoreNativeRefreshOnlySession({
      currentAccessToken: jwtWithClaims({
        sub: "child-user",
        iat: 300,
        is_anonymous: false,
        role: "child",
        family_id: "family-1",
      }),
      currentRefreshToken: "web-child-refresh",
      nativeAccessToken: jwt("child-user", 100),
      nativeRefreshToken: "native-child-refresh",
      nativeUserId: "child-user",
      nativeFamilyId: "family-1",
      nativeRole: "child",
    }),
    false,
  );
});

test("anonymous QR 세션 복구 예외는 기존 native child에만 허용한다", () => {
  const currentAnonymous = jwtWithClaims({
    sub: "temporary-anonymous",
    iat: 300,
    is_anonymous: true,
    role: "anonymous",
    family_id: null,
  });
  for (const nativeRole of ["parent", "teacher"]) {
    assert.equal(
      shouldRestoreNativeRefreshOnlySession({
        currentAccessToken: currentAnonymous,
        currentRefreshToken: "temporary-anonymous-refresh",
        nativeAccessToken: jwt(`${nativeRole}-user`, 100),
        nativeRefreshToken: `native-${nativeRole}-refresh`,
        nativeUserId: `${nativeRole}-user`,
        nativeFamilyId: "family-1",
        nativeRole,
      }),
      false,
    );
  }
});

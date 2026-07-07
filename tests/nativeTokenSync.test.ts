import test from "node:test";
import assert from "node:assert/strict";

import { shouldRestoreNativeRefreshOnlySession } from "../src/transform/nativeTokenSync.ts";

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
      nativeAccessToken: "native-access",
      nativeRefreshToken: "native-refresh",
      nativeUserId: "child-user",
      nativeFamilyId: "family-1",
      nativeRole: "child",
    }),
    false,
  );
});

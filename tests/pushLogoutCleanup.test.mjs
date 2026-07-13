import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("로그아웃은 세션을 지우기 전에 현재 FCM·웹 푸시 구독을 서버에서 해제한다", () => {
  const provider = read("src/auth/AuthProvider.tsx");
  const cleanupIndex = provider.indexOf("unregisterPushBeforeLogout");
  const logoutIndex = provider.indexOf("apiLogout();", cleanupIndex);
  assert.ok(cleanupIndex >= 0 && logoutIndex > cleanupIndex);
  assert.match(provider, /unsubscribeWebPush/);
});

test("계정 삭제도 서버 계정을 지우기 전에 현재 기기의 푸시 구독과 계정 context를 정리한다", () => {
  const provider = read("src/auth/AuthProvider.tsx");
  const deleteStart = provider.indexOf("const deleteAccount");
  const deleteEnd = provider.indexOf("const value", deleteStart);
  const body = provider.slice(deleteStart, deleteEnd);
  const cleanupIndex = body.indexOf("cleanupPushBeforeSessionEnd(state.userId)");
  const deleteIndex = body.indexOf("apiDeleteAccount()");

  assert.ok(deleteStart >= 0 && cleanupIndex >= 0 && deleteIndex > cleanupIndex);
  assert.match(provider, /unregisterPushBeforeLogout/);
  assert.match(provider, /unsubscribeWebPush/);
  assert.match(provider, /syncWebPushSessionContext\(null\)/);
});

test("네이티브 로그아웃은 네트워크를 기다리기 전에 push context를 먼저 비운다", () => {
  const push = read("src/lib/native/push.ts");
  assert.match(push, /unregisterPushBeforeLogout/);
  assert.match(push, /unregister_fcm_token/);
  assert.match(push, /clearPushContext/);
  const body = push.slice(push.indexOf("export async function unregisterPushBeforeLogout"), push.indexOf("export function isPushSupported"));
  const nativeBody = body.slice(body.indexOf("const cachedToken"));
  assert.ok(nativeBody.indexOf("clearPushContext") < nativeBody.indexOf("unregister_fcm_token"));
  assert.ok(nativeBody.indexOf("lastRegisteredToken = null") < nativeBody.indexOf("unregister_fcm_token"));
});

test("시간 제한 뒤 늦게 끝난 웹 context 정리가 새 로그인 context를 덮지 않는다", () => {
  const webPush = read("src/lib/webPush.ts");
  assert.match(webPush, /let contextSyncGeneration = 0/);
  assert.match(webPush, /const generation = \+\+contextSyncGeneration/);
  assert.match(webPush, /if \(generation !== contextSyncGeneration\) return false/);
});

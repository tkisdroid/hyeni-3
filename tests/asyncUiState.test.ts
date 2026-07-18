import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("../src/transform/asyncUiState.ts", import.meta.url);

test("비동기 UI 상태 모듈을 제공한다", () => {
  assert.equal(existsSync(moduleUrl), true);
});

test("로그인 요청이나 세션 commit 중에는 이전 화면 이탈을 잠근다", async () => {
  assert.equal(existsSync(moduleUrl), true, "비동기 UI 상태 모듈이 필요합니다");
  const { isLoginNavigationLocked } = await import(moduleUrl.href);

  assert.equal(isLoginNavigationLocked({ busy: false, commitBoundaryActive: false }), false);
  assert.equal(isLoginNavigationLocked({ busy: true, commitBoundaryActive: false }), true);
  assert.equal(isLoginNavigationLocked({ busy: false, commitBoundaryActive: true }), true);
  assert.equal(isLoginNavigationLocked({ busy: true, commitBoundaryActive: true }), true);
});

test("가입 진행 표시는 현재 요청을 소유한 버튼에만 나타난다", async () => {
  assert.equal(existsSync(moduleUrl), true, "비동기 UI 상태 모듈이 필요합니다");
  const { isSignupActionPending } = await import(moduleUrl.href);

  assert.equal(isSignupActionPending("request-code", "request-code"), true);
  assert.equal(isSignupActionPending("request-code", "verify"), false);
  assert.equal(isSignupActionPending("verify", "request-code"), false);
  assert.equal(isSignupActionPending("verify", "verify"), true);
  assert.equal(isSignupActionPending(null, "verify"), false);
});

test("늦게 끝난 이전 가입 요청은 최신 진행 상태를 해제하지 않는다", async () => {
  assert.equal(existsSync(moduleUrl), true, "비동기 UI 상태 모듈이 필요합니다");
  const { completeSignupPendingAction } = await import(moduleUrl.href);

  assert.equal(completeSignupPendingAction("request-code", "request-code"), null);
  assert.equal(completeSignupPendingAction("verify", "request-code"), "verify");
  assert.equal(completeSignupPendingAction("request-code", "verify"), "request-code");
  assert.equal(completeSignupPendingAction(null, "verify"), null);
});

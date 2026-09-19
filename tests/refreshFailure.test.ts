import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
const { classifyRefreshFailure } = await import("../src/transform/refreshFailure.ts");

test("다른 설치 로그인과 서버의 명시적 토큰 무효만 세션을 종료한다", () => {
  assert.equal(classifyRefreshFailure("device_session_inactive"), "inactive");
  assert.equal(classifyRefreshFailure("invalid_token"), "rejected");
});

test("HTML 403·알 수 없는 인증 오류·기기 준비 지연으로는 로그아웃하지 않는다", () => {
  for (const code of [null, "forbidden", "device_identity_required", "temporarily_unavailable"]) {
    assert.equal(classifyRefreshFailure(code), "error");
  }
});

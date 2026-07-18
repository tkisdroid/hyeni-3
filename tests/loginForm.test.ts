import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("../src/transform/loginForm.ts", import.meta.url);

test("로그인 폼 검증 모듈을 제공한다", () => {
  assert.equal(existsSync(moduleUrl), true);
});

test("공백 아이디와 공백 비밀번호를 각각의 필드 오류로 반환한다", async () => {
  assert.equal(existsSync(moduleUrl), true, "로그인 폼 검증 모듈이 필요합니다");
  const { validateLoginForm } = await import(moduleUrl.href);

  assert.deepEqual(
    validateLoginForm({ loginId: " \t", password: "\n" }),
    {
      loginId: "아이디를 입력해 주세요.",
      password: "비밀번호를 입력해 주세요.",
    },
  );
});

test("값이 있는 로그인 폼은 필드 오류를 반환하지 않는다", async () => {
  assert.equal(existsSync(moduleUrl), true, "로그인 폼 검증 모듈이 필요합니다");
  const { validateLoginForm } = await import(moduleUrl.href);

  assert.deepEqual(
    validateLoginForm({ loginId: "hyeni-parent", password: "secret" }),
    {},
  );
});

import "./helpers/appModuleResolve.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const autofillModule = await import("../src/transform/loginAutofill.ts").catch(() => ({}));

test("아이디와 비밀번호가 모두 자동완성되면 로그인 입력을 반환한다", () => {
  const resolveLoginAutofillSubmission = autofillModule.resolveLoginAutofillSubmission;

  assert.deepEqual(
    resolveLoginAutofillSubmission?.({
      loginId: "hyeni-parent",
      password: "saved-password",
      loginIdAutofilled: true,
      passwordAutofilled: true,
      busy: false,
      autofillAttempted: false,
    }),
    { loginId: "hyeni-parent", password: "saved-password" },
  );
});

test("수동 입력·한쪽만 자동완성·진행 중 상태는 자동 로그인하지 않는다", () => {
  const resolveLoginAutofillSubmission = autofillModule.resolveLoginAutofillSubmission;
  const base = {
    loginId: "hyeni-parent",
    password: "saved-password",
    loginIdAutofilled: true,
    passwordAutofilled: true,
    busy: false,
    autofillAttempted: false,
  };

  assert.equal(resolveLoginAutofillSubmission?.({ ...base, loginIdAutofilled: false }), null);
  assert.equal(resolveLoginAutofillSubmission?.({ ...base, passwordAutofilled: false }), null);
  assert.equal(resolveLoginAutofillSubmission?.({ ...base, busy: true }), null);
  assert.equal(resolveLoginAutofillSubmission?.({ ...base, loginId: "   " }), null);
  assert.equal(resolveLoginAutofillSubmission?.({ ...base, password: "" }), null);
});

test("자동 로그인을 한 번 시도한 화면은 평문 자격정보를 보관하지 않고 자동 재시도하지 않는다", () => {
  const resolveLoginAutofillSubmission = autofillModule.resolveLoginAutofillSubmission;

  assert.equal(
    resolveLoginAutofillSubmission?.({
      loginId: "hyeni-parent",
      password: "wrong-password",
      loginIdAutofilled: true,
      passwordAutofilled: true,
      busy: false,
      autofillAttempted: true,
    }),
    null,
  );
});

test("수동·자동완성·소셜 로그인이 공유하는 동기 gate는 인증 요청을 하나만 허용한다", () => {
  const createLoginActionGate = autofillModule.createLoginActionGate;
  const gate = createLoginActionGate?.();

  assert.equal(gate?.tryBegin(), true);
  assert.equal(gate?.tryBegin(), false);
  assert.equal(gate?.active(), true);
  gate?.end();
  assert.equal(gate?.active(), false);
  assert.equal(gate?.tryBegin(), true);
});

test("브라우저별 자동완성 selector 중 지원되는 계약을 독립적으로 확인한다", () => {
  const isAutofilledLoginInput = autofillModule.isAutofilledLoginInput;
  const checked: string[] = [];
  const input = {
    matches(selector: string) {
      checked.push(selector);
      if (selector === ":autofill") throw new DOMException("지원하지 않는 selector", "SyntaxError");
      return selector === ":-webkit-autofill";
    },
  };

  assert.equal(isAutofilledLoginInput?.(input), true);
  assert.deepEqual(checked, [":autofill", ":-webkit-autofill"]);
});

// 부모 멤버 이름·전화 기본값 — 공동 보호자가 "부모"로, 가입 때 확인한 번호가 빈 값으로
// 저장되던 문제(2026-09-25 브라우저 QA) 회귀 가드.
import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const {
  DEFAULT_PARENT_MEMBER_NAME,
  krMobileDisplayFromProfilePhone,
  readParentProfileDefaults,
  resolveParentMemberName,
} = await import("../lib/parentMemberDefaults.ts");

test("가입 프로필 휴대폰 번호를 앱 표시형으로 바꾸고, 휴대폰이 아니면 비운다", () => {
  assert.equal(krMobileDisplayFromProfilePhone("+821055550101"), "010-5555-0101");
  assert.equal(krMobileDisplayFromProfilePhone("821055550101"), "010-5555-0101");
  assert.equal(krMobileDisplayFromProfilePhone("01055550101"), "010-5555-0101");
  assert.equal(krMobileDisplayFromProfilePhone("0111234567"), "011-123-4567");
  assert.equal(krMobileDisplayFromProfilePhone("0212345678"), "");
  assert.equal(krMobileDisplayFromProfilePhone(null), "");
});

test("요청 이름이 없거나 옛 기본값이면 프로필 이름을 쓴다", () => {
  assert.equal(resolveParentMemberName("", "큐에이아빠"), "큐에이아빠");
  assert.equal(resolveParentMemberName(DEFAULT_PARENT_MEMBER_NAME, "큐에이아빠"), "큐에이아빠");
  assert.equal(resolveParentMemberName("아빠", "큐에이아빠"), "아빠");
  assert.equal(resolveParentMemberName("", ""), DEFAULT_PARENT_MEMBER_NAME);
  assert.equal(resolveParentMemberName(DEFAULT_PARENT_MEMBER_NAME, ""), DEFAULT_PARENT_MEMBER_NAME);
});

test("프로필 조회 실패는 기본값 없음으로 강등하고 가족 연결을 막지 않는다", async () => {
  const ok = {
    prepare: () => ({ bind: () => ({ first: async () => ({ display_name: " 큐에이아빠 ", phone: "+821055550202" }) }) }),
  };
  assert.deepEqual(await readParentProfileDefaults(ok, "u1"), { name: "큐에이아빠", phone: "010-5555-0202" });
  const broken = { prepare: () => { throw new Error("db down"); } };
  assert.deepEqual(await readParentProfileDefaults(broken, "u1"), { name: "", phone: "" });
});

const { normalizeMemberPhoneInput } = await import("../lib/profileInput.ts");

test("멤버 전화번호는 빈 값(지우기)과 한국 휴대폰만 받는다", () => {
  assert.deepEqual(normalizeMemberPhoneInput(""), { ok: true, phone: "" });
  assert.deepEqual(normalizeMemberPhoneInput(null), { ok: true, phone: "" });
  assert.deepEqual(normalizeMemberPhoneInput(" 010 5555 0101 "), { ok: true, phone: "010-5555-0101" });
  assert.deepEqual(normalizeMemberPhoneInput("+82 10-5555-0101"), { ok: true, phone: "010-5555-0101" });
  for (const invalid of ["0101234", "010-1234", "02-123-4567", "abc", "010-5555-0101 내선1", 1012345678]) {
    assert.deepEqual(normalizeMemberPhoneInput(invalid), { ok: false }, String(invalid));
  }
});

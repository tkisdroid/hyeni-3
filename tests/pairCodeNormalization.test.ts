// 페어링 코드 입력 정규화 회귀 (2026-08-22 TK iPhone 제보:
// 코드 입력란에 "KIDXXXXXXXX"(하이픈 없음)를 붙여넣으면 직접매치에 걸리지 않아
// 코드가 사라진 것처럼 보였다 — KID 접두어 8자리는 하이픈 유무와 무관하게 받는다.)
import test from "node:test";
import assert from "node:assert/strict";
import { normalizePairCodeInput } from "../src/transform/pairCode.ts";

test("KID 접두어가 붙은 8자리 코드는 하이픈 생략·소문자와 무관하게 정규화된다", () => {
  assert.equal(normalizePairCodeInput("KID-AB12CD34"), "KID-AB12CD34");
  // 실제 제보 형태: iOS 자동완성/붙여넣기에서 하이픈이 빠진 12자
  assert.equal(normalizePairCodeInput("KIDXXXXXXXX"), "KID-XXXXXXXX");
  assert.equal(normalizeCode("kid-ab12cd34"), "KID-AB12CD34");
  assert.equal(normalizeCode("kidab12cd34"), "KID-AB12CD34");
});

function normalizeCode(input: string) {
  return normalizePairCodeInput(input);
}

test("8자리 raw 코드는 KID 접두어를 붙여 정규화한다", () => {
  assert.equal(normalizeCode("AB12CD34"), "KID-AB12CD34");
  assert.equal(normalizeCode("ab12cd34"), "KID-AB12CD34");
});

test("공백 트림과 URL 쿼리 추출은 기존 계약을 유지한다", () => {
  assert.equal(normalizeCode("  KID-AB12CD34  "), "KID-AB12CD34");
  assert.equal(normalizeCode("https://x/#/onboarding?pair=KID-AB12CD34"), "KID-AB12CD34");
  assert.equal(normalizeCode("https://x/?pairCode=ab12cd34"), "KID-AB12CD34");
});

test("빈 값과 너무 짧은 값은 빈 문자열로 실패시킨다(무결성)", () => {
  assert.equal(normalizeCode(""), "");
  assert.equal(normalizeCode("ABC"), "");
});

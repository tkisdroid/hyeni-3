import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const onboarding = await readFile(
  new URL("../src/screens/onboarding/Onboarding.tsx", import.meta.url),
  "utf8",
);

test("부모 가입 제목은 서비스명이 아니라 모든 가족에게 자연스러운 표현을 쓴다", () => {
  // 문구는 catalog 로 이관됐다 — 화면은 ID 를 쓰고 한국어 원문은 카탈로그가 지킨다.
  assert.ok(onboarding.includes('className="ob-signup-title">{intl.formatMessage({ id: "onboarding.signup.title" })}<'));
  assert.doesNotMatch(onboarding, /혜니 가족 시작하기/);
});

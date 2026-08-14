import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const onboarding = await readFile(
  new URL("../src/screens/onboarding/Onboarding.tsx", import.meta.url),
  "utf8",
);

test("부모 가입 제목은 서비스명이 아니라 모든 가족에게 자연스러운 표현을 쓴다", () => {
  assert.match(onboarding, /className="ob-signup-title">우리 가족 만들기</);
  assert.doesNotMatch(onboarding, /혜니 가족 시작하기/);
});

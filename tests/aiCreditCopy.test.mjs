import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(rootDir, "src/screens/feature/AiCredit.tsx"), "utf8");

test("AI 크레딧 화면은 혜니와 대화가 아니라 일정·안전 지원을 설명한다", () => {
  assert.match(source, /AI가 아이의 일정, 안전을 도와줘요/);
  assert.match(source, /AI가 아이의 일정·안전 대화를 도울 때 크레딧 1회가 사용돼요/);
  assert.doesNotMatch(source, /AI 친구 혜니와 한 번 대화/);
  assert.doesNotMatch(source, /혜니와 대화할 수 있어요/);
});

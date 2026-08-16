import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/screens/child/AiFriendChat.tsx", import.meta.url), "utf8");
const koChild = JSON.parse(readFileSync(new URL("../locales/ko/child.json", import.meta.url), "utf8"));

test("아이 AI 한도 안내는 Free 업셀과 Premium 부모 상한을 혼동하지 않는다", () => {
  assert.match(source, /reason === "parent_safety_limit"[\s\S]*id: "child\.aiChat\.limit\.parent"/);
  assert.match(source, /reason === "free_included_limit"[\s\S]*id: "child\.aiChat\.limit\.free"/);
  assert.match(source, /id: "child\.aiChat\.limit\.premium"/);
  assert.match(koChild["child.aiChat.limit.free"], /무료로 오늘 5번.*부모님께 프리미엄을 부탁/);
  assert.match(koChild["child.aiChat.limit.parent"], /부모님이 정한 오늘 대화 횟수/);
  assert.doesNotMatch(koChild["child.aiChat.limit.parent"], /프리미엄을 부탁/);
  assert.match(source, /resolveAiLimitExhaustionReason\(status\)/);
  assert.match(source, /friendlyError\(err, aiCreditStatus\.data \?\? null\)/);
  assert.doesNotMatch(source, /한국어 신뢰 카피/);
});

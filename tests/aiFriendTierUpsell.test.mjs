import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/screens/child/AiFriendChat.tsx", import.meta.url), "utf8");

test("아이 AI 한도 안내는 Free 업셀과 Premium 부모 상한을 혼동하지 않는다", () => {
  assert.match(source, /무료로 오늘 5번 다 이야기했어/);
  assert.match(source, /부모님께 프리미엄을 부탁해 줘/);
  assert.match(source, /부모님이 정한 오늘 대화 횟수를 다 썼어/);
  assert.match(source, /resolveAiLimitExhaustionReason\(status\)/);
  assert.match(source, /friendlyError\(err, aiCreditStatus\.data \?\? null\)/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { childSubjectKo } from "../lib/koreanSubject.ts";

test("부모에게 가는 아이 메시지 알림은 이름에 '님'을 붙이지 않고 조사를 맞춘다", () => {
  // 2026-09-26 실기기: "둘째테스트님이 메시지를 보냈어요" — 부모가 자기 아이를 높여 부르는 문장이었다.
  assert.equal(childSubjectKo("민준"), "민준이가");
  assert.equal(childSubjectKo("아이야"), "아이야가");
  assert.equal(childSubjectKo(" 혜니 "), "혜니가");
  assert.equal(childSubjectKo("Mia"), "Mia가");
  for (const path of ["worker/lib/memoNotificationOutbox.ts", "worker/routes/push-notify.ts"]) {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\$\{senderName\}님이 메시지를 보냈어요/, path);
    assert.match(source, /\$\{childSubjectKo\(senderName\)\} 메시지를 보냈어요/, path);
  }
});

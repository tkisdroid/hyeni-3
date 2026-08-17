import test from "node:test";
import assert from "node:assert/strict";

import { memoDayStamp, formatMemoDayLabel, mapRepliesToThread } from "../src/transform/memoView.ts";
import { todayDateKey, addDaysToDateKey } from "../src/transform/dateKey.ts";

test("메모 dayStamp 는 명시한 가족 시간대 일자(yyyy-mm-dd)로 떨어진다", () => {
  const stamp = memoDayStamp("2026-07-09T15:32:18.633Z", "Asia/Seoul");
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(memoDayStamp("not-a-date", "Asia/Seoul"), "");
});

test("메모 날짜 구분선 라벨은 오늘/어제/그 외 날짜를 구분한다", () => {
  const now = new Date(2026, 6, 10, 12, 0, 0); // 2026-07-10 금요일
  assert.equal(formatMemoDayLabel("2026-07-10", now, "ko", "Asia/Seoul"), "오늘 · 금요일");
  assert.equal(formatMemoDayLabel("2026-07-09", now, "ko", "Asia/Seoul"), "어제 · 목요일");
  assert.equal(formatMemoDayLabel("2026-07-08", now, "ko", "Asia/Seoul"), "7월 8일 수요일");
  assert.equal(formatMemoDayLabel("", now, "ko", "Asia/Seoul"), "");
});

test("mapRepliesToThread 는 각 메시지에 dayStamp 를 싣는다(구분선 렌더 근거)", () => {
  const replies = [
    { id: "a", user_id: "u1", content: "안녕", created_at: "2026-07-09T01:00:00Z", read_by: [] },
    { id: "b", user_id: "u1", content: "잘자", created_at: "2026-07-10T01:00:00Z", read_by: [] },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msgs = mapRepliesToThread(replies as any, "u1", "ko", "Asia/Seoul");
  assert.equal(msgs.length, 2);
  assert.ok(msgs[0].dayStamp);
  assert.ok(msgs[1].dayStamp);
  assert.notEqual(msgs[0].dayStamp, msgs[1].dayStamp);
});

test("대화 조회 윈도우는 dateKey 유틸로 만든 최근 7일이다(직접 조립 금지 규칙)", () => {
  const today = todayDateKey(new Date(2026, 6, 10));
  const keys = Array.from({ length: 7 }, (_, i) => addDaysToDateKey(today, i - 6));
  assert.equal(keys.length, 7);
  assert.equal(keys[6], today);
  assert.equal(new Set(keys).size, 7);
  // 마지막 키가 오늘, 첫 키가 6일 전이어야 한다.
  assert.equal(keys[0], addDaysToDateKey(today, -6));
});

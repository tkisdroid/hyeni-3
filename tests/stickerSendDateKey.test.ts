import test from "node:test";
import assert from "node:assert/strict";

import * as stickerBook from "../src/transform/stickerBook.ts";

test("스티커 전송 날짜는 호스트가 아니라 가족 시간대의 날짜를 사용한다", () => {
  const stickerSendDateKey = Reflect.get(stickerBook, "stickerSendDateKey") as
    | undefined
    | ((now: Date, timeZone: string) => string);

  assert.equal(typeof stickerSendDateKey, "function");
  if (!stickerSendDateKey) return;

  // 방콕 22:30은 서울에서 이미 다음 날 00:30이다.
  const bangkok2230 = new Date("2026-07-08T15:30:00.000Z");
  assert.equal(stickerSendDateKey(bangkok2230, "Asia/Seoul"), "2026-6-9");
  assert.equal(stickerSendDateKey(bangkok2230, "Asia/Bangkok"), "2026-6-8");
});

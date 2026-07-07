import test from "node:test";
import assert from "node:assert/strict";

import {
  QUICK_STATUS_ACTIONS,
  buildQuickStatusMemo,
} from "../src/transform/quickStatusShare.ts";

test("아이 원탭 상태 공유는 6개 기본 버튼과 전송 메시지를 제공한다", () => {
  assert.deepEqual(
    QUICK_STATUS_ACTIONS.map((action) => [action.label, action.message]),
    [
      ["도착했어", "나 도착했어!"],
      ["출발했어", "나 출발했어!"],
      ["늦을 것 같아", "조금 늦을 것 같아"],
      ["데리러 와줘", "데리러 와줄 수 있어?"],
      ["전화해줘", "전화해줘"],
      ["배터리 없어", "배터리가 얼마 없어"],
    ],
  );
});

test("아이 원탭 상태 공유는 메모 전송 payload를 member id 기준으로 만든다", () => {
  assert.deepEqual(buildQuickStatusMemo("pickup", "member-1", "2026-6-7"), {
    content: "데리러 와줄 수 있어?",
    childId: "member-1",
    dateKey: "2026-6-7",
    origin: "quick_status",
  });
});

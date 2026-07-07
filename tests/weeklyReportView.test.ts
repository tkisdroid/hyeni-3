import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRecentWeekDateKeys,
  summarizeWeeklyReport,
} from "../src/transform/weeklyReportView.ts";
import { FEATURES, TIERS, canUse, lockMessageFor } from "../src/transform/tierPolicy.ts";

test("주간 리포트는 최근 7일 date_key를 dateKey 유틸 규칙으로 만든다", () => {
  assert.deepEqual(buildRecentWeekDateKeys(new Date("2026-07-07T12:00:00+09:00")), [
    "2026-6-1",
    "2026-6-2",
    "2026-6-3",
    "2026-6-4",
    "2026-6-5",
    "2026-6-6",
    "2026-6-7",
  ]);
});

test("주간 리포트는 프리미엄 전용 기능으로 잠근다", () => {
  assert.equal(canUse(TIERS.FREE, FEATURES.WEEKLY_REPORT), false);
  assert.equal(canUse(TIERS.REVIEWED, FEATURES.WEEKLY_REPORT), false);
  assert.equal(canUse(TIERS.PREMIUM, FEATURES.WEEKLY_REPORT), true);
  assert.match(lockMessageFor(FEATURES.WEEKLY_REPORT), /주간 리포트/);
});

test("주간 리포트는 활성 아이 데이터와 가족 공유 일정만 집계한다", () => {
  const summary = summarizeWeeklyReport({
    childMemberId: "child-member-1",
    weekDateKeys: ["2026-6-1", "2026-6-2"],
    events: [
      {
        id: "event-1",
        family_id: "family-1",
        date_key: "2026-6-1",
        title: "태권도",
        time: "16:00",
        end_time: null,
        category: "sports",
        emoji: null,
        is_family_event: false,
        events_children: [{ child_id: "child-member-1" }],
      },
      {
        id: "event-2",
        family_id: "family-1",
        date_key: "2026-6-2",
        title: "가족 외식",
        time: "18:00",
        end_time: null,
        category: "family",
        emoji: null,
        is_family_event: true,
        events_children: [],
      },
      {
        id: "event-3",
        family_id: "family-1",
        date_key: "2026-6-1",
        title: "다른 아이 일정",
        time: "15:00",
        end_time: null,
        category: "school",
        emoji: null,
        is_family_event: false,
        events_children: [{ child_id: "child-member-2" }],
      },
    ],
    supplies: [
      {
        family_id: "family-1",
        date_key: "2026-6-1",
        child_user_id: "child-member-1",
        label: "물통",
        done: true,
      },
      {
        family_id: "family-1",
        date_key: "2026-6-2",
        child_user_id: "child-member-1",
        label: "줄넘기",
        done: false,
      },
    ],
    memos: [
      {
        id: "memo-1",
        family_id: "family-1",
        child_id: "child-member-1",
        user_id: "child-user-1",
        user_role: "child",
        content: "나 도착했어!",
        created_at: "2026-07-07T01:00:00.000Z",
      },
    ],
    alerts: [
      {
        id: "alert-1",
        alert_type: "not_arrived",
        title: "미도착",
        message: "확인이 필요해요",
        severity: "warning",
        event_id: null,
        child_user_id: "child-user-1",
        read: false,
        created_at: "2026-07-02T02:00:00.000Z",
      },
    ],
    childUserId: "child-user-1",
  });

  assert.equal(summary.eventCount, 2);
  assert.equal(summary.supplyTotal, 2);
  assert.equal(summary.supplyDone, 1);
  assert.equal(summary.memoCount, 1);
  assert.equal(summary.alertCount, 1);
  assert.equal(summary.busiestDay?.dateKey, "2026-6-1");
});

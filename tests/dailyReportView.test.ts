import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveDailyReportStatus,
  summarizeDailySupplies,
  type DailyReportAlertInput,
} from "../src/transform/dailyReportView.ts";

test("오늘 SOS나 긴급 알림이 있으면 위험 상태로 분류한다", () => {
  const alerts: DailyReportAlertInput[] = [
    {
      alert_type: "sos",
      severity: "emergency",
      created_at: "2026-07-07T02:30:00.000Z",
    },
  ];

  const status = deriveDailyReportStatus({
    hasActiveChild: true,
    alerts,
    locationFreshness: "live",
    deviceSafetyLabel: "양호",
    deviceHasData: true,
    now: new Date("2026-07-07T12:00:00+09:00"),
  });

  assert.equal(status.status, "danger");
  assert.match(status.title, /긴급/);
});

test("오래된 위치나 기기 미확인은 주의 상태로 분류한다", () => {
  const status = deriveDailyReportStatus({
    hasActiveChild: true,
    alerts: [],
    locationFreshness: "stale",
    deviceSafetyLabel: "확인 중",
    deviceHasData: false,
    now: new Date("2026-07-07T12:00:00+09:00"),
  });

  assert.equal(status.status, "attention");
  assert.match(status.description, /확인/);
});

test("준비물 요약은 완료 수와 남은 항목을 계산한다", () => {
  const summary = summarizeDailySupplies([
    { label: "물통", done: true },
    { label: "줄넘기", done: false },
    { label: "미술 준비물", done: false },
    { label: "알림장", done: false },
  ]);

  assert.deepEqual(summary, {
    total: 4,
    done: 1,
    remaining: 3,
    remainingLabels: ["줄넘기", "미술 준비물", "알림장"],
  });
});

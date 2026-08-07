import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runbook = await readFile(
  new URL("../docs/release/release-day-rollback-runbook.md", import.meta.url),
  "utf8",
);

test("출시 런북은 운영 큐를 네 checkpoint에서 aggregate-only 증거로 저장한다", () => {
  assert.match(runbook, /first-hour-queue-snapshot\.sql/);
  assert.match(runbook, /capture-first-hour-queue-snapshot\.mjs/);
  assert.match(runbook, /--remote --yes --json --file=ops\/first-hour-queue-snapshot\.sql/);
  for (const checkpoint of ["T-10", "T+30", "T+45", "T+60"]) {
    assert.match(runbook, new RegExp(`-Checkpoint '${checkpoint.replace("+", "\\+")}'`));
  }
  assert.match(runbook, /pending_notifications/);
  assert.match(runbook, /memo_notification_outbox/);
  assert.match(runbook, /google_play_rtdn_events/);
  assert.match(runbook, /DB 시각과 고정 count만 반환/);
  assert.match(runbook, /원문·사용자·가족·아이·주문·token[\s\S]*저장하지 않는다/);
  assert.match(runbook, /\$queueCaptureResult = \$queueAggregate \| node/);
  assert.doesNotMatch(runbook, /SELECT\s+\*/i);
});

test("출시 런북은 두 구간 연속 증가만 ROLLBACK_REQUIRED로 판정하고 불충분 증거를 HOLD한다", () => {
  assert.match(runbook, /check-first-hour-queue-trend\.mjs/);
  assert.match(runbook, /1→2와 2→3 두 구간 연속 엄격히 증가/);
  assert.match(runbook, /`ROLLBACK_REQUIRED`\(exit 1\)/);
  assert.match(runbook, /단일 증가·정체·감소는 `HEALTHY`\(exit 0\)/);
  assert.match(runbook, /`INCONCLUSIVE`\(exit 2\)/);
  assert.match(runbook, /20분 초과 stale/);
  assert.match(runbook, /2분 초과 미래 시각/);
  assert.match(runbook, /90분 초과 관측 폭/);
  assert.match(runbook, /사람의 `GO`를 대체하지 않는다/);
  assert.match(runbook, /출시 확대를 HOLD합니다/);
});

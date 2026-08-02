import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./helpers/tsModuleResolve.mjs";
const {
  HOURLY_MAINTENANCE_CRON,
  resolveHourlyMaintenanceHandlers,
} = await import("../index.ts");
test("hourly maintenance는 12개 invocation으로 분리되고 각 D1 query 예산이 50 이하다", () => {
  assert.equal(HOURLY_MAINTENANCE_CRON, "0,5,10,15,20,25,30,35,40,45,50,55 * * * *");
  const names = [];
  for (const minute of [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]) {
    const handlers = resolveHourlyMaintenanceHandlers(
      Date.UTC(2026, 7, 1, 12, minute, 0),
    );
    assert.ok(handlers.length > 0, `${minute}분 slot이 비어 있습니다`);
    const budget = handlers.reduce(
      (total, handler) => total + handler.maxD1Queries,
      0,
    );
    assert.ok(budget <= 50, `${minute}분 slot이 ${budget} queries입니다`);
    names.push(...handlers.map((handler) => handler.name));
  }
  assert.deepEqual(names.sort(), [
    "account-deletion-tombstone-cleanup",
    "account-mutation-lease-cleanup",
    "anonymous-signup-protection-cleanup",
    "edge-cache-sweep",
    "location-confirmation-retention",
    "location-confirmation-retention",
    "location-confirmation-retention",
    "location-history-retention",
    "location-history-ingest-usage-cleanup",
    "memo-interaction-lease-cleanup",
    "premium-funnel-retention",
    "push-idempotency-cleanup",
    "referral-rewards",
    "storage-upload-usage-cleanup",
    "web-ai-credit-reconciliation",
    "web-ai-credit-reconciliation-secondary",
    "web-ai-credit-order-cleanup",
    "web-billing-financial-record-cleanup",
    "web-billing-refund-funnel-retry",
    "web-billing-refund-reconciliation",
    "web-billing-refund-reconciliation",
    "web-billing-refund-reconciliation",
    "web-billing-refund-reconciliation",
    "web-billing-refund-reconciliation",
    "web-billing-refund-reconciliation",
    "web-billing-initial-reconciliation",
    "web-billing-renewal",
  ].sort());
  assert.deepEqual(resolveHourlyMaintenanceHandlers(Number.NaN), []);
});

test("최초·갱신 복구를 매시간 유지하면서 환불 누락 대사는 5분 offset에서 시간당 6건 처리한다", () => {
  assert.deepEqual(
    resolveHourlyMaintenanceHandlers(Date.UTC(2026, 7, 1, 12, 10, 0)).map((handler) => handler.name),
    ["web-billing-initial-reconciliation"],
  );
  assert.deepEqual(
    resolveHourlyMaintenanceHandlers(Date.UTC(2026, 7, 1, 12, 5, 0)).map((handler) => handler.name),
    ["web-billing-refund-reconciliation"],
  );
  assert.deepEqual(
    resolveHourlyMaintenanceHandlers(Date.UTC(2026, 7, 1, 13, 10, 0)).map((handler) => handler.name),
    ["web-billing-initial-reconciliation"],
  );
  assert.deepEqual(
    resolveHourlyMaintenanceHandlers(Date.UTC(2026, 7, 1, 13, 20, 0)).map((handler) => handler.name),
    ["web-billing-renewal"],
  );
  for (const hour of [12, 13]) {
    const refundRuns = [5, 15, 25, 35, 45, 55].flatMap((minute) =>
      resolveHourlyMaintenanceHandlers(Date.UTC(2026, 7, 1, hour, minute, 0)),
    ).filter((handler) => handler.name === "web-billing-refund-reconciliation");
    assert.equal(refundRuns.length, 6, `${hour}시 환불 대사가 정확히 여섯 번이어야 합니다`);
    assert.ok(refundRuns.every((handler) => handler.maxD1Queries <= 50));
  }
});

test("wrangler의 다섯 번째 trigger가 hourly maintenance router와 정확히 일치한다", () => {
  const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const matches = wrangler.match(/crons\s*=\s*\[([^\]]+)\]/g) ?? [];
  const active = matches.at(-1) ?? "";
  assert.match(active, /0,5,10,15,20,25,30,35,40,45,50,55 \* \* \* \*/);
  assert.doesNotMatch(active, /"0 \* \* \* \*"/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const runbook = readFileSync(
  new URL("../ops/web-billing-refund-runbook.md", import.meta.url),
  "utf8",
);
const monitorSql = readFileSync(
  new URL("../ops/web-billing-refund-monitor.sql", import.meta.url),
  "utf8",
);
const workerReadme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const legacyCutover = readFileSync(new URL("../CUTOVER.md", import.meta.url), "utf8");

test("웹 구독 환불 runbook은 migration-first 배포와 코드 전용 롤백을 정확한 명령으로 고정한다", () => {
  const requiredCommands = [
    "npx wrangler d1 execute hyeni-calendar --remote --file=db/web-billing.sql -y",
    "npx wrangler d1 execute hyeni-calendar --remote --file=db/web-billing-key-revocation.sql -y",
    "npx wrangler d1 execute hyeni-calendar --remote --file=db/google-play-family-trial-claim.sql -y",
    "npx wrangler d1 execute hyeni-calendar --remote --file=db/web-billing-refunds.sql -y",
    "npx wrangler d1 execute hyeni-calendar --remote --file=db/web-billing-financial-retention.sql -y",
    "npx wrangler deploy",
    "npx wrangler deployments status",
    "npx wrangler rollback -y -m \"웹 구독 환불 코드 롤백; D1 additive schema 유지\"",
    "npx wrangler d1 execute hyeni-calendar --remote --file=ops/web-billing-refund-monitor.sql -y",
  ];

  for (const command of requiredCommands) {
    assert.match(runbook, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(runbook, /D1 migration은 되돌리지 않는다/);
  assert.match(runbook, /월 4,900원/);
  assert.match(runbook, /연 39,000원/);
  assert.doesNotMatch(runbook, /<[^>]+>|YOUR_|TODO|\.\.\./);
  assert.match(workerReadme, /ops\/web-billing-refund-runbook\.md/);
  assert.match(workerReadme, /ops\/web-billing-refund-monitor\.sql/);
});

test("웹 구독 환불 운영 모니터는 정본 스키마에서 실행 가능한 읽기 전용 집계다", () => {
  const executableSql = monitorSql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  assert.doesNotMatch(
    executableSql,
    /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE)\b/i,
  );
  assert.doesNotMatch(executableSql, /\b(?:customer_key|billing_key|payment_key)\b/i);
  assert.match(executableSql, /refund_reconciliation_due/);
  assert.match(executableSql, /refund_funnel_pending/);
  assert.match(executableSql, /active_toss_entitlement_from_full_refund/);

  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync(new URL("../../cloudflare/schema_d1.sql", import.meta.url), "utf8"));
    db.exec(monitorSql);
  } finally {
    db.close();
  }
});


test("구형 컷오버 문서는 역사 기록으로 봉인하고 현재 cron·VAPID 출시 게이트와 충돌하지 않는다", () => {
  assert.match(legacyCutover, /역사 기록 전용[^\n]*실행 금지/);
  assert.match(legacyCutover, /B2[^\n]*Supabase freeze[^\n]*다시 실행하지 않는다/);
  assert.match(legacyCutover, /현재 `wrangler\.toml \[triggers\]`의 활성 5개 cron/);
  assert.match(legacyCutover, /VAPID_PUBLIC_KEY[^\n]*VAPID_PRIVATE_KEY[^\n]*필수 출시 게이트/);
  assert.doesNotMatch(legacyCutover, /cf(?:at|ut)_[A-Za-z0-9]/);
  assert.doesNotMatch(legacyCutover, /sbp_[A-Za-z0-9]/);
});

test("Worker README는 통합 출시 중간 배포와 파괴 migration 재실행을 금지한다", () => {
  assert.match(workerReadme, /7단계 manifest가 운영 정본/);
  assert.match(workerReadme, /Worker를 한 번만 배포/);
  assert.doesNotMatch(workerReadme, /^npx wrangler deploy\s*$/m);
  assert.equal(
    (workerReadme.match(/--file=db\/ai-credit-balance-uniqueness\.sql/g) ?? []).length,
    1,
    "AI balance unique migration 실행 명령은 전역 1회만 있어야 합니다",
  );

  const rtdnStart = workerReadme.indexOf("### Google Play RTDN migration-first 배포");
  assert.ok(rtdnStart >= 0);
  const rtdnSection = workerReadme.slice(rtdnStart);
  assert.doesNotMatch(rtdnSection, /--file=db\/web-billing\.sql/);
  assert.doesNotMatch(rtdnSection, /--file=db\/google-play-family-trial-claim\.sql/);
  assert.match(rtdnSection, /PRAGMA table_info\(web_billing_trial_claims\)/);
  assert.match(rtdnSection, /PRAGMA table_info\(google_play_purchase_events\)/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = readFileSync(
  new URL("../db/web-billing-financial-retention.sql", import.meta.url),
  "utf8",
);

function columns(db) {
  return new Set(
    db.prepare("PRAGMA table_info(web_billing_financial_records)")
      .all()
      .map((row) => String(row.name)),
  );
}

test("기존 웹 구독 DB에 PII 없는 5년 금융 분리 정본을 멱등 추가한다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(migration);
    db.exec(migration);
    assert.deepEqual([...columns(db)].sort(), [
      "amount",
      "charge_kind",
      "created_at",
      "currency",
      "detached_at",
      "payment_key_hash",
      "period_end",
      "period_start",
      "plan",
      "provider",
      "provider_reference",
      "record_id",
      "record_status",
      "record_type",
      "retention_until",
    ].sort());
    for (const forbidden of [
      "family_id",
      "user_id",
      "parent_id",
      "customer_key",
      "billing_key",
      "billing_key_ciphertext",
    ]) {
      assert.equal(columns(db).has(forbidden), false);
    }
    assert.ok(db.prepare(
      `SELECT 1 FROM sqlite_master
        WHERE type='index' AND name='idx_web_billing_financial_retention'`,
    ).get());

    db.prepare(
      `INSERT INTO web_billing_financial_records
         (record_id,record_type,provider_reference,plan,amount,charge_kind,
          record_status,period_start,period_end,payment_key_hash,
          detached_at,retention_until,created_at)
       VALUES ('charge:valid','charge','HYENI-I-valid','month',4900,'initial',
               'paid','2026-08-01','2026-09-01',?,
               '2026-08-02','2031-08-01','2026-08-01')`,
    ).run("a".repeat(64));
    db.prepare(
      `INSERT INTO web_billing_financial_records
         (record_id,record_type,provider_reference,plan,amount,charge_kind,
          record_status,period_start,period_end,payment_key_hash,
          detached_at,retention_until,created_at)
       VALUES ('trial:valid','trial','checkout-valid','year',0,NULL,
               'trial_cancelled','2026-08-01','2026-08-08',NULL,
               '2026-08-02','2031-08-01','2026-08-01')`,
    ).run();
    db.prepare(
      `INSERT INTO web_billing_financial_records
         (record_id,record_type,provider,provider_reference,plan,amount,charge_kind,
          record_status,period_start,period_end,payment_key_hash,
          detached_at,retention_until,created_at)
       VALUES ('trial:google-valid','trial','google_play','google-play:${"a".repeat(64)}',
               'month',0,NULL,'trial_expired','2026-08-01','2026-08-08',NULL,
               '2026-08-09','2031-08-08','2026-08-01')`,
    ).run();

    assert.throws(() => db.prepare(
      `INSERT INTO web_billing_financial_records
         (record_id,record_type,provider_reference,plan,amount,charge_kind,
          record_status,period_start,period_end,payment_key_hash,
          detached_at,retention_until,created_at)
       VALUES ('charge:wrong-price','charge','HYENI-I-wrong-price','month',4901,'initial',
               'paid','2026-08-01','2026-09-01',?,
               '2026-08-02','2031-08-01','2026-08-01')`,
    ).run("b".repeat(64)), /constraint/i);
    assert.throws(() => db.prepare(
      `INSERT INTO web_billing_financial_records
         (record_id,record_type,provider_reference,plan,amount,charge_kind,
          record_status,period_start,period_end,payment_key_hash,
          detached_at,retention_until,created_at)
       VALUES ('charge:raw-key','charge','HYENI-I-raw-key','month',4900,'initial',
               'paid','2026-08-01','2026-09-01','raw-payment-key',
               '2026-08-02','2031-08-01','2026-08-01')`,
    ).run(), /constraint/i);
    assert.throws(() => db.prepare(
      `INSERT INTO web_billing_financial_records
         (record_id,record_type,provider,provider_reference,plan,amount,charge_kind,
          record_status,period_start,period_end,payment_key_hash,
          detached_at,retention_until,created_at)
       VALUES ('trial:wrong-provider','trial','other','provider-invalid','month',0,NULL,
               'trial_expired','2026-08-01','2026-08-08',NULL,
               '2026-08-09','2031-08-08','2026-08-01')`,
    ).run(), /constraint/i);
  } finally {
    db.close();
  }
});

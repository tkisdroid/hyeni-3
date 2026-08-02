import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migration = readFileSync(
  new URL("../db/google-play-credit-debt-disclosure.sql", import.meta.url),
  "utf8",
);

test("Google Play 크레딧 상계 migration은 기존 구매 이벤트에 0 기본값과 팩 상한을 추가한다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE google_play_purchase_events (
        purchase_token_hash TEXT PRIMARY KEY,
        credit_amount INTEGER
      );
      INSERT INTO google_play_purchase_events(purchase_token_hash,credit_amount)
      VALUES ('existing',30);
    `);
    db.exec(migration);
    assert.equal(
      db.prepare("SELECT debt_applied FROM google_play_purchase_events WHERE purchase_token_hash='existing'").get().debt_applied,
      0,
    );
    db.prepare(
      "UPDATE google_play_purchase_events SET debt_applied=25 WHERE purchase_token_hash='existing'",
    ).run();
    assert.equal(
      db.prepare("SELECT debt_applied FROM google_play_purchase_events WHERE purchase_token_hash='existing'").get().debt_applied,
      25,
    );
    assert.throws(
      () => db.prepare(
        "UPDATE google_play_purchase_events SET debt_applied=31 WHERE purchase_token_hash='existing'",
      ).run(),
      /CHECK constraint failed/,
    );
  } finally {
    db.close();
  }
});

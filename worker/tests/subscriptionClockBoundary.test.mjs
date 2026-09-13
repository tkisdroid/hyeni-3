import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { premiumSubscriptionSql, isPremiumSubscriptionState } from '../shared/subscriptionEntitlement.js';

test('구독 SQL과 메모리 판정은 전달된 시각의 만료 전·정각·직후에 일치한다', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE subscription(status TEXT, trial_ends_at TEXT, current_period_end TEXT)');
    for (const status of ['active', 'grace', 'cancelled', 'trial', 'expired']) {
      for (const end of ['2001-01-01T00:00:00Z', '2001-01-01 00:00:00+00']) {
        db.prepare('INSERT INTO subscription VALUES (?,?,?)').run(status, end, end);
        for (const stamp of ['2000-12-31T23:59:59Z', '2001-01-01T00:00:00Z', '2001-01-01T00:00:01Z']) {
          const actual = db.prepare(`SELECT ${premiumSubscriptionSql('', 'datetime(?1)')} AS premium FROM subscription`).get(stamp).premium;
          assert.equal(Boolean(actual), isPremiumSubscriptionState(status, end, end, new Date(stamp)), `${status} ${end} ${stamp}`);
        }
        db.exec('DELETE FROM subscription');
      }
    }
  } finally { db.close(); }
});

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const typeScriptResolutionHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".js"]) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

after(() => typeScriptResolutionHook.deregister());

const aiCredits = await import("../shared/aiCredits.js");
const atomic = await import(pathToFileURL(resolve(workerDir, "lib/aiCreditConsumption.ts")).href);

class D1StatementAdapter {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1StatementAdapter(this.db, this.sql, bindings);
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes ?? 0) }, results: [] };
  }
}

class D1DatabaseAdapter {
  constructor(db) {
    this.db = db;
    this.batchQueue = Promise.resolve();
  }

  prepare(sql) {
    return new D1StatementAdapter(this.db, sql);
  }

  async batch(statements) {
    const previous = this.batchQueue;
    let release;
    this.batchQueue = new Promise((resolveQueue) => {
      release = resolveQueue;
    });
    await previous;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  }
}

function createDb({ premium = false, includedUsed = 0, purchasedCredits = 0 } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE ai_credit_balances(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL,
      parent_id TEXT,
      is_premium INTEGER NOT NULL DEFAULT 0,
      daily_included_limit INTEGER NOT NULL DEFAULT 5,
      daily_included_used INTEGER NOT NULL DEFAULT 0,
      daily_reset_date TEXT NOT NULL,
      purchased_credits INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE ai_credit_ledger(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL,
      parent_id TEXT,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      message_id TEXT,
      transaction_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE push_idempotency(
      key TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      first_sent_at TEXT,
      family_id TEXT,
      action TEXT
    );
  `);
  sqlite.prepare(
    `INSERT INTO ai_credit_balances
      (id,family_id,child_user_id,parent_id,is_premium,daily_included_limit,daily_included_used,daily_reset_date,purchased_credits,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "balance-1",
    "family-1",
    "child-1",
    "parent-1",
    premium ? 1 : 0,
    premium ? 100 : 5,
    includedUsed,
    "2026-08-01",
    purchasedCredits,
    "2026-08-01 00:00:00.000+00",
  );
  return { sqlite, db: new D1DatabaseAdapter(sqlite) };
}

const baseArgs = {
  familyId: "family-1",
  childUserId: "child-1",
  usageDate: "2026-08-01",
  reason: "chat_response",
  now: new Date("2026-08-01T03:00:00.000Z"),
};

test("상업 AI 포함량은 부모 설정과 분리해 Free 5회, Premium 20회로 고정한다", () => {
  assert.equal(aiCredits.FREE_AI_DAILY_INCLUDED_CREDITS, 5);
  assert.equal(aiCredits.PREMIUM_AI_DAILY_INCLUDED_CREDITS, 20);
  assert.equal(aiCredits.resolveIncludedDailyLimit({ isPremium: false, parentDailyLimit: 100 }), 5);
  assert.equal(aiCredits.resolveIncludedDailyLimit({ isPremium: true, parentDailyLimit: 100 }), 20);
  assert.equal(aiCredits.resolveIncludedDailyLimit({ isPremium: true, parentDailyLimit: 3 }), 20);
});

test("Free 동시 대화는 정확히 5건만 원자 차감하고 원장과 잔액이 일치한다", async () => {
  const { sqlite, db } = createDb();
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, index) => atomic.consumeAiCreditAtomic(db, {
      ...baseArgs,
      parentDailyLimit: 100,
      transactionId: `chat-${index}`,
      messageId: `message-${index}`,
    })),
  );

  assert.equal(results.filter((result) => result.status === "consumed").length, 5);
  assert.equal(results.filter((result) => result.status === "exhausted").length, 1);
  assert.equal(sqlite.prepare("SELECT daily_included_used AS n FROM ai_credit_balances").get().n, 5);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_credit_ledger").get().n, 5);
  sqlite.close();
});

test("Premium은 부모 상한이 더 커도 포함량 20회까지만 쓰고 이후 구매 크레딧을 차감한다", async () => {
  const { sqlite, db } = createDb({ premium: true, includedUsed: 19, purchasedCredits: 2 });
  const first = await atomic.consumeAiCreditAtomic(db, {
    ...baseArgs,
    parentDailyLimit: 100,
    transactionId: "premium-included",
  });
  const second = await atomic.consumeAiCreditAtomic(db, {
    ...baseArgs,
    parentDailyLimit: 100,
    transactionId: "premium-purchased",
  });

  assert.equal(first.status, "consumed");
  assert.equal(first.source, "daily_included");
  assert.equal(second.status, "consumed");
  assert.equal(second.source, "purchased_credit");
  const balance = { ...sqlite.prepare(
    "SELECT daily_included_limit, daily_included_used, purchased_credits FROM ai_credit_balances",
  ).get() };
  assert.deepEqual(balance, { daily_included_limit: 20, daily_included_used: 20, purchased_credits: 1 });
  sqlite.close();
});

test("환불 부채는 일일 포함량 사용 중에도 보존되고 다음 충전분과 상계된 뒤 원자 차감된다", async () => {
  const { sqlite, db } = createDb({ includedUsed: 0, purchasedCredits: -25 });

  const included = await atomic.consumeAiCreditAtomic(db, {
    ...baseArgs,
    parentDailyLimit: 100,
    transactionId: "refund-debt-included",
  });

  assert.equal(included.status, "consumed");
  assert.equal(included.source, "daily_included");
  assert.equal(included.purchasedCredits, 0);
  assert.deepEqual(
    { ...sqlite.prepare(
      "SELECT daily_included_used, purchased_credits FROM ai_credit_balances",
    ).get() },
    { daily_included_used: 1, purchased_credits: -25 },
  );

  sqlite.prepare(
    "UPDATE ai_credit_balances SET purchased_credits=purchased_credits+30, daily_included_used=5",
  ).run();
  assert.equal(
    sqlite.prepare("SELECT purchased_credits AS n FROM ai_credit_balances").get().n,
    5,
  );

  const purchased = await Promise.all([
    atomic.consumeAiCreditAtomic(db, {
      ...baseArgs,
      parentDailyLimit: 100,
      transactionId: "refund-debt-purchased-1",
    }),
    atomic.consumeAiCreditAtomic(db, {
      ...baseArgs,
      parentDailyLimit: 100,
      transactionId: "refund-debt-purchased-2",
    }),
  ]);
  assert.deepEqual(purchased.map((result) => result.status), ["consumed", "consumed"]);
  assert.ok(purchased.every((result) => result.status === "consumed" && result.source === "purchased_credit"));
  assert.equal(
    sqlite.prepare("SELECT purchased_credits AS n FROM ai_credit_balances").get().n,
    3,
  );
  sqlite.close();
});

test("부모 안전 상한은 상업 한도와 별도로 전체 대화량을 더 낮게 제한한다", async () => {
  const { sqlite, db } = createDb({ premium: true });
  const results = [];
  for (let index = 0; index < 4; index += 1) {
    results.push(await atomic.consumeAiCreditAtomic(db, {
      ...baseArgs,
      parentDailyLimit: 3,
      transactionId: `parent-cap-${index}`,
    }));
  }

  assert.deepEqual(results.map((result) => result.status), ["consumed", "consumed", "consumed", "exhausted"]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_credit_ledger").get().n, 3);
  sqlite.close();
});

test("같은 transactionId 재시도는 잔액을 다시 차감하지 않는다", async () => {
  const { sqlite, db } = createDb();
  const first = await atomic.consumeAiCreditAtomic(db, {
    ...baseArgs,
    parentDailyLimit: 5,
    transactionId: "same-chat",
  });
  const duplicate = await atomic.consumeAiCreditAtomic(db, {
    ...baseArgs,
    parentDailyLimit: 5,
    transactionId: "same-chat",
  });

  assert.equal(first.status, "consumed");
  assert.equal(duplicate.status, "consumed");
  assert.equal(duplicate.alreadyConsumed, true);
  assert.equal(sqlite.prepare("SELECT daily_included_used AS n FROM ai_credit_balances").get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_credit_ledger").get().n, 1);
  sqlite.close();
});

test("migration 전 중복 balance가 남아 있어도 선택한 한 행만 갱신하고 원장을 정확히 1건 기록한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare(
    `INSERT INTO ai_credit_balances
      (id,family_id,child_user_id,parent_id,is_premium,daily_included_limit,daily_included_used,daily_reset_date,purchased_credits,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "balance-duplicate",
    "family-1",
    "child-1",
    "parent-1",
    0,
    5,
    0,
    "2026-08-01",
    0,
    "2026-08-01 00:00:00.000+00",
  );

  const consumed = await atomic.consumeAiCreditAtomic(db, {
    ...baseArgs,
    parentDailyLimit: 5,
    transactionId: "pre-migration-duplicate",
  });

  assert.equal(consumed.status, "consumed");
  assert.deepEqual(
    sqlite.prepare("SELECT id, daily_included_used FROM ai_credit_balances ORDER BY id").all().map((row) => ({ ...row })),
    [
      { id: "balance-1", daily_included_used: 1 },
      { id: "balance-duplicate", daily_included_used: 0 },
    ],
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_credit_ledger").get().n, 1);
  sqlite.close();
});

test("같은 자녀의 AI 비용 실행 lease는 한 요청만 획득하고 해제 뒤 다음 요청을 허용한다", async () => {
  const { sqlite, db } = createDb();
  const first = await atomic.acquireAiCreditExecutionLease(db, {
    familyId: "family-1",
    childUserId: "child-1",
    now: new Date("2026-08-01T03:00:00.000Z"),
  });
  const concurrent = await atomic.acquireAiCreditExecutionLease(db, {
    familyId: "family-1",
    childUserId: "child-1",
    now: new Date("2026-08-01T03:00:01.000Z"),
  });

  assert.equal(first.status, "acquired");
  assert.equal(concurrent.status, "busy");
  assert.equal(await atomic.releaseAiCreditExecutionLease(db, first.lease), true);

  const next = await atomic.acquireAiCreditExecutionLease(db, {
    familyId: "family-1",
    childUserId: "child-1",
    now: new Date("2026-08-01T03:00:02.000Z"),
  });
  assert.equal(next.status, "acquired");
  sqlite.close();
});

test("만료 lease를 회수해도 이전 요청의 늦은 해제가 새 lease를 삭제하지 않는다", async () => {
  const { sqlite, db } = createDb();
  const stale = await atomic.acquireAiCreditExecutionLease(db, {
    familyId: "family-1",
    childUserId: "child-1",
    now: new Date("2026-08-01T03:00:00.000Z"),
  });
  assert.equal(stale.status, "acquired");

  const replacement = await atomic.acquireAiCreditExecutionLease(db, {
    familyId: "family-1",
    childUserId: "child-1",
    now: new Date("2026-08-01T03:03:00.000Z"),
  });
  assert.equal(replacement.status, "acquired");
  assert.equal(await atomic.releaseAiCreditExecutionLease(db, stale.lease), false);

  const stillBusy = await atomic.acquireAiCreditExecutionLease(db, {
    familyId: "family-1",
    childUserId: "child-1",
    now: new Date("2026-08-01T03:03:01.000Z"),
  });
  assert.equal(stillBusy.status, "busy");
  sqlite.close();
});

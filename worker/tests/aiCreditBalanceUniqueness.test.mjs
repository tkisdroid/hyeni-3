import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath) {
  return readFileSync(resolve(workerDir, relativePath), "utf8");
}

test("canonical schema는 자녀별 AI balance를 정확히 한 행으로 제한한다", () => {
  assert.match(
    source("../cloudflare/schema_d1.sql"),
    /CREATE UNIQUE INDEX IF NOT EXISTS [^\n]+\s+ON "?ai_credit_balances"?\s*\("?family_id"?,\s*"?child_user_id"?\)/i,
  );
});

test("운영 migration은 중복 balance 의미를 보수적으로 병합한 뒤 UNIQUE를 건다", () => {
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
    INSERT INTO ai_credit_balances VALUES
      ('old-a','family-a','child-a',NULL,0,5,3,'2026-08-01',7,'2026-08-01 01:00:00.000+00'),
      ('new-a','family-a','child-a','parent-a',1,20,4,'2026-08-01',5,'2026-08-01 02:00:00.000+00'),
      ('old-b','family-b','child-b','parent-b',0,5,5,'2026-08-01',0,'2026-08-01 01:00:00.000+00'),
      ('new-b','family-b','child-b','parent-b',0,5,1,'2026-08-02',0,'2026-08-02 01:00:00.000+00'),
      ('old-c','family-c','child-c','parent-old-c',0,5,2,'2026-08-01',2,'2026-08-01T00:00:00.000Z'),
      ('new-c','family-c','child-c','parent-new-c',1,10,4,'2026-08-01',4,'2026-08-01 23:00:00.000+00'),
      ('old-d','family-d','child-d','parent-d',0,5,0,'2026-08-01',-25,'2026-08-01 01:00:00.000+00'),
      ('new-d','family-d','child-d','parent-d',0,5,0,'2026-08-01',-25,'2026-08-01 02:00:00.000+00'),
      ('old-e','family-e','child-e','parent-e',0,5,0,'2026-08-01',-25,'2026-08-01 01:00:00.000+00'),
      ('new-e','family-e','child-e','parent-e',0,5,0,'2026-08-01',5,'2026-08-01 02:00:00.000+00');
  `);

  sqlite.exec(source("db/ai-credit-balance-uniqueness.sql"));

  assert.deepEqual(
    sqlite.prepare(
      `SELECT id,family_id,child_user_id,parent_id,is_premium,daily_included_limit,
              daily_included_used,daily_reset_date,purchased_credits,updated_at
         FROM ai_credit_balances ORDER BY family_id`,
    ).all().map((row) => ({ ...row })),
    [
      {
        id: "new-a",
        family_id: "family-a",
        child_user_id: "child-a",
        parent_id: "parent-a",
        is_premium: 1,
        daily_included_limit: 20,
        daily_included_used: 4,
        daily_reset_date: "2026-08-01",
        purchased_credits: 7,
        updated_at: "2026-08-01 02:00:00.000+00",
      },
      {
        id: "new-b",
        family_id: "family-b",
        child_user_id: "child-b",
        parent_id: "parent-b",
        is_premium: 0,
        daily_included_limit: 5,
        daily_included_used: 1,
        daily_reset_date: "2026-08-02",
        purchased_credits: 0,
        updated_at: "2026-08-02 01:00:00.000+00",
      },
      {
        id: "new-c",
        family_id: "family-c",
        child_user_id: "child-c",
        parent_id: "parent-new-c",
        is_premium: 1,
        daily_included_limit: 10,
        daily_included_used: 4,
        daily_reset_date: "2026-08-01",
        purchased_credits: 4,
        updated_at: "2026-08-01 23:00:00.000+00",
      },
      {
        id: "new-d",
        family_id: "family-d",
        child_user_id: "child-d",
        parent_id: "parent-d",
        is_premium: 0,
        daily_included_limit: 5,
        daily_included_used: 0,
        daily_reset_date: "2026-08-01",
        purchased_credits: -25,
        updated_at: "2026-08-01 02:00:00.000+00",
      },
      {
        id: "new-e",
        family_id: "family-e",
        child_user_id: "child-e",
        parent_id: "parent-e",
        is_premium: 0,
        daily_included_limit: 5,
        daily_included_used: 0,
        daily_reset_date: "2026-08-01",
        purchased_credits: 5,
        updated_at: "2026-08-01 02:00:00.000+00",
      },
    ],
  );
  assert.throws(
    () => sqlite.prepare(
      `INSERT INTO ai_credit_balances
        (id,family_id,child_user_id,daily_reset_date,updated_at)
       VALUES ('again','family-a','child-a','2026-08-02','2026-08-02')`,
    ).run(),
    /UNIQUE constraint failed/,
  );
  sqlite.close();
});

test("운영 README와 migration 주석의 AI balance 진단은 원시 가족·자녀 식별자를 출력하지 않는다", () => {
  const readme = source("README.md");
  const commands = readme
    .split(/\r?\n/)
    .filter((line) => line.includes("--command") && line.includes("ai_credit_balances"));

  assert.ok(commands.length >= 1, "AI balance 운영 진단 명령이 필요하다");
  for (const command of commands) {
    const query = /--command\s+"([^"]+)"/.exec(command)?.[1];
    assert.ok(query, "Wrangler --command SQL을 읽을 수 있어야 한다");
    const projection = /^SELECT\s+(.+?)\s+FROM\s+/i.exec(query)?.[1];
    assert.ok(projection, "운영 진단은 명시적 SELECT projection이어야 한다");
    assert.doesNotMatch(projection, /\bfamily_id\b|\bchild_user_id\b/i);
    assert.notEqual(projection.trim(), "*");
  }

  assert.match(readme, /COUNT\(\*\) AS duplicate_groups/);
  assert.match(readme, /SUM\(group_rows\)\s*,\s*0\) AS duplicate_rows/);
  assert.match(readme, /SUM\(group_rows-1\)\s*,\s*0\) AS rows_to_merge/);

  const aggregateQuery = commands
    .map((command) => /--command\s+"([^"]+)"/.exec(command)?.[1])
    .find((query) => query?.includes("rows_to_merge"));
  assert.ok(aggregateQuery, "집계 전용 중복 진단 SQL이 필요하다");
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE ai_credit_balances(family_id TEXT NOT NULL, child_user_id TEXT NOT NULL);
      INSERT INTO ai_credit_balances VALUES
        ('family-a','child-a'),('family-a','child-a'),
        ('family-b','child-b'),('family-b','child-b'),('family-b','child-b'),
        ('family-c','child-c');
    `);
    assert.deepEqual({ ...sqlite.prepare(aggregateQuery).get() }, {
      duplicate_groups: 2,
      duplicate_rows: 5,
      rows_to_merge: 3,
    });
  } finally {
    sqlite.close();
  }

  const migrationHeader = source("db/ai-credit-balance-uniqueness.sql")
    .split("-- 병합 규칙:", 1)[0];
  assert.doesNotMatch(migrationHeader, /--\s*SELECT\s+family_id\s*,\s*child_user_id/i);
  assert.match(migrationHeader, /duplicate_groups/);
  assert.match(migrationHeader, /duplicate_rows/);
  assert.match(migrationHeader, /rows_to_merge/);
});

test("두 AI seed 경로는 UNIQUE 충돌을 정상 처리하고 DB 정본 행을 다시 읽는다", () => {
  for (const relativePath of ["routes/ai-child-chat.ts", "routes/ai-proactive.ts"]) {
    const text = source(relativePath);
    const conflictIndex = text.search(/ON CONFLICT\s*\(family_id,\s*child_user_id\)\s*DO NOTHING/i);
    assert.ok(conflictIndex >= 0, `${relativePath}: conflict-safe seed 필요`);
    const reloadIndex = text.indexOf(
      "SELECT id, family_id, child_user_id, parent_id, is_premium, daily_included_limit, daily_included_used, daily_reset_date, purchased_credits FROM ai_credit_balances",
      conflictIndex,
    );
    assert.ok(reloadIndex > conflictIndex, `${relativePath}: seed 뒤 DB 정본 재조회 필요`);
  }
});

test("원자 consume은 SELECT로 고른 balance id를 UPDATE 조건에 포함한다", () => {
  const text = source("lib/aiCreditConsumption.ts");
  assert.match(text, /SELECT id, family_id, child_user_id/i);
  assert.match(text, /WHERE id=\? AND family_id=\? AND child_user_id=\?/i);
});

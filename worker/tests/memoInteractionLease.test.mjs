import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = resolve(workerDir, "lib/memoInteractionLease.ts");
const migrationPath = resolve(workerDir, "db/memo-interaction-leases.sql");
const canonicalSchemaPath = resolve(workerDir, "../cloudflare/schema_d1.sql");

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

const leaseModule = existsSync(helperPath)
  ? await import(pathToFileURL(helperPath).href)
  : null;

class Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) { return new Statement(this.db, this.sql, bindings); }
  async first() { return this.db.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes) }, success: true };
  }
}

class Db {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function api() {
  assert.ok(leaseModule, "memoInteractionLease helper가 필요합니다");
  return leaseModule;
}

function createLeaseDb() {
  assert.ok(existsSync(migrationPath), "memo interaction lease migration이 필요합니다");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(migrationPath, "utf8"));
  sqlite.exec(`
    CREATE TABLE user_interaction_blocks(
      family_id TEXT NOT NULL,
      blocker_user_id TEXT NOT NULL,
      blocked_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(family_id, blocker_user_id, blocked_user_id)
    );
  `);
  return { sqlite, db: new Db(sqlite) };
}

test("memo interaction lease migration은 재실행 가능하고 정본 schema와 일치한다", () => {
  assert.ok(existsSync(migrationPath), "migration 파일이 필요합니다");
  const migration = readFileSync(migrationPath, "utf8");
  const db = new DatabaseSync(":memory:");
  db.exec(migration);
  db.exec(migration);
  const schemaDb = new DatabaseSync(":memory:");
  schemaDb.exec(readFileSync(canonicalSchemaPath, "utf8"));
  const columns = (database) => database.prepare("PRAGMA table_info(memo_interaction_leases)").all()
    .map((row) => ({ name: String(row.name), notnull: Number(row.notnull), pk: Number(row.pk) }));
  assert.deepEqual(columns(db), columns(schemaDb));
  assert.deepEqual(columns(db).filter((row) => row.pk > 0).map((row) => row.name), [
    "family_id", "user_a_id", "user_b_id",
  ]);
  assert.ok(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_memo_interaction_leases_expiry'",
  ).get());
  assert.throws(() => db.prepare(
    `INSERT INTO memo_interaction_leases
       (family_id,user_a_id,user_b_id,lease_token,expires_at,created_at,updated_at)
     VALUES ('family-a','z-user','a-user','token','2099-01-01','2026-01-01','2026-01-01')`,
  ).run(), /CHECK constraint failed/);
  db.close();
  schemaDb.close();
});

test("pair는 ASCII 오름차순의 동일한 무방향 키로 정규화된다", () => {
  const { canonicalizeMemoInteractionPair } = api();
  assert.deepEqual(
    canonicalizeMemoInteractionPair("family-a", "parent_2", "child-1"),
    { familyId: "family-a", userAId: "child-1", userBId: "parent_2" },
  );
  assert.deepEqual(
    canonicalizeMemoInteractionPair("family-a", "child-1", "parent_2"),
    { familyId: "family-a", userAId: "child-1", userBId: "parent_2" },
  );
  assert.equal(canonicalizeMemoInteractionPair("family-a", "same", "same"), null);
  assert.equal(canonicalizeMemoInteractionPair("family-a", "한글", "parent"), null);
});

test("만료되지 않은 pair는 busy이고 만료 pair만 새 token으로 탈취한다", async () => {
  const { acquireMemoInteractionLease } = api();
  const { sqlite, db } = createLeaseDb();
  const now = new Date("2026-07-14T01:00:00.000Z");
  const first = await acquireMemoInteractionLease(db, {
    familyId: "family-a", userId: "parent-a", peerUserId: "child-a", now,
  });
  assert.equal(first.status, "acquired");
  const busy = await acquireMemoInteractionLease(db, {
    familyId: "family-a", userId: "child-a", peerUserId: "parent-a",
    now: new Date("2026-07-14T01:01:59.999Z"),
  });
  assert.equal(busy.status, "busy");
  const stolen = await acquireMemoInteractionLease(db, {
    familyId: "family-a", userId: "child-a", peerUserId: "parent-a",
    now: new Date("2026-07-14T01:02:00.000Z"),
  });
  assert.equal(stolen.status, "acquired");
  assert.notEqual(stolen.lease.leaseToken, first.lease.leaseToken);
  sqlite.close();
});

test("예전 token 해제는 탈취된 현재 lease를 삭제하지 않는다", async () => {
  const { acquireMemoInteractionLease, releaseMemoInteractionLease } = api();
  const { sqlite, db } = createLeaseDb();
  const first = await acquireMemoInteractionLease(db, {
    familyId: "family-a", userId: "parent-a", peerUserId: "child-a",
    now: new Date("2026-07-14T01:00:00.000Z"),
  });
  const stolen = await acquireMemoInteractionLease(db, {
    familyId: "family-a", userId: "parent-a", peerUserId: "child-a",
    now: new Date("2026-07-14T01:02:00.000Z"),
  });
  assert.equal(first.status, "acquired");
  assert.equal(stolen.status, "acquired");
  assert.equal(await releaseMemoInteractionLease(db, first.lease), false);
  assert.equal(sqlite.prepare("SELECT lease_token FROM memo_interaction_leases").get().lease_token, stolen.lease.leaseToken);
  assert.equal(await releaseMemoInteractionLease(db, stolen.lease), true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM memo_interaction_leases").get().count, 0);
  sqlite.close();
});

test("다중 수신자 획득은 canonical 순서이며 하나가 busy면 앞선 획득도 조건부 원복한다", async () => {
  const { acquireMemoInteractionLease, acquireMemoInteractionLeases } = api();
  const { sqlite, db } = createLeaseDb();
  const blocker = await acquireMemoInteractionLease(db, {
    familyId: "family-a", userId: "sender-a", peerUserId: "recipient-b",
    now: new Date("2026-07-14T01:00:00.000Z"),
  });
  assert.equal(blocker.status, "acquired");
  const result = await acquireMemoInteractionLeases(db, {
    familyId: "family-a",
    senderUserId: "sender-a",
    recipientUserIds: ["recipient-c", "recipient-a", "recipient-b", "recipient-a"],
    now: new Date("2026-07-14T01:00:01.000Z"),
  });
  assert.equal(result.status, "busy");
  assert.deepEqual(
    sqlite.prepare("SELECT user_a_id,user_b_id FROM memo_interaction_leases ORDER BY user_a_id,user_b_id").all()
      .map((row) => ({ user_a_id: String(row.user_a_id), user_b_id: String(row.user_b_id) })),
    [{ user_a_id: "recipient-b", user_b_id: "sender-a" }],
  );
  sqlite.close();
});

test("delivery pair lease가 유지되는 동안 같은 쌍의 block 획득은 성공하지 않는다", async () => {
  const { acquireMemoInteractionLease } = api();
  const { sqlite, db } = createLeaseDb();
  const delivery = await acquireMemoInteractionLease(db, {
    familyId: "family-a", userId: "parent-a", peerUserId: "child-a",
    now: new Date("2026-07-14T01:00:00.000Z"),
  });
  const block = await acquireMemoInteractionLease(db, {
    familyId: "family-a", userId: "child-a", peerUserId: "parent-a",
    now: new Date("2026-07-14T01:00:01.000Z"),
  });
  assert.equal(delivery.status, "acquired");
  assert.equal(block.status, "busy");
  sqlite.close();
});

test("block을 먼저 확정한 수신자는 제외되고 다른 수신자는 그대로 남는다", async () => {
  const { loadUnblockedMemoRecipientIds } = api();
  const { sqlite, db } = createLeaseDb();
  sqlite.prepare("INSERT INTO user_interaction_blocks VALUES (?,?,?,?)")
    .run("family-a", "child-a", "parent-a", "2026-07-14 01:00:00+00");
  const recipients = await loadUnblockedMemoRecipientIds(db, {
    familyId: "family-a",
    senderUserId: "parent-a",
    recipientUserIds: ["child-a", "parent-b"],
  });
  assert.deepEqual(recipients, ["parent-b"]);
  sqlite.close();
});

test("모든 new_memo 공통 경로는 pair lease·차단 재조회·network deadline을 거친다", () => {
  const pushSource = readFileSync(resolve(workerDir, "routes/push-notify.ts"), "utf8");
  const memoSource = readFileSync(resolve(workerDir, "routes/memos.ts"), "utf8");
  const fcmSource = readFileSync(resolve(workerDir, "lib/fcm.ts"), "utf8");
  const webPushSource = readFileSync(resolve(workerDir, "lib/webpush.ts"), "utf8");
  assert.match(pushSource, /acquireMemoInteractionLeases/);
  assert.match(pushSource, /loadUnblockedMemoRecipientIds/);
  assert.match(pushSource, /MEMO_DELIVERY_NETWORK_DEADLINE_MS/);
  assert.match(pushSource, /finally\s*\{[\s\S]{0,300}releaseMemoInteractionLeases/);
  assert.match(pushSource, /sendWebPush\([\s\S]{0,180}memoDeliveryContext\?\.signal/);
  assert.match(pushSource, /sendFcmToFamily\([\s\S]{0,300}memoDeliveryContext\?\.signal/);
  assert.equal((pushSource.match(/export async function handleInstantNotification\(/g) ?? []).length, 1);
  assert.match(memoSource, /memos\.post\("\/blocks"[\s\S]*acquireMemoInteractionLease/);
  assert.match(memoSource, /memos\.delete\("\/blocks\/:targetUserId"[\s\S]*acquireMemoInteractionLease/);
  assert.match(fcmSource, /fetch\("https:\/\/oauth2\.googleapis\.com\/token"[\s\S]{0,300}signal/);
  assert.match(fcmSource, /messages:send[\s\S]{0,300}signal/);
  assert.match(webPushSource, /fetch\(endpoint,[\s\S]{0,300}signal/);
});

test("memo 전체 network deadline은 pair lease TTL보다 짧다", () => {
  const { MEMO_DELIVERY_NETWORK_DEADLINE_MS, MEMO_INTERACTION_LEASE_TTL_MS } = api();
  assert.ok(MEMO_DELIVERY_NETWORK_DEADLINE_MS > 0);
  assert.ok(MEMO_DELIVERY_NETWORK_DEADLINE_MS < MEMO_INTERACTION_LEASE_TTL_MS);
  assert.equal(MEMO_INTERACTION_LEASE_TTL_MS, 120_000);
  assert.equal(MEMO_DELIVERY_NETWORK_DEADLINE_MS, 90_000);
});

test("만료된 crash 잔여 lease만 정리하고 계정 삭제 참조 스캔에도 pair 컬럼을 포함한다", async () => {
  const { acquireMemoInteractionLease, cleanupExpiredMemoInteractionLeases } = api();
  assert.equal(typeof cleanupExpiredMemoInteractionLeases, "function");
  const { sqlite, db } = createLeaseDb();
  await acquireMemoInteractionLease(db, {
    familyId: "family-a", userId: "parent-a", peerUserId: "child-a",
    now: new Date("2026-07-14T01:00:00.000Z"),
  });
  await acquireMemoInteractionLease(db, {
    familyId: "family-a", userId: "parent-a", peerUserId: "child-b",
    now: new Date("2026-07-14T01:01:00.000Z"),
  });
  assert.equal(
    await cleanupExpiredMemoInteractionLeases(db, new Date("2026-07-14T01:02:30.000Z")),
    1,
  );
  assert.deepEqual(
    sqlite.prepare("SELECT user_a_id,user_b_id FROM memo_interaction_leases").all()
      .map((row) => ({ user_a_id: String(row.user_a_id), user_b_id: String(row.user_b_id) })),
    [{ user_a_id: "child-b", user_b_id: "parent-a" }],
  );
  const accountDeletionSource = readFileSync(resolve(workerDir, "lib/accountDeletion.ts"), "utf8");
  const indexSource = readFileSync(resolve(workerDir, "index.ts"), "utf8");
  assert.match(accountDeletionSource, /"user_a_id"/);
  assert.match(accountDeletionSource, /"user_b_id"/);
  assert.match(indexSource, /cleanupExpiredMemoInteractionLeases/);
  sqlite.close();
});

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

let outbox = {};
try {
  outbox = await import("../lib/memoNotificationOutbox.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

class Statement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes) } };
  }
}

class D1Adapter {
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

function requireApi() {
  assert.equal(typeof outbox.buildMemoReplyOutboxStatements, "function");
  assert.equal(typeof outbox.claimMemoNotificationOutbox, "function");
  assert.equal(typeof outbox.recordMemoNotificationOutboxFailure, "function");
  assert.equal(typeof outbox.completeMemoNotificationOutbox, "function");
  assert.equal(typeof outbox.memoNotificationRetryDelayMs, "function");
  return outbox;
}

function createOutboxDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE memo_replies(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      date_key TEXT NOT NULL,
      child_id TEXT,
      user_id TEXT,
      user_role TEXT NOT NULL,
      content TEXT NOT NULL,
      origin TEXT,
      read_by TEXT,
      created_at TEXT
    );
  `);
  const migrationPath = new URL("../db/memo-notification-outbox.sql", import.meta.url);
  assert.equal(existsSync(migrationPath), true, "memo outbox migration이 필요합니다");
  sqlite.exec(readFileSync(migrationPath, "utf8"));
  return { sqlite, db: new D1Adapter(sqlite) };
}

test("memo row와 reply_id PK outbox를 같은 D1 batch로 원자 확정한다", async () => {
  const { sqlite, db } = createOutboxDb();
  const { buildMemoReplyOutboxStatements } = requireApi();
  const statements = buildMemoReplyOutboxStatements(db, {
    id: "reply-1",
    familyId: "family-1",
    dateKey: "2026-6-14",
    childMemberId: "member-1",
    senderUserId: "parent-1",
    senderRole: "parent",
    content: "집에 오면 알려줘",
    origin: "reply",
    createdAt: "2026-07-14 01:00:00.000+00",
  });

  await db.batch(statements);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM memo_replies").get().n, 1);
  assert.deepEqual(
    { ...sqlite.prepare("SELECT reply_id,family_id,attempt_count FROM memo_notification_outbox").get() },
    { reply_id: "reply-1", family_id: "family-1", attempt_count: 0 },
  );
  assert.throws(() => sqlite.prepare("INSERT INTO memo_notification_outbox(reply_id,family_id,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run("reply-1", "family-1", "2026-07-14 01:00:00.000+00", "2026-07-14 01:00:00.000+00", "2026-07-14 01:00:00.000+00"));
  sqlite.prepare("DELETE FROM memo_replies WHERE id=?").run("reply-1");
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM memo_notification_outbox WHERE reply_id=?").get("reply-1").n,
    0,
    "계정삭제·unpair가 memo를 지우면 outbox도 함께 정리되어야 합니다",
  );
  sqlite.close();
});

test("즉시 처리에 인계된 mutation lease는 필요한 사용자·가족 scope를 모두 덮어야 한다", async () => {
  const { memoMutationLeasesCoverScopes } = await import("../lib/memoNotificationOutbox.ts");
  const scopes = [
    { userId: "parent-1", familyId: "family-1" },
    { userId: "child-1", familyId: "family-1" },
  ];
  const complete = [
    { id: "lease-1", userId: "parent-1", familyId: "family-1", expiresAt: "2099-01-01T00:00:00.000Z" },
    { id: "lease-2", userId: "child-1", familyId: "family-1", expiresAt: "2099-01-01T00:00:00.000Z" },
  ];
  assert.equal(memoMutationLeasesCoverScopes(complete, scopes), true);
  assert.equal(memoMutationLeasesCoverScopes(complete.slice(0, 1), scopes), false);
  assert.equal(
    memoMutationLeasesCoverScopes(
      complete.map((lease) => ({ ...lease, familyId: "other-family" })),
      scopes,
    ),
    false,
  );
});

test("outbox lease는 한 소비자만 잡고 실패 뒤 지수 backoff 후 재시도한다", async () => {
  const { sqlite, db } = createOutboxDb();
  const {
    buildMemoReplyOutboxStatements,
    claimMemoNotificationOutbox,
    recordMemoNotificationOutboxFailure,
    memoNotificationRetryDelayMs,
  } = requireApi();
  const createdAt = "2026-07-14 01:00:00.000+00";
  await db.batch(buildMemoReplyOutboxStatements(db, {
    id: "reply-lease", familyId: "family-1", dateKey: "2026-6-14", childMemberId: "member-1",
    senderUserId: "parent-1", senderRole: "parent", content: "안녕", origin: "reply", createdAt,
  }));
  const nowMs = Date.parse("2026-07-14T01:00:00Z");
  const first = await claimMemoNotificationOutbox(db, { replyId: "reply-lease", nowMs });
  assert.ok(first?.leaseToken);
  assert.equal(first?.attemptCount, 1);
  assert.equal(await claimMemoNotificationOutbox(db, { replyId: "reply-lease", nowMs }), null);

  await recordMemoNotificationOutboxFailure(db, first, "temporary", nowMs);
  assert.equal(await claimMemoNotificationOutbox(db, {
    replyId: "reply-lease",
    nowMs: nowMs + memoNotificationRetryDelayMs(1) - 1,
  }), null);
  const second = await claimMemoNotificationOutbox(db, {
    replyId: "reply-lease",
    nowMs: nowMs + memoNotificationRetryDelayMs(1),
  });
  assert.equal(second?.attemptCount, 2);
  sqlite.close();
});

test("완료는 현재 lease 소유자만 outbox를 제거한다", async () => {
  const { sqlite, db } = createOutboxDb();
  const { buildMemoReplyOutboxStatements, claimMemoNotificationOutbox, completeMemoNotificationOutbox } = requireApi();
  await db.batch(buildMemoReplyOutboxStatements(db, {
    id: "reply-done", familyId: "family-1", dateKey: "2026-6-14", childMemberId: "member-1",
    senderUserId: "parent-1", senderRole: "parent", content: "안녕", origin: "reply",
    createdAt: "2026-07-14 01:00:00.000+00",
  }));
  const claim = await claimMemoNotificationOutbox(db, {
    replyId: "reply-done",
    nowMs: Date.parse("2026-07-14T01:00:00Z"),
  });
  assert.ok(claim);
  assert.equal(await completeMemoNotificationOutbox(db, { ...claim, leaseToken: "wrong" }), false);
  assert.equal(await completeMemoNotificationOutbox(db, claim), true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM memo_notification_outbox").get().n, 0);
  sqlite.close();
});

test("memo route와 삭제 경로가 outbox 원자성·재시도·정리를 실제 연결한다", () => {
  const memoRoute = readFileSync(new URL("../routes/memos.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../db/memo-notification-outbox.sql", import.meta.url), "utf8");
  const helper = readFileSync(new URL("../lib/memoNotificationOutbox.ts", import.meta.url), "utf8");
  const workerIndex = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

  assert.match(memoRoute, /DB\.batch\(buildMemoReplyOutboxStatements/);
  assert.match(memoRoute, /processMemoNotificationOutboxReply/);
  assert.doesNotMatch(memoRoute, /await sendMemoPush/);
  assert.match(helper, /resolveVerifiedFamilyMembership/);
  assert.match(helper, /isActiveChildMutationTarget/);
  assert.match(helper, /loadFamilyNotificationMutationScopes/);
  assert.match(helper, /handleInstantNotification/);
  assert.match(helper, /pending_notifications/);
  assert.match(migration, /AFTER DELETE ON memo_replies/);
  assert.match(migration, /DELETE FROM memo_notification_outbox WHERE reply_id = OLD\.id/);
  assert.match(workerIndex, /import \{ processMemoNotificationOutbox \} from "\.\/lib\/memoNotificationOutbox"/);
  assert.match(workerIndex, /"\* \* \* \* \*"[\s\S]*?name: "memo-notification-outbox", run: processMemoNotificationOutbox/);
});

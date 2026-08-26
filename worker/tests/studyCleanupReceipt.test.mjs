import "./helpers/tsModuleResolve.mjs";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const migration = readFileSync(new URL("../db/study-link-cleanup.sql", import.meta.url), "utf8");
const {
  allStudyReceiptsCompleted,
  enqueueStudyLinkCleanupReceipts,
  processPendingStudyLinkCleanups,
  studyCleanupSourceIdForChild,
  studyLinkCleanupReceiptStmtForAccountOwner,
  studyLinkCleanupReceiptStmtsForUnpairJob,
} = await import("../lib/studyLinkCleanup.ts");

class Statement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.sqlite, this.sql, bindings);
  }

  async first() {
    return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class Db {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new Statement(this.sqlite, sql);
  }

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

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration);
  return { sqlite, db: new Db(sqlite) };
}

test("Study cleanup migration은 멱등이고 due index와 고정 제약을 만든다", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration);
  sqlite.exec(migration);
  const columns = sqlite.prepare("PRAGMA table_info(study_link_cleanup_receipts)").all()
    .map((row) => String(row.name));
  assert.deepEqual(columns, [
    "request_id", "source_kind", "source_id", "family_id", "child_member_id",
    "reason", "status", "attempts", "last_error_code", "next_attempt_at",
    "completed_at", "created_at", "updated_at",
  ]);
  assert.equal(
    sqlite.prepare(
      "SELECT COUNT(*) AS count FROM pragma_index_list('study_link_cleanup_receipts') WHERE name='idx_study_link_cleanup_due'",
    ).get().count,
    1,
  );
  assert.throws(
    () => sqlite.prepare(
      `INSERT INTO study_link_cleanup_receipts
       (request_id,source_kind,source_id,family_id,child_member_id,reason,next_attempt_at,created_at,updated_at)
       VALUES ('bad','delete_history','source','family','member','reason','now','now','now')`,
    ).run(),
    /CHECK constraint failed/,
  );
  sqlite.close();
});

test("가족 cleanup은 user_id가 없는 placeholder까지 같은 request ID로 재시도한다", async () => {
  const { sqlite, db } = createDb();
  const sourceId = "account-delete-job-a";
  await enqueueStudyLinkCleanupReceipts(db, {
    sourceKind: "account_delete",
    sourceId,
    reason: "account_deleted",
    targets: [
      { familyId: "family-a", memberId: "member-connected" },
      { familyId: "family-a", memberId: "member-placeholder" },
    ],
    now: new Date("2026-08-27T00:00:00.000Z"),
  });
  const firstIds = sqlite.prepare(
    "SELECT child_member_id,request_id FROM study_link_cleanup_receipts ORDER BY child_member_id",
  ).all();
  assert.equal(firstIds.length, 2);
  assert.match(String(firstIds[0].request_id), /^[0-9a-f-]{36}$/);

  const failedCalls = [];
  const failed = await processPendingStudyLinkCleanups({
    DB: db,
    STUDY_SERVICE: {
      async deactivateCalendarChildLink(familyId, memberId, reason, requestId) {
        failedCalls.push({ familyId, memberId, reason, requestId });
        throw new Error("temporary upstream detail");
      },
    },
  }, new Date("2026-08-27T00:00:00.000Z"));
  assert.deepEqual(failed, { processed: 0, pending: 2 });
  assert.equal(await allStudyReceiptsCompleted(db, "account_delete", sourceId), false);
  assert.deepEqual(
    sqlite.prepare("SELECT DISTINCT last_error_code FROM study_link_cleanup_receipts").all()
      .map((row) => ({ ...row })),
    [{ last_error_code: "study_unavailable" }],
  );
  assert.doesNotMatch(
    JSON.stringify(sqlite.prepare("SELECT * FROM study_link_cleanup_receipts").all()),
    /temporary upstream detail/,
  );

  const successCalls = [];
  const succeeded = await processPendingStudyLinkCleanups({
    DB: db,
    STUDY_SERVICE: {
      async deactivateCalendarChildLink(familyId, memberId, reason, requestId) {
        successCalls.push({ familyId, memberId, reason, requestId });
        return { apiVersion: "2026-08-24", requestId, status: "completed" };
      },
    },
  }, new Date("2026-08-27T00:02:00.000Z"));
  assert.deepEqual(succeeded, { processed: 2, pending: 0 });
  assert.equal(await allStudyReceiptsCompleted(db, "account_delete", sourceId), true);
  assert.deepEqual(
    successCalls.map((call) => call.requestId).sort(),
    firstIds.map((row) => row.request_id).sort(),
  );
  assert.deepEqual(
    failedCalls.map((call) => call.requestId).sort(),
    successCalls.map((call) => call.requestId).sort(),
  );
});

test("같은 cleanup 재등록은 기존 request ID와 완료 receipt를 바꾸지 않는다", async () => {
  const { sqlite, db } = createDb();
  const input = {
    sourceKind: "child_deactivate",
    sourceId: studyCleanupSourceIdForChild("family-a", "child-user-a"),
    reason: "calendar_child_unpaired",
    targets: [{ familyId: "family-a", memberId: "member-a" }],
    now: new Date("2026-08-27T00:00:00.000Z"),
  };
  await enqueueStudyLinkCleanupReceipts(db, input);
  const requestId = sqlite.prepare("SELECT request_id FROM study_link_cleanup_receipts").get().request_id;
  sqlite.prepare(
    "UPDATE study_link_cleanup_receipts SET status='completed',completed_at=updated_at WHERE request_id=?",
  ).run(requestId);
  await enqueueStudyLinkCleanupReceipts(db, { ...input, now: new Date("2026-08-28T00:00:00.000Z") });
  assert.deepEqual(
    { ...sqlite.prepare("SELECT request_id,status,COUNT(*) AS count FROM study_link_cleanup_receipts").get() },
    { request_id: requestId, status: "completed", count: 1 },
  );
});

test("unpair receipt는 cleanup job과 같은 batch에서만 생성된다", async () => {
  const { sqlite, db } = createDb();
  sqlite.exec(`CREATE TABLE family_unpair_cleanup_jobs (
    family_id TEXT NOT NULL, child_user_id TEXT NOT NULL,
    PRIMARY KEY(family_id, child_user_id)
  )`);
  const input = {
    sourceKind: "child_deactivate",
    sourceId: studyCleanupSourceIdForChild("family-a", "child-a"),
    reason: "calendar_child_unpaired",
    targets: [{ familyId: "family-a", memberId: "member-a" }],
    now: new Date("2026-08-27T00:00:00.000Z"),
  };
  await db.batch(studyLinkCleanupReceiptStmtsForUnpairJob(
    db, input, "family-a", "child-a",
  ));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM study_link_cleanup_receipts").get().count, 0);

  await db.batch([
    db.prepare("INSERT INTO family_unpair_cleanup_jobs(family_id,child_user_id) VALUES (?,?)")
      .bind("family-a", "child-a"),
    ...studyLinkCleanupReceiptStmtsForUnpairJob(db, input, "family-a", "child-a"),
  ]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM study_link_cleanup_receipts").get().count, 1);
});

test("account receipt 대상은 claim batch 안에서 placeholder까지 선택된다", async () => {
  const { sqlite, db } = createDb();
  sqlite.exec(`
    CREATE TABLE account_deletion_jobs (id TEXT PRIMARY KEY);
    CREATE TABLE families (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL);
    CREATE TABLE family_members (
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT, role TEXT NOT NULL
    );
    INSERT INTO families(id,parent_id) VALUES ('family-a','parent-a');
    INSERT INTO family_members(id,family_id,user_id,role) VALUES
      ('member-connected','family-a','child-a','child'),
      ('member-placeholder','family-a',NULL,'child');
  `);
  const receipt = studyLinkCleanupReceiptStmtForAccountOwner(db, {
    jobId: "job-a",
    ownerUserId: "parent-a",
    now: new Date("2026-08-27T00:00:00.000Z"),
  });
  await db.batch([receipt]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM study_link_cleanup_receipts").get().count, 0);

  await db.batch([
    db.prepare("INSERT INTO account_deletion_jobs(id) VALUES (?)").bind("job-a"),
    studyLinkCleanupReceiptStmtForAccountOwner(db, {
      jobId: "job-a",
      ownerUserId: "parent-a",
      now: new Date("2026-08-27T00:00:00.000Z"),
    }),
  ]);
  const receipts = sqlite.prepare(
    "SELECT request_id,child_member_id FROM study_link_cleanup_receipts ORDER BY child_member_id",
  ).all();
  assert.deepEqual(receipts.map((row) => row.child_member_id), ["member-connected", "member-placeholder"]);
  assert.equal(new Set(receipts.map((row) => row.request_id)).size, 2);
  assert.ok(receipts.every((row) => /^[0-9a-f]{32}$/.test(row.request_id)));
});

test("기존 unpair·account finalization은 Study receipt 완료 전 삭제를 금지한다", () => {
  const unpair = readFileSync(new URL("../lib/unpairCleanup.ts", import.meta.url), "utf8");
  const account = readFileSync(new URL("../routes/account.ts", import.meta.url), "utf8");
  const family = readFileSync(new URL("../routes/family.ts", import.meta.url), "utf8");
  assert.match(unpair, /allStudyReceiptsCompleted/);
  assert.match(account, /account_delete[\s\S]*allStudyReceiptsCompleted/);
  assert.match(family, /studyLinkCleanupReceiptStmts/);
  assert.doesNotMatch(unpair + account + family, /deleteStudyHistory|deleteLearningHistory/);
});

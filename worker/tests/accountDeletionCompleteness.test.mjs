import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";
import { applyWebAiCreditRetentionFixture } from "./webAiCreditRetentionFixture.mjs";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(workerDir, "..");
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

const accountRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/account.ts")).href)).default;
const familyRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/family.ts")).href)).default;
const {
  acquireAccountMutationLease,
  cleanupExpiredAccountMutationLeases,
  releaseAccountMutationLease,
} = await import(pathToFileURL(resolve(workerDir, "lib/accountMutationLease.ts")).href);
const { cleanupCompletedAccountDeletionClaims } = await import(
  pathToFileURL(resolve(workerDir, "lib/accountDeletionClaims.ts")).href
);

class Statement {
  constructor(db, sql, bindings = [], owner = null) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
    this.owner = owner;
  }
  bind(...bindings) { return new Statement(this.db, this.sql, bindings, this.owner); }
  async first() { return this.db.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    await this.owner?.beforeRun?.(this);
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class Db {
  constructor(sqlite, options = {}) {
    this.sqlite = sqlite;
    this.failFinalFamilyBatch = options.failFinalFamilyBatch ?? false;
    this.failUnpairPrepare = options.failUnpairPrepare ?? false;
    this.failUnpairFinalize = options.failUnpairFinalize ?? false;
    this.maxBatchLength = 0;
  }
  prepare(sql) { return new Statement(this.sqlite, sql, [], this); }
  async beforeRun() {}
  async beforeBatch() {}
  async batch(statements) {
    this.maxBatchLength = Math.max(this.maxBatchLength, statements.length);
    if (
      this.failFinalFamilyBatch
      && statements.some((statement) => statement.sql.includes("DELETE FROM families WHERE id"))
    ) throw new Error("d1_final_batch_failed");
    const hasUnpairJobInsert = statements.some((statement) =>
      statement.sql.includes("INSERT INTO family_unpair_cleanup_jobs")
    );
    const hasUnpairJobDelete = statements.some((statement) =>
      statement.sql.includes("DELETE FROM family_unpair_cleanup_jobs")
    );
    if (this.failUnpairPrepare && hasUnpairJobInsert) throw new Error("unpair_prepare_failed");
    if (this.failUnpairFinalize && hasUnpairJobDelete) throw new Error("unpair_finalize_failed");
    await this.beforeBatch(statements);
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

class PausingSetupWriteDb extends Db {
  constructor(sqlite) {
    super(sqlite);
    this.writeStarted = new Promise((resolve) => { this.markWriteStarted = resolve; });
    this.resumePromise = new Promise((resolve) => { this.resumeWrite = resolve; });
    this.didPause = false;
  }

  shouldPause(statements) {
    return !this.didPause && statements.some((statement) =>
      statement.sql.includes("INSERT INTO families")
      || statement.sql.includes("UPDATE families SET")
    );
  }

  async pause() {
    this.didPause = true;
    this.markWriteStarted();
    await this.resumePromise;
  }

  async beforeRun(statement) {
    if (this.shouldPause([statement])) await this.pause();
  }

  async beforeBatch(statements) {
    if (this.shouldPause(statements)) await this.pause();
  }

  resume() {
    this.resumeWrite();
  }
}

class PhotosBucket {
  constructor(entries = [], options = {}) {
    this.keys = new Set(entries.map((entry) => typeof entry === "string" ? entry : entry.key));
    this.customMetadata = new Map(
      entries
        .filter((entry) => typeof entry !== "string" && entry.customMetadata)
        .map((entry) => [entry.key, entry.customMetadata]),
    );
    this.failList = options.failList ?? false;
    this.failDelete = options.failDelete ?? false;
  }
  async list({ prefix = "", limit = 1000, startAfter } = {}) {
    if (this.failList) throw new Error("r2_list_failed");
    const matching = [...this.keys]
      .filter((key) => key.startsWith(prefix) && (!startAfter || key > startAfter))
      .sort();
    const keys = matching.slice(0, limit);
    return {
      objects: keys.map((key) => ({
        key,
        size: 1,
        etag: `etag-${key}`,
        customMetadata: this.customMetadata.get(key),
      })),
      truncated: matching.length > keys.length,
    };
  }
  async delete(input) {
    if (this.failDelete) throw new Error("r2_delete_failed");
    for (const key of Array.isArray(input) ? input : [input]) {
      this.keys.delete(key);
      this.customMetadata.delete(key);
    }
  }
}

class PausingPhotosBucket extends PhotosBucket {
  constructor(entries = [], pausePrefix = "family-a/") {
    super(entries);
    this.pausePrefix = pausePrefix;
    this.pausePromise = new Promise((resolve) => { this.resumeList = resolve; });
    this.listStarted = new Promise((resolve) => { this.markListStarted = resolve; });
    this.didPause = false;
  }

  async list(options = {}) {
    if (!this.didPause && options.prefix === this.pausePrefix) {
      this.didPause = true;
      this.markListStarted();
      await this.pausePromise;
    }
    return super.list(options);
  }

  resume() {
    this.resumeList();
  }
}

function createDb(options = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  applyWebAiCreditRetentionFixture(sqlite);
  return { sqlite, db: options.pauseSetupWrite ? new PausingSetupWriteDb(sqlite) : new Db(sqlite, options) };
}

function addUser(sqlite, id) {
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES (?,0)").run(id);
  sqlite.prepare(
    "INSERT INTO user_profiles(user_id,display_name,provider,created_at,updated_at) VALUES (?,?,'test','2026-07-14','2026-07-14')",
  ).run(id, id);
}

function addFamily(sqlite, familyId, parentId, childRows = []) {
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code,created_at) VALUES (?,?,?,'2026-07-14')",
  ).run(familyId, parentId, `PAIR-${familyId}`.toUpperCase());
  sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at) VALUES (?,?,?,?,?,1,'2026-07-14')",
  ).run(`member-${parentId}`, familyId, parentId, "parent", parentId);
  for (const [memberId, userId] of childRows) {
    sqlite.prepare(
      "INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at) VALUES (?,?,?,'child',?,1,'2026-07-14')",
    ).run(memberId, familyId, userId, userId);
  }
}

function addTeacherGraph(sqlite, suffix, userId, familyId, childMemberId) {
  const teacherId = `teacher-${suffix}`;
  const classId = `class-${suffix}`;
  const pairingId = `pairing-${suffix}`;
  const noticeId = `notice-${suffix}`;
  const eventId = `teacher-event-${suffix}`;
  sqlite.prepare(
    "INSERT INTO teacher_profiles(id,user_id,display_name,created_at,updated_at) VALUES (?,?,?,'2026-07-14','2026-07-14')",
  ).run(teacherId, userId, `선생님-${suffix}`);
  sqlite.prepare(
    "INSERT INTO teacher_classes(id,teacher_id,class_name,created_at,updated_at) VALUES (?,?,?,'2026-07-14','2026-07-14')",
  ).run(classId, teacherId, `반-${suffix}`);
  sqlite.prepare(
    `INSERT INTO teacher_child_pairings
      (id,teacher_id,class_id,child_member_id,family_id,pairing_status,permission_scope,created_at,updated_at)
      VALUES (?,?,?,?,?,'approved','schedule_attendance','2026-07-14','2026-07-14')`,
  ).run(pairingId, teacherId, classId, childMemberId, familyId);
  sqlite.prepare(
    "INSERT INTO teacher_class_children(id,class_id,pairing_id,child_member_id,added_at) VALUES (?,?,?,?, '2026-07-14')",
  ).run(`class-child-${suffix}`, classId, pairingId, childMemberId);
  sqlite.prepare(
    `INSERT INTO teacher_notices
      (id,teacher_id,class_id,title,body,source_type,has_schedule,created_at,updated_at)
      VALUES (?,?,?,'알림','내용','text',1,'2026-07-14','2026-07-14')`,
  ).run(noticeId, teacherId, classId);
  sqlite.prepare(
    `INSERT INTO teacher_notice_recipients
      (id,notice_id,child_member_id,family_id,event_ids,read_by,created_at)
      VALUES (?,?,?,?,?,'{}','2026-07-14')`,
  ).run(`recipient-${suffix}`, noticeId, childMemberId, familyId, `{${eventId}}`);
  sqlite.prepare(
    `INSERT INTO teacher_attendance_logs
      (id,teacher_id,class_id,child_member_id,family_id,date_key,created_at,updated_at)
      VALUES (?,?,?,?,?,'2026-6-14','2026-07-14','2026-07-14')`,
  ).run(`attendance-${suffix}`, teacherId, classId, childMemberId, familyId);
  sqlite.prepare(
    `INSERT INTO teacher_notification_batches
      (id,teacher_id,class_id,batch_type,window_start,window_end,created_at)
      VALUES (?,?,?,'attendance','2026-07-14','2026-07-15','2026-07-14')`,
  ).run(`batch-${suffix}`, teacherId, classId);
  sqlite.prepare(
    "INSERT INTO teacher_pairing_attempts(id,teacher_id,attempted_at) VALUES (?,?,'2026-07-14')",
  ).run(`attempt-${suffix}`, teacherId);
  sqlite.prepare(
    `INSERT INTO teacher_schedule_notes
      (id,teacher_id,child_member_id,date_key,note,created_at,updated_at)
      VALUES (?,?,?,'2026-6-14','메모','2026-07-14','2026-07-14')`,
  ).run(`note-${suffix}`, teacherId, childMemberId);
  sqlite.prepare(
    `INSERT INTO events
      (id,family_id,date_key,title,time,category,emoji,color,bg,created_by,created_at,updated_at)
      VALUES (?,?, '2026-6-14','선생님 일정','09:00','school','x','x','x',?,'2026-07-14','2026-07-14')`,
  ).run(eventId, familyId, userId);
  sqlite.prepare("INSERT INTO events_children(event_id,child_id) VALUES (?,?)").run(eventId, childMemberId);
  return { teacherId, classId, pairingId, noticeId, eventId };
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));
const studyService = {
  async deactivateCalendarChildLink(_familyId, _memberId, _reason, requestId) {
    return { apiVersion: "2026-08-24", requestId, status: "completed" };
  },
};

async function authHeader(sub, role, familyId = null) {
  const token = await new SignJWT({ role, family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

async function deleteAccount(db, photos, actor, binding = studyService) {
  const app = new Hono();
  app.route("/api/account", accountRoutes);
  return app.request(
    "http://test.local/api/account/delete",
    { method: "POST", headers: { Authorization: await authHeader(actor.sub, actor.role, actor.familyId) } },
    {
      DB: db,
      PHOTOS: photos,
      STUDY_SERVICE: binding,
      JWT_PRIVATE_KEY: jwtPrivateKey,
      JWT_PUBLIC_KEY: jwtPublicKey,
      FAMILY_ROOM: {
        idFromName: (name) => name,
        get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
      },
    },
  );
}

async function unpairChild(db, photos, parentId, familyId, childUserId, binding = studyService) {
  const app = new Hono();
  app.route("/api/family", familyRoutes);
  return app.request(
    "http://test.local/api/family/unpair",
    {
      method: "POST",
      headers: {
        Authorization: await authHeader(parentId, "parent", familyId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ family_id: familyId, child_user_id: childUserId }),
    },
    {
      DB: db,
      PHOTOS: photos,
      STUDY_SERVICE: binding,
      JWT_PRIVATE_KEY: jwtPrivateKey,
      JWT_PUBLIC_KEY: jwtPublicKey,
      FAMILY_ROOM: {
        idFromName: (name) => name,
        get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
      },
    },
  );
}

async function joinChild(db, photos, childUserId, familyId) {
  const app = new Hono();
  app.route("/api/family", familyRoutes);
  return app.request(
    "http://test.local/api/family/join",
    {
      method: "POST",
      headers: {
        Authorization: await authHeader(childUserId, "child", familyId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pairCode: `PAIR-${familyId}`, name: childUserId }),
    },
    {
      DB: db,
      PHOTOS: photos,
      JWT_PRIVATE_KEY: jwtPrivateKey,
      JWT_PUBLIC_KEY: jwtPublicKey,
      FAMILY_ROOM: {
        idFromName: (name) => name,
        get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
      },
    },
  );
}

async function setupFamily(db, photos, parentId) {
  const app = new Hono();
  app.route("/api/family", familyRoutes);
  return app.request(
    "http://test.local/api/family/setup",
    {
      method: "POST",
      headers: {
        Authorization: await authHeader(parentId, "parent", null),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parentName: "부모",
        familyName: "새 가족",
        plannedChildCount: 1,
        children: [{ name: "아이" }],
      }),
    },
    {
      DB: db,
      PHOTOS: photos,
      JWT_PRIVATE_KEY: jwtPrivateKey,
      JWT_PUBLIC_KEY: jwtPublicKey,
      FAMILY_ROOM: {
        idFromName: (name) => name,
        get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
      },
    },
  );
}

function count(sqlite, table, where = "1=1", bindings = []) {
  return Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get(...bindings).count);
}

test("주 보호자 탈퇴는 가족·자녀·선생님 관계와 가족/선생님 R2 객체를 지우고 타 사용자는 보존한다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-a", "co-parent-a", "child-a", "parent-b", "child-b", "teacher-b"]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "parent-a", [["child-member-a", "child-a"]]);
  sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,name,is_active,created_at) VALUES ('member-co-parent-a','family-a','co-parent-a','parent','공동부모',1,'2026-07-14')",
  ).run();
  addFamily(sqlite, "family-b", "parent-b", [["child-member-b", "child-b"]]);
  addTeacherGraph(sqlite, "target", "parent-a", "family-b", "child-member-b");
  addTeacherGraph(sqlite, "other", "teacher-b", "family-b", "child-member-b");
  sqlite.prepare(
    "INSERT INTO child_locations(user_id,family_id,lat,lng,updated_at) VALUES ('child-a','family-a',1,1,'2026-07-14'),('child-b','family-b',2,2,'2026-07-14')",
  ).run();
  sqlite.prepare(
    "INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at) VALUES ('child-a','family-a',1,1,'2026-07-14'),('child-b','family-b',2,2,'2026-07-14')",
  ).run();
  const photos = new PhotosBucket([
    "family-a/child-a.jpg",
    "family-ab/must-stay.jpg",
    "teacher-notices/parent-a/notice.pdf",
    "teacher-notices/parent-ab/must-stay.pdf",
    "teacher-notices/teacher-b/must-stay.pdf",
  ]);

  const response = await deleteAccount(db, photos, { sub: "parent-a", role: "parent", familyId: "family-a" });
  assert.equal(response.status, 200, await response.text());
  assert.equal(count(sqlite, "families", "id='family-a'"), 0);
  assert.equal(count(sqlite, "users", "id IN ('parent-a','child-a')"), 0);
  assert.equal(count(sqlite, "users", "id='co-parent-a'"), 1);
  assert.equal(count(sqlite, "family_members", "user_id='co-parent-a'"), 0);
  assert.equal(count(sqlite, "user_profiles", "user_id IN ('parent-a','child-a')"), 0);
  assert.equal(count(sqlite, "teacher_profiles", "user_id='parent-a'"), 0);
  assert.equal(count(sqlite, "teacher_classes", "id='class-target'"), 0);
  assert.equal(count(sqlite, "teacher_notices", "id='notice-target'"), 0);
  assert.equal(count(sqlite, "teacher_class_children", "id='class-child-target'"), 0);
  assert.equal(count(sqlite, "teacher_schedule_notes", "id='note-target'"), 0);
  assert.equal(count(sqlite, "child_locations", "user_id='child-a'"), 0);
  assert.equal(count(sqlite, "location_history", "user_id='child-a'"), 0);
  assert.equal(count(sqlite, "families", "id='family-b'"), 1);
  assert.equal(count(sqlite, "teacher_profiles", "user_id='teacher-b'"), 1);
  assert.equal(count(sqlite, "teacher_notices", "id='notice-other'"), 1);
  assert.deepEqual([...photos.keys].sort(), [
    "family-ab/must-stay.jpg",
    "teacher-notices/parent-ab/must-stay.pdf",
    "teacher-notices/teacher-b/must-stay.pdf",
  ]);
  assert.ok(db.maxBatchLength <= 40, `D1 batch가 40개를 넘었습니다: ${db.maxBatchLength}`);
});

test("주 보호자 탈퇴는 타 가족 active child와 inactive 과거 child를 전역 삭제 후보로 삼지 않는다", async () => {
  const { sqlite, db } = createDb();
  for (const id of [
    "parent-a",
    "parent-b",
    "child-cross",
    "child-old",
    "child-membership-only",
    "child-inactive-only",
    "child-inactive-cross",
  ]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "parent-a", [
    ["member-cross-a", "child-cross"],
    ["member-old-a", "child-old"],
    ["member-membership-only-a", "child-membership-only"],
    ["member-inactive-only-a", "child-inactive-only"],
    ["member-inactive-cross-a", "child-inactive-cross"],
  ]);
  sqlite.prepare(
    "UPDATE family_members SET is_active=0 WHERE id IN ('member-old-a','member-inactive-only-a')",
  ).run();
  addFamily(sqlite, "family-b", "parent-b", [
    ["member-cross-b", "child-cross"],
    ["member-old-b", "child-old"],
    ["member-membership-only-b", "child-membership-only"],
    ["member-inactive-cross-b", "child-inactive-cross"],
  ]);
  sqlite.prepare("UPDATE family_members SET is_active=0 WHERE id='member-inactive-cross-b'").run();
  sqlite.prepare(
    `INSERT INTO auth_identities(id,user_id,provider,provider_id,created_at)
     VALUES ('identity-cross','child-cross','test','provider-cross','2026-07-14'),
            ('identity-old','child-old','test','provider-old','2026-07-14')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO refresh_tokens(token,user_id,family_id,issued_at,expires_at,revoked)
     VALUES ('refresh-cross-b','child-cross','family-b','2026-07-14','2026-08-14',0),
            ('refresh-old-b','child-old','family-b','2026-07-14','2026-08-14',0)`,
  ).run();
  sqlite.prepare(
    `INSERT INTO child_locations(user_id,family_id,lat,lng,updated_at)
     VALUES ('child-cross','family-b',1,1,'2026-07-14'),
            ('child-old','family-b',2,2,'2026-07-14'),
            ('child-membership-only','family-b',3,3,'2026-07-14')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO ai_chat_messages(id,family_id,child_user_id,role,content,created_at)
     VALUES ('ai-cross-b','family-b','child-cross','user','보존','2026-07-14'),
            ('ai-old-b','family-b','child-old','user','보존','2026-07-14'),
            ('ai-membership-only-b','family-b','child-membership-only','user','보존','2026-07-14')`,
  ).run();

  const response = await deleteAccount(db, new PhotosBucket([
    "family-a/must-delete.jpg",
    "family-b/must-stay.jpg",
  ]), { sub: "parent-a", role: "parent", familyId: "family-a" });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(count(sqlite, "families", "id='family-a'"), 0);
  assert.equal(count(sqlite, "family_members", "family_id='family-a'"), 0);
  assert.equal(count(sqlite, "users", "id='parent-a'"), 0);
  for (const childUserId of ["child-cross", "child-old", "child-membership-only"]) {
    assert.equal(count(sqlite, "users", "id=?", [childUserId]), 1, `${childUserId} user 보존`);
    if (childUserId !== "child-membership-only") {
      assert.equal(
        count(sqlite, "auth_identities", "user_id=?", [childUserId]),
        1,
        `${childUserId} auth identity 보존`,
      );
    }
    assert.equal(
      count(sqlite, "family_members", "family_id='family-b' AND user_id=? AND is_active=1", [childUserId]),
      1,
      `${childUserId} 타 가족 활성 membership 보존`,
    );
    assert.equal(
      count(sqlite, "child_locations", "family_id='family-b' AND user_id=?", [childUserId]),
      1,
      `${childUserId} 타 가족 위치 보존`,
    );
    assert.equal(
      count(sqlite, "ai_chat_messages", "family_id='family-b' AND child_user_id=?", [childUserId]),
      1,
      `${childUserId} 타 가족 AI 데이터 보존`,
    );
  }
  assert.equal(count(sqlite, "users", "id='child-inactive-only'"), 1);
  assert.equal(count(sqlite, "user_profiles", "user_id='child-inactive-only'"), 1);
  assert.equal(count(sqlite, "family_members", "user_id='child-inactive-only'"), 0);
  assert.equal(count(sqlite, "users", "id='child-inactive-cross'"), 1);
  assert.equal(
    count(sqlite, "family_members", "id='member-inactive-cross-b' AND is_active=0"),
    1,
    "타 가족 inactive 역사 membership도 독립 증거로 보존해야 합니다",
  );
});

test("선생님 self 탈퇴는 만든 반·연결·알림장·출결·배치·메모와 R2 첨부만 제거한다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-b", "child-b", "teacher-a", "teacher-b"]) addUser(sqlite, id);
  addFamily(sqlite, "family-b", "parent-b", [["child-member-b", "child-b"]]);
  addTeacherGraph(sqlite, "target", "teacher-a", "family-b", "child-member-b");
  addTeacherGraph(sqlite, "other", "teacher-b", "family-b", "child-member-b");
  const photos = new PhotosBucket([
    "teacher-notices/teacher-a/a.pdf",
    "teacher-notices/teacher-ab/must-stay.pdf",
    "teacher-notices/teacher-b/must-stay.pdf",
  ]);

  const response = await deleteAccount(db, photos, { sub: "teacher-a", role: "teacher", familyId: null });
  assert.equal(response.status, 200, await response.text());
  for (const [table, where] of [
    ["teacher_profiles", "user_id='teacher-a'"],
    ["teacher_classes", "id='class-target'"],
    ["teacher_child_pairings", "id='pairing-target'"],
    ["teacher_class_children", "id='class-child-target'"],
    ["teacher_notices", "id='notice-target'"],
    ["teacher_notice_recipients", "id='recipient-target'"],
    ["teacher_attendance_logs", "id='attendance-target'"],
    ["teacher_notification_batches", "id='batch-target'"],
    ["teacher_pairing_attempts", "id='attempt-target'"],
    ["teacher_schedule_notes", "id='note-target'"],
    ["events", "id='teacher-event-target'"],
  ]) assert.equal(count(sqlite, table, where), 0, `${table} target row must be removed`);
  assert.equal(count(sqlite, "teacher_profiles", "user_id='teacher-b'"), 1);
  assert.equal(count(sqlite, "teacher_notices", "id='notice-other'"), 1);
  assert.equal(count(sqlite, "families", "id='family-b'"), 1);
  assert.deepEqual([...photos.keys].sort(), [
    "teacher-notices/teacher-ab/must-stay.pdf",
    "teacher-notices/teacher-b/must-stay.pdf",
  ]);
});

test("아이 self 탈퇴는 본인 user/member 귀속 전체와 정확한 프로필 사진만 지우고 가족·형제 데이터는 보존한다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-a", "child-a", "child-b", "teacher-shared"]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "parent-a", [
    ["child-member-a", "child-a"],
    ["child-member-b", "child-b"],
  ]);
  sqlite.prepare("UPDATE family_members SET photo_url='https://api.example/api/storage/child-photos/family-a%2Fchild-a-profile.jpg?token=legacy' WHERE id='child-member-a'").run();
  sqlite.prepare("UPDATE family_members SET photo_url='family-a/child-b-profile.jpg' WHERE id='child-member-b'").run();
  for (const [userId, lat] of [["child-a", 1], ["child-b", 2]]) {
    sqlite.prepare("INSERT INTO child_locations(user_id,family_id,lat,lng,updated_at) VALUES (?,'family-a',?,?, '2026-07-14')")
      .run(userId, lat, lat);
    sqlite.prepare("INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at) VALUES (?,'family-a',?,?, '2026-07-14')")
      .run(userId, lat, lat);
    sqlite.prepare(
      "INSERT INTO ai_chat_messages(id,family_id,child_user_id,role,content,created_at) VALUES (?,'family-a',?,'user','메시지','2026-07-14')",
    ).run(`ai-${userId}`, userId);
    sqlite.prepare(
      "INSERT INTO memo_replies(id,family_id,date_key,user_id,user_role,content,created_at,child_id) VALUES (?,'family-a','2026-6-14',?,'child','메모','2026-07-14',?)",
    ).run(`memo-${userId}`, userId, userId === "child-a" ? "child-member-a" : "child-member-b");
    sqlite.prepare(
      "INSERT INTO stickers(id,user_id,family_id,event_id,date_key,earned_at) VALUES (?,?,'family-a','event','2026-6-14','2026-07-14')",
    ).run(`sticker-${userId}`, userId);
  }
  sqlite.prepare(
    "INSERT INTO memo_replies(id,family_id,date_key,user_id,user_role,content,created_at,child_id) VALUES ('memo-parent-to-a','family-a','2026-6-14','parent-a','parent','부모 메시지','2026-07-14','child-member-a')",
  ).run();
  sqlite.prepare(
    `INSERT INTO daily_supplies(id,family_id,child_id,date_key,supplies,homework,note,created_at,updated_at)
     VALUES ('supply-a','family-a','child-member-a','2026-6-14','','','','2026-07-14','2026-07-14'),
            ('supply-b','family-a','child-member-b','2026-6-14','','','','2026-07-14','2026-07-14')`,
  ).run();
  for (const suffix of ["a", "b"]) {
    sqlite.prepare(
      `INSERT INTO events(id,family_id,date_key,title,time,category,emoji,color,bg,created_by,created_at,updated_at)
       VALUES (?, 'family-a','2026-6-14','일정','09:00','school','x','x','x','parent-a','2026-07-14','2026-07-14')`,
    ).run(`event-${suffix}`);
    sqlite.prepare("INSERT INTO events_children(event_id,child_id) VALUES (?,?)")
      .run(`event-${suffix}`, `child-member-${suffix}`);
  }
  sqlite.prepare(
    "INSERT INTO teacher_profiles(id,user_id,display_name,created_at,updated_at) VALUES ('teacher-profile-shared','teacher-shared','선생님','2026-07-14','2026-07-14')",
  ).run();
  sqlite.prepare(
    "INSERT INTO teacher_classes(id,teacher_id,class_name,created_at,updated_at) VALUES ('class-shared','teacher-profile-shared','공유반','2026-07-14','2026-07-14')",
  ).run();
  for (const suffix of ["a", "b"]) {
    sqlite.prepare(
      `INSERT INTO teacher_child_pairings
       (id,teacher_id,class_id,child_member_id,family_id,pairing_status,permission_scope,created_at,updated_at)
       VALUES (?, 'teacher-profile-shared','class-shared',?,'family-a','approved','schedule_attendance','2026-07-14','2026-07-14')`,
    ).run(`member-pair-${suffix}`, `child-member-${suffix}`);
    sqlite.prepare(
      "INSERT INTO teacher_class_children(id,class_id,pairing_id,child_member_id,added_at) VALUES (?,'class-shared',?,?,'2026-07-14')",
    ).run(`member-class-child-${suffix}`, `member-pair-${suffix}`, `child-member-${suffix}`);
    sqlite.prepare(
      `INSERT INTO teacher_schedule_notes(id,teacher_id,child_member_id,date_key,note,created_at,updated_at)
       VALUES (?,'teacher-profile-shared',?,'2026-6-14','메모','2026-07-14','2026-07-14')`,
    ).run(`member-note-${suffix}`, `child-member-${suffix}`);
  }
  const photos = new PhotosBucket([
    "family-a/child-a-profile.jpg",
    "family-a/child-b-profile.jpg",
    "family-a/child-a-profile.jpg.backup",
    {
      key: "family-a/legacy-orphan-child-a.jpg",
      customMetadata: { familyId: "family-a", ownerUserId: "child-a", purpose: "legacy" },
    },
  ]);

  const response = await deleteAccount(db, photos, {
    sub: "child-a", role: "child", familyId: "family-a",
  });
  assert.equal(response.status, 200, await response.text());
  for (const table of ["child_locations", "location_history", "ai_chat_messages", "memo_replies", "stickers", "user_profiles"]) {
    const column = table === "ai_chat_messages" ? "child_user_id" : "user_id";
    assert.equal(count(sqlite, table, `${column}='child-a'`), 0, `${table} target row must be removed`);
    assert.equal(count(sqlite, table, `${column}='child-b'`), 1, `${table} sibling row must remain`);
  }
  assert.equal(count(sqlite, "memo_replies", "child_id='child-member-a'"), 0);
  assert.equal(count(sqlite, "memo_replies", "child_id='child-member-b'"), 1);
  assert.equal(count(sqlite, "daily_supplies", "child_id='child-member-a'"), 0);
  assert.equal(count(sqlite, "daily_supplies", "child_id='child-member-b'"), 1);
  assert.equal(count(sqlite, "events_children", "child_id='child-member-a'"), 0);
  assert.equal(count(sqlite, "events_children", "child_id='child-member-b'"), 1);
  assert.equal(count(sqlite, "teacher_child_pairings", "child_member_id='child-member-a'"), 0);
  assert.equal(count(sqlite, "teacher_child_pairings", "child_member_id='child-member-b'"), 1);
  assert.equal(count(sqlite, "teacher_class_children", "child_member_id='child-member-a'"), 0);
  assert.equal(count(sqlite, "teacher_class_children", "child_member_id='child-member-b'"), 1);
  assert.equal(count(sqlite, "teacher_schedule_notes", "child_member_id='child-member-a'"), 0);
  assert.equal(count(sqlite, "teacher_schedule_notes", "child_member_id='child-member-b'"), 1);
  assert.equal(count(sqlite, "families", "id='family-a'"), 1);
  assert.equal(count(sqlite, "users", "id='parent-a'"), 1);
  assert.deepEqual([...photos.keys].sort(), [
    "family-a/child-a-profile.jpg.backup",
    "family-a/child-b-profile.jpg",
  ]);
});

test("R2 목록 또는 삭제 실패 시 성공을 반환하지 않고 D1 계정과 가족을 보존한다", async () => {
  for (const photos of [
    new PhotosBucket(["family-a/a.jpg"], { failList: true }),
    new PhotosBucket(["family-a/a.jpg"], { failDelete: true }),
  ]) {
    const { sqlite, db } = createDb();
    addUser(sqlite, "parent-a");
    addFamily(sqlite, "family-a", "parent-a");
    const response = await deleteAccount(db, photos, {
      sub: "parent-a", role: "parent", familyId: "family-a",
    });
    assert.equal(response.status, 503);
    assert.equal(count(sqlite, "users", "id='parent-a'"), 1);
    assert.equal(count(sqlite, "families", "id='family-a'"), 1);
  }
});

test("D1 최종 batch 실패도 성공으로 위장하지 않고 재시도용 auth·family·member를 보존한다", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  applyWebAiCreditRetentionFixture(sqlite);
  const db = new Db(sqlite, { failFinalFamilyBatch: true });
  addUser(sqlite, "parent-a");
  addUser(sqlite, "child-a");
  addFamily(sqlite, "family-a", "parent-a", [["child-member-a", "child-a"]]);
  sqlite.prepare(
    "INSERT INTO refresh_tokens(token,user_id,family_id,revoked) VALUES ('refresh-parent','parent-a','family-a',0),('refresh-child','child-a','family-a',0)",
  ).run();
  const response = await deleteAccount(db, new PhotosBucket(["family-a/a.jpg"]), {
    sub: "parent-a", role: "parent", familyId: "family-a",
  });
  assert.equal(response.status, 503);
  assert.equal(count(sqlite, "users", "id IN ('parent-a','child-a')"), 2);
  assert.equal(count(sqlite, "families", "id='family-a'"), 1);
  assert.equal(count(sqlite, "family_members", "family_id='family-a'"), 2);
  assert.equal(count(sqlite, "refresh_tokens", "family_id='family-a'"), 2);
});

test("R2 가족 prefix가 1000개를 넘어도 페이지 누락 없이 삭제하고 인접 prefix는 보존한다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "parent-a");
  addFamily(sqlite, "family-a", "parent-a");
  const familyKeys = Array.from({ length: 1_005 }, (_, index) => `family-a/photo-${String(index).padStart(4, "0")}.jpg`);
  const photos = new PhotosBucket([...familyKeys, "family-ab/must-stay.jpg"]);
  const response = await deleteAccount(db, photos, {
    sub: "parent-a", role: "parent", familyId: "family-a",
  });
  assert.equal(response.status, 200, await response.text());
  assert.deepEqual([...photos.keys], ["family-ab/must-stay.jpg"]);
});

test("아이 self 사진 키를 형제가 함께 참조하면 R2 객체는 보존한다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-a", "child-a", "child-b"]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "parent-a", [
    ["child-member-a", "child-a"],
    ["child-member-b", "child-b"],
  ]);
  sqlite.prepare(
    "UPDATE family_members SET photo_url='family-a/shared.jpg' WHERE id IN ('child-member-a','child-member-b')",
  ).run();
  const photos = new PhotosBucket(["family-a/shared.jpg"]);
  const response = await deleteAccount(db, photos, {
    sub: "child-a", role: "child", familyId: "family-a",
  });
  assert.equal(response.status, 200, await response.text());
  assert.deepEqual([...photos.keys], ["family-a/shared.jpg"]);
});

test("아이 self 메모 이미지 키를 남는 형제 스레드가 참조하면 R2 객체는 보존한다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-a", "child-a", "child-b"]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "parent-a", [
    ["child-member-a", "child-a"],
    ["child-member-b", "child-b"],
  ]);
  sqlite.prepare(
    `INSERT INTO memo_replies(id,family_id,date_key,user_id,user_role,content,created_at,child_id)
     VALUES ('memo-image-a','family-a','2026-6-14','child-a','child','[[img:family-a/uploads/child-a/shared-memo.jpg]]','2026-07-14','child-member-a'),
            ('memo-image-b','family-a','2026-6-14','child-b','child','[[img:family-a/uploads/child-a/shared-memo.jpg]]','2026-07-14','child-member-b')`,
  ).run();
  const photos = new PhotosBucket(["family-a/uploads/child-a/shared-memo.jpg"]);
  const response = await deleteAccount(db, photos, {
    sub: "child-a", role: "child", familyId: "family-a",
  });
  assert.equal(response.status, 200, await response.text());
  assert.deepEqual([...photos.keys], ["family-a/uploads/child-a/shared-memo.jpg"]);
});

test("아이 self 탈퇴는 메모 저장 전에 실패한 본인 업로드 prefix도 삭제한다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-a", "child-a", "child-b"]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "parent-a", [
    ["child-member-a", "child-a"],
    ["child-member-b", "child-b"],
  ]);
  const photos = new PhotosBucket([
    "family-a/uploads/child-a/orphan-a.jpg",
    "family-a/uploads/child-b/orphan-b.jpg",
  ]);

  const response = await deleteAccount(db, photos, {
    sub: "child-a", role: "child", familyId: "family-a",
  });
  assert.equal(response.status, 200, await response.text());
  assert.deepEqual([...photos.keys], ["family-a/uploads/child-b/orphan-b.jpg"]);
});

test("과거 hard-unpair 사용자는 본인 refresh family snapshot으로 본인 소유 R2만 회수한다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-a", "child-a", "child-b"]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "parent-a", [["child-member-b", "child-b"]]);
  sqlite.prepare(
    `INSERT INTO refresh_tokens(token,user_id,family_id,issued_at,expires_at,revoked)
     VALUES ('hashed-refresh-a','child-a','family-a','2026-07-01','2026-08-01',0)`,
  ).run();
  sqlite.prepare(
    `INSERT INTO memo_replies(id,family_id,date_key,user_id,user_role,content,created_at,child_id)
     VALUES ('memo-shared','family-a','2026-6-14','child-b','child','[[img:family-a/uploads/child-a/shared.jpg]]','2026-07-14','child-member-b')`,
  ).run();
  const photos = new PhotosBucket([
    "family-a/uploads/child-a/orphan.jpg",
    "family-a/uploads/child-a/shared.jpg",
    "family-a/uploads/child-a/shared-profile.jpg",
    "family-a/uploads/child-b/must-stay.jpg",
    "family-b/uploads/child-a/not-in-snapshot.jpg",
    {
      key: "family-a/legacy-child-a.jpg",
      customMetadata: { familyId: "family-a", ownerUserId: "child-a", purpose: "legacy" },
    },
    {
      key: "family-a/legacy-child-b.jpg",
      customMetadata: { familyId: "family-a", ownerUserId: "child-b", purpose: "legacy" },
    },
  ]);

  const response = await deleteAccount(db, photos, {
    sub: "child-a", role: "child", familyId: "family-a",
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(count(sqlite, "users", "id='child-a'"), 0);
  assert.deepEqual([...photos.keys].sort(), [
    "family-a/legacy-child-b.jpg",
    "family-a/uploads/child-a/shared.jpg",
    "family-a/uploads/child-b/must-stay.jpg",
    "family-b/uploads/child-a/not-in-snapshot.jpg",
  ]);
});

test("과거 refresh family snapshot이 한 페이지를 넘어도 모든 본인 업로드 scope를 회수한다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "child-history");
  const familyIds = Array.from({ length: 65 }, (_, index) => `history-family-${String(index).padStart(2, "0")}`);
  const insertRefresh = sqlite.prepare(
    `INSERT INTO refresh_tokens(token,user_id,family_id,issued_at,expires_at,revoked)
     VALUES (?,'child-history',?,'2026-07-01','2026-08-01',0)`,
  );
  for (const [index, familyId] of familyIds.entries()) {
    insertRefresh.run(`refresh-history-${index}`, familyId);
  }
  const photos = new PhotosBucket([
    ...familyIds.map((familyId) => `${familyId}/uploads/child-history/orphan.jpg`),
    "unrelated-family/uploads/child-history/must-stay.jpg",
  ]);

  const response = await deleteAccount(db, photos, {
    sub: "child-history", role: "child", familyId: null,
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual([...photos.keys], ["unrelated-family/uploads/child-history/must-stay.jpg"]);
});

test("계정 삭제는 Study 실패 시 Calendar를 보존하고 같은 receipt ID로 재시도한다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-study", "child-study"]) addUser(sqlite, id);
  addFamily(sqlite, "family-study", "parent-study", [["member-study", "child-study"]]);
  const photos = new PhotosBucket(["family-study/photo.jpg"]);
  const failedRequestIds = [];
  const failed = await deleteAccount(db, photos, {
    sub: "parent-study", role: "parent", familyId: "family-study",
  }, {
    async deactivateCalendarChildLink(_familyId, _memberId, _reason, requestId) {
      failedRequestIds.push(requestId);
      throw new Error("temporary upstream detail");
    },
  });
  assert.equal(failed.status, 503);
  assert.equal(count(sqlite, "families", "id='family-study'"), 1);
  assert.equal(count(sqlite, "family_members", "id='member-study'"), 1);
  assert.equal(count(sqlite, "account_deletion_jobs", "owner_user_id='parent-study'"), 1);
  assert.equal(count(sqlite, "study_link_cleanup_receipts", "status='pending'"), 1);
  assert.equal(
    sqlite.prepare("SELECT last_error_code FROM study_link_cleanup_receipts").get().last_error_code,
    "study_unavailable",
  );

  sqlite.prepare(
    "UPDATE study_link_cleanup_receipts SET next_attempt_at='2000-01-01T00:00:00.000Z'",
  ).run();
  const successRequestIds = [];
  const retried = await deleteAccount(db, photos, {
    sub: "parent-study", role: "parent", familyId: "family-study",
  }, {
    async deactivateCalendarChildLink(_familyId, _memberId, _reason, requestId) {
      successRequestIds.push(requestId);
      return { apiVersion: "2026-08-24", requestId, status: "completed" };
    },
  });
  assert.equal(retried.status, 200, await retried.text());
  assert.deepEqual(successRequestIds, failedRequestIds);
  assert.equal(count(sqlite, "families", "id='family-study'"), 0);
});

test("아이 연결 해제는 Study 실패 시 inactive job을 보존하고 같은 receipt ID로 재시도한다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-study", "child-study"]) addUser(sqlite, id);
  addFamily(sqlite, "family-study", "parent-study", [["member-study", "child-study"]]);
  const failedRequestIds = [];
  const failed = await unpairChild(
    db,
    new PhotosBucket(),
    "parent-study",
    "family-study",
    "child-study",
    {
      async deactivateCalendarChildLink(_familyId, _memberId, _reason, requestId) {
        failedRequestIds.push(requestId);
        throw new Error("temporary upstream detail");
      },
    },
  );
  assert.equal(failed.status, 200, await failed.clone().text());
  assert.deepEqual(await failed.json(), { ok: true, cleanup_pending: true });
  assert.equal(count(sqlite, "family_members", "id='member-study' AND is_active=0"), 1);
  assert.equal(count(sqlite, "family_unpair_cleanup_jobs", "child_user_id='child-study'"), 1);

  sqlite.prepare(
    "UPDATE study_link_cleanup_receipts SET next_attempt_at='2000-01-01T00:00:00.000Z'",
  ).run();
  const successRequestIds = [];
  const retried = await unpairChild(
    db,
    new PhotosBucket(),
    "parent-study",
    "family-study",
    "child-study",
    {
      async deactivateCalendarChildLink(_familyId, _memberId, _reason, requestId) {
        successRequestIds.push(requestId);
        return { apiVersion: "2026-08-24", requestId, status: "completed" };
      },
    },
  );
  assert.equal(retried.status, 200, await retried.clone().text());
  assert.deepEqual(await retried.json(), { ok: true, cleanup_pending: false });
  assert.deepEqual(successRequestIds, failedRequestIds);
  assert.equal(count(sqlite, "family_members", "id='member-study'"), 0);
});

test("아이 연결 해제는 멤버 행 삭제 전에 업로더 prefix와 해당 스레드를 정리하고 남은 가족 참조는 보존한다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-a", "child-a", "child-b"]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "parent-a", [
    ["child-member-a", "child-a"],
    ["child-member-b", "child-b"],
  ]);
  sqlite.prepare(
    "UPDATE family_members SET photo_url='family-a/uploads/child-a/shared-profile.jpg' WHERE id IN ('child-member-a','child-member-b')",
  ).run();
  sqlite.prepare(
    `INSERT INTO memo_replies(id,family_id,date_key,user_id,user_role,content,created_at,child_id)
     VALUES ('memo-child-only','family-a','2026-6-14','child-a','child','[[img:family-a/uploads/child-a/child-only.jpg]]','2026-07-14','child-member-a'),
            ('memo-shared-a','family-a','2026-6-14','child-a','child','[[img:family-a/uploads/child-a/shared.jpg]]','2026-07-14','child-member-a'),
            ('memo-shared-b','family-a','2026-6-14','child-b','child','[[img:family-a/uploads/child-a/shared.jpg]]','2026-07-14','child-member-b')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO daily_supplies(id,family_id,child_id,date_key,supplies,homework,note,created_at,updated_at)
     VALUES ('unpair-supply-a','family-a','child-member-a','2026-6-14','','','','2026-07-14','2026-07-14'),
            ('unpair-supply-b','family-a','child-member-b','2026-6-14','','','','2026-07-14','2026-07-14')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO point_transactions(id,wallet_id,family_id,member_id,type,category,amount,balance_after,created_at)
     VALUES ('unpair-point-a','wallet-a','family-a','child-member-a','earn','test',1,1,'2026-07-14'),
            ('unpair-point-b','wallet-b','family-a','child-member-b','earn','test',1,1,'2026-07-14')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO subscriptions(id,family_id,child_id,status,product_id,price_krw,created_at,updated_at)
     VALUES ('unpair-sub-a','family-a','child-member-a','active','test',0,'2026-07-14','2026-07-14'),
            ('unpair-sub-b','family-a','child-member-b','active','test',0,'2026-07-14','2026-07-14')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO child_locations(user_id,family_id,lat,lng,updated_at)
     VALUES ('child-a','family-a',1,1,'2026-07-14'),('child-b','family-a',2,2,'2026-07-14')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO ai_chat_messages(id,family_id,child_user_id,role,content,created_at)
     VALUES ('unpair-ai-a','family-a','child-a','user','삭제','2026-07-14'),
            ('unpair-ai-b','family-a','child-b','user','보존','2026-07-14')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO emergency_audio_chunks(id,family_id,child_id,parent_id,file_url,duration_seconds,sequence_number,recorded_at)
     VALUES ('unpair-audio-a','family-a','child-a','parent-a','a.wav',1,1,'2026-07-14'),
            ('unpair-audio-b','family-a','child-b','parent-a','b.wav',1,1,'2026-07-14')`,
  ).run();
  addTeacherGraph(sqlite, "unpair-a", "parent-a", "family-a", "child-member-a");
  addTeacherGraph(sqlite, "unpair-b", "parent-a", "family-a", "child-member-b");
  const photos = new PhotosBucket([
    "family-a/uploads/child-a/orphan-before-memo.jpg",
    "family-a/uploads/child-a/child-only.jpg",
    "family-a/uploads/child-a/shared.jpg",
    "family-a/uploads/child-a/shared-profile.jpg",
    "family-a/uploads/child-b/must-stay.jpg",
    {
      key: "family-a/legacy-orphan-child-a.jpg",
      customMetadata: { familyId: "family-a", ownerUserId: "child-a", purpose: "legacy" },
    },
  ]);

  const response = await unpairChild(db, photos, "parent-a", "family-a", "child-a");
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(count(sqlite, "family_members", "user_id='child-a'"), 0);
  assert.equal(count(sqlite, "family_members", "user_id='child-b'"), 1);
  assert.equal(count(sqlite, "memo_replies", "id IN ('memo-child-only','memo-shared-a')"), 0);
  assert.equal(count(sqlite, "memo_replies", "id='memo-shared-b'"), 1);
  for (const [table, targetWhere, siblingWhere] of [
    ["daily_supplies", "child_id='child-member-a'", "child_id='child-member-b'"],
    ["point_transactions", "member_id='child-member-a'", "member_id='child-member-b'"],
    ["subscriptions", "child_id='child-member-a'", "child_id='child-member-b'"],
    ["teacher_child_pairings", "child_member_id='child-member-a'", "child_member_id='child-member-b'"],
    ["teacher_class_children", "child_member_id='child-member-a'", "child_member_id='child-member-b'"],
    ["teacher_notice_recipients", "child_member_id='child-member-a'", "child_member_id='child-member-b'"],
    ["teacher_attendance_logs", "child_member_id='child-member-a'", "child_member_id='child-member-b'"],
    ["teacher_schedule_notes", "child_member_id='child-member-a'", "child_member_id='child-member-b'"],
    ["child_locations", "user_id='child-a'", "user_id='child-b'"],
    ["ai_chat_messages", "child_user_id='child-a'", "child_user_id='child-b'"],
    ["emergency_audio_chunks", "child_id='child-a'", "child_id='child-b'"],
  ]) {
    assert.equal(count(sqlite, table, targetWhere), 0, `${table} target row must be removed`);
    assert.equal(count(sqlite, table, siblingWhere), 1, `${table} sibling row must remain`);
  }
  assert.deepEqual([...photos.keys].sort(), [
    "family-a/uploads/child-a/shared-profile.jpg",
    "family-a/uploads/child-a/shared.jpg",
    "family-a/uploads/child-b/must-stay.jpg",
  ]);
});

test("아이 연결 해제 cleanup 실패는 inactive+job을 남기고 재페어링을 막은 뒤 멱등 재시도로 완료한다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-a", "child-a"]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "parent-a", [["child-member-a", "child-a"]]);
  sqlite.prepare(
    `INSERT INTO memo_replies(id,family_id,date_key,user_id,user_role,content,created_at,child_id)
     VALUES ('memo-a','family-a','2026-6-14','child-a','child','[[img:family-a/uploads/child-a/memo.jpg]]','2026-07-14','child-member-a')`,
  ).run();
  const photos = new PhotosBucket(
    ["family-a/uploads/child-a/memo.jpg"],
    { failDelete: true },
  );

  const response = await unpairChild(db, photos, "parent-a", "family-a", "child-a");
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { ok: true, cleanup_pending: true });
  assert.equal(count(sqlite, "family_members", "user_id='child-a'"), 1);
  assert.equal(count(sqlite, "family_members", "user_id='child-a' AND is_active=0"), 1);
  assert.equal(count(sqlite, "memo_replies", "id='memo-a'"), 1);
  const job = sqlite.prepare(
    "SELECT member_ids, attempts, last_error FROM family_unpair_cleanup_jobs WHERE family_id='family-a' AND child_user_id='child-a'",
  ).get();
  assert.equal(job?.member_ids, '["child-member-a"]');
  assert.equal(job?.attempts, 1);
  assert.equal(job?.last_error, "r2_cleanup_failed");

  const rejoin = await joinChild(db, photos, "child-a", "family-a");
  assert.equal(rejoin.status, 409, await rejoin.text());

  photos.failDelete = false;
  const retried = await unpairChild(db, photos, "parent-a", "family-a", "child-a");
  assert.equal(retried.status, 200, await retried.clone().text());
  assert.deepEqual(await retried.json(), { ok: true, cleanup_pending: false });
  assert.equal(count(sqlite, "family_members", "user_id='child-a'"), 0);
  assert.equal(count(sqlite, "memo_replies", "id='memo-a'"), 0);
  assert.equal(count(sqlite, "family_unpair_cleanup_jobs", "child_user_id='child-a'"), 0);
});

test("아이 연결 해제 prepare batch 실패는 active 멤버와 R2를 그대로 보존한다", async () => {
  const { sqlite, db } = createDb({ failUnpairPrepare: true });
  for (const id of ["parent-a", "child-a"]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "parent-a", [["child-member-a", "child-a"]]);
  const photos = new PhotosBucket(["family-a/uploads/child-a/orphan.jpg"]);

  const response = await unpairChild(db, photos, "parent-a", "family-a", "child-a");
  assert.equal(response.status, 503, await response.clone().text());
  assert.deepEqual(await response.json(), { error: "unpair_prepare_retryable" });
  assert.equal(count(sqlite, "family_members", "user_id='child-a' AND is_active=1"), 1);
  assert.equal(count(sqlite, "family_unpair_cleanup_jobs"), 0);
  assert.deepEqual([...photos.keys], ["family-a/uploads/child-a/orphan.jpg"]);
});

test("R2 성공 뒤 D1 finalize 실패도 inactive job으로 격리하고 cron과 같은 재진입으로 완료한다", async () => {
  const { sqlite, db } = createDb({ failUnpairFinalize: true });
  for (const id of ["parent-a", "child-a"]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "parent-a", [["child-member-a", "child-a"]]);
  sqlite.prepare(
    `INSERT INTO memo_replies(id,family_id,date_key,user_id,user_role,content,created_at,child_id)
     VALUES ('memo-a','family-a','2026-6-14','child-a','child','[[img:family-a/uploads/child-a/memo.jpg]]','2026-07-14','child-member-a')`,
  ).run();
  const photos = new PhotosBucket(["family-a/uploads/child-a/memo.jpg"]);

  const response = await unpairChild(db, photos, "parent-a", "family-a", "child-a");
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { ok: true, cleanup_pending: true });
  assert.equal(count(sqlite, "family_members", "user_id='child-a' AND is_active=0"), 1);
  assert.equal(count(sqlite, "memo_replies", "id='memo-a'"), 1);
  assert.equal(count(sqlite, "family_unpair_cleanup_jobs", "child_user_id='child-a'"), 1);
  assert.deepEqual([...photos.keys], []);

  db.failUnpairFinalize = false;
  const retried = await unpairChild(db, photos, "parent-a", "family-a", "child-a");
  assert.equal(retried.status, 200, await retried.clone().text());
  assert.deepEqual(await retried.json(), { ok: true, cleanup_pending: false });
  assert.equal(count(sqlite, "family_members", "user_id='child-a'"), 0);
  assert.equal(count(sqlite, "memo_replies", "id='memo-a'"), 0);
  assert.equal(count(sqlite, "family_unpair_cleanup_jobs", "child_user_id='child-a'"), 0);
});

test("F1 부모 탈퇴가 R2에서 지연되는 동안 F2 join이 성공했다면 새 가족 세션과 참조를 지우지 않는다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-a", "child-a", "parent-b"]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "parent-a", [["child-member-a", "child-a"]]);
  addFamily(sqlite, "family-b", "parent-b");
  const photos = new PausingPhotosBucket(["family-a/uploads/child-a/old.jpg"]);

  const deletionPromise = deleteAccount(db, photos, {
    sub: "parent-a",
    role: "parent",
    familyId: "family-a",
  });
  await photos.listStarted;

  const joinResponse = await joinChild(db, photos, "child-a", "family-b");
  const joinStatus = joinResponse.status;
  if (joinStatus === 200) {
    sqlite.prepare(
      "INSERT INTO child_locations(user_id,family_id,lat,lng,updated_at) VALUES ('child-a','family-b',1,1,'2026-07-14')",
    ).run();
    sqlite.prepare(
      `INSERT INTO ai_chat_messages(id,family_id,child_user_id,role,content,created_at)
       VALUES ('ai-after-join','family-b','child-a','user','보존','2026-07-14')`,
    ).run();
  }

  photos.resume();
  const deletionResponse = await deletionPromise;
  assert.equal(deletionResponse.status, 200, await deletionResponse.clone().text());
  assert.ok(
    joinStatus === 200 || joinStatus === 409,
    `삭제 claim과 경합한 join은 성공 후 보존되거나 409로 닫혀야 합니다: ${joinStatus}`,
  );
  assert.equal(count(sqlite, "families", "id='family-a'"), 0);
  assert.equal(count(sqlite, "families", "id='family-b'"), 1);

  if (joinStatus === 200) {
    assert.equal(count(sqlite, "users", "id='child-a'"), 1, "성공한 F2 join 사용자는 보존해야 합니다");
    assert.equal(
      count(sqlite, "family_members", "family_id='family-b' AND user_id='child-a' AND is_active=1"),
      1,
      "성공한 F2 membership을 보존해야 합니다",
    );
    assert.equal(
      count(sqlite, "refresh_tokens", "family_id='family-b' AND user_id='child-a' AND revoked=0"),
      1,
      "성공한 F2 세션을 보존해야 합니다",
    );
    assert.equal(count(sqlite, "child_locations", "family_id='family-b' AND user_id='child-a'"), 1);
    assert.equal(count(sqlite, "ai_chat_messages", "id='ai-after-join'"), 1);
  } else {
    assert.equal(
      count(sqlite, "family_members", "family_id='family-b' AND user_id='child-a'"),
      0,
      "409로 닫힌 join은 부분 membership을 남기면 안 됩니다",
    );
    assert.equal(
      count(sqlite, "refresh_tokens", "family_id='family-b' AND user_id='child-a'"),
      0,
      "409로 닫힌 join은 부분 세션을 남기면 안 됩니다",
    );
  }
});

test("계정 삭제 claim이 먼저 확정되면 같은 가족 unpair는 부분 tombstone 없이 409로 닫힌다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-a", "child-a"]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "parent-a", [["child-member-a", "child-a"]]);
  const photos = new PausingPhotosBucket(["family-a/uploads/child-a/old.jpg"]);

  const deletionPromise = deleteAccount(db, photos, {
    sub: "parent-a",
    role: "parent",
    familyId: "family-a",
  });
  await photos.listStarted;

  const unpairResponse = await unpairChild(db, photos, "parent-a", "family-a", "child-a");
  const activeDuringRace = count(
    sqlite,
    "family_members",
    "family_id='family-a' AND user_id='child-a' AND is_active=1",
  );
  const pendingDuringRace = count(
    sqlite,
    "family_unpair_cleanup_jobs",
    "family_id='family-a' AND child_user_id='child-a'",
  );

  photos.resume();
  const deletionResponse = await deletionPromise;
  assert.equal(deletionResponse.status, 200, await deletionResponse.clone().text());
  assert.equal(unpairResponse.status, 409, await unpairResponse.clone().text());
  assert.deepEqual(await unpairResponse.json(), { error: "account_deletion_in_progress" });
  assert.equal(activeDuringRace, 1, "거부된 unpair는 active membership을 바꾸면 안 됩니다");
  assert.equal(pendingDuringRace, 0, "거부된 unpair는 cleanup job을 만들면 안 됩니다");
});

test("unpair tombstone이 먼저 확정되면 account delete는 cleanup 대상을 빼앗지 않고 409로 닫힌다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-a", "child-a"]) addUser(sqlite, id);
  addFamily(sqlite, "family-a", "parent-a", [["child-member-a", "child-a"]]);
  const photos = new PhotosBucket(["family-a/uploads/child-a/pending.jpg"], { failDelete: true });

  const unpairResponse = await unpairChild(db, photos, "parent-a", "family-a", "child-a");
  assert.equal(unpairResponse.status, 200, await unpairResponse.clone().text());
  assert.deepEqual(await unpairResponse.json(), { ok: true, cleanup_pending: true });
  assert.equal(count(sqlite, "family_unpair_cleanup_jobs", "child_user_id='child-a'"), 1);
  assert.equal(count(sqlite, "family_members", "user_id='child-a' AND is_active=0"), 1);

  const deletionResponse = await deleteAccount(db, photos, {
    sub: "parent-a",
    role: "parent",
    familyId: "family-a",
  });
  assert.equal(deletionResponse.status, 409, await deletionResponse.clone().text());
  assert.deepEqual(await deletionResponse.json(), { error: "account_deletion_conflict" });
  assert.equal(count(sqlite, "users", "id='parent-a'"), 1);
  assert.equal(count(sqlite, "families", "id='family-a'"), 1);
  assert.equal(count(sqlite, "account_deletion_jobs", "owner_user_id='parent-a'"), 0);
  assert.equal(count(sqlite, "family_unpair_cleanup_jobs", "child_user_id='child-a'"), 1);
});

test("자녀 mutation lease가 먼저면 unpair는 tombstone 없이 409로 닫히고 lease 해제 후 완료된다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-unpair-lease", "child-unpair-lease"]) addUser(sqlite, id);
  addFamily(sqlite, "family-unpair-lease", "parent-unpair-lease", [
    ["child-member-unpair-lease", "child-unpair-lease"],
  ]);
  const photos = new PhotosBucket();
  const lease = await acquireAccountMutationLease(db, {
    userId: "child-unpair-lease",
    familyId: "family-unpair-lease",
  });
  assert.equal(lease.status, "acquired");

  const blocked = await unpairChild(
    db,
    photos,
    "parent-unpair-lease",
    "family-unpair-lease",
    "child-unpair-lease",
  );
  assert.equal(blocked.status, 409, await blocked.clone().text());
  assert.deepEqual(await blocked.json(), { error: "child_mutation_in_progress" });
  assert.equal(
    count(sqlite, "family_members", "user_id='child-unpair-lease' AND is_active=1"),
    1,
  );
  assert.equal(count(sqlite, "family_unpair_cleanup_jobs", "child_user_id='child-unpair-lease'"), 0);

  await releaseAccountMutationLease(db, lease.lease.id);
  const completed = await unpairChild(
    db,
    photos,
    "parent-unpair-lease",
    "family-unpair-lease",
    "child-unpair-lease",
  );
  assert.equal(completed.status, 200, await completed.clone().text());
  assert.equal(count(sqlite, "family_members", "user_id='child-unpair-lease'"), 0);
});

test("unpair job이 먼저면 같은 자녀·가족 mutation lease를 발급하지 않는다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-unpair-first", "child-unpair-first"]) addUser(sqlite, id);
  addFamily(sqlite, "family-unpair-first", "parent-unpair-first", [
    ["child-member-unpair-first", "child-unpair-first"],
  ]);
  const photos = new PhotosBucket(
    ["family-unpair-first/uploads/child-unpair-first/pending.jpg"],
    { failDelete: true },
  );

  const unpair = await unpairChild(
    db,
    photos,
    "parent-unpair-first",
    "family-unpair-first",
    "child-unpair-first",
  );
  assert.equal(unpair.status, 200, await unpair.clone().text());
  assert.deepEqual(await unpair.json(), { ok: true, cleanup_pending: true });
  assert.equal(count(sqlite, "family_unpair_cleanup_jobs", "child_user_id='child-unpair-first'"), 1);

  const blockedLease = await acquireAccountMutationLease(db, {
    userId: "child-unpair-first",
    familyId: "family-unpair-first",
  });
  assert.equal(blockedLease.status, "blocked");
  assert.equal(count(sqlite, "account_mutation_leases", "user_id='child-unpair-first'"), 0);
});

test("가족 setup lease가 먼저면 계정 삭제를 재시도로 닫고 setup 전체만 원자 완료한다", async () => {
  const { sqlite, db } = createDb({ pauseSetupWrite: true });
  addUser(sqlite, "parent-setup-race");
  const photos = new PhotosBucket();

  const setupPromise = setupFamily(db, photos, "parent-setup-race");
  await db.writeStarted;

  const deletionResponse = await deleteAccount(db, photos, {
    sub: "parent-setup-race",
    role: "parent",
    familyId: null,
  });
  assert.equal(deletionResponse.status, 409, await deletionResponse.clone().text());
  assert.deepEqual(await deletionResponse.json(), { error: "account_deletion_conflict" });

  db.resume();
  const setupResponse = await setupPromise;
  assert.equal(setupResponse.status, 200, await setupResponse.clone().text());
  const setup = await setupResponse.json();
  assert.equal(count(sqlite, "users", "id='parent-setup-race'"), 1);
  assert.equal(count(sqlite, "families", "parent_id='parent-setup-race'"), 1);
  assert.equal(count(sqlite, "family_members", `family_id='${setup.id}' AND user_id='parent-setup-race'`), 1);
  assert.equal(count(sqlite, "family_members", `family_id='${setup.id}' AND role='child'`), 1);
});

test("계정 삭제 claim이 먼저 확정되면 가족 setup은 어떤 부분 행도 만들지 않는다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "parent-setup-blocked");
  const photos = new PausingPhotosBucket([], "teacher-notices/parent-setup-blocked/");

  const deletionPromise = deleteAccount(db, photos, {
    sub: "parent-setup-blocked",
    role: "parent",
    familyId: null,
  });
  await photos.listStarted;

  const setupResponse = await setupFamily(db, photos, "parent-setup-blocked");
  assert.equal(setupResponse.status, 409, await setupResponse.clone().text());
  assert.deepEqual(await setupResponse.json(), { error: "account_deletion_in_progress" });
  assert.equal(count(sqlite, "families", "parent_id='parent-setup-blocked'"), 0);
  assert.equal(count(sqlite, "family_members", "user_id='parent-setup-blocked'"), 0);

  photos.resume();
  const deletionResponse = await deletionPromise;
  assert.equal(deletionResponse.status, 200, await deletionResponse.clone().text());
  assert.equal(count(sqlite, "users", "id='parent-setup-blocked'"), 0);
});

test("setup 원자 batch가 먼저 완료되면 뒤 account delete가 새 가족·placeholder·user를 모두 삭제한다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "parent-setup-first");
  const photos = new PhotosBucket();
  const setupResponse = await setupFamily(db, photos, "parent-setup-first");
  assert.equal(setupResponse.status, 200, await setupResponse.clone().text());
  const setup = await setupResponse.json();
  assert.equal(count(sqlite, "families", "parent_id='parent-setup-first'"), 1);
  assert.equal(count(sqlite, "family_members", `family_id='${setup.id}' AND role='child'`), 1);

  const deletionResponse = await deleteAccount(db, photos, {
    sub: "parent-setup-first",
    role: "parent",
    familyId: setup.id,
  });
  assert.equal(deletionResponse.status, 200, await deletionResponse.clone().text());
  assert.equal(count(sqlite, "users", "id='parent-setup-first'"), 0);
  assert.equal(count(sqlite, "families", `id='${setup.id}'`), 0);
  assert.equal(count(sqlite, "family_members", `family_id='${setup.id}'`), 0);
});

test("활성 자녀·가족 mutation lease가 먼저면 부모 account delete는 데이터 변경 없이 재시도로 닫힌다", async () => {
  const { sqlite, db } = createDb();
  for (const id of ["parent-lease", "child-lease"]) addUser(sqlite, id);
  addFamily(sqlite, "family-lease", "parent-lease", [["child-member-lease", "child-lease"]]);
  const photos = new PhotosBucket();
  const leaseResult = await acquireAccountMutationLease(db, {
    userId: "child-lease",
    familyId: "family-lease",
  });
  assert.equal(leaseResult.status, "acquired");

  const blocked = await deleteAccount(db, photos, {
    sub: "parent-lease",
    role: "parent",
    familyId: "family-lease",
  });
  assert.equal(blocked.status, 409, await blocked.clone().text());
  assert.deepEqual(await blocked.json(), { error: "account_deletion_conflict" });
  assert.equal(count(sqlite, "users", "id='parent-lease'"), 1);
  assert.equal(count(sqlite, "families", "id='family-lease'"), 1);
  assert.equal(count(sqlite, "account_deletion_jobs", "owner_user_id='parent-lease'"), 0);

  await releaseAccountMutationLease(db, leaseResult.lease.id);
  const completed = await deleteAccount(db, photos, {
    sub: "parent-lease",
    role: "parent",
    familyId: "family-lease",
  });
  assert.equal(completed.status, 200, await completed.clone().text());
  assert.equal(count(sqlite, "users", "id='parent-lease'"), 0);
  assert.equal(count(sqlite, "account_deletion_jobs", "owner_user_id='parent-lease' AND status='completed'"), 1);
  assert.equal(count(sqlite, "account_deletion_scopes", "scope_id='parent-lease'"), 1);
});

test("완료 deletion tombstone은 24시간 동안 새 mutation을 막고 만료 cleanup은 멱등이다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "user-tombstone");
  const photos = new PhotosBucket();
  const completed = await deleteAccount(db, photos, {
    sub: "user-tombstone",
    role: "parent",
    familyId: null,
  });
  assert.equal(completed.status, 200, await completed.clone().text());
  const blockedLease = await acquireAccountMutationLease(db, {
    userId: "user-tombstone",
    familyId: null,
  });
  assert.equal(blockedLease.status, "blocked");

  sqlite.prepare(
    "UPDATE account_deletion_jobs SET updated_at='2026-07-14T00:00:00.000Z' WHERE owner_user_id='user-tombstone'",
  ).run();
  assert.deepEqual(
    await cleanupCompletedAccountDeletionClaims(db, new Date("2026-07-14T23:59:59.000Z")),
    { scopes: 0, jobs: 0 },
  );
  assert.deepEqual(
    await cleanupCompletedAccountDeletionClaims(db, new Date("2026-07-15T00:00:01.000Z")),
    { scopes: 1, jobs: 1 },
  );
  assert.deepEqual(
    await cleanupCompletedAccountDeletionClaims(db, new Date("2026-07-16T00:00:01.000Z")),
    { scopes: 0, jobs: 0 },
  );
});

test("비정상 종료로 남은 mutation lease는 1시간 TTL 뒤 cron cleanup이 멱등 회수한다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "user-expired-lease");
  const now = new Date("2026-07-14T00:00:00.000Z");
  const acquired = await acquireAccountMutationLease(db, {
    userId: "user-expired-lease",
    familyId: null,
    now,
  });
  assert.equal(acquired.status, "acquired");
  assert.equal(
    await cleanupExpiredAccountMutationLeases(db, new Date("2026-07-14T00:59:59.000Z")),
    0,
  );
  assert.equal(count(sqlite, "account_mutation_leases"), 1);
  assert.equal(
    await cleanupExpiredAccountMutationLeases(db, new Date("2026-07-14T01:00:01.000Z")),
    1,
  );
  assert.equal(await cleanupExpiredAccountMutationLeases(db, new Date("2026-07-14T02:00:00.000Z")), 0);
});

test("R2 실패 뒤 동일 account delete 재시도와 완료 후 stale JWT 재호출은 멱등 성공한다", async () => {
  const { sqlite, db } = createDb();
  addUser(sqlite, "user-delete-retry");
  const photos = new PhotosBucket([], { failList: true });
  const actor = { sub: "user-delete-retry", role: "parent", familyId: null };

  const failed = await deleteAccount(db, photos, actor);
  assert.equal(failed.status, 503, await failed.clone().text());
  assert.equal(count(sqlite, "users", "id='user-delete-retry'"), 1);
  assert.equal(count(sqlite, "account_deletion_jobs", "owner_user_id='user-delete-retry' AND status='claimed'"), 1);

  photos.failList = false;
  const retried = await deleteAccount(db, photos, actor);
  assert.equal(retried.status, 200, await retried.clone().text());
  assert.equal(count(sqlite, "users", "id='user-delete-retry'"), 0);
  assert.equal(count(sqlite, "account_deletion_jobs", "owner_user_id='user-delete-retry' AND status='completed'"), 1);

  const repeated = await deleteAccount(db, photos, actor);
  assert.equal(repeated.status, 200, await repeated.clone().text());
  assert.equal(count(sqlite, "account_deletion_jobs", "owner_user_id='user-delete-retry' AND status='completed'"), 1);
  assert.equal(count(sqlite, "account_deletion_scopes", "scope_id='user-delete-retry'"), 1);
});

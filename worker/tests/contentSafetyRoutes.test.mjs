import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";

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

const memoRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/memos.ts")).href)).default;
const aiRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/ai-chat-data.ts")).href)).default;

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

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY, is_anonymous INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE families(id TEXT PRIMARY KEY, parent_id TEXT NOT NULL, created_at TEXT);
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT, role TEXT NOT NULL,
      name TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT, last_selected_at TEXT
    );
    CREATE TABLE memo_replies(
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, date_key TEXT NOT NULL, child_id TEXT,
      user_id TEXT, user_role TEXT NOT NULL, content TEXT NOT NULL, origin TEXT,
      read_by TEXT DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE ai_chat_messages(
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, child_user_id TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT NOT NULL, animal_character TEXT,
      flagged INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE user_feedback(
      id TEXT PRIMARY KEY, family_id TEXT, user_id TEXT NOT NULL, type TEXT NOT NULL,
      message TEXT NOT NULL, error_logs TEXT, device_info TEXT, current_screen TEXT,
      status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL
    );
    CREATE TABLE user_interaction_blocks(
      family_id TEXT NOT NULL, blocker_user_id TEXT NOT NULL, blocked_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(family_id, blocker_user_id, blocked_user_id)
    );
    CREATE TABLE memo_interaction_leases(
      family_id TEXT NOT NULL, user_a_id TEXT NOT NULL, user_b_id TEXT NOT NULL,
      lease_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY(family_id,user_a_id,user_b_id),
      CHECK(user_a_id <> user_b_id), CHECK(user_a_id < user_b_id)
    );
    CREATE TABLE pending_notifications(
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, title TEXT, body TEXT, data TEXT,
      delivered INTEGER NOT NULL DEFAULT 0, delivered_at TEXT, created_at TEXT,
      expires_at TEXT
    );
    CREATE TABLE account_deletion_scopes(
      job_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(scope_type,scope_id)
    );
    CREATE TABLE account_mutation_leases(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, family_id TEXT,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE family_unpair_cleanup_jobs(
      family_id TEXT NOT NULL, child_user_id TEXT NOT NULL
    );
  `);
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-a", "parent-a", "2026-07-14 00:00:00+00");
  sqlite.prepare("INSERT INTO families VALUES (?,?,?)").run("family-b", "parent-b", "2026-07-14 00:00:00+00");
  const members = [
    ["parent-member-a", "family-a", "parent-a", "parent", "부모", 1],
    ["child-member-a", "family-a", "child-a", "child", "혜니", 1],
    ["child-member-b", "family-a", "child-b", "child", "동생", 1],
    ["parent-member-b", "family-b", "parent-b", "parent", "다른 부모", 1],
    ["child-member-other", "family-b", "child-other", "child", "다른 아이", 1],
    ["child-member-a-other-family", "family-b", "child-a", "child", "같은 아이 다른 가족", 1],
  ];
  for (const row of members) {
    sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?,?,NULL)")
      .run(...row, "2026-07-14 00:00:00+00");
  }
  for (const userId of new Set(members.map((row) => row[2]))) {
    sqlite.prepare("INSERT OR IGNORE INTO users(id) VALUES (?)").run(userId);
  }
  const replies = [
    ["reply-child", "family-a", "2026-6-14", "child-member-a", "child-a", "child", "안녕"],
    ["reply-parent", "family-a", "2026-6-14", "child-member-a", "parent-a", "parent", "잘 다녀와"],
    ["reply-other", "family-b", "2026-6-14", "child-member-other", "child-other", "child", "다른 가족"],
  ];
  for (const row of replies) {
    assert.equal(row.length, 7, JSON.stringify(row));
    sqlite.prepare(
      "INSERT INTO memo_replies(id,family_id,date_key,child_id,user_id,user_role,content,origin,read_by) VALUES (?,?,?,?,?,?,?,'reply','{}')",
    ).run(row[0], row[1], row[2], row[3], row[4], row[5], row[6]);
  }
  const aiMessages = [
    ["ai-own", "family-a", "child-a", "assistant", "AI 답변"],
    ["ai-user", "family-a", "child-a", "user", "아이 질문"],
    ["ai-sibling", "family-a", "child-b", "assistant", "형제 답변"],
    ["ai-other-family", "family-b", "child-a", "assistant", "다른 가족 답변"],
  ];
  for (const row of aiMessages) {
    sqlite.prepare("INSERT INTO ai_chat_messages VALUES (?,?,?,?,?,NULL,0,?)")
      .run(...row, "2026-07-14 01:00:00+00");
  }
  return { sqlite, db: new Db(sqlite) };
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

async function authorization(sub, role, familyId) {
  const token = await new SignJWT({ role, family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

async function request(db, path, actor, init = {}) {
  const app = new Hono();
  app.route("/api/memos", memoRoutes);
  app.route("/api/ai", aiRoutes);
  return app.request(
    `http://test.local${path}`,
    {
      ...init,
      headers: {
        Authorization: await authorization(actor.sub, actor.role, actor.familyId),
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    },
    {
      DB: db,
      JWT_PRIVATE_KEY: jwtPrivateKey,
      JWT_PUBLIC_KEY: jwtPublicKey,
      FAMILY_ROOM: {
        idFromName: (name) => name,
        get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
      },
    },
  );
}

test("아이는 자기 assistant 답변만 신고하고 중복은 멱등 성공한다", async () => {
  const { sqlite, db } = createDb();
  const actor = { sub: "child-a", role: "child", familyId: "family-a" };
  const body = JSON.stringify({ reason: "inaccurate", detail: "사실과 달라" });
  const first = await request(db, "/api/ai/messages/ai-own/report", actor, { method: "POST", body });
  const duplicate = await request(db, "/api/ai/messages/ai-own/report", actor, { method: "POST", body });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, duplicate: false });
  assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM user_feedback").get().count, 1);

  const userRole = await request(db, "/api/ai/messages/ai-user/report", actor, { method: "POST", body });
  const sibling = await request(db, "/api/ai/messages/ai-sibling/report", actor, { method: "POST", body });
  const otherFamily = await request(db, "/api/ai/messages/ai-other-family/report", actor, { method: "POST", body });
  const parentRole = await request(db, "/api/ai/messages/ai-own/report", {
    sub: "child-a", role: "parent", familyId: "family-a",
  }, { method: "POST", body });
  assert.equal(userRole.status, 404);
  assert.equal(sibling.status, 404);
  assert.equal(otherFamily.status, 404);
  assert.equal(parentRole.status, 403);
});

test("메모 신고는 정확한 가족·아이 스레드와 상대 메시지만 허용한다", async () => {
  const { sqlite, db } = createDb();
  const actor = { sub: "parent-a", role: "parent", familyId: "family-a" };
  const body = JSON.stringify({ reason: "harassment" });
  const valid = await request(db, "/api/memos/replies/reply-child/report", actor, { method: "POST", body });
  const own = await request(db, "/api/memos/replies/reply-parent/report", actor, { method: "POST", body });
  const other = await request(db, "/api/memos/replies/reply-other/report", actor, { method: "POST", body });
  assert.equal(valid.status, 200);
  assert.equal(own.status, 400);
  assert.equal(other.status, 403);
  const payload = JSON.parse(sqlite.prepare("SELECT message FROM user_feedback").get().message);
  assert.equal(payload.contentId, "reply-child");
  assert.equal("content" in payload, false);
});

test("메모 차단은 조회와 남은 memo pending만 숨기고 안전 pending은 유지한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO pending_notifications VALUES (?,?,?,?,?,0,NULL,?,NULL)")
    .run("pending-memo", "family-a", "메모", "안녕", JSON.stringify({ type: "new_memo", targetUserId: "parent-a", senderUserId: "child-a" }), "2026-07-14 01:00:00+00");
  sqlite.prepare("INSERT INTO pending_notifications VALUES (?,?,?,?,?,0,NULL,?,NULL)")
    .run("pending-sos", "family-a", "SOS", "도와줘", JSON.stringify({ type: "sos", targetUserId: "parent-a", senderUserId: "child-a" }), "2026-07-14 01:00:00+00");
  const actor = { sub: "parent-a", role: "parent", familyId: "family-a" };
  const block = await request(db, "/api/memos/blocks", actor, {
    method: "POST",
    body: JSON.stringify({ family_id: "family-a", target_user_id: "child-a" }),
  });
  assert.equal(block.status, 200);
  const pending = sqlite.prepare("SELECT id, delivered FROM pending_notifications ORDER BY id").all()
    .map((row) => ({ id: String(row.id), delivered: Number(row.delivered) }));
  assert.deepEqual(pending, [
    { id: "pending-memo", delivered: 1 },
    { id: "pending-sos", delivered: 0 },
  ]);

  const thread = await request(
    db,
    "/api/memos/replies?family_id=family-a&date_keys=2026-6-14&child_id=child-member-a",
    actor,
  );
  assert.equal(thread.status, 200);
  assert.deepEqual((await thread.json()).map((row) => row.id), ["reply-parent"]);
  const blocks = await request(db, "/api/memos/blocks?family_id=family-a", actor);
  assert.deepEqual(await blocks.json(), { blockedUserIds: ["child-a"] });
});

test("전송 pair lease가 잡혀 있으면 차단과 해제는 성공으로 응답하지 않는다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare(
    `INSERT INTO memo_interaction_leases
       (family_id,user_a_id,user_b_id,lease_token,expires_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    "family-a",
    "child-a",
    "parent-a",
    "delivery-token",
    "2099-07-14T01:02:00.000Z",
    "2026-07-14T01:00:00.000Z",
    "2026-07-14T01:00:00.000Z",
  );
  const actor = { sub: "parent-a", role: "parent", familyId: "family-a" };
  const block = await request(db, "/api/memos/blocks", actor, {
    method: "POST",
    body: JSON.stringify({ family_id: "family-a", target_user_id: "child-a" }),
  });
  assert.equal(block.status, 409);
  assert.deepEqual(await block.json(), { error: "memo_interaction_busy" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM user_interaction_blocks").get().count, 0);

  sqlite.prepare("INSERT INTO user_interaction_blocks VALUES (?,?,?,?)")
    .run("family-a", "parent-a", "child-a", "2026-07-14 01:00:00+00");
  const unblock = await request(
    db,
    "/api/memos/blocks/child-a?family_id=family-a",
    actor,
    { method: "DELETE" },
  );
  assert.equal(unblock.status, 409);
  assert.deepEqual(await unblock.json(), { error: "memo_interaction_busy" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM user_interaction_blocks").get().count, 1);
});

test("차단 상대의 계정 삭제 claim이 먼저면 pair 정책 행을 만들지 않는다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO account_deletion_scopes VALUES (?,?,?,?)")
    .run("delete-child-a", "user", "child-a", "2026-07-14T01:00:00.000Z");
  const actor = { sub: "parent-a", role: "parent", familyId: "family-a" };
  const block = await request(db, "/api/memos/blocks", actor, {
    method: "POST",
    body: JSON.stringify({ family_id: "family-a", target_user_id: "child-a" }),
  });
  assert.equal(block.status, 409);
  assert.deepEqual(await block.json(), { error: "account_mutation_blocked" });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM user_interaction_blocks").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM memo_interaction_leases").get().count, 0);
});

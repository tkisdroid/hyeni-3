import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(workerDir, "..");
const hook = registerHooks({
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
after(() => hook.deregister());

const { issueRefreshToken, rotateRefreshToken } = await import(
  pathToFileURL(resolve(workerDir, "lib/refresh.ts")).href
);

class Statement {
  constructor(owner, sql, bindings = []) {
    this.owner = owner;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.owner, this.sql, bindings);
  }

  async first() {
    const row = this.owner.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
    await this.owner.afterFirst(this, row);
    return row;
  }

  async all() {
    return { results: this.owner.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes ?? 0) } };
  }
}

class Db {
  constructor(sqlite) {
    this.sqlite = sqlite;
    this.batchTail = Promise.resolve();
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async afterFirst() {}

  async batch(statements) {
    const previous = this.batchTail;
    let release;
    this.batchTail = new Promise((resolveRelease) => {
      release = resolveRelease;
    });
    await previous;
    try {
      this.sqlite.exec("BEGIN IMMEDIATE");
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  }
}

class PausingAfterRefreshReadDb extends Db {
  constructor(sqlite) {
    super(sqlite);
    this.readStarted = new Promise((resolveStarted) => {
      this.resolveStarted = resolveStarted;
    });
    this.resumePromise = new Promise((resolveResume) => {
      this.resolveResume = resolveResume;
    });
    this.paused = false;
  }

  async afterFirst(statement) {
    if (this.paused || !statement.sql.includes("SELECT * FROM refresh_tokens WHERE token=?")) return;
    this.paused = true;
    this.resolveStarted();
    await this.resumePromise;
  }

  resume() {
    this.resolveResume();
  }
}

function createSqlite() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  return sqlite;
}

function addUser(sqlite, userId) {
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES (?,0)").run(userId);
}

function addRefresh(sqlite, { token, userId, familyId = null, deviceId = null, revoked = 0, rotatedTo = null }) {
  sqlite.prepare(
    `INSERT INTO refresh_tokens
      (token,user_id,family_id,device_id,issued_at,expires_at,revoked,rotated_to,rotated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    token,
    userId,
    familyId,
    deviceId,
    new Date(Date.now() - 60_000).toISOString(),
    new Date(Date.now() + 86_400_000).toISOString(),
    revoked,
    rotatedTo,
    revoked ? new Date().toISOString() : null,
  );
}

function beginDeletion(sqlite, userId, familyId = null) {
  const jobId = `delete-${userId}`;
  sqlite.prepare(
    `INSERT INTO account_deletion_jobs
      (id,owner_user_id,mode,status,attempts,created_at,updated_at)
     VALUES (?,?,?,'claimed',0,'2026-07-14','2026-07-14')`,
  ).run(jobId, userId, familyId ? "family" : "self");
  sqlite.prepare(
    `INSERT INTO account_deletion_scopes(job_id,scope_type,scope_id,created_at)
     VALUES (?,'user',?,'2026-07-14')`,
  ).run(jobId, userId);
  if (familyId) {
    sqlite.prepare(
      `INSERT INTO account_deletion_scopes(job_id,scope_type,scope_id,created_at)
       VALUES (?,'family',?,'2026-07-14')`,
    ).run(jobId, familyId);
  }
}

test("삭제된 사용자나 삭제 claim 대상에는 refresh token을 새로 발급하지 않는다", async () => {
  const sqlite = createSqlite();
  const db = new Db(sqlite);

  await assert.rejects(() => issueRefreshToken(db, "missing-user", null));
  addUser(sqlite, "deleting-user");
  beginDeletion(sqlite, "deleting-user");
  await assert.rejects(() => issueRefreshToken(db, "deleting-user", null));

  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM refresh_tokens").get().count, 0);
});

test("old refresh 조회 뒤 계정 삭제가 끝나도 orphan token과 세션을 되살리지 않는다", async () => {
  const sqlite = createSqlite();
  addUser(sqlite, "refresh-race-user");
  addRefresh(sqlite, { token: "old-refresh", userId: "refresh-race-user", deviceId: "device-one" });
  const db = new PausingAfterRefreshReadDb(sqlite);

  const rotation = rotateRefreshToken(db, "old-refresh", "device-one");
  await db.readStarted;
  beginDeletion(sqlite, "refresh-race-user");
  sqlite.prepare("DELETE FROM refresh_tokens WHERE user_id=?").run("refresh-race-user");
  sqlite.prepare("DELETE FROM users WHERE id=?").run("refresh-race-user");
  db.resume();
  const result = await rotation;

  assert.equal(result, null);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM refresh_tokens").get().count, 0);
});

test("같은 old refresh의 동시 회전은 하나의 live token으로 수렴한다", async () => {
  const sqlite = createSqlite();
  addUser(sqlite, "parallel-refresh-user");
  addRefresh(sqlite, { token: "parallel-old", userId: "parallel-refresh-user", deviceId: "device-one" });
  const db = new Db(sqlite);

  const [first, second] = await Promise.all([
    rotateRefreshToken(db, "parallel-old", "device-one"),
    rotateRefreshToken(db, "parallel-old", "device-one"),
  ]);

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.newToken, second.newToken);
  assert.equal(
    sqlite.prepare(
      "SELECT COUNT(*) AS count FROM refresh_tokens WHERE user_id='parallel-refresh-user' AND revoked=0",
    ).get().count,
    1,
  );
});

test("삭제 claim 이후에는 이미 회전된 token chain도 반환하지 않는다", async () => {
  const sqlite = createSqlite();
  addUser(sqlite, "chain-deleting-user");
  addRefresh(sqlite, {
    token: "chain-old",
    userId: "chain-deleting-user",
    deviceId: "device-one",
    revoked: 1,
    rotatedTo: "chain-live",
  });
  addRefresh(sqlite, {
    token: "chain-live",
    userId: "chain-deleting-user",
    deviceId: "device-one",
  });
  beginDeletion(sqlite, "chain-deleting-user");

  const result = await rotateRefreshToken(new Db(sqlite), "chain-old", "device-one");

  assert.equal(result, null);
});

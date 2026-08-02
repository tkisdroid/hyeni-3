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
        if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
after(() => hook.deregister());

const { upsertDaySummary } = await import(pathToFileURL(resolve(workerDir, "routes/ai.ts")).href);
const { insertChatMessages } = await import(pathToFileURL(resolve(workerDir, "routes/ai-child-chat.ts")).href);
const { aiMutationScopeState } = await import(
  pathToFileURL(resolve(workerDir, "lib/aiMutationScope.ts")).href
);

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
    return { success: true, meta: { changes: Number(result.changes) } };
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

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  const parentId = "11111111-1111-4111-8111-111111111111";
  const childId = "22222222-2222-4222-8222-222222222222";
  const familyId = "33333333-3333-4333-8333-333333333333";
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES (?,0),(?,0)").run(parentId, childId);
  sqlite.prepare("INSERT INTO families(id,parent_id,pair_code) VALUES (?,?,?)")
    .run(familyId, parentId, "PAIR-AI");
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active)
     VALUES ('parent-ai',?,?,'parent','부모',1),('child-ai',?,?,'child','아이',1)`,
  ).run(familyId, parentId, familyId, childId);
  return { sqlite, db: new Db(sqlite), parentId, childId, familyId };
}

test("day-summary 외부 응답 대기 중 삭제 scope가 생기면 최종 upsert가 orphan을 만들지 않는다", async () => {
  const { sqlite, db, parentId, childId, familyId } = fixture();
  assert.equal(await aiMutationScopeState(db, {
    actorUserId: parentId,
    familyId,
    childUserId: childId,
    actorRole: "parent",
  }), "active", "외부 호출을 시작할 때는 유효한 가족이어야 합니다");

  sqlite.prepare(
    "INSERT INTO account_deletion_scopes(job_id,scope_type,scope_id,created_at) VALUES ('delete-ai','family',?,'2026-07-14')",
  ).run(familyId);
  const stored = await upsertDaySummary(
    db,
    parentId,
    familyId,
    childId,
    "2026-07-14",
    "저장되면 안 되는 요약",
    { promptVersion: 2 },
  );
  assert.equal(stored, false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_day_summaries").get().n, 0);
});

test("child-chat 외부 응답 대기 중 삭제 scope가 생기면 대화 batch 전체가 0건으로 닫힌다", async () => {
  const { sqlite, db, childId, familyId } = fixture();
  assert.equal(await aiMutationScopeState(db, {
    actorUserId: childId,
    familyId,
    childUserId: childId,
    actorRole: "child",
  }), "active");

  sqlite.prepare(
    "INSERT INTO account_deletion_scopes(job_id,scope_type,scope_id,created_at) VALUES ('delete-chat','user',?,'2026-07-14')",
  ).run(childId);
  const logged = await insertChatMessages(db, familyId, childId, "🐰", [
    { role: "user", content: "안녕", flagged: false },
    { role: "assistant", content: "안녕!", flagged: false },
  ]);
  assert.equal(logged, null);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_chat_messages").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_credit_ledger").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM ai_memory_summaries").get().n, 0);
});

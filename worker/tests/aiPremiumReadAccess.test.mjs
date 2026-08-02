import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
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

const { authorizePremiumAiParent } = await import(
  pathToFileURL(resolve(workerDir, "lib/aiPremiumParentAccess.ts")).href
);

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
}

class Db {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new Statement(this.sqlite, sql);
  }
}

function future() {
  return new Date(Date.now() + 24 * 60 * 60_000).toISOString();
}

function past() {
  return new Date(Date.now() - 24 * 60 * 60_000).toISOString();
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      user_tier TEXT DEFAULT 'free',
      subscription_tier TEXT DEFAULT 'free'
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE family_subscription(
      family_id TEXT PRIMARY KEY,
      status TEXT,
      trial_ends_at TEXT,
      current_period_end TEXT,
      remote_listen_enabled INTEGER DEFAULT 1
    );
    CREATE TABLE subscriptions(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      status TEXT NOT NULL,
      expires_at TEXT
    );
    CREATE TABLE family_review_rewards(
      family_id TEXT PRIMARY KEY,
      granted_at TEXT
    );
  `);

  for (const [familyId, parentId] of [
    ["family-free", "parent-free"],
    ["family-reviewed", "parent-reviewed"],
    ["family-premium", "parent-premium"],
    ["family-expired", "parent-expired"],
  ]) {
    sqlite.prepare("INSERT INTO families VALUES (?,?,?,?)")
      .run(familyId, parentId, "free", "free");
    sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,1)")
      .run(`member-${parentId}`, familyId, parentId, "parent");
  }
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,1)")
    .run("member-child", "family-premium", "child-premium", "child");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,0)")
    .run("member-inactive", "family-premium", "parent-inactive", "parent");
  sqlite.prepare("INSERT INTO family_review_rewards VALUES (?,?)")
    .run("family-reviewed", "2026-07-01T00:00:00.000Z");
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-premium", "active", null, future(), 1);
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?,?,?,?)")
    .run("family-expired", "expired", null, past(), 1);
  return { sqlite, db: new Db(sqlite) };
}

test("AI 하루·주간 요약은 공통 엔타이틀먼트가 확인한 활성 Premium 부모만 허용한다", async () => {
  const { sqlite, db } = createDb();
  assert.deepEqual(await authorizePremiumAiParent(db, {
    callerUserId: "parent-premium",
    familyId: "family-premium",
  }), { ok: true, familyId: "family-premium" });

  for (const callerUserId of ["child-premium", "parent-inactive"]) {
    assert.deepEqual(await authorizePremiumAiParent(db, {
      callerUserId,
      familyId: "family-premium",
    }), { ok: false, status: 403, error: "forbidden" });
  }
  sqlite.close();
});

test("Free·기존 review 혜택·만료 구독은 AI Premium 요약을 열지 않는다", async () => {
  const { sqlite, db } = createDb();
  for (const [callerUserId, familyId] of [
    ["parent-free", "family-free"],
    ["parent-reviewed", "family-reviewed"],
    ["parent-expired", "family-expired"],
  ]) {
    assert.deepEqual(await authorizePremiumAiParent(db, { callerUserId, familyId }), {
      ok: false,
      status: 403,
      error: "premium_required",
    });
  }
  sqlite.close();
});

test("엔타이틀먼트 조회 오류는 Premium으로 추정하지 않고 503으로 닫는다", async () => {
  const { sqlite, db } = createDb();
  const failingDb = {
    prepare(sql) {
      if (sql.includes("family_subscription")) throw new Error("D1 unavailable");
      return db.prepare(sql);
    },
  };
  assert.deepEqual(await authorizePremiumAiParent(failingDb, {
    callerUserId: "parent-premium",
    familyId: "family-premium",
  }), { ok: false, status: 503, error: "family_entitlement_unavailable" });
  sqlite.close();
});

test("day-summary GET·POST와 child-monitor weekly_summary는 Premium gate를 우회하지 않는다", () => {
  const source = readFileSync(resolve(workerDir, "routes/ai.ts"), "utf8");
  const postStart = source.indexOf('ai.post("/day-summary"');
  const getStart = source.indexOf('ai.get("/day-summary"');
  const monitorStart = source.indexOf('ai.post("/child-monitor"');
  const monitorEnd = source.indexOf("export default ai", monitorStart);
  const postBlock = source.slice(postStart, getStart);
  const getBlock = source.slice(getStart, monitorStart);
  const monitorBlock = source.slice(monitorStart, monitorEnd);

  assert.match(postBlock, /authorizePremiumAiParent/);
  assert.match(getBlock, /authorizePremiumAiParent/);
  assert.match(monitorBlock, /analysisType === "weekly_summary"[\s\S]+authorizePremiumAiParent/);
  assert.ok(
    monitorBlock.indexOf("authorizePremiumAiParent") < monitorBlock.indexOf("reserveAiParseQuota"),
    "주간 요약 Premium gate가 AI 쿼터·외부 호출보다 먼저여야 합니다",
  );
});

test("검증할 아이·기간·도착 정본이 없는 weekly_summary는 client weekData를 실제 집계로 사용하지 않는다", () => {
  const source = readFileSync(resolve(workerDir, "routes/ai.ts"), "utf8");
  const monitorStart = source.indexOf('ai.post("/child-monitor"');
  const monitorBlock = source.slice(monitorStart, source.indexOf("export default ai", monitorStart));

  assert.doesNotMatch(source, /function buildWeeklySummaryPrompt/);
  assert.doesNotMatch(monitorBlock, /buildWeeklySummaryPrompt\(body\.weekData/);
  assert.match(monitorBlock, /weekly_summary_source_unavailable/);
});

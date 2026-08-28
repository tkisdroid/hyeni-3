import "./helpers/tsModuleResolve.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const market = await import("../lib/studyMarket.ts");

class D1StatementAdapter {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1StatementAdapter(this.sqlite, this.sql, bindings);
  }

  async first() {
    return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes) } };
  }
}

class D1DatabaseAdapter {
  constructor(sqlite) {
    this.sqlite = sqlite;
    this.batchBarrier = null;
    this.batchTail = Promise.resolve();
  }

  prepare(sql) {
    return new D1StatementAdapter(this.sqlite, sql);
  }

  async batch(statements) {
    if (this.batchBarrier) await this.batchBarrier();
    const run = this.batchTail.then(() => this.runBatch(statements));
    this.batchTail = run.catch(() => undefined);
    return run;
  }

  async runBatch(statements) {
    this.sqlite.exec("BEGIN");
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

function createFixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY, registration_country TEXT);
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      service_country TEXT,
      service_country_source TEXT,
      service_country_confirmed_at TEXT,
      study_market TEXT,
      service_country_row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      learning_grade_override INTEGER,
      learning_grade_row_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE study_setting_audit(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      member_id TEXT,
      actor_user_id TEXT NOT NULL,
      setting TEXT NOT NULL,
      previous_value TEXT,
      next_value TEXT,
      request_id TEXT NOT NULL UNIQUE,
      request_row_version INTEGER NOT NULL,
      occurred_at TEXT NOT NULL
    );
    INSERT INTO users(id) VALUES ('parent'), ('coparent'), ('child');
    INSERT INTO families(id,parent_id,service_country,service_country_source,study_market,service_country_row_version)
      VALUES ('family-a','parent',NULL,NULL,NULL,1), ('family-b','coparent',NULL,NULL,NULL,1);
    INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES
      ('parent-member','family-a','parent','parent',1),
      ('coparent-member','family-a','coparent','parent',1),
      ('child-member','family-a','child','child',1);
  `);
  return { sqlite, db: new D1DatabaseAdapter(sqlite) };
}

test("첫 기기 등록 국가는 이후 edge 국가로 덮어쓰지 않는다", async () => {
  const { sqlite, db } = createFixture();
  await market.recordRegistrationCountry(db, "parent", "KR");
  await market.recordRegistrationCountry(db, "parent", "JP");
  assert.equal(sqlite.prepare("SELECT registration_country FROM users WHERE id='parent'").get().registration_country, "KR");
  sqlite.close();
});

test("선행 migration이 없는 구형 DB도 인증 성공을 500으로 바꾸지 않는다", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE users(id TEXT PRIMARY KEY)");
  await market.recordRegistrationCountry(new D1DatabaseAdapter(sqlite), "parent", "KR");
  assert.equal(sqlite.prepare("SELECT id FROM users WHERE id='parent'").get(), undefined);
  sqlite.close();
});

test("서비스 국가 정규화는 두 글자 코드만 허용한다", () => {
  assert.equal(market.normalizeServiceCountry(" kr "), "KR");
  assert.equal(market.normalizeServiceCountry("KOR"), null);
  assert.equal(market.normalizeServiceCountry(null), null);
});

test("저장 국가에는 ISO alpha-2가 아닌 특수·임의 코드가 들어가지 않는다", () => {
  for (const code of ["AA", "XX", "ZZ", "T1"]) {
    assert.equal(market.normalizeServiceCountry(code), null, code);
  }
  assert.equal(market.normalizeServiceCountry("JP"), "JP");
  assert.equal(market.normalizeServiceCountry("MF"), "MF");
});

test("edge 제안 KR은 보호자 확정 전 Study market을 열지 않는다", async () => {
  const { sqlite, db } = createFixture();
  const result = await market.storeInitialServiceCountry(db, "family-a", "kr", false);
  assert.deepEqual(result, { serviceCountry: "KR", source: "edge_suggested", studyMarket: null });
  const stored = sqlite.prepare("SELECT service_country, service_country_source, study_market FROM families WHERE id='family-a'").get();
  assert.equal(stored.service_country, "KR");
  assert.equal(stored.service_country_source, "edge_suggested");
  assert.equal(stored.study_market, null);
  sqlite.close();
});

test("대표 보호자가 KR을 확정하면 가족의 Study market이 KR이 된다", async () => {
  const { sqlite, db } = createFixture();
  const result = await market.confirmServiceCountry(db, {
    actorId: "parent", familyId: "family-a", country: "KR", rowVersion: 1,
    requestId: "request-kr", occurredAt: "2026-08-28T00:00:00.000Z",
  });
  assert.deepEqual(result, {
    status: 200, serviceCountry: "KR", studyMarket: "KR", source: "guardian_confirmed", rowVersion: 2,
  });
  sqlite.close();
});

test("비대표 보호자와 다른 가족은 서비스 국가를 바꾸지 못한다", async () => {
  const { sqlite, db } = createFixture();
  const notPrimary = await market.confirmServiceCountry(db, {
    actorId: "coparent", familyId: "family-a", country: "KR", rowVersion: 1,
    requestId: "request-coparent", occurredAt: "2026-08-28T00:00:00.000Z",
  });
  const foreign = await market.confirmServiceCountry(db, {
    actorId: "parent", familyId: "family-b", country: "KR", rowVersion: 1,
    requestId: "request-foreign", occurredAt: "2026-08-28T00:00:00.000Z",
  });
  assert.deepEqual(notPrimary, { status: 403, error: "primary_parent_required" });
  assert.deepEqual(foreign, { status: 403, error: "primary_parent_required" });
  sqlite.close();
});

test("오래된 버전과 KOR 값은 거부하고 JP 확정은 market을 비운다", async () => {
  const { sqlite, db } = createFixture();
  const invalid = await market.confirmServiceCountry(db, {
    actorId: "parent", familyId: "family-a", country: "KOR", rowVersion: 1,
    requestId: "request-invalid", occurredAt: "2026-08-28T00:00:00.000Z",
  });
  const jp = await market.confirmServiceCountry(db, {
    actorId: "parent", familyId: "family-a", country: "JP", rowVersion: 1,
    requestId: "request-jp", occurredAt: "2026-08-28T00:00:00.000Z",
  });
  const stale = await market.confirmServiceCountry(db, {
    actorId: "parent", familyId: "family-a", country: "KR", rowVersion: 1,
    requestId: "request-stale", occurredAt: "2026-08-28T00:00:01.000Z",
  });
  assert.deepEqual(invalid, { status: 400, error: "invalid_service_country" });
  assert.deepEqual(jp, {
    status: 200, serviceCountry: "JP", studyMarket: null, source: "guardian_confirmed", rowVersion: 2,
  });
  assert.deepEqual(stale, { status: 409, error: "service_country_version_conflict", rowVersion: 2 });
  sqlite.close();
});

test("같은 request id 재시도는 감사 행과 version을 중복시키지 않는다", async () => {
  const { sqlite, db } = createFixture();
  const input = {
    actorId: "parent", familyId: "family-a", country: "KR", rowVersion: 1,
    requestId: "request-idempotent", occurredAt: "2026-08-28T00:00:00.000Z",
  };
  const first = await market.confirmServiceCountry(db, input);
  const retry = await market.confirmServiceCountry(db, input);
  assert.deepEqual(retry, first);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM study_setting_audit WHERE request_id='request-idempotent'").get().count, 1);
  assert.equal(sqlite.prepare("SELECT service_country_row_version AS version FROM families WHERE id='family-a'").get().version, 2);
  sqlite.close();
});

test("완전히 동시인 같은 request id 요청은 후행도 canonical 200 replay를 반환한다", async () => {
  const { sqlite, db } = createFixture();
  let arrivals = 0;
  let releaseBatches;
  const bothAtBatch = new Promise((resolve) => { releaseBatches = resolve; });
  db.batchBarrier = async () => {
    arrivals += 1;
    if (arrivals === 2) releaseBatches();
    await bothAtBatch;
  };
  const input = {
    actorId: "parent", familyId: "family-a", country: "KR", rowVersion: 1,
    requestId: "request-concurrent-replay", occurredAt: "2026-08-28T00:00:00.000Z",
  };
  const [first, second] = await Promise.all([
    market.confirmServiceCountry(db, input),
    market.confirmServiceCountry(db, input),
  ]);
  const expected = {
    status: 200, serviceCountry: "KR", studyMarket: "KR", source: "guardian_confirmed", rowVersion: 2,
  };
  assert.deepEqual(first, expected);
  assert.deepEqual(second, expected);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM study_setting_audit WHERE request_id='request-concurrent-replay'").get().count, 1);
  sqlite.close();
});

test("stale race에서 조건부 update가 0건이면 audit만 남기지 않고 409로 닫는다", async () => {
  const { sqlite, db } = createFixture();
  const originalBatch = db.batch.bind(db);
  db.batch = async (statements) => {
    sqlite.prepare("UPDATE families SET service_country_row_version=2 WHERE id='family-a'").run();
    return originalBatch(statements);
  };
  const result = await market.confirmServiceCountry(db, {
    actorId: "parent", familyId: "family-a", country: "KR", rowVersion: 1,
    requestId: "request-stale-race", occurredAt: "2026-08-28T00:00:00.000Z",
  });
  assert.deepEqual(result, { status: 409, error: "service_country_version_conflict", rowVersion: 2 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM study_setting_audit WHERE request_id='request-stale-race'").get().count, 0);
  sqlite.close();
});

test("같은 request id의 다른 나라나 expected version 재사용은 409로 닫는다", async () => {
  const { sqlite, db } = createFixture();
  const input = {
    actorId: "parent", familyId: "family-a", country: "KR", rowVersion: 1,
    requestId: "request-payload-conflict", occurredAt: "2026-08-28T00:00:00.000Z",
  };
  await market.confirmServiceCountry(db, input);
  const countryConflict = await market.confirmServiceCountry(db, { ...input, country: "JP" });
  const versionConflict = await market.confirmServiceCountry(db, { ...input, rowVersion: 2 });
  assert.deepEqual(countryConflict, { status: 409, error: "service_country_request_id_conflict" });
  assert.deepEqual(versionConflict, { status: 409, error: "service_country_request_id_conflict" });
  sqlite.close();
});

test("동일 request id 재시도는 계산값이 아니라 현재 canonical family 행을 반환한다", async () => {
  const { sqlite, db } = createFixture();
  const input = {
    actorId: "parent", familyId: "family-a", country: "KR", rowVersion: 1,
    requestId: "request-canonical-replay", occurredAt: "2026-08-28T00:00:00.000Z",
  };
  await market.confirmServiceCountry(db, input);
  sqlite.prepare(
    "UPDATE families SET service_country='JP', service_country_source='guardian_changed', study_market=NULL, service_country_row_version=3 WHERE id='family-a'",
  ).run();
  assert.deepEqual(await market.confirmServiceCountry(db, input), {
    status: 200, serviceCountry: "JP", studyMarket: null, source: "guardian_changed", rowVersion: 3,
  });
  sqlite.close();
});

test("자녀는 가족 시장을 상속하며 user 국가를 복제하지 않는다", async () => {
  const { sqlite, db } = createFixture();
  await market.confirmServiceCountry(db, {
    actorId: "parent", familyId: "family-a", country: "KR", rowVersion: 1,
    requestId: "request-child", occurredAt: "2026-08-28T00:00:00.000Z",
  });
  assert.equal(await market.studyMarketForMember(db, "child-member"), "KR");
  assert.equal(sqlite.prepare("SELECT registration_country FROM users WHERE id='child'").get().registration_country, null);
  sqlite.close();
});

test("세 스키마는 맡은 Study market 열과 제약을 제공한다", async () => {
  const [canonical, authSchema, migration] = await Promise.all([
    readFile(new URL("../../cloudflare/schema_d1.sql", import.meta.url), "utf8"),
    readFile(new URL("../db/auth-schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../db/study-market.sql", import.meta.url), "utf8"),
  ]);
  for (const source of [canonical, migration]) {
    assert.match(source, /"?registration_country"? TEXT/);
    assert.match(source, /"?service_country"? TEXT/);
    assert.match(source, /"?study_market"? TEXT/);
    assert.match(source, /"?service_country_row_version"? INTEGER NOT NULL DEFAULT 1/);
    assert.match(source, /"?learning_grade_override"? INTEGER/);
    assert.match(source, /"?learning_grade_row_version"? INTEGER NOT NULL DEFAULT 1/);
    assert.match(source, /study_setting_audit/);
  }
  assert.match(authSchema, /"?registration_country"? TEXT/);
  assert.match(authSchema, /length\(registration_country\) = 2/);
});

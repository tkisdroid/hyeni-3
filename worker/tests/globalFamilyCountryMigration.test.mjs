import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const { readFamilyCountryMigrationState } = await import("../lib/region.ts");

class Statement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.bindings) }; }
}

class Db {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
}

test("가족 국가 migration은 기존 가족을 KR로 보존하고 두 번째 실행 전에 감지한다", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE families(id TEXT PRIMARY KEY, parent_id TEXT NOT NULL)");
  sqlite.exec("INSERT INTO families(id,parent_id) VALUES ('family-a','parent-a')");
  const db = new Db(sqlite);
  const migration = await readFile(new URL("../db/global-family-country.sql", import.meta.url), "utf8");

  assert.deepEqual(await readFamilyCountryMigrationState(db), { status: "pending" });
  sqlite.exec(migration);
  assert.deepEqual(await readFamilyCountryMigrationState(db), { status: "applied" });
  assert.equal(sqlite.prepare("SELECT country_code FROM families WHERE id='family-a'").get().country_code, "KR");

  // 운영 도구는 applied 상태에서 SQL을 다시 실행하지 않는다. 중복 column 오류를 실행으로 발견하지 않는다.
  assert.equal((await readFamilyCountryMigrationState(db)).status, "applied");
  sqlite.close();
});

test("canonical schema와 readiness는 families.country_code를 필수로 선언한다", async () => {
  const [schema, readiness] = await Promise.all([
    readFile(new URL("../../cloudflare/schema_d1.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/healthReadiness.ts", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /"country_code" TEXT NOT NULL DEFAULT 'KR'/);
  assert.match(readiness, /table:\s*"families",\s*name:\s*"country_code"/);
});

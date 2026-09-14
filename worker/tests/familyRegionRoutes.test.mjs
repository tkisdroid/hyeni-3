import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";

const familyRoutes = (await import("../routes/family.ts")).default;
const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

class Statement {
  constructor(sqlite, sql, bindings = []) { this.sqlite = sqlite; this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { success: true, results: this.sqlite.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class Db {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  async batch(statements) {
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

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../../cloudflare/schema_d1.sql", import.meta.url), "utf8"));
  sqlite.exec(`
    INSERT INTO users(id,is_anonymous) VALUES ('primary',0),('coparent',0),('other',0);
    INSERT INTO families(id,parent_id,pair_code,country_code) VALUES
      ('family-a','primary','KID-AAAA0000','KR'),
      ('family-b','other','KID-BBBB0000','KR');
    INSERT INTO family_members(id,family_id,user_id,role,name,is_active) VALUES
      ('primary-member','family-a','primary','parent','대표 보호자',1),
      ('coparent-member','family-a','coparent','parent','공동 보호자',1),
      ('other-member','family-b','other','parent','다른 보호자',1);
  `);
  return { sqlite, db: new Db(sqlite) };
}

async function authorization(sub, familyId) {
  const token = await new SignJWT({ role: "parent", family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

function env(db) {
  return {
    DB: db,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    FAMILY_ROOM: {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
    },
  };
}

const app = new Hono();
app.route("/api/family", familyRoutes);

async function patchRegion(db, caller, tokenFamily, body) {
  return app.request("http://test.local/api/family/region", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: await authorization(caller, tokenFamily),
    },
    body: JSON.stringify(body),
  }, env(db));
}

test("주 보호자만 정본 가족 국가를 바꾸며 정규화한 값을 반환한다", async () => {
  const { sqlite, db } = fixture();
  const response = await patchRegion(db, "primary", "family-a", { countryCode: " jp ", timeZone: "Asia/Tokyo" });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.countryCode, "JP");
  assert.equal(body.timeZone, "Asia/Tokyo");
  assert.deepEqual(body.mapPolicy, { provider: "google", countryCode: "JP" });
  assert.equal(sqlite.prepare("SELECT country_code FROM families WHERE id='family-a'").get().country_code, "JP");
  sqlite.close();
});

test("잘못된 국가·보조 보호자·타 가족 selector는 쓰기 전에 거부한다", async () => {
  const { sqlite, db } = fixture();
  const invalid = await patchRegion(db, "primary", "family-a", { countryCode: "JPN" });
  const coparent = await patchRegion(db, "coparent", "family-a", { countryCode: "JP" });
  const foreign = await patchRegion(db, "primary", "family-a", { familyId: "family-b", countryCode: "JP" });

  assert.equal(invalid.status, 400);
  assert.equal(coparent.status, 403);
  assert.equal(foreign.status, 403);
  assert.equal(sqlite.prepare("SELECT country_code FROM families WHERE id='family-a'").get().country_code, "KR");
  assert.equal(sqlite.prepare("SELECT country_code FROM families WHERE id='family-b'").get().country_code, "KR");
  sqlite.close();
});

test("가족 조회는 서버 정본 countryCode와 같은 정책의 mapPolicy를 반환한다", async () => {
  const { sqlite, db } = fixture();
  sqlite.prepare("UPDATE families SET country_code='JP' WHERE id='family-a'").run();
  const response = await app.request("http://test.local/api/family/mine", {
    headers: { authorization: await authorization("primary", "family-a") },
  }, env(db));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.countryCode, "JP");
  assert.deepEqual(body.mapPolicy, { provider: "google", countryCode: "JP" });
  sqlite.close();
});

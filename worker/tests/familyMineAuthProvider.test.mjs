// 가족 조회(/mine)의 본인 가입 방식(myAuthProvider) 회귀 가드.
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


// 2026-09-25 브라우저 QA — 전화번호로 가입한 계정이 비밀번호로 다시 로그인하면 세션에
// app_metadata.provider 가 없어 설정 화면에 "ID 계정"으로 보였다. /mine 이 가입 방식 정본을 준다.
const { resolveAccountAuthProvider } = await import("../lib/accountAuthProvider.ts");

async function mine(db, caller, familyId) {
  const response = await app.request("http://test.local/api/family/mine", {
    headers: { authorization: await authorization(caller, familyId) },
  }, env(db));
  assert.equal(response.status, 200);
  return response.json();
}

test("가입 방식은 가입 프로필 → 첫 로그인 연결 → 익명 순으로 판정하고 모르면 null", () => {
  assert.equal(resolveAccountAuthProvider({ profile_provider: "phone", identity_provider: "kakao" }), "phone");
  assert.equal(resolveAccountAuthProvider({ profile_provider: "unknown", identity_provider: "google" }), "google");
  assert.equal(resolveAccountAuthProvider({ profile_provider: null, identity_provider: null, anon: 1 }), "anonymous");
  assert.equal(resolveAccountAuthProvider({ profile_provider: "unknown", identity_provider: "email", anon: 0 }), null);
  assert.equal(resolveAccountAuthProvider(null), null);
});

test("가족 조회는 주 보호자·공동 보호자 모두 본인 가입 방식을 돌려준다", async () => {
  const { sqlite, db } = fixture();
  sqlite.exec(`
    INSERT INTO user_profiles(user_id,login_id,display_name,phone,provider) VALUES
      ('primary','primary01','대표 보호자','+821012345678','phone');
    INSERT INTO auth_identities(id,user_id,provider,provider_id,created_at) VALUES
      ('identity-1','coparent','kakao','kakao-1','2026-09-01T00:00:00Z'),
      ('identity-2','coparent','google','google-1','2026-09-10T00:00:00Z');
  `);
  assert.equal((await mine(db, "primary", "family-a")).myAuthProvider, "phone");
  assert.equal((await mine(db, "coparent", "family-a")).myAuthProvider, "kakao");
  assert.equal((await mine(db, "other", "family-b")).myAuthProvider, null);
  sqlite.close();
});

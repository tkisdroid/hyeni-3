import "./helpers/tsModuleResolve.mjs";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(workerDir, "..");
const familyRoutes = (await import("../routes/family.ts")).default;
const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

class Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.db, this.sql, bindings);
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { success: true, results: this.db.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  return {
    sqlite,
    d1: {
      prepare: (sql) => new Statement(sqlite, sql),
    },
  };
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

function environment(db) {
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

test("빈 아이 전화번호는 null 입력을 빈 문자열로 저장해 프로필 전체 수정을 성공시킨다", async () => {
  const { sqlite, d1 } = createDb();
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('parent-1',0)").run();
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code,created_at) VALUES ('family-1','parent-1','KID-TEST','2026-08-31')",
  ).run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,birthdate,phone,is_active,created_at)
     VALUES ('parent-member','family-1','parent-1','parent','보호자',NULL,'',1,'2026-08-31')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,birthdate,phone,is_active,created_at)
     VALUES ('child-1','family-1',NULL,'child','수정 전','2017-01-02','',1,'2026-08-31')`,
  ).run();

  const response = await app.request("http://test.local/api/family/member/profile", {
    method: "POST",
    headers: {
      authorization: await authorization("parent-1", "family-1"),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      family_id: "family-1",
      member_id: "child-1",
      new_name: "수정 후",
      color_hex: "#F3A6C4",
      birthdate: "2018-03-04",
      phone: null,
    }),
  }, environment(d1));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(
    { ...sqlite.prepare("SELECT name,birthdate,phone FROM family_members WHERE id='child-1'").get() },
    { name: "수정 후", birthdate: "2018-03-04", phone: "" },
  );
});

test("아이 전화번호가 휴대폰 형식이 아니면 400 invalid_phone으로 거부하고, 휴대폰은 표시형으로 저장한다", async () => {
  const { sqlite, d1 } = createDb();
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('parent-1',0)").run();
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code,created_at) VALUES ('family-1','parent-1','KID-TEST','2026-08-31')",
  ).run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,birthdate,phone,is_active,created_at)
     VALUES ('parent-member','family-1','parent-1','parent','보호자',NULL,'',1,'2026-08-31')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,birthdate,phone,is_active,created_at)
     VALUES ('child-1','family-1',NULL,'child','아이','2017-01-02','',1,'2026-08-31')`,
  ).run();
  const save = async (phone) => app.request("http://test.local/api/family/member/profile", {
    method: "POST",
    headers: {
      authorization: await authorization("parent-1", "family-1"),
      "content-type": "application/json",
    },
    body: JSON.stringify({ family_id: "family-1", member_id: "child-1", new_name: "아이", phone }),
  }, environment(d1));

  const invalid = await save("0101234");
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "invalid_phone" });
  assert.equal(sqlite.prepare("SELECT phone FROM family_members WHERE id='child-1'").get().phone, "");

  const valid = await save("01055550303");
  assert.equal(valid.status, 200);
  assert.equal(sqlite.prepare("SELECT phone FROM family_members WHERE id='child-1'").get().phone, "010-5555-0303");
});

// 2026-09-25 브라우저 QA — 검증 도입 전에 저장된 옛 번호("010-1234")가 남아 있으면, 계정 화면은
// 이름만 고쳐도 그 번호를 함께 보내므로 invalid_phone 으로 이름 저장까지 막혔다.
test("저장된 옛 형식 번호를 그대로 다시 보내면 번호는 두고 이름만 저장한다", async () => {
  const { sqlite, d1 } = createDb();
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('parent-1',0)").run();
  sqlite.prepare(
    "INSERT INTO families(id,parent_id,pair_code,created_at) VALUES ('family-1','parent-1','KID-TEST','2026-08-31')",
  ).run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,birthdate,phone,is_active,created_at)
     VALUES ('parent-member','family-1','parent-1','parent','보호자',NULL,'010-1234',1,'2026-08-31')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,birthdate,phone,is_active,created_at)
     VALUES ('child-1','family-1',NULL,'child','아이','2017-01-02','0101234',1,'2026-08-31')`,
  ).run();
  const request = async (path, method, body) => app.request(`http://test.local/api/family${path}`, {
    method,
    headers: {
      authorization: await authorization("parent-1", "family-1"),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }, environment(d1));
  const row = (id) => sqlite.prepare("SELECT name, phone FROM family_members WHERE id=?").get(id);

  const own = await request("/profile", "PATCH", { family_id: "family-1", name: "새 이름", phone: "010-1234" });
  assert.equal(own.status, 200);
  assert.deepEqual({ ...row("parent-member") }, { name: "새 이름", phone: "010-1234" });

  const child = await request("/member/profile", "POST", {
    family_id: "family-1", member_id: "child-1", new_name: "아이 새 이름", phone: "010-1234",
  });
  assert.equal(child.status, 200);
  assert.deepEqual({ ...row("child-1") }, { name: "아이 새 이름", phone: "0101234" });

  // 번호를 실제로 바꾸면 새 값은 여전히 검증한다.
  const changed = await request("/profile", "PATCH", { family_id: "family-1", name: "새 이름", phone: "010-9999" });
  assert.equal(changed.status, 400);
  assert.deepEqual(await changed.json(), { error: "invalid_phone" });
  assert.equal(row("parent-member").phone, "010-1234");
});

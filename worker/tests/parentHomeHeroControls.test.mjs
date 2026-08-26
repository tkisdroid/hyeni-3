/**
 * 부모 홈 히어로 캐러셀 운영 설정 회귀.
 *
 * 고정하는 것
 *  · 값 판정은 **전부 맞을 때만** 수용한다(절반만 맞는 설정이 화면에 나가면 운영자 의도와 달라진다).
 *  · 행 누락·형식 오류는 `configured:false` + 기본값이고, **D1 장애는 진단 조회에서 전파**한다
 *    (관리자가 확인되지 않은 값을 현재 설정으로 오인하면 안 된다).
 *  · 소비자 읽기는 모든 오류를 기본값으로 강등한다 — 히어로는 안전 기능이 아니라 표시 영역이다.
 *  · 관리자 API 는 `ADMIN_USER_IDS` 화이트리스트 밖에서 **404**(존재를 숨긴다)이고 응답은 `no-store` 다.
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import "./helpers/tsModuleResolve.mjs";
import { exportJWK, generateKeyPair } from "jose";

const ADMIN_ID = "admin-hero-carousel";
const OTHER_ID = "not-admin-hero-carousel";
const FAMILY_ID = "family-hero-carousel";
const CONTROLS_KEY = "parent_home_hero_carousel_v1";

const {
  MAX_HERO_SLIDES,
  inspectParentHomeHeroControls,
  parseParentHomeHeroControls,
  readParentHomeHeroControls,
  writeParentHomeHeroControls,
} = await import("../lib/parentHomeHeroControls.ts");
const { admin } = await import("../routes/admin.ts");
const { signAccessToken } = await import("../lib/jwt.ts");

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
    if (this.db.failSettingsRead && this.sql.includes("FROM app_global_settings")) {
      throw new Error("simulated_hero_settings_read_failure");
    }
    return this.db.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { success: true, results: this.db.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    if (this.db.failSettingsWrite && this.sql.includes("app_global_settings")) {
      throw new Error("simulated_hero_settings_write_failure");
    }
    const result = this.db.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class D1Adapter {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.failSettingsRead = false;
    this.failSettingsWrite = false;
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  close() {
    this.sqlite.close();
  }
}

function createDb() {
  const db = new D1Adapter();
  db.sqlite.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE families(id TEXT PRIMARY KEY,parent_id TEXT NOT NULL,created_at TEXT);
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,family_id TEXT NOT NULL,user_id TEXT,role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT,last_selected_at TEXT
    );
    CREATE TABLE account_deletion_scopes(
      job_id TEXT NOT NULL,scope_type TEXT NOT NULL,scope_id TEXT NOT NULL,
      created_at TEXT NOT NULL,PRIMARY KEY(scope_type,scope_id)
    );
    CREATE TABLE account_deletion_jobs(
      id TEXT PRIMARY KEY,status TEXT NOT NULL,created_at TEXT
    );
    -- lease 조건부 INSERT 가 미완료 unpair job 을 함께 확인한다.
    CREATE TABLE family_unpair_cleanup_jobs(
      id TEXT PRIMARY KEY,family_id TEXT,child_user_id TEXT,status TEXT NOT NULL,created_at TEXT
    );
    -- 비-GET 요청은 requireAuth 가 계정 mutation lease 를 확보한다(쓰기 선형화 계약).
    CREATE TABLE account_mutation_leases(
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,family_id TEXT,
      expires_at TEXT NOT NULL,created_at TEXT NOT NULL
    );
    CREATE TABLE app_global_settings(
      key TEXT PRIMARY KEY,value TEXT NOT NULL DEFAULT '',updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  for (const id of [ADMIN_ID, OTHER_ID]) {
    db.sqlite.prepare("INSERT INTO users(id) VALUES (?)").run(id);
  }
  db.sqlite.prepare("INSERT INTO families(id,parent_id,created_at) VALUES (?,?,?)").run(
    FAMILY_ID,
    ADMIN_ID,
    "2026-08-01 00:00:00+00",
  );
  db.sqlite.prepare(
    `INSERT INTO family_members
       (id,family_id,user_id,role,is_active,created_at,last_selected_at)
     VALUES (?,?,?,?,1,?,NULL)`,
  ).run("member-hero-carousel", FAMILY_ID, ADMIN_ID, "parent", "2026-08-01 00:00:00+00");
  return db;
}

function saveRawControls(db, value) {
  db.sqlite.prepare(
    `INSERT INTO app_global_settings(key,value,updated_by)
     VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by`,
  ).run(CONTROLS_KEY, value, ADMIN_ID);
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

async function authorization(sub) {
  const token = await signAccessToken({
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
  }, { sub, role: "parent", family_id: FAMILY_ID, is_anonymous: false });
  return `Bearer ${token}`;
}

async function callAdmin(db, { method = "GET", body, sub = ADMIN_ID, adminIds = ADMIN_ID } = {}) {
  const response = await admin.request("https://local.test/hero-carousel", {
    method,
    headers: {
      Authorization: await authorization(sub),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, {
    DB: db,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    ADMIN_USER_IDS: adminIds,
  });
  return { response, body: await response.json().catch(() => null) };
}

test("컨트롤 파서는 형식·범위가 모두 맞을 때만 수용한다", () => {
  assert.deepEqual(
    parseParentHomeHeroControls({ freeVisibleCount: 3, premiumVisibleCount: 2, autoPlayMs: 6000 }),
    { freeVisibleCount: 3, premiumVisibleCount: 2, autoPlayMs: 6000 },
  );
  // 0 은 "자동 전환 끄기"라는 정상 값이다.
  assert.equal(
    parseParentHomeHeroControls({ freeVisibleCount: 1, premiumVisibleCount: 1, autoPlayMs: 0 }).autoPlayMs,
    0,
  );
  for (const bad of [
    null,
    [],
    { freeVisibleCount: 3, premiumVisibleCount: 2 },
    { freeVisibleCount: -1, premiumVisibleCount: 2, autoPlayMs: 6000 },
    { freeVisibleCount: 3, premiumVisibleCount: MAX_HERO_SLIDES + 1, autoPlayMs: 6000 },
    { freeVisibleCount: 2.5, premiumVisibleCount: 2, autoPlayMs: 6000 },
    { freeVisibleCount: 3, premiumVisibleCount: 2, autoPlayMs: 100 },
    { freeVisibleCount: 3, premiumVisibleCount: 2, autoPlayMs: 60_000 },
  ]) {
    assert.equal(parseParentHomeHeroControls(bad), null, `수용돼서는 안 됩니다: ${JSON.stringify(bad)}`);
  }
});

test("행 누락·형식 오류는 configured=false 와 기본값이고 D1 장애는 진단에서 전파된다", async () => {
  const db = createDb();
  try {
    const missing = await inspectParentHomeHeroControls(db);
    assert.equal(missing.configured, false);
    assert.equal(missing.controls.freeVisibleCount, 3);
    assert.equal(missing.controls.premiumVisibleCount, 2);

    saveRawControls(db, "{not json");
    assert.equal((await inspectParentHomeHeroControls(db)).configured, false);

    saveRawControls(db, JSON.stringify({ freeVisibleCount: 99, premiumVisibleCount: 2, autoPlayMs: 6000 }));
    assert.equal((await inspectParentHomeHeroControls(db)).configured, false, "범위 밖 값은 설정으로 인정하지 않는다");

    db.failSettingsRead = true;
    await assert.rejects(() => inspectParentHomeHeroControls(db), /simulated_hero_settings_read_failure/);
    // 소비자 읽기는 같은 장애에서 기본값으로 강등한다(히어로를 감추지 않는다).
    const consumer = await readParentHomeHeroControls(db);
    assert.equal(consumer.freeVisibleCount, 3);
  } finally {
    db.close();
  }
});

test("관리자 저장은 원자 upsert 로 세 값을 함께 갱신한다", async () => {
  const db = createDb();
  try {
    await writeParentHomeHeroControls(db, {
      freeVisibleCount: 4,
      premiumVisibleCount: 1,
      autoPlayMs: 8000,
    }, ADMIN_ID);
    const state = await inspectParentHomeHeroControls(db);
    assert.equal(state.configured, true);
    assert.deepEqual(state.controls, { freeVisibleCount: 4, premiumVisibleCount: 1, autoPlayMs: 8000 });
    const row = db.sqlite.prepare("SELECT updated_by FROM app_global_settings WHERE key=?").get(CONTROLS_KEY);
    assert.equal(row.updated_by, ADMIN_ID);
  } finally {
    db.close();
  }
});

test("관리자 API 는 화이트리스트 밖에서 404 이고 응답은 no-store 다", async () => {
  const db = createDb();
  try {
    const denied = await callAdmin(db, { sub: OTHER_ID });
    assert.equal(denied.response.status, 404, "권한 없음은 존재를 숨기는 404 여야 합니다");

    // secret 이 비면 아무도 관리자가 아니다(fail-closed).
    const noSecret = await callAdmin(db, { adminIds: "" });
    assert.equal(noSecret.response.status, 404);

    const allowed = await callAdmin(db);
    assert.equal(allowed.response.status, 200);
    assert.equal(allowed.body.configured, false);
    assert.equal(allowed.body.maxSlides, MAX_HERO_SLIDES);
    assert.equal(allowed.response.headers.get("cache-control"), "no-store");
  } finally {
    db.close();
  }
});

test("관리자 PUT 은 범위 밖 값을 400 으로 거절하고 저장 실패를 503 으로 닫는다", async () => {
  const db = createDb();
  try {
    const bad = await callAdmin(db, {
      method: "PUT",
      body: { freeVisibleCount: 99, premiumVisibleCount: 2, autoPlayMs: 6000 },
    });
    assert.equal(bad.response.status, 400);
    assert.equal(bad.body.error, "invalid_hero_controls");

    const ok = await callAdmin(db, {
      method: "PUT",
      body: { freeVisibleCount: 2, premiumVisibleCount: 1, autoPlayMs: 0 },
    });
    assert.equal(ok.response.status, 200);
    assert.deepEqual(
      { free: ok.body.freeVisibleCount, premium: ok.body.premiumVisibleCount, ms: ok.body.autoPlayMs },
      { free: 2, premium: 1, ms: 0 },
    );
    assert.equal(ok.body.configured, true);

    db.failSettingsWrite = true;
    const failed = await callAdmin(db, {
      method: "PUT",
      body: { freeVisibleCount: 3, premiumVisibleCount: 3, autoPlayMs: 6000 },
    });
    assert.equal(failed.response.status, 503);
    assert.equal(failed.body.error, "save_failed");
  } finally {
    db.close();
  }
});

test("서버 상한은 클라이언트 정본과 같다", async () => {
  const client = await import("../../src/transform/parentHomeHeroCarousel.ts");
  assert.equal(MAX_HERO_SLIDES, client.MAX_PARENT_HOME_HERO_SLIDES);
});

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import "./helpers/tsModuleResolve.mjs";
import { exportJWK, generateKeyPair } from "jose";

const ADMIN_ID = "admin-commerce-controls";
const FAMILY_ID = "family-commerce-controls";
const CONTROLS_KEY = "commerce_runtime_controls_v1";

const {
  inspectCommerceRuntimeControls,
  parseCommerceRuntimeControls,
  readCommerceRuntimeControls,
} = await import("../lib/commerceRuntimeControls.ts");
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
    if (this.db.failCommerceRead && this.sql.includes("FROM app_global_settings")) {
      throw new Error("simulated_commerce_settings_read_failure");
    }
    return this.db.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { success: true, results: this.db.sqlite.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.db.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class D1Adapter {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.failCommerceRead = false;
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
    CREATE TABLE app_global_settings(
      key TEXT PRIMARY KEY,value TEXT NOT NULL DEFAULT '',updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.sqlite.prepare("INSERT INTO users(id) VALUES (?)").run(ADMIN_ID);
  db.sqlite.prepare("INSERT INTO families(id,parent_id,created_at) VALUES (?,?,?)").run(
    FAMILY_ID,
    "owner-commerce-controls",
    "2026-08-01 00:00:00+00",
  );
  db.sqlite.prepare(
    `INSERT INTO family_members
       (id,family_id,user_id,role,is_active,created_at,last_selected_at)
     VALUES (?,?,?,?,1,?,NULL)`,
  ).run(
    "member-commerce-controls",
    FAMILY_ID,
    ADMIN_ID,
    "child",
    "2026-08-01 00:00:00+00",
  );
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

async function adminAuthorization() {
  const token = await signAccessToken({
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
  }, {
    sub: ADMIN_ID,
    role: "child",
    family_id: FAMILY_ID,
    is_anonymous: false,
  });
  return `Bearer ${token}`;
}

async function getAdminControls(db) {
  const response = await admin.request("https://local.test/commerce-controls", {
    headers: { Authorization: await adminAuthorization() },
  }, {
    DB: db,
    JWT_PRIVATE_KEY: jwtPrivateKey,
    JWT_PUBLIC_KEY: jwtPublicKey,
    ADMIN_USER_IDS: ADMIN_ID,
  });
  return { response, body: await response.json() };
}

test("결제 제어 파서는 행 누락·잘못된 JSON·필드 누락을 두 판매 중지로 닫는다", () => {
  const closed = {
    webSubscriptionNewCheckoutsEnabled: false,
    webAiCreditNewCheckoutsEnabled: false,
  };
  assert.deepEqual(parseCommerceRuntimeControls(undefined), closed);
  assert.deepEqual(parseCommerceRuntimeControls("not-json"), closed);
  assert.deepEqual(parseCommerceRuntimeControls(JSON.stringify({
    webSubscriptionNewCheckoutsEnabled: true,
  })), closed);
  assert.deepEqual(parseCommerceRuntimeControls(JSON.stringify({
    webSubscriptionNewCheckoutsEnabled: true,
    webAiCreditNewCheckoutsEnabled: false,
  })), {
    webSubscriptionNewCheckoutsEnabled: true,
    webAiCreditNewCheckoutsEnabled: false,
  });
});

test("결제 제어 조회는 행 누락·형식 오류를 configured=false로 구분하면서 두 판매를 닫는다", async () => {
  const db = createDb();
  try {
    const missing = await inspectCommerceRuntimeControls(db);
    assert.deepEqual(missing, {
      configured: false,
      controls: {
        webSubscriptionNewCheckoutsEnabled: false,
        webAiCreditNewCheckoutsEnabled: false,
      },
    });

    saveRawControls(db, "not-json");
    const malformed = await inspectCommerceRuntimeControls(db);
    assert.deepEqual(malformed, missing);

    saveRawControls(db, JSON.stringify({
      webSubscriptionNewCheckoutsEnabled: false,
      webAiCreditNewCheckoutsEnabled: false,
    }));
    const deliberatelyPaused = await inspectCommerceRuntimeControls(db);
    assert.equal(deliberatelyPaused.configured, true);
    assert.deepEqual(deliberatelyPaused.controls, missing.controls);
  } finally {
    db.close();
  }
});

test("결제 제어 D1 오류는 판매 경로에서 두 판매 중지로 닫고 진단 조회에는 오류를 전파한다", async () => {
  const db = createDb();
  try {
    db.failCommerceRead = true;
    const runtimeControls = await readCommerceRuntimeControls(db);
    assert.deepEqual(runtimeControls, {
      webSubscriptionNewCheckoutsEnabled: false,
      webAiCreditNewCheckoutsEnabled: false,
    });
    await assert.rejects(
      inspectCommerceRuntimeControls(db),
      /simulated_commerce_settings_read_failure/,
    );
  } finally {
    db.close();
  }
});

test("관리자 GET은 의도적 전체 중지·미설정·D1 장애를 서로 구분한다", async () => {
  const db = createDb();
  try {
    saveRawControls(db, JSON.stringify({
      webSubscriptionNewCheckoutsEnabled: false,
      webAiCreditNewCheckoutsEnabled: false,
    }));
    const deliberatelyPaused = await getAdminControls(db);
    assert.equal(deliberatelyPaused.response.status, 200);
    assert.deepEqual(deliberatelyPaused.body, {
      webSubscriptionNewCheckoutsEnabled: false,
      webAiCreditNewCheckoutsEnabled: false,
      configured: true,
    });

    saveRawControls(db, "not-json");
    const malformed = await getAdminControls(db);
    assert.equal(malformed.response.status, 200);
    assert.deepEqual(malformed.body, {
      webSubscriptionNewCheckoutsEnabled: false,
      webAiCreditNewCheckoutsEnabled: false,
      configured: false,
    });

    db.failCommerceRead = true;
    const unavailable = await getAdminControls(db);
    assert.equal(unavailable.response.status, 503);
    assert.deepEqual(unavailable.body, { error: "commerce_controls_unavailable" });
  } finally {
    db.close();
  }
});

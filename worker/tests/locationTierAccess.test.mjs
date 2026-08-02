import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { Hono } from "hono";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Node의 type stripping으로 실제 Worker TypeScript를 실행하되, 번들러가 처리하는
// 확장자 없는 상대 import만 테스트 환경에서 동일하게 해석한다.
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

const authz = await import(pathToFileURL(resolve(workerDir, "db/authz.ts")).href);
const locationModule = await import(pathToFileURL(resolve(workerDir, "routes/location.ts")).href);
const usageQuota = await import(pathToFileURL(resolve(workerDir, "lib/featureUsageQuota.ts")).href);
const locationRoutes = locationModule.default;
const locationConfirmationMigration = readFileSync(
  resolve(workerDir, "db/location-confirmation-records.sql"),
  "utf8",
);

class D1StatementAdapter {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1StatementAdapter(this.db, this.sql, bindings);
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes ?? 0) }, results: [] };
  }
}

class D1DatabaseAdapter {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new D1StatementAdapter(this.db, sql);
  }
}

function d1Timestamp(offsetMinutes) {
  return new Date(Date.now() + offsetMinutes * 60_000)
    .toISOString()
    .replace("T", " ")
    .replace("Z", "+00");
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY, is_anonymous INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      user_tier TEXT DEFAULT 'free',
      subscription_tier TEXT DEFAULT 'free',
      created_at TEXT
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT,
      last_selected_at TEXT
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
    CREATE TABLE child_locations(
      user_id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      updated_at TEXT NOT NULL,
      accuracy_m REAL
    );
    CREATE TABLE location_history(
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      recorded_at TEXT NOT NULL,
      is_estimated INTEGER,
      accuracy_m REAL
    );
    CREATE TABLE parent_alerts(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      title TEXT,
      message TEXT,
      severity TEXT,
      event_id TEXT,
      child_user_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE push_idempotency(
      key TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      first_sent_at TEXT,
      family_id TEXT,
      action TEXT
    );
    CREATE INDEX idx_location_history_user_recorded
      ON location_history(user_id, recorded_at);
    CREATE TABLE account_deletion_scopes(
      job_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(scope_type,scope_id)
    );
  `);
  sqlite.exec(locationConfirmationMigration);

  for (const [familyId, parentId] of [
    ["family-free", "parent-free"],
    ["family-reviewed", "parent-reviewed"],
    ["family-premium", "parent-premium"],
  ]) {
    sqlite.prepare("INSERT INTO users(id) VALUES (?)").run(parentId);
    sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)").run(familyId, parentId);
    sqlite.prepare(
      "INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES (?,?,?,?,1)",
    )
      .run(`member-${parentId}`, familyId, parentId, "parent");
  }

  sqlite.prepare("INSERT INTO family_review_rewards VALUES (?,?)")
    .run("family-reviewed", d1Timestamp(-60));
  sqlite.prepare("INSERT INTO family_subscription(family_id,status,trial_ends_at,current_period_end) VALUES (?,?,?,?)")
    .run("family-premium", "active", null, d1Timestamp(24 * 60));

  const members = [
    ["member-child-a", "family-reviewed", "child-a", "child", 1],
    ["member-child-b", "family-reviewed", "child-b", "child", 1],
    ["member-child-old", "family-reviewed", "child-old", "child", 0],
    ["member-teacher", "family-reviewed", "teacher-a", "teacher", 1],
    ["member-anonymous", "family-reviewed", "anonymous-a", "anonymous", 1],
    ["member-premium-child", "family-premium", "premium-child", "child", 1],
    ["member-free-child", "family-free", "free-child", "child", 1],
  ];
  for (const member of members) {
    sqlite.prepare(
      "INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES (?,?,?,?,?)",
    ).run(...member);
    sqlite.prepare("INSERT OR IGNORE INTO users(id) VALUES (?)").run(member[2]);
  }

  for (const [userId, lat, offsetMinutes] of [
    ["child-a", 37.51, -2],
    ["child-b", 37.52, -3],
    ["child-old", 37.53, -4],
    ["premium-child", 37.54, -1],
    ["free-child", 37.21, -1],
  ]) {
    const familyId = userId === "premium-child"
      ? "family-premium"
      : (userId === "free-child" ? "family-free" : "family-reviewed");
    sqlite.prepare("INSERT INTO child_locations VALUES (?,?,?,?,?,?)")
      .run(userId, familyId, lat, 127.01, d1Timestamp(offsetMinutes), 8);
  }

  for (const [userId, lat, offsetMinutes, estimated, accuracy] of [
    ["child-a", 37.30, -30, 0, 12],
    ["child-a", 37.40, -20, 0, 10],
    ["child-a", 37.45, -18, 1, 9],
    ["child-a", 37.50, -10, 0, 7],
    ["child-b", 37.60, -12, 0, 6],
    ["child-old", 37.70, -25, 0, 5],
    ["premium-child", 37.80, -10, 0, 4],
    ["free-child", 37.20, -20, 0, 5],
  ]) {
    const familyId = userId === "premium-child"
      ? "family-premium"
      : (userId === "free-child" ? "family-free" : "family-reviewed");
    sqlite.prepare(
      "INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m) VALUES (?,?,?,?,?,?,?)",
    ).run(userId, familyId, lat, 127.02, d1Timestamp(offsetMinutes), estimated, accuracy);
  }

  sqlite.prepare("INSERT INTO parent_alerts VALUES (?,?,?,?,?,?,?,?,?)").run(
    "incident-a",
    "family-reviewed",
    "location_stale",
    "위치 끊김",
    "확인이 필요합니다",
    "warning",
    null,
    "child-b",
    d1Timestamp(-5),
  );
  sqlite.prepare("INSERT INTO parent_alerts VALUES (?,?,?,?,?,?,?,?,?)").run(
    "incident-old",
    "family-reviewed",
    "location_stale",
    "이전 아이 위치 끊김",
    "확인이 필요합니다",
    "warning",
    null,
    "child-old",
    d1Timestamp(-4),
  );

  return { sqlite, db: new D1DatabaseAdapter(sqlite) };
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));
const locationAuditCursorSecret = "location-audit-cursor-test-secret-32-bytes";

async function bearer(sub, role, familyId) {
  const token = await new SignJWT({ role, family_id: familyId, is_anonymous: role === "anonymous" })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

async function request(db, path, { sub, role, familyId }, envOverrides = {}) {
  const app = new Hono();
  app.route("/api/location", locationRoutes);
  return app.request(
    `http://test.local/api/location${path}`,
    { headers: { Authorization: await bearer(sub, role, familyId) } },
    {
      DB: db,
      JWT_PRIVATE_KEY: jwtPrivateKey,
      JWT_PUBLIC_KEY: jwtPublicKey,
      LOCATION_AUDIT_CURSOR_SECRET: locationAuditCursorSecret,
      ...envOverrides,
    },
  );
}

test("위치 접근 모드는 free/reviewed를 standard, premium을 realtime로 판정한다", async () => {
  const { sqlite, db } = createDb();
  assert.equal(typeof authz.resolveLocationAccessMode, "function");
  assert.equal(await authz.resolveLocationAccessMode(db, "family-free"), "standard");
  assert.equal(await authz.resolveLocationAccessMode(db, "family-reviewed"), "standard");
  assert.equal(await authz.resolveLocationAccessMode(db, "family-premium"), "realtime");
  sqlite.close();
});

test("만료된 family_subscription 행은 legacy premium을 되살리지 않고 review만 별도 인정한다", async () => {
  const { sqlite, db } = createDb();
  for (const familyId of ["family-legacy", "family-expired", "family-expired-reviewed"]) {
    sqlite.prepare("INSERT INTO families(id,parent_id,user_tier,subscription_tier) VALUES (?,?,?,?)")
      .run(familyId, `parent-${familyId}`, "premium", "premium");
  }
  sqlite.prepare("INSERT INTO family_subscription(family_id,status,trial_ends_at,current_period_end) VALUES (?,?,?,?)")
    .run("family-expired", "expired", null, d1Timestamp(-60));
  sqlite.prepare("INSERT INTO family_subscription(family_id,status,trial_ends_at,current_period_end) VALUES (?,?,?,?)")
    .run("family-expired-reviewed", "cancelled", null, d1Timestamp(-60));
  sqlite.prepare("INSERT INTO family_review_rewards VALUES (?,?)")
    .run("family-expired-reviewed", d1Timestamp(-30));

  assert.equal(await authz.resolveLocationAccessMode(db, "family-legacy"), "realtime");
  assert.equal(await authz.resolveLocationAccessMode(db, "family-expired"), "standard");
  assert.equal(await authz.resolveLocationAccessMode(db, "family-expired-reviewed"), "standard");
  sqlite.close();
});

test("엔타이틀먼트 DB 오류는 위치 최신값을 fail-open하지 않는다", async (t) => {
  t.mock.method(console, "warn", () => {});
  assert.equal(typeof authz.resolveLocationAccessMode, "function");
  const failingDb = { prepare: () => { throw new Error("D1 unavailable"); } };
  await assert.rejects(
    authz.resolveLocationAccessMode(failingDb, "family-reviewed"),
    (error) => error?.code === "location_entitlement_unavailable" && error?.status === 503,
  );
});

test("위치 조회 API는 엔타이틀먼트 DB 오류를 503으로 반환한다", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { sqlite, db } = createDb();
  const failingDb = {
    prepare(sql) {
      if (sql.includes("family_subscription")) throw new Error("D1 unavailable");
      return db.prepare(sql);
    },
  };
  const response = await request(failingDb, "/children?family_id=family-reviewed", {
    sub: "parent-reviewed",
    role: "parent",
    familyId: "family-reviewed",
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "location_entitlement_unavailable" });
  sqlite.close();
});

test("무료·reviewed 부모 children은 10분 자동 cutoff 이전 아이별 최신 실측점만 받는다", async () => {
  const { sqlite, db } = createDb();
  const response = await request(db, "/children?family_id=family-reviewed", {
    sub: "parent-reviewed",
    role: "parent",
    familyId: "family-reviewed",
  });
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.user_id), ["child-a", "child-b"]);
  assert.equal(rows[0].lat, 37.50);
  assert.equal(rows[0].accuracy_m, 7);
  assert.equal(rows[0].updated_at, sqlite.prepare(
    "SELECT recorded_at FROM location_history WHERE user_id='child-a' AND lat=37.50",
  ).get().recorded_at);
  sqlite.close();
});

test("부모 children은 무료 10분 자동 스냅샷과 프리미엄 실시간을 서버에서 강제한다", async () => {
  const { sqlite, db } = createDb();
  const freeResponse = await request(db, "/children?family_id=family-free", {
    sub: "parent-free",
    role: "parent",
    familyId: "family-free",
  });
  assert.equal(freeResponse.status, 200);
  const freeRows = await freeResponse.json();
  assert.deepEqual(freeRows.map((row) => row.user_id), ["free-child"]);
  assert.equal(freeRows[0].lat, 37.20);

  const premiumResponse = await request(db, "/children?family_id=family-premium", {
    sub: "parent-premium",
    role: "parent",
    familyId: "family-premium",
  });
  assert.equal(premiumResponse.status, 200);
  assert.deepEqual((await premiumResponse.json()).map((row) => row.user_id), ["premium-child"]);
  sqlite.close();
});

test("무료 수동 위치 요청 뒤 새 실측점은 5분 확인 창에서 즉시 보이고 quota 재시도는 중복 차감하지 않는다", async () => {
  const { sqlite, db } = createDb();
  const requestAt = new Date(Date.now() - 2 * 60_000);
  const first = await usageQuota.claimLocationManualRequestUsage(db, {
    familyId: "family-free",
    targetUserId: "free-child",
    requestId: "manual-refresh-a",
    now: requestAt,
  });
  const duplicate = await usageQuota.claimLocationManualRequestUsage(db, {
    familyId: "family-free",
    targetUserId: "free-child",
    requestId: "manual-refresh-a",
    now: new Date(requestAt.getTime() + 1_000),
  });
  assert.equal(first.status, "claimed");
  assert.equal(duplicate.status, "duplicate");

  sqlite.prepare(
    "UPDATE child_locations SET lat=?, updated_at=? WHERE family_id=? AND user_id=?",
  ).run(37.299, d1Timestamp(-1), "family-free", "free-child");

  const response = await request(db, "/children?family_id=family-free", {
    sub: "parent-free",
    role: "parent",
    familyId: "family-free",
  });
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lat, 37.299);
  assert.equal(
    sqlite.prepare(
      "SELECT COUNT(*) AS n FROM push_idempotency WHERE action=?",
    ).get(usageQuota.LOCATION_MANUAL_USAGE_ACTION).n,
    1,
  );
  sqlite.close();
});

test("아이 children은 티어와 무관하게 활성 본인 최신 위치 한 건만 받는다", async () => {
  const { sqlite, db } = createDb();
  const response = await request(db, "/children?family_id=family-reviewed", {
    sub: "child-a",
    role: "child",
    familyId: "family-reviewed",
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map((row) => row.user_id), ["child-a"]);
  sqlite.close();
});

test("DB의 활성 child 정본은 stale parent JWT claim으로 형제 위치를 우회하지 못한다", async () => {
  const { sqlite, db } = createDb();
  const response = await request(db, "/children?family_id=family-reviewed", {
    sub: "child-a",
    role: "parent",
    familyId: "family-reviewed",
  });
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.deepEqual(rows.map((row) => row.user_id), ["child-a"]);
  assert.equal(rows[0].lat, 37.51);
  sqlite.close();
});

test("DB에 parent가 아닌 사용자는 stale parent JWT claim으로 위치 API를 우회하지 못한다", async () => {
  const { sqlite, db } = createDb();
  const start = encodeURIComponent(d1Timestamp(-60).replace(" ", "T").replace("+00", "Z"));
  const end = encodeURIComponent(d1Timestamp(1).replace(" ", "T").replace("+00", "Z"));
  for (const path of [
    "/children?family_id=family-reviewed",
    `/history?family_id=family-reviewed&start=${start}&end=${end}`,
    `/incidents?family_id=family-reviewed&start=${start}&end=${end}`,
  ]) {
    const response = await request(db, path, {
      sub: "teacher-a",
      role: "parent",
      familyId: "family-reviewed",
    });
    assert.equal(response.status, 403, path);
  }
  sqlite.close();
});

test("DB의 주보호자 정본은 stale child JWT claim보다 우선한다", async () => {
  const { sqlite, db } = createDb();
  const response = await request(db, "/children?family_id=family-reviewed", {
    sub: "parent-reviewed",
    role: "child",
    familyId: "family-reviewed",
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map((row) => row.user_id), ["child-a", "child-b"]);
  sqlite.close();
});

test("선생님과 anonymous는 children을 조회할 수 없다", async () => {
  const { sqlite, db } = createDb();
  for (const caller of [
    { sub: "teacher-a", role: "teacher", familyId: "family-reviewed" },
    { sub: "anonymous-a", role: "anonymous", familyId: "family-reviewed" },
  ]) {
    const response = await request(db, "/children?family_id=family-reviewed", caller);
    assert.equal(response.status, 403);
  }
  sqlite.close();
});

test("history는 무료·reviewed의 현재 08시 기준 오늘과 프리미엄 최근 30일만 연다", async () => {
  const { sqlite, db } = createDb();
  let nowMs = Date.now();
  let standardWindow = locationModule.standardLocationHistoryWindow(nowMs);
  const elapsedFromWindowStartMs = nowMs - standardWindow.startMs;
  if (elapsedFromWindowStartMs < 2_000) {
    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 2_000 - elapsedFromWindowStartMs);
    });
    nowMs = Date.now();
    standardWindow = locationModule.standardLocationHistoryWindow(nowMs);
  }
  const inWindowTimestamp = new Date(Math.max(standardWindow.startMs, nowMs - 1_000))
    .toISOString()
    .replace("T", " ")
    .replace("Z", "+00");
  const insertInWindow = sqlite.prepare(
    `INSERT INTO location_history
       (user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m)
     VALUES (?,?,?,?,?,0,?)`,
  );
  insertInWindow.run("child-a", "family-reviewed", 37.501, 127.02, inWindowTimestamp, 5);
  insertInWindow.run("free-child", "family-free", 37.201, 127.02, inWindowTimestamp, 5);
  const start = encodeURIComponent(new Date(standardWindow.startMs).toISOString());
  const end = encodeURIComponent(new Date(standardWindow.endMs).toISOString());
  const path = `/history?family_id=family-premium&start=${start}&end=${end}`;
  const premium = await request(db, path, {
    sub: "parent-premium",
    role: "parent",
    familyId: "family-premium",
  });
  assert.equal(premium.status, 200);
  assert.equal((await premium.json()).length, 1);

  for (const caller of [
    { sub: "parent-reviewed", role: "parent", familyId: "family-reviewed", family: "family-reviewed", expected: true },
    { sub: "parent-free", role: "parent", familyId: "family-free", family: "family-free", expected: true },
    { sub: "premium-child", role: "child", familyId: "family-premium", family: "family-premium", expected: false },
  ]) {
    const callerPath = `/history?family_id=${caller.family}&start=${start}&end=${end}`;
    const response = await request(db, callerPath, caller);
    assert.equal(response.status, 200);
    const rows = await response.json();
    if (caller.expected) assert.ok(rows.length > 0, caller.family);
    else assert.deepEqual(rows, []);
  }

  const yesterdayStart = encodeURIComponent(new Date(standardWindow.startMs - 24 * 60 * 60_000).toISOString());
  const yesterdayEnd = encodeURIComponent(new Date(standardWindow.startMs).toISOString());
  const oldFree = await request(
    db,
    `/history?family_id=family-free&start=${yesterdayStart}&end=${yesterdayEnd}`,
    { sub: "parent-free", role: "parent", familyId: "family-free" },
  );
  assert.equal(oldFree.status, 200);
  assert.deepEqual(await oldFree.json(), []);
  sqlite.close();
});

test("history read window는 KST 08시 경계와 Premium 30일 상한을 정확히 clamp한다", () => {
  const nowMs = Date.parse("2026-08-01T03:00:00.000Z"); // KST 12:00
  const standard = locationModule.standardLocationHistoryWindow(nowMs);
  assert.deepEqual(standard, {
    startMs: Date.parse("2026-07-31T23:00:00.000Z"),
    endMs: Date.parse("2026-08-01T23:00:00.000Z"),
  });

  assert.deepEqual(
    locationModule.resolveLocationHistoryReadWindow(
      "standard",
      "2026-07-31T23:00:00.000Z",
      "2026-08-01T23:00:00.000Z",
      nowMs,
    ),
    { startMs: standard.startMs, endMs: nowMs },
  );
  assert.equal(
    locationModule.resolveLocationHistoryReadWindow(
      "standard",
      "2026-07-31T22:59:59.999Z",
      "2026-08-01T03:00:00.000Z",
      nowMs,
    ),
    null,
  );

  assert.deepEqual(
    locationModule.resolveLocationHistoryReadWindow(
      "realtime",
      "2026-05-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
      nowMs,
    ),
    {
      startMs: nowMs - 30 * 24 * 60 * 60_000,
      endMs: nowMs,
    },
  );
});

test("incidents는 티어와 무관한 부모 전용이며 아이·선생님에게 형제 기록을 숨긴다", async () => {
  const { sqlite, db } = createDb();
  const start = encodeURIComponent(d1Timestamp(-60).replace(" ", "T").replace("+00", "Z"));
  const end = encodeURIComponent(d1Timestamp(1).replace(" ", "T").replace("+00", "Z"));
  const path = `/incidents?family_id=family-reviewed&start=${start}&end=${end}`;

  const parent = await request(db, path, {
    sub: "parent-reviewed",
    role: "parent",
    familyId: "family-reviewed",
  });
  assert.equal(parent.status, 200);
  assert.deepEqual((await parent.json()).map((row) => row.id), ["incident-a"]);

  const activeChild = await request(db, `${path}&child_user_id=child-b`, {
    sub: "parent-reviewed",
    role: "parent",
    familyId: "family-reviewed",
  });
  assert.equal(activeChild.status, 200);
  assert.deepEqual((await activeChild.json()).map((row) => row.id), ["incident-a"]);

  const inactiveChild = await request(db, `${path}&child_user_id=child-old`, {
    sub: "parent-reviewed",
    role: "parent",
    familyId: "family-reviewed",
  });
  assert.equal(inactiveChild.status, 200);
  assert.deepEqual(await inactiveChild.json(), []);

  for (const caller of [
    { sub: "child-a", role: "child", familyId: "family-reviewed" },
    { sub: "teacher-a", role: "teacher", familyId: "family-reviewed" },
  ]) {
    const response = await request(db, path, caller);
    assert.equal(response.status, 403);
  }
  sqlite.close();
});

test("위치 확인자료 열람은 인증 가족·활성 자녀 범위만 반환하고 좌표를 노출하지 않는다", async () => {
  const { sqlite, db } = createDb();
  const start = encodeURIComponent(new Date(Date.now() - 60 * 60_000).toISOString());
  const end = encodeURIComponent(new Date(Date.now() + 60 * 60_000).toISOString());
  const path = `/audit?family_id=family-reviewed&start=${start}&end=${end}`;

  const parent = await request(db, path, {
    sub: "parent-reviewed",
    role: "parent",
    familyId: "family-reviewed",
  });
  assert.equal(parent.status, 200);
  const parentPage = await parent.json();
  assert.equal(parentPage.hasMore, false);
  assert.equal(parentPage.nextCursor, null);
  const parentRows = parentPage.records;
  assert.ok(parentRows.length > 0);
  assert.deepEqual(
    [...new Set(parentRows.map((row) => row.subject_user_id))].sort(),
    ["child-a", "child-b"],
  );
  for (const row of parentRows) {
    for (const forbidden of ["lat", "lng", "latitude", "longitude", "address", "metadata", "payload"]) {
      assert.equal(Object.hasOwn(row, forbidden), false, forbidden);
    }
  }

  const child = await request(db, path, {
    sub: "child-a",
    role: "child",
    familyId: "family-reviewed",
  });
  assert.equal(child.status, 200);
  const childPage = await child.json();
  assert.deepEqual(
    [...new Set(childPage.records.map((row) => row.subject_user_id))],
    ["child-a"],
  );

  const crossFamily = await request(db, path, {
    sub: "parent-free",
    role: "parent",
    familyId: "family-free",
  });
  assert.equal(crossFamily.status, 403);

  const tooWideStart = encodeURIComponent(new Date(Date.now() - 32 * 24 * 60 * 60_000).toISOString());
  const invalidWindow = await request(
    db,
    `/audit?family_id=family-reviewed&start=${tooWideStart}&end=${end}`,
    { sub: "parent-reviewed", role: "parent", familyId: "family-reviewed" },
  );
  assert.equal(invalidWindow.status, 400);
  assert.deepEqual(await invalidWindow.json(), { error: "invalid_audit_window" });
  sqlite.close();
});

test("위치 확인자료 keyset 페이지는 동률 시각 1,005건을 중복·누락 없이 끝까지 순회한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.exec("DELETE FROM location_confirmation_records");
  const occurredAt = d1Timestamp(-10);
  const insert = sqlite.prepare(
    `INSERT INTO location_confirmation_records
       (id,family_id,subject_user_id,action,requester_kind,requester_user_id,
        recipient_kind,recipient_user_id,collection_method,acquisition_path,
        service_code,delivery_method,purpose_code,occurred_at,completed_at,recorded_at)
     VALUES (?,'family-reviewed','child-a','collect','subject','child-a',
             'none',NULL,'android_fused_location','android_native_app',
             'current_location_ingest','https_worker_api','family_location_safety',?,?,?)`,
  );
  for (let index = 0; index < 1_005; index += 1) {
    insert.run(`audit-${String(index).padStart(4, "0")}`, occurredAt, occurredAt, occurredAt);
  }

  const start = encodeURIComponent(new Date(Date.now() - 60 * 60_000).toISOString());
  const end = encodeURIComponent(new Date(Date.now() + 60 * 60_000).toISOString());
  const basePath = `/audit?family_id=family-reviewed&start=${start}&end=${end}&pageSize=1000`;
  const caller = { sub: "parent-reviewed", role: "parent", familyId: "family-reviewed" };

  const ids = [];
  let cursor = null;
  do {
    const response = await request(
      db,
      `${basePath}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      caller,
    );
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.equal(Array.isArray(page.records), true);
    assert.equal(typeof page.hasMore, "boolean");
    assert.equal(page.nextCursor === null || typeof page.nextCursor === "string", true);
    ids.push(...page.records.map((row) => row.id));
    cursor = page.nextCursor;
    if (!page.hasMore) assert.equal(cursor, null);
  } while (cursor);

  assert.equal(ids.length, 1_005);
  assert.equal(new Set(ids).size, 1_005);
  assert.deepEqual(ids, [...ids].sort().reverse());

  const defaultPageResponse = await request(
    db,
    `/audit?family_id=family-reviewed&start=${start}&end=${end}`,
    caller,
  );
  assert.equal(defaultPageResponse.status, 200);
  const defaultPage = await defaultPageResponse.json();
  assert.equal(defaultPage.records.length, 1_000);
  assert.equal(defaultPage.hasMore, true);
  assert.equal(typeof defaultPage.nextCursor, "string");
  sqlite.close();
});

test("위치 확인자료 cursor는 손상·서명 변조·범위 변경·자녀 scope 변경을 거부한다", async () => {
  const { sqlite, db } = createDb();
  const startIso = new Date(Date.now() - 60 * 60_000).toISOString();
  const endIso = new Date(Date.now() + 60 * 60_000).toISOString();
  const start = encodeURIComponent(startIso);
  const end = encodeURIComponent(endIso);
  const caller = { sub: "parent-reviewed", role: "parent", familyId: "family-reviewed" };
  const first = await request(
    db,
    `/audit?family_id=family-reviewed&start=${start}&end=${end}&pageSize=1`,
    caller,
  );
  assert.equal(first.status, 200);
  const firstPage = await first.json();
  assert.equal(typeof firstPage.nextCursor, "string");
  const cursorParts = firstPage.nextCursor.split(".");
  assert.equal(cursorParts.length, 3);
  const tamperedPayload = JSON.parse(Buffer.from(cursorParts[1], "base64url").toString("utf8"));
  tamperedPayload.id = `${tamperedPayload.id}-tampered`;
  const tamperedCursor = [
    cursorParts[0],
    Buffer.from(JSON.stringify(tamperedPayload), "utf8").toString("base64url"),
    cursorParts[2],
  ].join(".");

  for (const path of [
    `/audit?family_id=family-reviewed&start=${start}&end=${end}&pageSize=1&cursor=${encodeURIComponent("not-a-cursor")}`,
    `/audit?family_id=family-reviewed&start=${start}&end=${end}&pageSize=1&cursor=${encodeURIComponent(tamperedCursor)}`,
    `/audit?family_id=family-reviewed&start=${encodeURIComponent(new Date(Date.now() - 30 * 60_000).toISOString())}&end=${end}&pageSize=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    `/audit?family_id=family-reviewed&start=${start}&end=${end}&child_user_id=child-a&pageSize=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
  ]) {
    const response = await request(db, path, caller);
    assert.equal(response.status, 400, path);
    assert.deepEqual(await response.json(), { error: "invalid_audit_cursor" }, path);
  }

  for (const pageSize of ["0", "1001", "1.5", "nope"]) {
    const response = await request(
      db,
      `/audit?family_id=family-reviewed&start=${start}&end=${end}&pageSize=${pageSize}`,
      caller,
    );
    assert.equal(response.status, 400, pageSize);
    assert.deepEqual(await response.json(), { error: "invalid_audit_page_size" }, pageSize);
  }

  for (const unavailableSecret of [undefined, "too-short"]) {
    const response = await request(
      db,
      `/audit?family_id=family-reviewed&start=${start}&end=${end}&pageSize=1`,
      caller,
      { LOCATION_AUDIT_CURSOR_SECRET: unavailableSecret },
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "location_audit_cursor_unavailable" });
  }

  const crossFamily = await request(
    db,
    `/audit?family_id=family-reviewed&start=${start}&end=${end}&pageSize=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    { sub: "parent-free", role: "parent", familyId: "family-free" },
  );
  assert.equal(crossFamily.status, 403);
  assert.deepEqual(await crossFamily.json(), { error: "forbidden" });
  sqlite.close();
});

test("법정 확인자료 원장이 없으면 위치 조회는 좌표를 fail-open하지 않는다", async () => {
  const { sqlite, db } = createDb();
  sqlite.exec("DROP TABLE location_confirmation_records");
  const response = await request(db, "/children?family_id=family-premium", {
    sub: "parent-premium",
    role: "parent",
    familyId: "family-premium",
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "location_confirmation_unavailable" });
  sqlite.close();
});

test("위치 제공 확인자료는 실제 반환된 활성 자녀에 대해서만 기록한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.exec("DELETE FROM location_confirmation_records");
  sqlite.prepare("DELETE FROM child_locations WHERE user_id=?").run("child-b");
  sqlite.prepare("DELETE FROM location_history WHERE user_id=?").run("child-b");

  const response = await request(db, "/children?family_id=family-reviewed", {
    sub: "parent-reviewed",
    role: "parent",
    familyId: "family-reviewed",
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map((row) => row.user_id), ["child-a"]);
  assert.deepEqual(
    sqlite.prepare(
      "SELECT subject_user_id FROM location_confirmation_records ORDER BY subject_user_id",
    ).all().map((row) => row.subject_user_id),
    ["child-a"],
  );
  sqlite.close();
});

test("빈 위치 응답은 제공하지 않은 자녀의 확인자료를 만들지 않는다", async () => {
  const { sqlite, db } = createDb();
  sqlite.exec(`
    DELETE FROM location_confirmation_records;
    DELETE FROM child_locations WHERE family_id='family-reviewed';
    DELETE FROM location_history WHERE family_id='family-reviewed';
    DELETE FROM parent_alerts WHERE family_id='family-reviewed';
  `);

  const start = encodeURIComponent(new Date(Date.now() - 60 * 60_000).toISOString());
  const end = encodeURIComponent(new Date(Date.now() + 1_000).toISOString());
  for (const path of [
    "/children?family_id=family-reviewed",
    `/history?family_id=family-reviewed&start=${start}&end=${end}`,
    `/incidents?family_id=family-reviewed&start=${start}&end=${end}`,
  ]) {
    const response = await request(db, path, {
      sub: "parent-reviewed",
      role: "parent",
      familyId: "family-reviewed",
    });
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), [], path);
  }
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM location_confirmation_records").get().count,
    0,
  );
  sqlite.close();
});

test("자녀 본인 위치가 없으면 사용하지 않은 확인자료를 만들지 않는다", async () => {
  const { sqlite, db } = createDb();
  sqlite.exec("DELETE FROM location_confirmation_records");
  sqlite.prepare("DELETE FROM child_locations WHERE user_id=?").run("child-a");
  const response = await request(db, "/children?family_id=family-reviewed", {
    sub: "child-a",
    role: "child",
    familyId: "family-reviewed",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM location_confirmation_records").get().count,
    0,
  );
  sqlite.close();
});

test("10분 자동 cutoff는 버킷 경계의 밀리초를 보존하고 이후 최신점으로 대체하지 않는다", () => {
  assert.equal(typeof locationModule.locationStandardCutoff, "function");
  assert.equal(typeof locationModule.STANDARD_CHILD_LOCATIONS_SQL, "string");

  const cutoff = locationModule.locationStandardCutoff(Date.parse("2026-07-13T03:15:00.000Z"));
  assert.equal(cutoff, "2026-07-13 03:10:00.000000+00");

  const { sqlite } = createDb();
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_location_history_user_recorded ON location_history(user_id, recorded_at)");
  sqlite.prepare("DELETE FROM location_history WHERE family_id=?").run("family-reviewed");
  sqlite.prepare(
    "INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m) VALUES (?,?,?,?,?,?,?)",
  ).run("child-a", "family-reviewed", 37.15, 127.0, "2026-07-13 03:10:00.000000+00", 0, 5);
  sqlite.prepare(
    "INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m) VALUES (?,?,?,?,?,?,?)",
  ).run("child-a", "family-reviewed", 37.149999, 127.0, "2026-07-13 03:10:00.001000+00", 0, 4);

  const rows = sqlite.prepare(locationModule.STANDARD_CHILD_LOCATIONS_SQL)
    .all(cutoff, "family-reviewed");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lat, 37.15);
  assert.equal(rows[0].updated_at, "2026-07-13 03:10:00.000000+00");
  sqlite.close();
});

test("standard 자동 최신점 쿼리는 active child별 correlated index lookup을 사용한다", () => {
  assert.equal(typeof locationModule.STANDARD_CHILD_LOCATIONS_SQL, "string");
  const sql = locationModule.STANDARD_CHILD_LOCATIONS_SQL;
  assert.match(sql, /candidate\.user_id = fm\.user_id/);
  assert.match(sql, /candidate\.recorded_at <= \?/);
  assert.match(sql, /ORDER BY candidate\.recorded_at DESC, candidate\.id DESC/);
  assert.doesNotMatch(sql, /ROW_NUMBER|WITH\s+ranked|substr\(|datetime\(/i);

  const { sqlite } = createDb();
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_location_history_user_recorded ON location_history(user_id, recorded_at)");
  const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all("2026-07-13 03:00:00.000000+00", "family-reviewed")
    .map((row) => row.detail)
    .join("\n");
  assert.match(plan, /CORRELATED SCALAR SUBQUERY/);
  assert.match(plan, /idx_location_history_user_recorded \(user_id=\? AND recorded_at<\?\)/);
  sqlite.close();
});

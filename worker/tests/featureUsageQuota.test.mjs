import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
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

const quota = await import(pathToFileURL(resolve(workerDir, "lib/featureUsageQuota.ts")).href);

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

async function createDb() {
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      user_tier TEXT DEFAULT 'free',
      subscription_tier TEXT DEFAULT 'free'
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
      status TEXT,
      expires_at TEXT
    );
    CREATE TABLE family_review_rewards(
      family_id TEXT PRIMARY KEY,
      granted_at TEXT
    );
    CREATE TABLE push_idempotency(
      key TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      first_sent_at TEXT,
      family_id TEXT,
      action TEXT
    );
    CREATE TABLE force_ring_events(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      delivered_at TEXT,
      stopped_at TEXT,
      stop_reason TEXT,
      triggered_at TEXT NOT NULL
    );
  `);
  for (const familyId of ["family-free", "family-reviewed", "family-premium"]) {
    sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)")
      .run(familyId, `parent-${familyId}`);
  }
  sqlite.prepare("INSERT INTO family_review_rewards(family_id,granted_at) VALUES (?,?)")
    .run("family-reviewed", "2026-07-01 00:00:00.000000+00");
  sqlite.prepare(
    "INSERT INTO family_subscription(family_id,status,current_period_end) VALUES (?,?,?)",
  ).run("family-premium", "active", "2099-01-01 00:00:00.000000+00");
  return { sqlite, db: new D1DatabaseAdapter(sqlite) };
}

const NOW = new Date("2026-08-01T03:00:00.000Z");

test("무료와 grandfather 가족의 즉시 위치 요청은 24시간 동안 정확히 5회만 원자 허용한다", async () => {
  for (const familyId of ["family-free", "family-reviewed"]) {
    const { sqlite, db } = await createDb();
    const claims = await Promise.all(
      Array.from({ length: 6 }, (_, index) => quota.claimLocationManualRequestUsage(db, {
        familyId,
        targetUserId: "child-a",
        requestId: `request-${index}`,
        now: NOW,
      })),
    );

    assert.equal(claims.filter((claim) => claim.status === "claimed").length, 5, familyId);
    assert.deepEqual(
      claims.find((claim) => claim.status === "exhausted"),
      { status: "exhausted", tier: "free", quota: 5, used: 5 },
      familyId,
    );
    assert.equal(
      sqlite.prepare(
        "SELECT COUNT(*) AS n FROM push_idempotency WHERE family_id=? AND action=?",
      ).get(familyId, quota.LOCATION_MANUAL_USAGE_ACTION).n,
      5,
    );
    sqlite.close();
  }
});

test("같은 위치 요청 재시도는 quota를 다시 차감하지 않고 같은 대상의 수동 갱신 근거를 남긴다", async () => {
  const { sqlite, db } = await createDb();
  const first = await quota.claimLocationManualRequestUsage(db, {
    familyId: "family-free",
    targetUserId: "child-a",
    requestId: "same-request",
    now: NOW,
  });
  const duplicate = await quota.claimLocationManualRequestUsage(db, {
    familyId: "family-free",
    targetUserId: "child-a",
    requestId: "same-request",
    now: new Date(NOW.getTime() + 1_000),
  });

  assert.equal(first.status, "claimed");
  assert.deepEqual(duplicate, { status: "duplicate", tier: "free", quota: 5, used: 1 });
  const row = sqlite.prepare("SELECT key FROM push_idempotency").get();
  assert.equal(quota.locationManualUsageTarget(row.key), "child-a");
  assert.equal(quota.locationManualUsageTarget("attacker-controlled"), null);
  sqlite.close();
});

test("프리미엄 위치 즉시 요청은 무제한이며 사용량 행을 만들지 않는다", async () => {
  const { sqlite, db } = await createDb();
  const result = await quota.claimLocationManualRequestUsage(db, {
    familyId: "family-premium",
    targetUserId: "child-premium",
    requestId: "premium-request",
    now: NOW,
  });

  assert.deepEqual(result, { status: "unlimited", tier: "premium", quota: null, used: 0 });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_idempotency").get().n, 0);
  sqlite.close();
});

test("위치 요청 한도는 달력 날짜가 아니라 요청 시각 기준 rolling 24시간으로 복구된다", async () => {
  const { sqlite, db } = await createDb();
  const expiredAt = new Date(NOW.getTime() - 24 * 60 * 60_000 - 1_000);
  for (let index = 0; index < 5; index++) {
    const oldClaim = await quota.claimLocationManualRequestUsage(db, {
      familyId: "family-free",
      targetUserId: "child-a",
      requestId: `old-${index}`,
      now: expiredAt,
    });
    assert.equal(oldClaim.status, "claimed");
  }

  for (let index = 0; index < 5; index++) {
    const currentClaim = await quota.claimLocationManualRequestUsage(db, {
      familyId: "family-free",
      targetUserId: "child-a",
      requestId: `current-${index}`,
      now: NOW,
    });
    assert.equal(currentClaim.status, "claimed");
  }
  const exhausted = await quota.claimLocationManualRequestUsage(db, {
    familyId: "family-free",
    targetUserId: "child-a",
    requestId: "current-sixth",
    now: NOW,
  });
  assert.deepEqual(exhausted, { status: "exhausted", tier: "free", quota: 5, used: 5 });
  sqlite.close();
});

test("무료 소리 울리기 동시 발사는 provisional lease로 1회만 허용하고 해제 후 재시도할 수 있다", async () => {
  const { sqlite, db } = await createDb();
  const [first, second] = await Promise.all([
    quota.claimForceRingQuotaLease(db, {
      familyId: "family-free",
      requestId: "ring-a",
      now: NOW,
    }),
    quota.claimForceRingQuotaLease(db, {
      familyId: "family-free",
      requestId: "ring-b",
      now: NOW,
    }),
  ]);
  const claimed = [first, second].find((result) => result.status === "claimed");
  const rejected = [first, second].find((result) => result.status !== "claimed");

  assert.ok(claimed && claimed.status === "claimed");
  assert.deepEqual(rejected, { status: "duplicate", tier: "free", quota: 1, used: 1 });
  assert.equal(await quota.releaseFeatureUsageClaim(db, claimed.claimKey), true);
  const retry = await quota.claimForceRingQuotaLease(db, {
    familyId: "family-free",
    requestId: "ring-b",
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(retry.status, "claimed");
  sqlite.close();
});

test("프리미엄 소리 울리기는 10회, 무료·reviewed는 1회이고 완료 이벤트를 기준으로 계산한다", async () => {
  const { sqlite, db } = await createDb();
  for (let index = 0; index < 9; index++) {
    sqlite.prepare(
      "INSERT INTO force_ring_events(id,family_id,delivered_at,triggered_at) VALUES (?,?,?,?)",
    ).run(
      `ring-${index}`,
      "family-premium",
      "2026-08-01 02:59:00.000000+00",
      "2026-08-01 02:59:00.000000+00",
    );
  }
  sqlite.prepare(
    "INSERT INTO force_ring_events(id,family_id,delivered_at,triggered_at) VALUES (?,?,?,?)",
  ).run(
    "free-ring",
    "family-free",
    "2026-08-01 02:59:00.000000+00",
    "2026-08-01 02:59:00.000000+00",
  );

  assert.deepEqual(await quota.readForceRingQuota(db, "family-free", NOW), {
    allowed: false,
    quota: 1,
    used: 1,
    tier: "free",
  });
  assert.deepEqual(await quota.readForceRingQuota(db, "family-reviewed", NOW), {
    allowed: true,
    quota: 1,
    used: 0,
    tier: "free",
  });
  assert.deepEqual(await quota.readForceRingQuota(db, "family-premium", NOW), {
    allowed: true,
    quota: 10,
    used: 9,
    tier: "premium",
  });

  const tenth = await quota.claimForceRingQuotaLease(db, {
    familyId: "family-premium",
    requestId: "premium-ring-tenth",
    now: NOW,
  });
  assert.equal(tenth.status, "claimed");
  assert.equal(await quota.releaseFeatureUsageClaim(db, tenth.claimKey), true);
  sqlite.prepare(
    "INSERT INTO force_ring_events(id,family_id,delivered_at,triggered_at) VALUES (?,?,?,?)",
  ).run(
    "premium-ring-tenth",
    "family-premium",
    "2026-08-01 03:00:00.000000+00",
    "2026-08-01 03:00:00.000000+00",
  );
  assert.deepEqual(
    await quota.claimForceRingQuotaLease(db, {
      familyId: "family-premium",
      requestId: "premium-ring-eleventh",
      now: new Date(NOW.getTime() + 1_000),
    }),
    { status: "exhausted", tier: "premium", quota: 10, used: 10 },
  );
  sqlite.close();
});

test("엔타이틀먼트 또는 사용량 DB 장애는 무료로 추정하지 않고 typed 503으로 닫는다", async () => {
  const failingDb = {
    prepare(sql) {
      if (sql.includes("family_subscription")) throw new Error("D1 unavailable");
      throw new Error("unexpected query");
    },
  };

  await assert.rejects(
    quota.claimLocationManualRequestUsage(failingDb, {
      familyId: "family-free",
      targetUserId: "child-a",
      requestId: "request-a",
      now: NOW,
    }),
    (error) => error?.status === 503,
  );
  await assert.rejects(
    quota.claimForceRingQuotaLease(failingDb, {
      familyId: "family-free",
      requestId: "ring-a",
      now: NOW,
    }),
    (error) => error?.status === 503,
  );
});

test("사용량 quota wiring은 request_location·force_ring에만 있고 SOS·긴급 action을 제한하지 않는다", () => {
  const source = readFileSync(resolve(workerDir, "routes/push-notify.ts"), "utf8");
  assert.match(source, /claimLocationManualRequestUsage/);
  assert.match(source, /claimForceRingQuotaLease/);

  const sosDispatch = source.slice(
    source.indexOf('body?.action === "emergency"'),
    source.indexOf("return await handleInstantNotification", source.indexOf('body?.action === "emergency"')) + 50,
  );
  assert.doesNotMatch(sosDispatch, /Quota|quota|Usage/);
});

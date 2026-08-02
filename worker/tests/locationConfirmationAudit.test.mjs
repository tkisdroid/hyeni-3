import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

const audit = await import(
  pathToFileURL(resolve(workerDir, "lib/locationConfirmationAudit.ts")).href
);
const migration = readFileSync(
  resolve(workerDir, "db/location-confirmation-records.sql"),
  "utf8",
);
const capacityMonitorSql = readFileSync(
  resolve(workerDir, "ops/location-confirmation-capacity.sql"),
  "utf8",
);

class D1StatementAdapter {
  constructor(db, sql, bindings = [], boundParameterCounts = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
    this.boundParameterCounts = boundParameterCounts;
  }

  bind(...bindings) {
    this.boundParameterCounts.push(bindings.length);
    if (bindings.length > 100) {
      throw new Error(`D1_ERROR: too many SQL variables: ${bindings.length}`);
    }
    return new D1StatementAdapter(this.db, this.sql, bindings, this.boundParameterCounts);
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
    this.boundParameterCounts = [];
  }

  prepare(sql) {
    return new D1StatementAdapter(this.db, sql, [], this.boundParameterCounts);
  }

  async batch(statements) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
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
    CREATE TABLE families(id TEXT PRIMARY KEY, parent_id TEXT NOT NULL);
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);
  sqlite.exec(migration);
  sqlite.exec(migration);
  return { sqlite, db: new D1DatabaseAdapter(sqlite) };
}

test("좌표 저장 trigger는 수집 확인자료를 같은 transaction에서 자동 기록한다", () => {
  const { sqlite } = createDb();
  sqlite.prepare(
    "INSERT INTO child_locations VALUES (?,?,?,?,?,?)",
  ).run("child-1", "family-1", 37.1, 127.1, "2026-08-01 01:00:00", 5);
  sqlite.prepare(
    "INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m) VALUES (?,?,?,?,?,?,?)",
  ).run("child-1", "family-1", 37.2, 127.2, "2026-08-01 01:00:00", 0, 5);
  sqlite.prepare(
    "INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m) VALUES (?,?,?,?,?,?,?)",
  ).run("child-1", "family-1", 37.2, 127.2, "2026-08-01 01:01:00", 0, 5);
  sqlite.prepare(
    "INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m) VALUES (?,?,?,?,?,?,?)",
  ).run("child-1", "family-1", 37.25, 127.25, "2026-08-01 01:02:00", 1, 5);

  const rows = sqlite.prepare(
    `SELECT action, subject_user_id, requester_kind, requester_user_id,
            recipient_kind, recipient_user_id, collection_method, acquisition_path,
            service_code, delivery_method, purpose_code, occurred_at, completed_at
       FROM location_confirmation_records ORDER BY occurred_at`,
  ).all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    {
      action: "collect",
      subject_user_id: "child-1",
      requester_kind: "subject",
      requester_user_id: "child-1",
      recipient_kind: "none",
      recipient_user_id: null,
      collection_method: "android_fused_location",
      acquisition_path: "android_native_app",
      service_code: "current_location_ingest",
      delivery_method: "https_worker_api",
      purpose_code: "family_location_safety",
      occurred_at: "2026-08-01 01:00:00",
      completed_at: "2026-08-01 01:00:00",
    },
    {
      action: "collect",
      subject_user_id: "child-1",
      requester_kind: "subject",
      requester_user_id: "child-1",
      recipient_kind: "none",
      recipient_user_id: null,
      collection_method: "android_fused_location",
      acquisition_path: "android_native_app",
      service_code: "location_history_ingest",
      delivery_method: "https_worker_api",
      purpose_code: "family_location_safety",
      occurred_at: "2026-08-01 01:01:00",
      completed_at: "2026-08-01 01:01:00",
    },
  ]);
  sqlite.close();
});

test("current·history trigger는 순서와 무관하게 같은 sink 쌍의 동일 Android fix만 합친다", () => {
  const { sqlite } = createDb();
  assert.match(migration, /WHERE NOT EXISTS \([\s\S]+existing\.occurred_at=NEW\.recorded_at/);
  assert.match(migration, /substr\(existing\.occurred_at,1,19\)=substr\(NEW\.recorded_at,1,19\)/);
  assert.doesNotMatch(migration, /INSERT\s+OR\s+IGNORE/i);
  assert.doesNotMatch(migration, /ON\s+CONFLICT/i);
  assert.match(migration, /AFTER INSERT ON location_history\s+WHEN NEW\.is_estimated=0/);

  sqlite.prepare(
    "INSERT INTO location_history(user_id,family_id,lat,lng,recorded_at,is_estimated,accuracy_m) VALUES (?,?,?,?,?,?,?)",
  ).run("child-reverse", "family-1", 37.3, 127.3, "2026-08-01 01:30:00", 0, 5);
  sqlite.prepare(
    "INSERT INTO child_locations VALUES (?,?,?,?,?,?)",
  ).run("child-reverse", "family-1", 37.3, 127.3, "2026-08-01 01:30:00", 5);
  assert.equal(
    sqlite.prepare(
      "SELECT COUNT(*) AS n FROM location_confirmation_records WHERE subject_user_id='child-reverse' AND action='collect'",
    ).get().n,
    1,
  );

  const plan = sqlite.prepare(
    `EXPLAIN QUERY PLAN SELECT 1 FROM location_confirmation_records existing
      WHERE existing.family_id=? AND existing.subject_user_id=?
        AND existing.action='collect' AND existing.acquisition_path='android_native_app'
        AND existing.service_code='current_location_ingest'
        AND substr(existing.occurred_at,1,19)=substr(?,1,19)
        AND existing.occurred_at=? LIMIT 1`,
  ).all("family-1", "child-1", "2026-08-01 01:00:00", "2026-08-01 01:00:00");
  assert.match(
    plan.map((row) => String(row.detail)).join("\n"),
    /USING INDEX idx_location_confirmation_family_subject_occurred/,
  );

  const insert = sqlite.prepare(
    `INSERT INTO location_confirmation_records
       (id,family_id,subject_user_id,action,requester_kind,requester_user_id,
        recipient_kind,recipient_user_id,collection_method,acquisition_path,
        service_code,delivery_method,purpose_code,occurred_at,completed_at,recorded_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const common = ["family-1", "child-1", "2026-08-01 02:00:00"];
  insert.run(
    "use-1", common[0], common[1], "use", "system", null, "none", null,
    "not_applicable", "current_location_store", "registered_place_monitor",
    "worker_internal", "arrival_departure_alert", common[2], common[2], common[2],
  );
  insert.run(
    "use-2", common[0], common[1], "use", "system", null, "none", null,
    "not_applicable", "current_location_store", "danger_zone_monitor",
    "worker_internal", "danger_zone_alert", common[2], common[2], common[2],
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM location_confirmation_records WHERE action='use'").get().n,
    2,
  );
  sqlite.close();
});

test("확인자료 스키마는 좌표·주소·자유 JSON 없이 고정 allowlist만 허용한다", () => {
  const { sqlite } = createDb();
  const columns = sqlite.prepare("PRAGMA table_info(location_confirmation_records)")
    .all().map((row) => String(row.name));
  for (const forbidden of ["lat", "lng", "latitude", "longitude", "address", "metadata", "payload", "details"]) {
    assert.equal(columns.includes(forbidden), false);
  }
  assert.throws(() => {
    sqlite.prepare(
      `INSERT INTO location_confirmation_records
         (id,family_id,subject_user_id,action,requester_kind,requester_user_id,
          recipient_kind,recipient_user_id,collection_method,acquisition_path,
          service_code,delivery_method,purpose_code,occurred_at,completed_at,recorded_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      crypto.randomUUID(), "family-1", "child-1", "read anything", "system", null,
      "none", null, "not_applicable", "current_location_store", "free text",
      "worker_internal", "family_location_display", "2026-08-01 01:00:00",
      "2026-08-01 01:00:00", "2026-08-01 01:00:00",
    );
  }, /CHECK constraint failed/);
  const tableDefinition = migration.slice(
    migration.indexOf("CREATE TABLE"),
    migration.indexOf("CREATE INDEX"),
  );
  assert.doesNotMatch(tableDefinition, /\b(lat|lng|latitude|longitude|address|metadata|payload)\b/i);
  sqlite.close();
});

test("서버 helper는 고정 서비스 코드만 기록하고 좌표·자유문구 입력을 받지 않는다", async () => {
  const { sqlite, db } = createDb();
  await audit.recordLocationConfirmation(db, {
    familyId: "family-1",
    subjectUserId: "child-1",
    action: "provide",
    requesterKind: "parent",
    requesterUserId: "parent-1",
    recipientKind: "family_parent",
    recipientUserId: "parent-1",
    collectionMethod: "not_applicable",
    acquisitionPath: "current_location_store",
    serviceCode: "parent_live_map",
    deliveryMethod: "https_worker_api",
    purposeCode: "family_location_display",
    occurredAt: "2026-08-01 01:00:00",
    completedAt: "2026-08-01 01:00:00",
  });
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM location_confirmation_records").get().n,
    1,
  );
  await assert.rejects(
    audit.recordLocationConfirmation(db, {
      familyId: "family-1",
      subjectUserId: "child-1",
      action: "use",
      requesterKind: "system",
      requesterUserId: null,
      recipientKind: "none",
      recipientUserId: null,
      collectionMethod: "not_applicable",
      acquisitionPath: "current_location_store",
      serviceCode: "custom report text",
      deliveryMethod: "worker_internal",
      purposeCode: "family_location_display",
      occurredAt: "2026-08-01 01:00:00",
      completedAt: "2026-08-01 01:00:00",
    }),
    /invalid_location_confirmation_code/,
  );
  sqlite.close();
});

test("확인자료 일괄 기록은 D1 100개 바인딩 경계에서 6명과 7명을 모두 보존한다", async () => {
  const { sqlite, db } = createDb();
  const details = {
    action: "use",
    requesterKind: "system",
    requesterUserId: null,
    recipientKind: "none",
    recipientUserId: null,
    collectionMethod: "not_applicable",
    acquisitionPath: "current_location_store",
    serviceCode: "registered_place_monitor",
    deliveryMethod: "worker_internal",
    purposeCode: "arrival_departure_alert",
    occurredAt: "2026-08-01 01:00:00",
    completedAt: "2026-08-01 01:00:00",
  };
  const subjects = (count) => Array.from({ length: count }, (_, index) => ({
    familyId: "family-1",
    subjectUserId: `child-${index + 1}`,
  }));

  assert.equal(await audit.recordLocationConfirmationForSubjects(db, subjects(6), details), 6);
  assert.deepEqual(db.boundParameterCounts, [96]);

  sqlite.exec("DELETE FROM location_confirmation_records");
  db.boundParameterCounts.length = 0;
  assert.equal(await audit.recordLocationConfirmationForSubjects(db, subjects(7), details), 7);
  assert.deepEqual(db.boundParameterCounts, [96, 16]);
  assert.deepEqual(
    sqlite.prepare(
      "SELECT subject_user_id FROM location_confirmation_records ORDER BY subject_user_id",
    ).all().map((row) => row.subject_user_id),
    ["child-1", "child-2", "child-3", "child-4", "child-5", "child-6", "child-7"],
  );
  sqlite.close();
});

test("위치 기반 알림 제공은 활성 자녀와 실제 가족 부모별 push 확인자료를 먼저 기록한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families VALUES (?,?)").run("family-1", "parent-owner");
  for (const row of [
    ["member-parent", "family-1", "parent-member", "parent", 1],
    ["member-child", "family-1", "child-1", "child", 1],
    ["member-old", "family-1", "child-old", "child", 0],
  ]) {
    sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)").run(...row);
  }

  const recorded = await audit.recordLocationAlertProvisionToParents(db, {
    familyId: "family-1",
    childUserIds: ["child-1"],
    alertType: "danger_zone",
    occurredAt: "2026-08-01 01:00:00",
  });
  assert.equal(recorded, 2);
  assert.deepEqual(
    sqlite.prepare(
      `SELECT subject_user_id, action, requester_kind, recipient_kind,
              recipient_user_id, acquisition_path, service_code,
              delivery_method, purpose_code
         FROM location_confirmation_records ORDER BY recipient_user_id`,
    ).all().map((row) => ({ ...row })),
    [
      {
        subject_user_id: "child-1",
        action: "provide",
        requester_kind: "system",
        recipient_kind: "family_parent",
        recipient_user_id: "parent-member",
        acquisition_path: "current_location_store",
        service_code: "location_alert_delivery",
        delivery_method: "push_notification",
        purpose_code: "danger_zone_alert",
      },
      {
        subject_user_id: "child-1",
        action: "provide",
        requester_kind: "system",
        recipient_kind: "family_parent",
        recipient_user_id: "parent-owner",
        acquisition_path: "current_location_store",
        service_code: "location_alert_delivery",
        delivery_method: "push_notification",
        purpose_code: "danger_zone_alert",
      },
    ],
  );
  await assert.rejects(
    audit.recordLocationAlertProvisionToParents(db, {
      familyId: "family-1",
      childUserIds: ["child-old"],
      alertType: "danger_zone",
    }),
    /location_alert_audience_unavailable/,
  );
  sqlite.close();
});

test("위치 알림 제공 확인자료는 여러 statement 중 하나라도 실패하면 전부 rollback한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO families(id,parent_id) VALUES (?,?)")
    .run("family-atomic", "parent-1");
  sqlite.prepare(
    "INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES (?,?,?,?,1)",
  ).run("child-member", "family-atomic", "child-1", "child");
  for (let index = 2; index <= 7; index += 1) {
    sqlite.prepare(
      "INSERT INTO family_members(id,family_id,user_id,role,is_active) VALUES (?,?,?,?,1)",
    ).run(`parent-member-${index}`, "family-atomic", `parent-${index}`, "parent");
  }
  sqlite.exec(`
    CREATE TRIGGER fail_second_confirmation_statement
    BEFORE INSERT ON location_confirmation_records
    WHEN NEW.recipient_user_id = 'parent-7'
    BEGIN
      SELECT RAISE(ABORT, 'injected confirmation failure');
    END;
  `);

  await assert.rejects(
    audit.recordLocationAlertProvisionToParents(db, {
      familyId: "family-atomic",
      childUserIds: ["child-1"],
      alertType: "arrived",
    }),
    /injected confirmation failure/,
  );
  assert.equal(
    sqlite.prepare(
      "SELECT COUNT(*) AS n FROM location_confirmation_records WHERE family_id='family-atomic'",
    ).get().n,
    0,
  );
  sqlite.close();
});

test("보존 cron은 정확히 6개월보다 오래된 확인자료만 삭제한다", async () => {
  const { sqlite, db } = createDb();
  const insert = sqlite.prepare(
    `INSERT INTO location_confirmation_records
       (id,family_id,subject_user_id,action,requester_kind,requester_user_id,
        recipient_kind,recipient_user_id,collection_method,acquisition_path,
        service_code,delivery_method,purpose_code,occurred_at,completed_at,recorded_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const values = (id, recordedAt) => [
    id, "family-1", "child-1", "use", "system", null, "none", null,
    "not_applicable", "current_location_store", "location_staleness_monitor",
    "worker_internal", "location_staleness_alert", recordedAt, recordedAt, recordedAt,
  ];
  insert.run(...values("older", "2026-01-31 11:59:59"));
  insert.run(...values("boundary", "2026-01-31 12:00:00"));
  insert.run(...values("newer", "2026-02-01 00:00:00"));
  insert.run(
    "collect-older", "family-1", "child-1", "collect", "subject", "child-1",
    "none", null, "android_fused_location", "android_native_app", "current_location_ingest",
    "https_worker_api", "family_location_safety", "2026-01-01 00:00:00",
    "2026-01-01 00:00:00", "2026-01-01 00:00:00",
  );

  const result = await audit.cleanupLocationConfirmationRecords(
    db,
    new Date("2026-07-31T12:00:00.000Z"),
  );
  assert.deepEqual(result, { removedRows: 2 });
  assert.deepEqual(
    sqlite.prepare("SELECT id FROM location_confirmation_records ORDER BY id").all()
      .map((row) => row.id),
    ["boundary", "newer"],
  );
  sqlite.close();
});

test("보존 cron이 5,000행 상한을 채우면 식별자 없는 포화 경고를 남긴다", async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const db = {
      prepare: () => ({
        bind: () => ({
          run: async () => ({ meta: { changes: audit.LOCATION_CONFIRMATION_DELETE_BATCH } }),
        }),
      }),
    };
    assert.deepEqual(
      await audit.runLocationConfirmationRetention({ DB: db }),
      { removedRows: audit.LOCATION_CONFIRMATION_DELETE_BATCH },
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(warnings, [[{
    scope: "worker",
    event: "location_confirmation_retention_batch_saturated",
    count: audit.LOCATION_CONFIRMATION_DELETE_BATCH,
  }]]);
});

test("위치 확인자료 용량 모니터는 집계 전용 read-only SQL이다", () => {
  const { sqlite } = createDb();
  const executable = capacityMonitorSql.replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(
    executable,
    /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH)\b/i,
  );
  assert.match(capacityMonitorSql, /critical_85_hold/);
  assert.match(capacityMonitorSql, /workers_free[\s\S]+500000000/);
  assert.match(capacityMonitorSql, /workers_paid[\s\S]+10000000000/);
  assert.match(capacityMonitorSql, /steady_state_insert_delete_lower_bound/);
  assert.match(capacityMonitorSql, /15000 AS hourly_delete_capacity/);
  assert.doesNotMatch(capacityMonitorSql, /SELECT\s+(?:family_id|subject_user_id)\b/i);
  assert.doesNotThrow(() => sqlite.exec(capacityMonitorSql));
  sqlite.close();
});

test("현재 위치 중앙 write/read/use 경로는 확인자료 기록을 우회하지 않는다", () => {
  const sources = new Map([
    ["routes/location.ts", ["recordLocationConfirmationForSubjects", "parent_live_map", "parent_location_history"]],
    ["cron/registered-place-geofence-check.ts", ["recordLocationConfirmationForSubjects", "registered_place_monitor"]],
    ["cron/danger-zone-geofence-check.ts", ["recordLocationConfirmationForSubjects", "danger_zone_monitor"]],
    ["cron/location-staleness-check.ts", ["recordLocationConfirmationForSubjects", "location_staleness_monitor"]],
    ["cron/unregistered-stay-check.ts", ["recordLocationConfirmationForSubjects", "unregistered_stay_monitor"]],
    ["cron/friend-playdate-auto-end.ts", ["recordLocationConfirmationForSubjects", "playdate_auto_end"]],
    ["lib/arrivalDetect.ts", ["recordLocationConfirmation", "arbitrary_arrival_monitor"]],
    ["lib/legacyScheduleAlertEvidence.ts", ["recordLocationConfirmation", "schedule_arrival_monitor"]],
    ["routes/playdate.ts", ["recordLocationConfirmation", "playdate_matching"]],
    ["routes/push-notify.ts", ["recordLocationConfirmationForSubjects", "schedule_not_arrived_monitor"]],
    ["cron/_deliver.ts", ["recordLocationAlertProvisionToParents"]],
    ["routes/parent-alerts.ts", ["recordLocationAlertProvisionToParents"]],
    ["routes/rest-shim-rpc.ts", ["recordLocationAlertProvisionToParents"]],
  ]);
  for (const [relativePath, required] of sources) {
    const source = readFileSync(resolve(workerDir, relativePath), "utf8");
    for (const token of required) assert.match(source, new RegExp(token), relativePath);
  }
  const rpc = readFileSync(resolve(workerDir, "routes/rest-shim-rpc.ts"), "utf8");
  const table = readFileSync(resolve(workerDir, "routes/rest-shim-table.ts"), "utf8");
  assert.match(rpc, /CURRENT_LOCATION_UPSERT_SQL/);
  assert.match(rpc, /INSERT INTO location_history/);
  assert.match(table, /CURRENT_LOCATION_UPSERT_SQL/);
  assert.match(migration, /AFTER INSERT ON child_locations/);
  assert.match(migration, /AFTER UPDATE OF lat, lng, updated_at ON child_locations/);
  assert.match(migration, /AFTER INSERT ON location_history/);
  const index = readFileSync(resolve(workerDir, "index.ts"), "utf8");
  assert.match(index, /location-confirmation-retention/);
  assert.match(index, /runLocationConfirmationRetention/);
});

test("정기 위치 판정은 실제 조회 결과가 확인된 뒤 사용 사실을 기록한다", () => {
  const registered = readFileSync(resolve(workerDir, "cron/registered-place-geofence-check.ts"), "utf8");
  const registeredHistoryLoad = registered.indexOf("const recentFixes = await loadRecentFixes");
  const registeredHistoryAudit = registered.indexOf("acquisitionPath: \"location_history_store\"");
  const registeredCurrentLoad = registered.indexOf("const fixMap = await loadLatestFix");
  const registeredCurrentAudit = registered.indexOf("acquisitionPath: \"current_location_store\"");
  assert.ok(registeredHistoryLoad >= 0 && registeredHistoryLoad < registeredHistoryAudit);
  assert.ok(registeredHistoryAudit < registeredCurrentLoad);
  assert.ok(registeredCurrentLoad < registeredCurrentAudit);
  assert.match(registered, /const membersWithPlaces = members\.filter[\s\S]+placesByFamily\.get/);
  assert.match(registered, /const fallbackMembers = membersWithPlaces\.filter[\s\S]+recentFixes\.get/);
  assert.match(
    registered,
    /const currentMembers = fallbackMembers\.filter[\s\S]+selectRegisteredPlaceEvaluationFixes\(\[\], fix, nowMs\)\.length > 0/,
  );

  for (const [relativePath, loadToken, subjectToken] of [
    ["cron/danger-zone-geofence-check.ts", "const fixMap = await loadLatestFix", "children.map((child)"],
    ["cron/location-staleness-check.ts", "SELECT user_id, family_id, lat, lng, updated_at FROM child_locations", "children.map((child)"],
    ["cron/unregistered-stay-check.ts", "const [history, excludeByFamily, presence]", "historyChildren.map((child)"],
  ]) {
    const source = readFileSync(resolve(workerDir, relativePath), "utf8");
    const loadIndex = source.indexOf(loadToken);
    const auditIndex = source.indexOf("await recordLocationConfirmationForSubjects", loadIndex);
    assert.ok(loadIndex >= 0, `${relativePath}: 실제 위치 조회 누락`);
    assert.ok(auditIndex > loadIndex, `${relativePath}: 실제 결과 확인 전 사용 기록`);
    assert.match(
      source.slice(auditIndex, auditIndex + 500),
      new RegExp(subjectToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${relativePath}: 실제 결과 대상 계산 누락`,
    );
  }
});

test("대규모 위치 판정 대상은 D1 100개 바인딩 전에 90개씩 분할한다", () => {
  for (const [relativePath, minimumChunkCalls] of [
    ["cron/location-staleness-check.ts", 6],
    ["cron/unregistered-stay-check.ts", 5],
  ]) {
    const source = readFileSync(resolve(workerDir, relativePath), "utf8");
    assert.match(source, /const LOCATION_CRON_QUERY_CHUNK = 90/);
    assert.ok(
      (source.match(/chunkSqlVariables\(/g) ?? []).length >= minimumChunkCalls,
      `${relativePath}: 분할 조회 누락`,
    );
    assert.doesNotMatch(
      source,
      /const ph\w* = (?:familyIds|childUserIds|premiumIds|enabledIds|premiumFamilyIdArr)\.map/,
    );
    assert.doesNotMatch(
      source,
      /\.bind\(\.\.\.(?:familyIds|childUserIds|premiumIds|enabledIds|premiumFamilyIdArr)/,
    );
  }
});

test("부모 위치 알림 제공 확인자료는 실제 parent_alert 저장이 성공한 뒤에만 기록한다", () => {
  for (const relativePath of [
    "cron/_deliver.ts",
    "lib/arrivalDetect.ts",
    "routes/parent-alerts.ts",
    "routes/push-notify.ts",
    "routes/rest-shim-rpc.ts",
  ]) {
    const source = readFileSync(resolve(workerDir, relativePath), "utf8");
    const auditIndex = source.indexOf("await recordLocationAlertProvisionToParents");
    assert.notEqual(auditIndex, -1, `${relativePath}: 제공 확인자료 호출 누락`);
    const alertIndex = source.lastIndexOf("await insertParentAlertV2", auditIndex);
    assert.notEqual(alertIndex, -1, `${relativePath}: parent_alert 저장 호출 누락`);
    assert.ok(alertIndex < auditIndex, `${relativePath}: 저장 전에 제공 완료를 기록하면 안 됨`);
  }
});

test("계정 삭제·페어링 해제는 법정 확인자료를 일반 위치 원본과 함께 지우지 않는다", () => {
  const deletionSource = readFileSync(resolve(workerDir, "lib/accountDeletion.ts"), "utf8");
  const unpairSource = readFileSync(resolve(workerDir, "lib/unpairCleanup.ts"), "utf8");
  assert.doesNotMatch(deletionSource, /DELETE\s+FROM\s+location_confirmation_records/i);
  assert.doesNotMatch(unpairSource, /DELETE\s+FROM\s+location_confirmation_records/i);
  assert.doesNotMatch(migration, /REFERENCES\s+(?:families|users|family_members)/i);
});

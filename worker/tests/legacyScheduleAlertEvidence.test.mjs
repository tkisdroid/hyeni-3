import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";

const typeScriptResolutionHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".js"]) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

const locationConfirmationMigration = readFileSync(
  new URL("../db/location-confirmation-records.sql", import.meta.url),
  "utf8",
);

let evidence = {};
try {
  evidence = await import("../lib/legacyScheduleAlertEvidence.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

class Statement {
  constructor(db, sql, bindings = []) { this.db = db; this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new Statement(this.db, this.sql, bindings); }
  async first() { return this.db.prepare(this.sql).get(...this.bindings) ?? null; }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes ?? 0) } };
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(id TEXT PRIMARY KEY, time_zone TEXT DEFAULT 'Asia/Seoul');
    INSERT INTO families(id) VALUES ('family-a');
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT,
      role TEXT NOT NULL, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE events(
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL, date_key TEXT NOT NULL,
      title TEXT NOT NULL, time TEXT NOT NULL, location TEXT,
      updated_at TEXT, is_family_event INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE events_children(event_id TEXT NOT NULL, child_id TEXT NOT NULL);
    CREATE TABLE child_locations(
      family_id TEXT NOT NULL, user_id TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
      accuracy_m REAL, updated_at TEXT NOT NULL
    );
    CREATE TABLE parent_alerts(
      family_id TEXT NOT NULL, event_id TEXT, alert_type TEXT NOT NULL
    );
    CREATE TABLE location_history(
      id INTEGER PRIMARY KEY, family_id TEXT NOT NULL, user_id TEXT NOT NULL,
      lat REAL NOT NULL, lng REAL NOT NULL, recorded_at TEXT NOT NULL
    );
  `);
  sqlite.exec(locationConfirmationMigration);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?)")
    .run("member-child", "family-a", "child-a", "child", "혜니", 1);
  sqlite.prepare("INSERT INTO events VALUES (?,?,?,?,?,?,?,?)")
    .run(
      "event-a", "family-a", "2026-6-14", "태권도", "15:00",
      JSON.stringify({ lat: 37.5000, lng: 127.0000 }),
      "2026-07-14 05:00:00+00", 0,
    );
  sqlite.prepare("INSERT INTO events_children VALUES (?,?)").run("event-a", "member-child");
  sqlite.prepare("INSERT INTO child_locations VALUES (?,?,?,?,?,?)")
    .run("family-a", "child-a", 37.5001, 127.0001, 20, "2026-07-14 06:04:00+00");
  return { sqlite, db: { prepare: (sql) => new Statement(sqlite, sql) } };
}

test.after(() => typeScriptResolutionHook.deregister());

function resolver() {
  assert.equal(
    typeof evidence.resolveLegacyChildScheduleAlertEvidence,
    "function",
    "구 Android 일정 알림을 서버 증거로 재검증하는 helper가 필요합니다",
  );
  return evidence.resolveLegacyChildScheduleAlertEvidence;
}

test("아이의 arrived 요청은 활성 일정·시간창·신선한 위치가 모두 맞을 때 서버 문구로 재구성된다", async () => {
  const { db } = createDb();
  const result = await resolver()(db, {
    callerUserId: "child-a",
    familyId: "family-a",
    requestedChildUserId: "child-a",
    requestedAlertType: "arrived",
    sourceEventId: "event-a",
    eventId: "client-occurrence-is-not-trusted",
    nowMs: Date.UTC(2026, 6, 14, 6, 5),
  });

  assert.equal(result?.status, "verified");
  assert.equal(result?.alertType, "arrived");
  assert.equal(result?.title, "✅ 태권도 도착");
  assert.equal(result?.message, "혜니님이 태권도 장소에 도착했어요.");
  assert.equal(result?.sourceEventId, "event-a");
  assert.notEqual(result?.eventId, "client-occurrence-is-not-trusted");
  assert.deepEqual(result?.writeScope, { callerRole: "child", childUserId: "child-a" });
});

test("stale·부정확·원거리 위치 또는 타인 일정은 arrived 저장 근거가 되지 않는다", async () => {
  const cases = [
    { sql: "UPDATE child_locations SET updated_at='2026-07-14 05:40:00+00'", label: "stale" },
    { sql: "UPDATE child_locations SET accuracy_m=151", label: "inaccurate" },
    { sql: "UPDATE child_locations SET lat=37.7, lng=127.2", label: "far" },
    { sql: "DELETE FROM events_children", label: "unassigned" },
  ];
  for (const item of cases) {
    const { sqlite, db } = createDb();
    sqlite.exec(item.sql);
    const result = await resolver()(db, {
      callerUserId: "child-a",
      familyId: "family-a",
      requestedChildUserId: "child-a",
      requestedAlertType: "arrived",
      sourceEventId: "event-a",
      eventId: "ignored",
      nowMs: Date.UTC(2026, 6, 14, 6, 5),
    });
    assert.deepEqual(result, { status: "deferred" }, item.label);
  }
});

test("not_arrived는 구 Android 재시도를 멈추되 사용자 본문으로 저장하지 않고 서버 cron에 맡긴다", async () => {
  const { db } = createDb();
  const result = await resolver()(db, {
    callerUserId: "child-a",
    familyId: "family-a",
    requestedChildUserId: "child-a",
    requestedAlertType: "not_arrived",
    sourceEventId: "event-a",
    eventId: "ignored",
    nowMs: Date.UTC(2026, 6, 14, 6, 5),
  });
  assert.deepEqual(result, { status: "deferred" });
});

test("부모·비활성 아이·형제 child id는 legacy 호환 응답 대상도 아니다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?,?)")
    .run("member-parent", "family-a", "parent-a", "parent", "부모", 1);
  for (const input of [
    { callerUserId: "parent-a", requestedChildUserId: "child-a" },
    { callerUserId: "child-a", requestedChildUserId: "child-b" },
  ]) {
    const result = await resolver()(db, {
      ...input,
      familyId: "family-a",
      requestedAlertType: "not_arrived",
      sourceEventId: "event-a",
      eventId: "ignored",
      nowMs: Date.UTC(2026, 6, 14, 6, 5),
    });
    assert.equal(result, null);
  }
});

test("parent-alert route는 legacy 일정 증거의 정본 필드만 저장하고 deferred는 202로 재시도를 멈춘다", () => {
  const source = readFileSync(new URL("../routes/parent-alerts.ts", import.meta.url), "utf8");
  assert.match(source, /resolveLegacyChildScheduleAlertEvidence\(c\.env\.DB/);
  assert.match(source, /server_derived: true \}, 202/);
  assert.match(source, /legacyScheduleEvidence\.alertType/);
  assert.match(source, /legacyScheduleEvidence\.title/);
  assert.match(source, /legacyScheduleEvidence\.message/);
  assert.match(source, /legacyScheduleEvidence\.eventId/);
});

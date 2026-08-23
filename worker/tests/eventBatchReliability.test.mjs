import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

let eventBatch = {};
try {
  eventBatch = await import("../lib/eventBatch.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

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
    return { meta: { changes: Number(result.changes) } };
  }
}

class D1DatabaseAdapter {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new D1StatementAdapter(this.db, sql);
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
    CREATE TABLE families(
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      user_tier TEXT DEFAULT 'free',
      subscription_tier TEXT DEFAULT 'free'
    );
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE family_subscription(family_id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE subscriptions(family_id TEXT, status TEXT);
    CREATE TABLE family_review_rewards(family_id TEXT PRIMARY KEY, granted_at TEXT);
    CREATE TABLE events(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      date_key TEXT NOT NULL,
      title TEXT NOT NULL,
      time TEXT NOT NULL,
      category TEXT NOT NULL,
      emoji TEXT NOT NULL,
      color TEXT NOT NULL,
      bg TEXT NOT NULL,
      memo TEXT DEFAULT '',
      location TEXT,
      notif_override TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      end_time TEXT,
      is_family_event INTEGER NOT NULL DEFAULT 0,
      series_id TEXT
    );
    CREATE TABLE events_children(
      event_id TEXT NOT NULL,
      child_id TEXT NOT NULL,
      PRIMARY KEY(event_id, child_id)
    );
    CREATE TABLE pending_notifications(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      data TEXT,
      delivered INTEGER DEFAULT 0,
      expires_at TEXT
    );
    CREATE TABLE push_sent(
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      notif_key TEXT NOT NULL,
      sent_at TEXT
    );
  `);
  sqlite.prepare("INSERT INTO families VALUES (?,?,?,?)").run("family-a", "parent-a", "free", "free");
  sqlite.prepare("INSERT INTO families VALUES (?,?,?,?)").run("family-b", "parent-b", "free", "free");
  sqlite.prepare("INSERT INTO family_subscription VALUES (?,?)").run("family-a", "active");
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)").run("child-a", "family-a", "user-a", "child", 1);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)").run("child-a-old", "family-a", "user-a-old", "child", 0);
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)").run("child-b", "family-b", "user-b", "child", 1);
  return { sqlite, db: new D1DatabaseAdapter(sqlite) };
}

function eventRow(id, familyId, title = id) {
  return {
    id,
    family_id: familyId,
    date_key: "2026-6-13",
    title,
    time: "10:30",
    category: "academy",
    emoji: "calendar",
    color: "rose",
    bg: "soft",
    memo: "",
    location: { address: "테스트", lat: 37.5, lng: 127.0 },
    notif_override: { minutesBefore: [15, 5] },
    series_id: "series-1",
  };
}

function saveInput(id, familyId, childIds = ["child-a"], expectedUpdatedAt = undefined) {
  return {
    event: eventRow(id, familyId),
    childIds,
    familyAll: childIds.length === 0,
    ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
  };
}

function insertEvent(sqlite, row, updatedAt = "2026-07-13 00:00:00.000+00") {
  sqlite.prepare(`
    INSERT INTO events(
      id,family_id,date_key,title,time,category,emoji,color,bg,memo,location,notif_override,
      created_by,created_at,updated_at,end_time,is_family_event,series_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    row.id, row.family_id, row.date_key, row.title, row.time, row.category, row.emoji,
    row.color, row.bg, row.memo, JSON.stringify(row.location), JSON.stringify(row.notif_override),
    "parent-a", updatedAt, updatedAt, null, 0, row.series_id ?? null,
  );
}

function requireEventBatchApi() {
  assert.equal(typeof eventBatch.validateEventBatch, "function", "validateEventBatch가 구현되어야 합니다");
  assert.equal(typeof eventBatch.buildEventBatchStatements, "function", "원자 batch statement 빌더가 구현되어야 합니다");
  assert.equal(typeof eventBatch.buildEventDeleteStatements, "function", "원자 일정 삭제 statement 빌더가 구현되어야 합니다");
  assert.equal(typeof eventBatch.normalizeEventTimeForResponse, "function", "종일 일정 time 응답 정규화가 구현되어야 합니다");
  return {
    validateEventBatch: eventBatch.validateEventBatch,
    buildEventBatchStatements: eventBatch.buildEventBatchStatements,
    buildEventDeleteStatements: eventBatch.buildEventDeleteStatements,
    normalizeEventTimeForResponse: eventBatch.normalizeEventTimeForResponse,
  };
}

const validationDeps = {
  assertFamilyParent: async (db, userId, familyId) => {
    const row = await db.prepare(`
      SELECT 1 AS ok FROM families f
       WHERE f.id=?1
         AND (
           f.parent_id=?2
           OR EXISTS (
             SELECT 1 FROM family_members fm
              WHERE fm.family_id=f.id AND fm.user_id=?2
                AND fm.role='parent' AND fm.is_active=1
           )
         )
       LIMIT 1
    `)
      .bind(familyId, userId)
      .first();
    return !!row;
  },
  serviceLimitForFamily: async (db, familyId) => {
    const premium = await db.prepare("SELECT 1 AS ok FROM family_subscription WHERE family_id=? AND status IN ('trial','active','grace') LIMIT 1")
      .bind(familyId)
      .first();
    return premium ? null : 1;
  },
};

test("활성 공동 보호자는 가족 일정을 등록할 수 있다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("INSERT INTO family_members VALUES (?,?,?,?,?)")
    .run("parent-coparent", "family-a", "coparent-a", "parent", 1);
  const { validateEventBatch, buildEventBatchStatements } = requireEventBatchApi();

  const validated = await validateEventBatch(db, "coparent-a", [saveInput("coparent-event", "family-a")], {
    assertFamilyParent: async (targetDb, userId, familyId) => {
      const row = await targetDb.prepare(`
        SELECT 1 AS ok
          FROM families f
         WHERE f.id=?1
           AND (
             f.parent_id=?2
             OR EXISTS (
               SELECT 1 FROM family_members fm
                WHERE fm.family_id=f.id AND fm.user_id=?2
                  AND fm.role='parent' AND fm.is_active=1
             )
           )
         LIMIT 1
      `).bind(familyId, userId).first();
      return !!row;
    },
    serviceLimitForFamily: async () => null,
  });

  assert.equal(validated.familyId, "family-a");
  assert.equal(validated.newCount, 1);
  await db.batch(buildEventBatchStatements(
    db,
    "coparent-a",
    validated,
    "2026-08-23 04:00:00.000+00",
  ));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE id='coparent-event'").get().n, 1);
  sqlite.close();
});

test("다른 가족이 이미 소유한 event id는 같은 id upsert로 탈취할 수 없다", async () => {
  const { sqlite, db } = createDb();
  insertEvent(sqlite, eventRow("shared-id", "family-b"));
  const { validateEventBatch } = requireEventBatchApi();

  await assert.rejects(
    validateEventBatch(db, "parent-a", [saveInput("shared-id", "family-a")], validationDeps),
    (error) => error?.status === 409 && error?.code === "event_id_conflict",
  );
  sqlite.close();
});

test("DB의 종일 일정 빈 time은 API 응답에서 null로 복원한다", () => {
  const { normalizeEventTimeForResponse } = requireEventBatchApi();
  assert.equal(normalizeEventTimeForResponse(""), null);
  assert.equal(normalizeEventTimeForResponse("08:30"), "08:30");
  assert.equal(normalizeEventTimeForResponse(null), null);
});

test("expectedUpdatedAt가 있는 편집 대상 행이 삭제되었으면 409로 중단한다", async () => {
  const { sqlite, db } = createDb();
  const { validateEventBatch } = requireEventBatchApi();

  await assert.rejects(
    validateEventBatch(db, "parent-a", [
      saveInput("deleted-id", "family-a", ["child-a"], "2026-07-13 00:00:00.000+00"),
    ], validationDeps),
    (error) => error?.status === 409 && error?.code === "concurrent_modification",
  );
  sqlite.close();
});

test("자녀 배정은 같은 가족의 활성 child member만 허용한다", async () => {
  for (const invalidChildId of ["child-a-old", "child-b", "missing-child"]) {
    const { sqlite, db } = createDb();
    const { validateEventBatch } = requireEventBatchApi();
    await assert.rejects(
      validateEventBatch(db, "parent-a", [saveInput(`event-${invalidChildId}`, "family-a", [invalidChildId])], validationDeps),
      (error) => error?.status === 400 && error?.code === "invalid_child_assignment",
    );
    sqlite.close();
  }
});

test("플랜 한도는 batch의 신규 일정 전체를 저장 전에 합산한다", async () => {
  const { sqlite, db } = createDb();
  sqlite.prepare("DELETE FROM family_subscription WHERE family_id=?").run("family-a");
  insertEvent(sqlite, eventRow("existing", "family-a"));
  const { validateEventBatch } = requireEventBatchApi();

  await assert.rejects(
    validateEventBatch(db, "parent-a", [
      saveInput("new-1", "family-a"),
      saveInput("new-2", "family-a"),
    ], validationDeps),
    (error) => error?.status === 403 && error?.code === "schedule_limit_reached" && error?.count === 3,
  );
  sqlite.close();
});

test("서버 batch 크기는 앱의 요일 반복 최대 56개로 제한한다", async () => {
  const { sqlite, db } = createDb();
  const { validateEventBatch } = requireEventBatchApi();
  const inputs = Array.from({ length: 57 }, (_, index) => saveInput(`too-many-${index}`, "family-a"));

  await assert.rejects(
    validateEventBatch(db, "parent-a", inputs, validationDeps),
    (error) => error?.status === 400 && error?.code === "event_batch_too_large",
  );
  sqlite.close();
});

test("서버는 화면에서 사라지거나 알림이 멈추는 잘못된 일정 필드를 저장 전에 거부한다", async () => {
  const invalidCases = [
    ["invalid_date_key", { date_key: "" }],
    ["invalid_date_key", { date_key: "2026-1-30" }],
    ["invalid_event_title", { title: "   " }],
    ["invalid_event_time", { time: "99:99" }],
    ["invalid_event_time", { end_time: "8:30" }],
    ["invalid_event_location", { location: { lat: "37.5", lng: 127 } }],
    ["invalid_event_location", { location: { lat: 37.5 } }],
    ["invalid_event_location", { location: {} }],
    ["invalid_notif_override", { notif_override: { minutesBefore: [15, 0] } }],
    ["invalid_notif_override", { notif_override: { minutesBefore: "15" } }],
  ];

  for (const [expectedCode, patch] of invalidCases) {
    const { sqlite, db } = createDb();
    const { validateEventBatch } = requireEventBatchApi();
    const input = saveInput(`invalid-${expectedCode}-${JSON.stringify(patch)}`, "family-a");
    Object.assign(input.event, patch);
    await assert.rejects(
      validateEventBatch(db, "parent-a", [input], validationDeps),
      (error) => error?.status === 400 && error?.code === expectedCode,
    );
    sqlite.close();
  }
});

test("유효한 종일·주소 전용 장소·명시적 알림 없음은 정규화해 보존한다", async () => {
  const { sqlite, db } = createDb();
  const { validateEventBatch } = requireEventBatchApi();
  const input = saveInput("normalized-event", "family-a");
  Object.assign(input.event, {
    date_key: " 2026-6-13 ",
    title: "  피아노  ",
    time: null,
    end_time: "",
    location: { address: "  신사동 학원  " },
    notif_override: { minutesBefore: [] },
  });

  const validated = await validateEventBatch(db, "parent-a", [input], validationDeps);
  assert.deepEqual(validated.inputs[0].event, {
    ...input.event,
    id: "normalized-event",
    family_id: "family-a",
    date_key: "2026-6-13",
    title: "피아노",
    time: null,
    end_time: null,
    location: { address: "신사동 학원" },
    notif_override: { minutesBefore: [] },
  });
  sqlite.close();
});

test("event와 자녀 링크 및 과거 pending/push claim을 한 D1 batch로 함께 갱신한다", async () => {
  const { sqlite, db } = createDb();
  const oldUpdatedAt = "2026-07-13 00:00:00.000+00";
  insertEvent(sqlite, eventRow("edit-1", "family-a", "수정 전"), oldUpdatedAt);
  sqlite.prepare("INSERT INTO events_children VALUES (?,?)").run("edit-1", "child-a");
  sqlite.prepare("INSERT INTO pending_notifications(id,family_id,title,body,data) VALUES (?,?,?,?,?)")
    .run("pending-1", "family-a", "old", "old", JSON.stringify({ eventId: "edit-1" }));
  sqlite.prepare("INSERT INTO push_sent VALUES (?,?,?,?)")
    .run("push-1", "edit-1", "15min", oldUpdatedAt);
  const { validateEventBatch, buildEventBatchStatements } = requireEventBatchApi();
  const input = saveInput("edit-1", "family-a", [], oldUpdatedAt);
  input.event.title = "수정 후";
  input.event.series_id = "series-safe";

  const validated = await validateEventBatch(db, "parent-a", [input], validationDeps);
  const statements = buildEventBatchStatements(db, "parent-a", validated, "2026-07-13 00:01:00.000+00");
  await db.batch(statements);

  assert.deepEqual({ ...sqlite.prepare("SELECT title,series_id,is_family_event FROM events WHERE id=?").get("edit-1") }, {
    title: "수정 후",
    series_id: "series-safe",
    is_family_event: 1,
  });
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM events_children WHERE event_id=?").get("edit-1").n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM pending_notifications").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM push_sent").get().n, 0);
  sqlite.close();
});

test("updated_at이 NULL인 레거시 일정도 원자 guard에서 편집할 수 있다", async () => {
  const { sqlite, db } = createDb();
  insertEvent(sqlite, eventRow("legacy-null", "family-a", "수정 전"));
  sqlite.prepare("UPDATE events SET updated_at=NULL WHERE id=?").run("legacy-null");
  const { validateEventBatch, buildEventBatchStatements } = requireEventBatchApi();
  const input = saveInput("legacy-null", "family-a");
  input.event.title = "수정 후";

  const validated = await validateEventBatch(db, "parent-a", [input], validationDeps);
  await db.batch(buildEventBatchStatements(db, "parent-a", validated, "2026-07-13 00:01:00.000+00"));

  assert.equal(sqlite.prepare("SELECT title FROM events WHERE id=?").get("legacy-null").title, "수정 후");
  sqlite.close();
});

test("요일 반복 최대치도 D1 invocation query 상한 안에서 한 batch로 묶는다", () => {
  const { sqlite, db } = createDb();
  const { buildEventBatchStatements } = requireEventBatchApi();
  const inputs = Array.from({ length: 56 }, (_, index) => ({
    event: eventRow(`weekday-${index}`, "family-a"),
    id: `weekday-${index}`,
    familyId: "family-a",
    childIds: ["child-a"],
    familyAll: false,
    expectedUpdatedAt: null,
    existing: null,
  }));
  const statements = buildEventBatchStatements(db, "parent-a", {
    familyId: "family-a",
    inputs,
    currentCount: 0,
    newCount: inputs.length,
    limit: null,
  }, "2026-07-13 00:01:00.000+00");

  assert.ok(statements.length <= 50, `D1 batch statement가 ${statements.length}개입니다`);
  sqlite.close();
});

test("검증 뒤 다른 편집이 끼어들면 batch 전체가 rollback되어 앞 일정도 부분 저장되지 않는다", async () => {
  const { sqlite, db } = createDb();
  const oldUpdatedAt = "2026-07-13 00:00:00.000+00";
  insertEvent(sqlite, eventRow("edit-a", "family-a", "A 전"), oldUpdatedAt);
  insertEvent(sqlite, eventRow("edit-b", "family-a", "B 전"), oldUpdatedAt);
  const { validateEventBatch, buildEventBatchStatements } = requireEventBatchApi();
  const inputA = saveInput("edit-a", "family-a", ["child-a"], oldUpdatedAt);
  const inputB = saveInput("edit-b", "family-a", ["child-a"], oldUpdatedAt);
  inputA.event.title = "A 후";
  inputB.event.title = "B 후";
  const validated = await validateEventBatch(db, "parent-a", [inputA, inputB], validationDeps);

  sqlite.prepare("UPDATE events SET updated_at=? WHERE id=?")
    .run("2026-07-13 00:00:30.000+00", "edit-b");
  const statements = buildEventBatchStatements(db, "parent-a", validated, "2026-07-13 00:01:00.000+00");
  await assert.rejects(db.batch(statements), /malformed JSON/);

  assert.equal(sqlite.prepare("SELECT title FROM events WHERE id=?").get("edit-a").title, "A 전");
  assert.equal(sqlite.prepare("SELECT title FROM events WHERE id=?").get("edit-b").title, "B 전");
  sqlite.close();
});

test("일정 삭제는 event·링크·pending·push claim을 한 batch에서 함께 지운다", async () => {
  const { sqlite, db } = createDb();
  const updatedAt = "2026-07-13 00:00:00.000+00";
  insertEvent(sqlite, eventRow("delete-1", "family-a"), updatedAt);
  sqlite.prepare("INSERT INTO events_children VALUES (?,?)").run("delete-1", "child-a");
  sqlite.prepare("INSERT INTO pending_notifications(id,family_id,title,body,data) VALUES (?,?,?,?,?)")
    .run("pending-delete", "family-a", "old", "old", JSON.stringify({ eventId: "delete-1" }));
  sqlite.prepare("INSERT INTO push_sent VALUES (?,?,?,?)")
    .run("push-delete", "delete-1", "15min", updatedAt);
  const { buildEventDeleteStatements } = requireEventBatchApi();

  await db.batch(buildEventDeleteStatements(db, {
    id: "delete-1",
    familyId: "family-a",
    expectedUpdatedAt: updatedAt,
  }));

  for (const table of ["events", "events_children", "pending_notifications", "push_sent"]) {
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, `${table}가 남았습니다`);
  }
  sqlite.close();
});

test("삭제 검증 뒤 일정이 편집되면 알림 claim까지 포함해 삭제 전체를 rollback한다", async () => {
  const { sqlite, db } = createDb();
  const updatedAt = "2026-07-13 00:00:00.000+00";
  insertEvent(sqlite, eventRow("delete-race", "family-a"), updatedAt);
  sqlite.prepare("INSERT INTO pending_notifications(id,family_id,title,body,data) VALUES (?,?,?,?,?)")
    .run("pending-race", "family-a", "old", "old", JSON.stringify({ eventId: "delete-race" }));
  const { buildEventDeleteStatements } = requireEventBatchApi();
  const statements = buildEventDeleteStatements(db, {
    id: "delete-race",
    familyId: "family-a",
    expectedUpdatedAt: updatedAt,
  });
  sqlite.prepare("UPDATE events SET updated_at=? WHERE id=?")
    .run("2026-07-13 00:00:30.000+00", "delete-race");

  await assert.rejects(db.batch(statements), /malformed JSON/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM pending_notifications").get().n, 1);
  sqlite.close();
});

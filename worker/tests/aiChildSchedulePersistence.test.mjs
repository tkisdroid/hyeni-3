import "./helpers/tsModuleResolve.mjs";

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

let persistenceModule = {};
try {
  persistenceModule = await import("../lib/aiChildSchedulePersistence.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

class Statement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.sqlite, this.sql, bindings);
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class Db {
  constructor(sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql) {
    return new Statement(this.sqlite, sql);
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
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
  sqlite.exec(`
    CREATE TABLE events (
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
      end_time TEXT,
      is_family_event INTEGER DEFAULT 0 NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE events_children (
      event_id TEXT NOT NULL,
      child_id TEXT NOT NULL,
      PRIMARY KEY (event_id, child_id)
    );
  `);
  return { sqlite, db: new Db(sqlite) };
}

function eventRow() {
  return {
    id: "event-ai-1",
    family_id: "family-1",
    date_key: "2026-7-24",
    title: "피아노",
    time: "15:00",
    category: "other",
    emoji: "📌",
    color: "#EC4899",
    bg: "#FCE7F3",
    memo: "AI 친구가 추가한 일정",
    location: null,
    notif_override: null,
    end_time: null,
    is_family_event: false,
    created_by: "child-user-1",
  };
}

test("AI 일정은 이벤트와 아이 연결을 원자 저장하고 실시간 행을 발행한다", async () => {
  const persist = persistenceModule.persistAiChildSchedule;
  assert.equal(typeof persist, "function", "AI 일정 저장 경계가 구현되어야 합니다");

  const { sqlite, db } = fixture();
  const notifications = [];
  const saved = await persist(
    db,
    {
      eventRow: eventRow(),
      childMemberId: "child-member-1",
      timestamp: "2026-08-24 12:00:00",
    },
    async (row) => notifications.push(row),
  );

  assert.deepEqual({ ...sqlite.prepare("SELECT id, title, time, date_key FROM events").get() }, {
    id: "event-ai-1",
    title: "피아노",
    time: "15:00",
    date_key: "2026-7-24",
  });
  assert.deepEqual({ ...sqlite.prepare("SELECT event_id, child_id FROM events_children").get() }, {
    event_id: "event-ai-1",
    child_id: "child-member-1",
  });
  assert.deepEqual(saved.events_children, [{ child_id: "child-member-1" }]);
  assert.equal(saved.created_at, "2026-08-24 12:00:00");
  assert.deepEqual(notifications, [saved]);
});

test("아이 연결 저장이 실패하면 이벤트도 남기지 않고 실시간 알림도 보내지 않는다", async () => {
  const persist = persistenceModule.persistAiChildSchedule;
  assert.equal(typeof persist, "function", "AI 일정 저장 경계가 구현되어야 합니다");

  const { sqlite, db } = fixture();
  sqlite.prepare("INSERT INTO events_children(event_id,child_id) VALUES (?,?)")
    .run("event-ai-1", "child-member-1");
  const notifications = [];

  await assert.rejects(
    persist(
      db,
      {
        eventRow: eventRow(),
        childMemberId: "child-member-1",
        timestamp: "2026-08-24 12:00:00",
      },
      async (row) => notifications.push(row),
    ),
    (error) => error?.code === "schedule_create_failed",
  );

  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count, 0);
  assert.deepEqual(notifications, []);
});

test("실시간 발행이 실패해도 이미 저장된 AI 일정을 실패로 되돌리지 않는다", async (t) => {
  const persist = persistenceModule.persistAiChildSchedule;
  assert.equal(typeof persist, "function", "AI 일정 저장 경계가 구현되어야 합니다");
  t.mock.method(console, "error", () => {});

  const { sqlite, db } = fixture();
  const saved = await persist(
    db,
    {
      eventRow: eventRow(),
      childMemberId: "child-member-1",
      timestamp: "2026-08-24 12:00:00",
    },
    async () => {
      throw new Error("realtime unavailable");
    },
  );

  assert.equal(saved.id, "event-ai-1");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events").get().count, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM events_children").get().count, 1);
});

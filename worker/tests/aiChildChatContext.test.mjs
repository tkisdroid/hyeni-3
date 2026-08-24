import "./helpers/tsModuleResolve.mjs";

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

let contextModule = {};
try {
  contextModule = await import("../lib/aiChildChatContext.ts");
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

  async all() {
    return { results: this.sqlite.prepare(this.sql).all(...this.bindings) };
  }
}

test("같은 시각에 저장된 user/assistant 대화도 실제 입력 순서로 복원한다", async () => {
  const loadContext = contextModule.loadAiChildChatContextWindow;
  assert.equal(typeof loadContext, "function", "대화 순서를 보장하는 조회 경계가 필요합니다");

  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE ai_chat_messages (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const insert = sqlite.prepare("INSERT INTO ai_chat_messages VALUES (?,?,?,?,?,?)");
  const timestamp = "2026-08-24 12:00:00.000+00";
  insert.run("m1", "family-1", "child-1", "user", "일정 추가", timestamp);
  insert.run("m2", "family-1", "child-1", "assistant", "몇 시에 추가할까?", timestamp);
  insert.run("m3", "family-1", "child-1", "user", "내일 오후 3시", timestamp);
  insert.run("m4", "family-1", "child-1", "assistant", "어떤 일정인지 알려줘.", timestamp);

  const context = await loadContext(
    { prepare: (sql) => new Statement(sqlite, sql) },
    "family-1",
    "child-1",
  );

  assert.deepEqual(context, [
    { role: "user", content: "일정 추가", createdAt: timestamp },
    { role: "assistant", content: "몇 시에 추가할까?", createdAt: timestamp },
    { role: "user", content: "내일 오후 3시", createdAt: timestamp },
    { role: "assistant", content: "어떤 일정인지 알려줘.", createdAt: timestamp },
  ]);
  sqlite.close();
});

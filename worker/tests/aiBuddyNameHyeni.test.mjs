import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("여우 AI 친구의 앱·Worker 정본 이름은 혜니다", () => {
  const setup = read("src/screens/child/AiFriendSetup.tsx");
  const worker = read("worker/routes/ai-child-chat.ts");
  const settingsRoute = read("worker/routes/ai-chat-data.ts");
  assert.match(setup, /emoji: "🦊", name: "혜니"/);
  assert.match(worker, /"🐰": \{ name: "혜니"/);
  assert.match(worker, /"🦊": \{ name: "혜니"/);
  assert.doesNotMatch(setup, /꼬미/);
  assert.doesNotMatch(worker, /"🐰": \{ name: "통통이"/);
  assert.doesNotMatch(worker, /"🦊": \{ name: "꼬미"/);
  assert.match(
    settingsRoute,
    /if \(!insertColsFromPatch\.includes\("ai_friend_name"\)\) \{[\s\S]{0,160}insertValuesFromPatch\.push\("혜니"\)/,
    "부모가 이름보다 토글을 먼저 저장해도 운영 DB의 옛 기본값에 기대면 안 된다",
  );
});

test("신규 D1 기본 이름은 혜니고 과거 기본값만 멱등 변경한다", () => {
  const schema = read("cloudflare/schema_d1.sql");
  const migration = read("worker/db/ai-buddy-name-hyeni.sql");
  assert.match(schema, /"ai_friend_name" TEXT DEFAULT '혜니' NOT NULL/);

  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE ai_parent_settings (
    id TEXT PRIMARY KEY,
    ai_friend_name TEXT NOT NULL DEFAULT 'AI 친구',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec("INSERT INTO ai_parent_settings (id, ai_friend_name) VALUES ('rabbit', '통통이'), ('fox', '꼬미'), ('generic', 'AI 친구'), ('custom', '별이')");
  db.exec(migration);
  db.exec(migration);
  assert.deepEqual(
    db.prepare("SELECT id, ai_friend_name FROM ai_parent_settings ORDER BY id").all()
      .map((row) => ({ ...row })),
    [
      { id: "custom", ai_friend_name: "별이" },
      { id: "fox", ai_friend_name: "혜니" },
      { id: "generic", ai_friend_name: "혜니" },
      { id: "rabbit", ai_friend_name: "혜니" },
    ],
  );
});

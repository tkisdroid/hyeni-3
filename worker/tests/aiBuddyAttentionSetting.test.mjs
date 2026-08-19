// 플로팅 AI 친구가 스스로 아이를 부르는 동작의 부모 스위치(2026-08-19 TK 지시).
//
// 이 테스트가 지키는 것
//  · 부모가 끌 수 있어야 한다 — 아이 화면을 잠깐 가리는 동작이라 가족마다 선택이 다르다.
//  · 부모 기기에서 끄면 **아이 기기**가 그걸 알아야 하므로 공개 설정으로도 내려가야 한다.
//  · 기본값은 켜짐이다(발견되게 하는 것이 이 기능의 목적). 옛 행에도 같은 기본값이 적용된다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const COLUMN = "buddy_attention_enabled";

test("부모 설정 route 가 새 스위치를 읽고 쓰고 아이에게도 내려보낸다", () => {
  const source = read("worker/routes/ai-chat-data.ts");
  const boolCols = /const FRIEND_BOOL_COLS = new Set\(\[([\s\S]*?)\]\);/.exec(source);
  assert.ok(boolCols, "FRIEND_BOOL_COLS 를 찾지 못했어요");
  assert.match(boolCols[1], new RegExp(`"${COLUMN}"`), "0/1 로 정규화되지 않으면 문자열이 저장된다");

  const selectCols = /const FRIEND_SELECT_COLS =\s*"([^"]+)"/.exec(source);
  assert.ok(selectCols, "FRIEND_SELECT_COLS 를 찾지 못했어요");
  assert.ok(selectCols[1].split(", ").includes(COLUMN), "부모 설정 화면이 현재 값을 못 읽는다");

  const publicCols = /const FRIEND_PUBLIC_COLS =\s*"([^"]+)"/.exec(source);
  assert.ok(publicCols, "FRIEND_PUBLIC_COLS 를 찾지 못했어요");
  assert.ok(
    publicCols[1].split(", ").includes(COLUMN),
    "공개 설정에 없으면 부모가 꺼도 아이 기기가 알 수 없다",
  );
});

test("정본 스키마와 운영 migration 이 같은 컬럼·기본값을 만든다", () => {
  const schema = read("cloudflare/schema_d1.sql");
  assert.match(schema, new RegExp(`"${COLUMN}" INTEGER DEFAULT 1 NOT NULL`));

  const migration = read("worker/db/ai-buddy-attention.sql");
  assert.match(
    migration,
    new RegExp(`ALTER TABLE ai_parent_settings ADD COLUMN ${COLUMN} INTEGER DEFAULT 1 NOT NULL`),
  );
  // 운영에서 1회만 실행한다는 사실이 파일에 남아 있어야 재실행 사고를 막는다.
  assert.match(migration, /1회만 실행/);
});

test("기존 행에도 기본값 켜짐이 적용되고 부모가 끄면 0 으로 저장된다", () => {
  const db = new DatabaseSync(":memory:");
  // migration 이전 모습으로 만든 뒤 실제 ALTER 를 적용한다(운영과 같은 순서).
  db.exec(`CREATE TABLE ai_parent_settings (
    id TEXT NOT NULL,
    family_id TEXT NOT NULL,
    child_user_id TEXT NOT NULL,
    ai_enabled INTEGER DEFAULT 0 NOT NULL
  );`);
  db.exec("INSERT INTO ai_parent_settings (id, family_id, child_user_id, ai_enabled) VALUES ('a','f','c',1);");
  db.exec(read("worker/db/ai-buddy-attention.sql"));

  const existing = db.prepare(`SELECT ${COLUMN} AS v FROM ai_parent_settings WHERE id='a'`).get();
  assert.equal(existing.v, 1, "이미 있던 가족도 기본은 켜짐이다");

  db.prepare(`UPDATE ai_parent_settings SET ${COLUMN}=0 WHERE id='a'`).run();
  const off = db.prepare(`SELECT ${COLUMN} AS v FROM ai_parent_settings WHERE id='a'`).get();
  assert.equal(off.v, 0, "부모가 끄면 꺼진 채로 저장된다");
  db.close();
});

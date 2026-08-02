import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("자녀 AI 채팅은 canonical tier 동기화 write 실패를 stale Premium으로 계속 사용하지 않는다", () => {
  const text = source("routes/ai-child-chat.ts");
  const start = text.indexOf("subscription AI credit sync failed");
  assert.ok(start >= 0);
  const block = text.slice(start - 1_800, start + 300);
  assert.match(block, /syncResult\.meta\?\.changes/);
  assert.match(block, /ai_credit_subscription_sync_not_applied/);
  assert.match(block, /return c\.json\(\{ error: "ai_credit_balance_unavailable" \}, 503\)/);
});

test("선제 AI도 canonical tier 동기화 write 실패 시 메시지 생성을 닫는다", () => {
  const text = source("routes/ai-proactive.ts");
  const start = text.indexOf("subscription credit sync failed");
  assert.ok(start >= 0);
  const block = text.slice(start - 1_800, start + 300);
  assert.match(block, /syncResult\.meta\?\.changes/);
  assert.match(block, /ai_credit_subscription_sync_not_applied/);
  assert.match(block, /return \{ error: "credit_sync_failed", row: null \}/);
});

test("신규 AI 친구 설정은 DB 기본값이 아니라 canonical Free 5회·Premium 20회를 명시 저장한다", () => {
  const route = source("routes/ai-chat-data.ts");
  const schema = source("../cloudflare/schema_d1.sql");

  assert.match(route, /async function defaultFriendDailyLimit[\s\S]*resolveFamilyEntitlement[\s\S]*resolveIncludedDailyLimit/);
  assert.match(route, /insertColsFromPatch\.push\("daily_limit"\)[\s\S]*defaultFriendDailyLimit\(db, familyId\)/);
  assert.match(route, /ai_friend_name, daily_limit, updated_by/);
  assert.match(route, /\.bind\(crypto\.randomUUID\(\), familyId, uid, finalName, dailyLimit, uid, now, now\)/);
  assert.match(schema, /CREATE TABLE "ai_parent_settings"[\s\S]*"daily_limit" INTEGER DEFAULT 20 NOT NULL/);
});

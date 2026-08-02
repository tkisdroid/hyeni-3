import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [chatData, childChat, ai] = await Promise.all([
  readFile(new URL("../routes/ai-chat-data.ts", import.meta.url), "utf8"),
  readFile(new URL("../routes/ai-child-chat.ts", import.meta.url), "utf8"),
  readFile(new URL("../routes/ai.ts", import.meta.url), "utf8"),
]);

test("AI 설정·기록 helper는 현재 활성 parent/child membership만 허용한다", () => {
  assert.match(chatData, /resolveVerifiedFamilyMembership/);
  assert.match(chatData, /childMemberId[\s\S]{0,500}is_active\s*=\s*1/);
  assert.match(chatData, /m\.family_id\s*=\s*\?/);
});

test("아이 AI 채팅은 JWT child 역할과 정본 가족의 활성 child 행을 함께 검증한다", () => {
  assert.match(childChat, /resolveCanonicalFamilyMembership/);
  assert.match(childChat, /authUser\.role\s*!==\s*"child"/);
  assert.match(childChat, /family_id\s*=\s*\?[\s\S]{0,160}user_id\s*=\s*\?[\s\S]{0,160}role\s*=\s*'child'[\s\S]{0,120}is_active\s*=\s*1/);
});

test("AI 요약의 부모·아이 직접 조회도 비활성 멤버를 제외한다", () => {
  const directMembershipQueries = ai.match(/SELECT[^"`]+FROM family_members[^"`]+/g) ?? [];
  assert.ok(directMembershipQueries.length >= 3);
  for (const query of directMembershipQueries) {
    if (/role='(?:parent|child)'/.test(query)) assert.match(query, /is_active=1/);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../routes/push-notify.ts", import.meta.url), "utf8");

function blockBetween(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `${start} 블록을 찾지 못했습니다`);
  return source.slice(startIndex, endIndex);
}

function assertCompleteTarget(payloadBlock, targetRole) {
  assert.match(payloadBlock, /familyId/);
  assert.match(payloadBlock, /targetUserId/);
  assert.match(payloadBlock, new RegExp(`targetRole:\\s*"${targetRole}"`));
}

test("기기 소리 울리기 시작 FCM은 자녀 세션의 완전한 대상 문맥을 보낸다", () => {
  const block = blockBetween("const fcmPayload =", "const fcmResults =");
  assertCompleteTarget(block, "child");
});

test("기기 소리 울리기 정지 FCM도 같은 자녀 대상 문맥을 보낸다", () => {
  const block = blockBetween("async function handleForceRingStop", "export async function handleForceRingReminder");
  assertCompleteTarget(block, "child");
});

test("기기 소리 울리기 5분 경과 알림은 요청 부모만 대상으로 보낸다", () => {
  const block = blockBetween("export async function handleForceRingReminder", "export async function validateRemoteListenEntitlement");
  assertCompleteTarget(block, "parent");
});

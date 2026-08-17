import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  resolveMemoQuickReplies,
  PARENT_QUICK_REPLIES,
  CHILD_QUICK_REPLIES,
} from "../src/transform/memoQuickReplies.ts";
import { resolveMemoChatCopy } from "../src/transform/memoChatCopy.ts";

test("빠른 답장은 부모/아이 모드로 갈린다(아이 화면에 부모 질문이 뜨지 않는다)", () => {
  // TK 제보: 아이 대화창에 "지금 어디야?", "숙제는 했어?"(부모→아이 질문)가 노출됐다.
  assert.deepEqual(resolveMemoQuickReplies("parent"), PARENT_QUICK_REPLIES);
  assert.deepEqual(resolveMemoQuickReplies("child"), CHILD_QUICK_REPLIES);
  assert.deepEqual(resolveMemoQuickReplies("teacher"), PARENT_QUICK_REPLIES);
  assert.deepEqual(resolveMemoQuickReplies(null), PARENT_QUICK_REPLIES);

  for (const parentOnly of ["지금 어디야?", "숙제는 했어?", "몇 시에 끝나?"]) {
    assert.ok(PARENT_QUICK_REPLIES.includes(parentOnly));
    assert.ok(!CHILD_QUICK_REPLIES.includes(parentOnly), `${parentOnly} 가 아이 문구에 있다`);
  }
  assert.equal(new Set([...PARENT_QUICK_REPLIES, ...CHILD_QUICK_REPLIES]).size, 10);
});

test("대화 문구는 부모=존댓말, 아이=반말로 분리된다", () => {
  const parent = resolveMemoChatCopy("parent");
  const child = resolveMemoChatCopy("child");

  assert.equal(parent.empty, "아직 나눈 대화가 없어요. 먼저 인사를 건네 보세요 💌");
  assert.equal(child.empty, "아직 나눈 대화가 없어. 먼저 인사해 볼까? 💌");
  assert.notEqual(parent.sendFailed, child.sendFailed);
  assert.notEqual(parent.inputPlaceholder, child.inputPlaceholder);

  // 아이 문구에 존댓말 어미가 섞이면 안 된다.
  for (const [key, value] of Object.entries(child)) {
    if (key === "loading") continue; // "…중…" 중립 표현
    assert.ok(!/(해요|하세요|해 주세요|었어요|없어요|못했어요)$/.test(value), `${key}: ${value}`);
  }
});

test("MemoChat 은 하드코딩 문구 대신 role 별 copy 를 쓴다", () => {
  const src = readFileSync(new URL("../src/screens/shared/MemoChat.tsx", import.meta.url), "utf8");
  assert.match(src, /resolveMemoQuickReplies\(role, intl\)/);
  assert.match(src, /resolveMemoChatCopy\(role, intl\)/);
  for (const hardcoded of [
    '"메시지를 입력해 주세요"',
    '"메시지 전송에 실패했어요"',
    '"새 대화를 시작해요"',
    '"메시지를 입력하세요…"',
  ]) {
    assert.ok(!src.includes(hardcoded), `하드코딩 문구가 남아 있다: ${hardcoded}`);
  }
});

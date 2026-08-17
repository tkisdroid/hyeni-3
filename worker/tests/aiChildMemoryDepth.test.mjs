// AI 친구가 아이를 점점 더 잘 알게 되는 부분(2026-08-17) 회귀.
//
// 지키는 것
//  · 고정 목록에 없는 말도 문장 구조로 알아듣고 기억한다("레고 좋아해", "발표가 무서워").
//  · 그렇다고 아무 낱말이나 저장하지 않는다 — 민감 정보·대명사·일시적 감정은 그대로 막는다.
//  · 프롬프트가 아는 것을 목록으로 보여 주고, 모르는 건 아는 척하지 말라고 못박는다.
//  · 대화 맥락 창과 기억 조회량이 다시 좁아지지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createLongTermMemoryPatch } from "../shared/aiMemoryPolicy.js";
import { buildChildSystemPrompt } from "../shared/aiChildContext.js";

const route = readFileSync(new URL("../routes/ai-child-chat.ts", import.meta.url), "utf8");

test("고정 목록 밖의 관심사도 문장 구조로 기억한다", () => {
  const patch = createLongTermMemoryPatch("나 레고 진짜 좋아해");
  assert.equal(patch.shouldStore, true);
  assert.equal(patch.memory.type, "interest");
  assert.equal(patch.memory.key, "레고");
  assert.match(patch.memory.value, /레고/);
});

test("무서워하는 것·잘하는 것·꿈도 기억한다", () => {
  const fear = createLongTermMemoryPatch("발표가 무서워");
  assert.equal(fear.memory.type, "fear");
  assert.equal(fear.memory.key, "발표");

  const strength = createLongTermMemoryPatch("나 줄넘기 잘해");
  assert.equal(strength.memory.type, "strength");
  assert.equal(strength.memory.key, "줄넘기");

  // "수의사"는 의료 안전 필터(의사)에 걸려 저장하지 않는다 — 보수적 정책을 그대로 둔다.
  const dream = createLongTermMemoryPatch("나중에 요리사 되고 싶어");
  assert.equal(dream.memory.type, "dream");
  assert.equal(dream.memory.key, "요리사");
});

test("자주 하는 말일수록 확신이 높게 시작한다", () => {
  const once = createLongTermMemoryPatch("레고 좋아해");
  const often = createLongTermMemoryPatch("레고 매일 좋아해");
  assert.ok(often.memory.confidence > once.memory.confidence);
});

test("민감 정보·일시적 감정·대명사는 여전히 저장하지 않는다", () => {
  assert.equal(createLongTermMemoryPatch("우리 학교 이름은 햇빛초등학교야").shouldStore, false);
  assert.equal(createLongTermMemoryPatch("내 전화번호 010-1234-5678이야").shouldStore, false);
  assert.equal(createLongTermMemoryPatch("오늘은 학원 싫어").shouldStore, false);
  assert.equal(createLongTermMemoryPatch("그거 좋아해").shouldStore, false);
  assert.equal(createLongTermMemoryPatch("엄마 좋아해").shouldStore, false);
  // 부모가 금지한 주제도 그대로 막힌다.
  assert.equal(
    createLongTermMemoryPatch("게임 좋아해", { parentSettings: { forbidden_topics: ["게임"] } }).shouldStore,
    false,
  );
});

test("반복해서 들은 이야기는 확신이 올라가되 확정되지는 않는다", () => {
  assert.match(route, /Math\.min\(\s*0\.95,/);
  assert.match(route, /priorConfidence \+ 0\.05/);
});

test("대화 맥락 창과 기억 조회량이 다시 좁아지지 않는다", () => {
  assert.match(route, /ai_chat_messages[\s\S]{0,200}LIMIT 14/);
  assert.match(route, /ai_memory_summaries[\s\S]{0,160}LIMIT 5/);
  assert.match(route, /ai_long_term_memories[\s\S]{0,200}confidence DESC[\s\S]{0,60}LIMIT 30/);
});

test("프롬프트는 아는 것을 목록으로 주고 모르는 건 아는 척하지 말라고 한다", () => {
  const prompt = buildChildSystemPrompt({
    persona: { name: "코코", tone: "활발한" },
    childProfile: { name: "혜니", birthday: "2017-04-02" },
    memory: { longTermMemories: ["레고를 좋아함", "발표를 무서워함"], recentSummary: "어제 학교 이야기" },
    todaySchedule: [{ title: "수호 생일 챙기기", time: "11:00" }],
    referenceDate: "2026-08-17",
  });
  assert.match(prompt, /## 아이에 대해 알고 있는 것/);
  assert.match(prompt, /- 레고를 좋아함/);
  assert.match(prompt, /- 발표를 무서워함/);
  assert.match(prompt, /아는 척하지 않는다/);
  // 일정 성격 힌트가 프롬프트에 실린다(생일에 준비물을 묻지 않도록).
  assert.match(prompt, /## 오늘 일정의 성격/);
  assert.match(prompt, /수호 생일 챙기기: .*준비물 이야기는 하지 않는다/);
});

test("아는 것이 없으면 없다고 말하고 넘겨짚지 않게 한다", () => {
  const prompt = buildChildSystemPrompt({
    persona: { name: "코코" },
    childProfile: { name: "혜니" },
    referenceDate: "2026-08-17",
  });
  assert.match(prompt, /아직 아는 것이 없다/);
  assert.match(prompt, /판단할 일정 없음/);
});

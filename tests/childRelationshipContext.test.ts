// 아이와 관계를 쌓는 AI 친구 — 습관 기억·활동별 챙길 물건 회귀(2026-08-19 TK 지시).
//
// 이 테스트가 지키는 것
//  · 집에 와서 일정을 정리하는 아이에게는 집에 왔을 때 그 일을 먼저 제안한다.
//  · 태권도에 가면 "준비물"이 아니라 "도복이랑 띠"를 묻는다.
//  · 물건을 자주 두고 오는 아이에게는 장소를 옮길 때 한 번 확인해 준다.
//  · 생일·병원 일정에는 챙길 물건을 묻지 않는다(성격 계약 유지).
//  · 클라이언트 물건 표와 Worker 물건 표가 갈라지지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ACTIVITY_BELONGINGS,
  belongingsForActivity,
  belongingsQuestionForItems,
  joinBelongings,
} from "../src/transform/childBelongings.ts";
import {
  belongingsForEvent,
  buildBelongingsQuestion,
  buildEventCompanionGreeting,
  eventCompanionSuggestions,
} from "../src/transform/eventCompanionPrompt.ts";
import {
  ACTIVITY_BELONGINGS as WORKER_BELONGINGS,
  buildBelongingsHints,
  buildBelongingsQuestion as workerBelongingsQuestion,
  buildChildRelationshipLines,
  buildDepartureBelongingsMessage,
  buildHabitHomeArrivalMessage,
  extractChildHabitMemory,
  findHabitForTrigger,
  habitActionLabel,
  isForgetfulChild,
} from "../worker/shared/aiChildHabits.js";
import { createLongTermMemoryPatch } from "../worker/shared/aiMemoryPolicy.js";
import { buildProactiveAiMessage } from "../worker/shared/aiProactivePolicy.js";
import { buildChildSystemPrompt } from "../worker/shared/aiChildContext.js";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// ── 활동별 챙길 물건 ────────────────────────────────────────────────────────

test("태권도에는 준비물이 아니라 도복과 띠를 묻는다", () => {
  assert.deepEqual([...belongingsForActivity("태권도 학원")], ["도복", "띠"]);
  assert.equal(buildBelongingsQuestion("태권도 학원"), "도복이랑 띠를 챙겼어?");
  const greeting = buildEventCompanionGreeting({ title: "태권도 학원", time: "17:00" }, "안녕");
  assert.match(greeting, /도복이랑 띠를 챙겼어\?/);
  assert.doesNotMatch(greeting, /준비물/);
});

test("받침에 따라 조사가 바뀌고 물건이 하나면 잇지 않는다", () => {
  // 받침 있음 → 이랑/을, 받침 없음 → 랑/를.
  assert.equal(joinBelongings(["도복", "띠"]), "도복이랑 띠");
  assert.equal(joinBelongings(["수영복", "수경", "수건"]), "수영복이랑 수경이랑 수건");
  assert.equal(belongingsQuestionForItems(["악보"]), "악보를 챙겼어?");
  assert.equal(belongingsQuestionForItems(["도복"]), "도복을 챙겼어?");
  assert.equal(belongingsQuestionForItems([]), "");
});

test("모르는 활동에는 물건을 지어내지 않는다", () => {
  assert.deepEqual([...belongingsForActivity("그냥 일정")], []);
  assert.equal(buildBelongingsQuestion("그냥 일정"), "");
  assert.equal(buildBelongingsQuestion(""), "");
});

test("생일·병원 일정에는 챙길 물건을 묻지 않는다", () => {
  // 제목에 "학교"가 섞여 있어도 성격이 생일이면 알림장을 묻지 않는다.
  assert.deepEqual([...belongingsForEvent("학교 생일 파티")], []);
  assert.equal(buildBelongingsQuestion("학교 생일 파티"), "");
  assert.equal(buildBelongingsQuestion("치과 진료"), "");
  // 표 자체는 낱말만 보므로 게이트가 없으면 걸린다 — 게이트가 실제로 일하고 있다.
  assert.deepEqual([...belongingsForActivity("학교 생일 파티")], ["알림장", "숙제"]);
});

test("클라이언트와 Worker의 물건 표는 항상 같다", () => {
  assert.deepEqual(
    ACTIVITY_BELONGINGS.map(([keyword, items]) => [keyword, [...items]]),
    (WORKER_BELONGINGS as ReadonlyArray<readonly [string, readonly string[]]>)
      .map(([keyword, items]) => [keyword, [...items]]),
  );
  for (const [keyword] of ACTIVITY_BELONGINGS) {
    assert.equal(
      buildBelongingsQuestion(`${keyword} 수업`),
      workerBelongingsQuestion(`${keyword} 수업`),
      `${keyword} 문장이 서버와 다르다`,
    );
  }
});

test("제안 칩도 그 활동의 물건을 먼저 꺼낸다", () => {
  const chips = eventCompanionSuggestions({ title: "태권도 학원" });
  assert.match(chips[0], /도복/);
  // 물건을 모르는 일정은 기존 칩 그대로다.
  assert.deepEqual(
    [...eventCompanionSuggestions({ title: "그냥 일정" })],
    [...eventCompanionSuggestions(null)],
  );
});

// ── 대화에서 배우는 습관 ────────────────────────────────────────────────────

test("집에 와서 일정 정리하는 습관을 기억한다", () => {
  const memory = extractChildHabitMemory("나는 집에 오면 내일 일정 정리해");
  assert.equal(memory?.type, "habit");
  assert.equal(memory?.key, "home_arrival");
  assert.match(String(memory?.value), /집에 오면 일정 정리를 함/);
  // 장기기억 정책을 거쳐도 같은 결과여야 프롬프트까지 도달한다.
  const patch = createLongTermMemoryPatch("나는 집에 오면 내일 일정 정리해");
  assert.equal(patch.shouldStore, true);
  assert.equal(patch.memory?.type, "habit");
});

test("물건을 자주 두고 오는 아이를 기억하고, 안 그런 말은 저장하지 않는다", () => {
  const memory = extractChildHabitMemory("나 맨날 물건 두고 와");
  assert.equal(memory?.key, "물건 챙기기");
  assert.match(String(memory?.value), /물건을 자주 두고 옴/);
  assert.equal(isForgetfulChild([String(memory?.value)]), true);
  // 부정문은 습관이 아니다.
  assert.equal(extractChildHabitMemory("나 물건 잘 안 잃어버려"), null);
  // 습관이 아니면 null 을 돌려 기존 판정(관심·싫음)이 이어진다.
  assert.equal(extractChildHabitMemory("나 레고 좋아해"), null);
  assert.equal(createLongTermMemoryPatch("나 레고 좋아해").memory?.type, "interest");
});

test("민감한 말은 습관이어도 저장하지 않는다", () => {
  // 장기기억 정책의 민감 필터가 습관 판정보다 먼저다.
  const patch = createLongTermMemoryPatch("집에 오면 병원 약 먹어");
  assert.equal(patch.shouldStore, false);
  assert.equal(patch.reason, "sensitive_personal_information");
});

test("기억한 습관에서 무엇을 하는지 읽어낸다", () => {
  const memories = ["집에 오면 일정 정리를 함", "레고를 좋아함"];
  assert.equal(findHabitForTrigger(memories, "home_arrival"), "집에 오면 일정 정리를 함");
  assert.equal(habitActionLabel("집에 오면 일정 정리를 함"), "일정 정리");
  assert.equal(findHabitForTrigger(memories, "before_bed"), "");
  assert.equal(habitActionLabel("레고를 좋아함"), "");
});

// ── 기억을 다시 쓰는 순간 ───────────────────────────────────────────────────

test("집에 도착하면 늘 하던 일을 먼저 제안한다", () => {
  const message = buildHabitHomeArrivalMessage(["집에 오면 일정 정리를 함"], "혜니");
  assert.match(message, /혜니/);
  assert.match(message, /늘 하던 대로 일정 정리 같이 할까\?/);

  // 선제 대화 정책도 같은 문장을 쓴다.
  const proactive = buildProactiveAiMessage({
    childName: "혜니",
    arrivalPlaceName: "집",
    referenceDate: "2026-08-19",
    nowHHMM: "16:20",
    longTermMemories: ["집에 오면 일정 정리를 함"],
  });
  assert.equal(proactive, message);

  // 아는 습관이 없으면 기존 일반 인사로 강등한다(없는 습관을 지어내지 않는다).
  const fallback = buildProactiveAiMessage({
    childName: "혜니",
    arrivalPlaceName: "집",
    referenceDate: "2026-08-19",
    nowHHMM: "16:20",
    longTermMemories: [],
  });
  assert.match(fallback, /집/);
  assert.doesNotMatch(fallback, /늘 하던 대로/);
});

test("장소를 떠날 때는 물건을 자주 두고 오는 아이에게만 확인해 준다", () => {
  const forgetful = buildDepartureBelongingsMessage({
    childName: "혜니",
    placeName: "학교",
    forgetful: true,
  });
  assert.match(forgetful, /학교에서 나왔네/);
  assert.match(forgetful, /두고 온/);

  // 잘 챙기는 아이인데 다음 일정도 모르면 아무 말도 하지 않는다.
  assert.equal(
    buildDepartureBelongingsMessage({ childName: "혜니", placeName: "학교" }),
    "",
  );
  // 다음 일정에 챙길 물건이 분명하면 그 물건으로 묻는다.
  const lesson = buildDepartureBelongingsMessage({
    childName: "혜니",
    placeName: "집",
    nextEventTitle: "태권도 학원",
  });
  assert.match(lesson, /태권도 학원 가는구나/);
  assert.match(lesson, /도복이랑 띠를 챙겼어\?/);
});

test("떠남 트리거는 할 말이 없으면 빈 문자열로 조용히 지나간다", () => {
  assert.equal(
    buildProactiveAiMessage({
      childName: "혜니",
      departurePlaceName: "학교",
      todaySchedule: [],
      referenceDate: "2026-08-19",
      nowHHMM: "15:10",
      longTermMemories: [],
    }),
    "",
  );
  // 물건을 자주 두고 오는 아이에게는 확인해 준다.
  assert.match(
    buildProactiveAiMessage({
      childName: "혜니",
      departurePlaceName: "학교",
      referenceDate: "2026-08-19",
      nowHHMM: "15:10",
      longTermMemories: ["물건을 자주 두고 옴(장소를 옮길 때 확인이 필요함)"],
    }),
    /두고 온/,
  );
});

test("다음 일정 안내도 아는 활동이면 물건 이름으로 묻는다", () => {
  const message = buildProactiveAiMessage({
    childName: "혜니",
    todaySchedule: [{ title: "태권도 학원", time: "17:00" }],
    referenceDate: "2026-08-19",
    nowHHMM: "16:00",
  });
  assert.match(message, /17:00에 태권도 학원 있어/);
  assert.match(message, /도복이랑 띠를 챙겼어\?/);
});

// ── 프롬프트에 실리는지 ─────────────────────────────────────────────────────

test("시스템 프롬프트가 습관과 오늘 챙길 것을 알려 준다", () => {
  const prompt = buildChildSystemPrompt({
    persona: { name: "코코" },
    childProfile: { name: "혜니", birthday: "2016-05-05" },
    memory: { longTermMemories: ["집에 오면 일정 정리를 함", "물건을 자주 두고 옴"] },
    todaySchedule: [{ title: "태권도 학원", time: "17:00" }],
    referenceDate: "2026-08-19",
  });
  assert.match(prompt, /## 이 아이의 습관·오늘 챙길 것/);
  assert.match(prompt, /집에 오면 일정 정리를 함/);
  assert.match(prompt, /장소를 옮길 때 두고 온 게 없는지/);
  assert.match(prompt, /태권도 학원: 도복, 띠/);
  // 아는 습관이 없으면 넘겨짚지 말라고 분명히 말한다.
  const empty = buildChildSystemPrompt({ persona: { name: "코코" }, referenceDate: "2026-08-19" });
  assert.match(empty, /아직 파악한 습관이 없다/);
});

test("성격이 다른 일정에는 챙길 것 힌트를 만들지 않는다", () => {
  assert.deepEqual(buildBelongingsHints([{ title: "수호 생일 챙기기" }]), []);
  assert.deepEqual(buildBelongingsHints([{ title: "치과 진료" }]), []);
  assert.deepEqual(buildBelongingsHints([{ title: "수영 수업" }]), ["수영 수업: 수영복, 수경, 수건"]);
});

test("관계 안내 줄은 시키는 말투가 아니라 같이 하자는 말투를 요구한다", () => {
  const lines = buildChildRelationshipLines({
    longTermMemories: ["집에 오면 일정 정리를 함", "물건을 자주 두고 옴"],
    todaySchedule: [{ title: "태권도 학원" }],
  });
  assert.equal(lines.length, 3);
  assert.match(lines.join("\n"), /같이 해 준다/);
  assert.match(lines.join("\n"), /물어보는 말투/);
});

// ── 배선 가드 ──────────────────────────────────────────────────────────────

test("장소를 떠날 때도 AI 친구 선제 대화가 걸려 있다", () => {
  const cron = read("worker/cron/registered-place-geofence-check.ts");
  assert.match(cron, /trigger: "place_departure"/);
  assert.match(cron, /if \(!isEnter\) \{[\s\S]{0,200}aiDepartureTriggered\+\+/);
  const route = read("worker/routes/ai-proactive.ts");
  assert.match(route, /body\.trigger === "place_departure"/);
  // 습관을 쓰려면 장기기억을 함께 읽어야 한다.
  assert.match(route, /loadLongTermMemories\(db, familyId, childUserId\)/);
  assert.match(route, /longTermMemories,/);
});

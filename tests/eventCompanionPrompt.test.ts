// 일정 성격에 맞는 AI 친구 제안 — "수호 생일 챙기기"에 준비물을 묻던 실사고 회귀.
//
// 지키는 것
//  · 생일·병원·시험처럼 성격이 다른 일정에 같은 말("준비는 다 됐어?")을 하지 않는다.
//  · 아이 홈 말풍선도 이동이 필요 없는 일정에 "같이 가자"라고 하지 않는다.
//  · 클라이언트 키워드 표와 Worker 키워드 표가 갈라지지 않는다(앞뒤 다른 친구 방지).
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEventCompanionGreeting,
  eventCompanionSuggestions,
  EVENT_COMPANION_KEYWORDS,
  resolveEventCompanionKind,
} from "../src/transform/eventCompanionPrompt.ts";
import {
  EVENT_COMPANION_KEYWORDS as WORKER_KEYWORDS,
  buildEventCompanionHints,
  resolveEventCompanionKind as workerResolveKind,
} from "../worker/shared/aiEventContext.js";

test("일정 제목에서 성격을 읽는다", () => {
  assert.equal(resolveEventCompanionKind("수호 생일 챙기기"), "birthday");
  assert.equal(resolveEventCompanionKind("치과 진료"), "medical");
  assert.equal(resolveEventCompanionKind("받아쓰기 시험"), "exam");
  assert.equal(resolveEventCompanionKind("학예회 발표"), "performance");
  assert.equal(resolveEventCompanionKind("축구 시합"), "sports");
  assert.equal(resolveEventCompanionKind("태권도 학원"), "lesson");
  assert.equal(resolveEventCompanionKind("학교 등교"), "school");
  assert.equal(resolveEventCompanionKind("가을 소풍"), "outing");
  assert.equal(resolveEventCompanionKind("할머니 댁"), "family");
  assert.equal(resolveEventCompanionKind("그냥 일정"), "general");
});

test("생일 일정에 준비물을 묻지 않는다", () => {
  const greeting = buildEventCompanionGreeting(
    { title: "수호 생일 챙기기", time: "11:00" },
    "안녕",
  );
  assert.match(greeting, /수호 생일 챙기기/);
  assert.match(greeting, /선물/);
  assert.doesNotMatch(greeting, /준비물|준비는 다 됐어/);

  const suggestions = eventCompanionSuggestions({ title: "수호 생일 챙기기" });
  assert.ok(suggestions.some((s) => s.includes("선물")), suggestions.join(","));
  assert.ok(!suggestions.some((s) => s.includes("준비물")), suggestions.join(","));
});

test("성격이 다르면 하는 말도 다르다", () => {
  const lines = ["치과 진료", "받아쓰기 시험", "축구 시합", "태권도 학원"].map((title) =>
    buildEventCompanionGreeting({ title }, "안녕"),
  );
  assert.equal(new Set(lines).size, lines.length, lines.join("\n"));
  assert.match(lines[0], /긴장|같이 있어/);
  assert.match(lines[1], /떨리|잘할 수 있어/);
  assert.match(lines[2], /파이팅/);
  assert.match(lines[3], /챙길/);
});

test("시간을 모르면 시간을 지어내지 않는다", () => {
  const greeting = buildEventCompanionGreeting({ title: "축구 시합" }, "안녕");
  assert.doesNotMatch(greeting, /\d{1,2}:\d{2}/);
});

// 아이 홈 말풍선은 글로벌 i18n 카탈로그(shared.adventure.*)가 정본이 되어
// 성격별 꼬리말을 쓰지 않는다. 성격 판정은 서버 프롬프트 힌트에서 계속 쓰인다.

test("클라이언트와 Worker의 성격 키워드 표는 항상 같다", () => {
  assert.deepEqual(
    EVENT_COMPANION_KEYWORDS.map(([kind, words]) => [kind, [...words]]),
    (WORKER_KEYWORDS as ReadonlyArray<readonly [string, readonly string[]]>)
      .map(([kind, words]) => [kind, [...words]]),
  );
  for (const title of ["수호 생일 챙기기", "치과 진료", "받아쓰기 시험", "그냥 일정"]) {
    assert.equal(resolveEventCompanionKind(title), workerResolveKind(title), title);
  }
});

test("서버 프롬프트 힌트는 일정별 성격을 한 줄씩 알려 준다", () => {
  const hints = buildEventCompanionHints([
    { title: "수호 생일 챙기기" },
    { title: "태권도 학원" },
  ]) as string[];
  assert.equal(hints.length, 2);
  assert.match(hints[0], /수호 생일 챙기기/);
  assert.match(hints[0], /준비물 이야기는 하지 않는다/);
  assert.match(hints[1], /챙길 물건/);
  // 일정이 없으면 있는 척하지 않는다.
  assert.deepEqual(buildEventCompanionHints([]), []);
  assert.deepEqual(buildEventCompanionHints(null), []);
});

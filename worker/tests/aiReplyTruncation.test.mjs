// 출력 상한에 걸려 잘린 AI 답·일정 파싱 예시 날짜 회귀 가드(2026-09-25 프롬프트 감사).
import "./helpers/tsModuleResolve.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { trimToLastCompleteSentence } = await import("../lib/aiReplyText.ts");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("잘린 답은 마지막 완결 문장까지만 남기고, 완결 문장이 없으면 빈 문자열이다", () => {
  assert.equal(trimToLastCompleteSentence("오늘 피아노 있지! 악보 챙겼어? 끝나면 같이 숙제 계"), "오늘 피아노 있지! 악보 챙겼어?");
  assert.equal(trimToLastCompleteSentence("응 좋아! 같이 확인해 볼까? 😊 그리고"), "응 좋아! 같이 확인해 볼까?");
  assert.equal(trimToLastCompleteSentence("완결 문장 없이 잘린 답"), "");
});

test("아이 대화는 finish_reason=length 일 때만 답을 자른다", () => {
  const route = read("routes/ai-child-chat.ts");
  assert.match(route, /if \(data\.choices\?\.\[0\]\?\.finish_reason === "length"\) \{\s*assistantText = trimToLastCompleteSentence\(assistantText\);/);
});

test("일정 파싱 예시는 오늘+1 계산 대신 실제 내일 날짜를 써서 월말에도 없는 날짜를 보여 주지 않는다", () => {
  const route = read("routes/ai.ts");
  assert.doesNotMatch(route, /"day":\$\{\(day \|\| 0\) \+ 1\}/);
  assert.match(route, /"year":\$\{tomorrowDate\.getFullYear\(\)\},"month":\$\{tomorrowDate\.getMonth\(\)\},"day":\$\{tomorrowDate\.getDate\(\)\}/);
});

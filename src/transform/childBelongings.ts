/**
 * 활동별로 실제 챙겨야 하는 물건 — 아이 화면 정본(표 + 문장 만들기).
 *
 * 왜 필요한가(2026-08-19 TK 지시): "준비물 챙겼어?"는 무엇을 챙길지 모르는 말이다.
 * 태권도에 가는 아이에게는 "도복이랑 띠를 챙겼어?"라고 물어야 친구가 내 하루를 아는 것처럼 느껴진다.
 *
 * 이 모듈은 **아무것도 import 하지 않는 아래층**이다. 일정 성격(생일·병원엔 묻지 않기) 게이트는
 * 위층인 `eventCompanionPrompt.ts` 가 씌운다 — 두 모듈이 서로를 import 하면 순환이 된다.
 *
 * ⚠️ 표는 Worker `worker/shared/aiChildHabits.js` 의 ACTIVITY_BELONGINGS 와 같아야 한다.
 * 한쪽만 고치면 아이 홈에서 하는 말과 대화에서 하는 말이 달라진다.
 * 동기화는 `tests/childRelationshipContext.test.ts` 가 고정한다.
 */

export const ACTIVITY_BELONGINGS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["태권도", ["도복", "띠"]],
  ["검도", ["도복", "죽도"]],
  ["유도", ["도복"]],
  ["수영", ["수영복", "수경", "수건"]],
  ["발레", ["레오타드", "발레슈즈"]],
  ["피아노", ["악보"]],
  ["바이올린", ["악기", "악보"]],
  ["미술", ["앞치마", "미술 도구"]],
  ["축구", ["축구화", "정강이 보호대"]],
  ["야구", ["글러브", "모자"]],
  ["농구", ["운동화"]],
  ["체육", ["체육복", "운동화"]],
  ["도서관", ["빌린 책"]],
  ["소풍", ["도시락", "물통"]],
  ["현장학습", ["도시락", "물통"]],
  ["학원", ["교재", "필통"]],
  ["학교", ["알림장", "숙제"]],
];

function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

function objectParticle(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "을";
  return (last - 0xac00) % 28 === 0 ? "를" : "을";
}

function andParticle(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "랑";
  return (last - 0xac00) % 28 === 0 ? "랑" : "이랑";
}

/** 일정 제목에서 챙길 물건을 읽는다. 표에 없으면 빈 배열(없는 걸 지어내지 않는다). */
export function belongingsForActivity(title: unknown, extra?: unknown): readonly string[] {
  const text = `${normalize(title)}${normalize(extra)}`;
  if (!text) return [];
  for (const [keyword, items] of ACTIVITY_BELONGINGS) {
    if (text.includes(normalize(keyword))) return items;
  }
  return [];
}

/** "도복이랑 띠" 처럼 물건을 잇는다. */
export function joinBelongings(items: readonly string[]): string {
  const list = items.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).map((item) => `${item}${andParticle(item)}`).join(" ")} ${list[list.length - 1]}`;
}

/** 물건 목록 → "도복이랑 띠를 챙겼어?"(반말). 빈 목록이면 빈 문자열. */
export function belongingsQuestionForItems(items: readonly string[]): string {
  const list = items.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (list.length === 0) return "";
  return `${joinBelongings(list)}${objectParticle(list[list.length - 1])} 챙겼어?`;
}

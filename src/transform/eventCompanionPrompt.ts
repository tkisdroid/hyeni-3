/**
 * 일정 성격에 맞는 AI 친구의 말 — 아이 화면 정본.
 *
 * 왜 필요한가: 전에는 어떤 일정이든 "준비는 다 됐어?"로 물었다.
 * "수호 생일 챙기기"에 준비물을 묻는 건 상황에 맞지 않고, 친구가 내 하루를 모른다는 느낌을 준다.
 * 그래서 제목에서 일정의 성격을 먼저 읽고 그 성격에 맞는 말을 고른다.
 *
 * ⚠️ 키워드 표는 Worker `worker/shared/aiEventContext.js` 와 같아야 한다
 * (아이 화면 인사와 서버 LLM 답변이 서로 다른 성격으로 말하면 안 된다).
 * 두 표의 동기화는 `tests/eventCompanionPrompt.test.ts` 가 고정한다.
 */

import { belongingsForActivity, belongingsQuestionForItems } from "./childBelongings.ts";

export type EventCompanionKind =
  | "birthday"
  | "medical"
  | "exam"
  | "performance"
  | "sports"
  | "lesson"
  | "school"
  | "outing"
  | "playdate"
  | "family"
  | "general";

/** 성격 판정 키워드. 위에서부터 먼저 맞는 것을 쓴다(구체적인 것이 앞). */
export const EVENT_COMPANION_KEYWORDS: ReadonlyArray<readonly [EventCompanionKind, readonly string[]]> = [
  ["birthday", ["생일", "생신", "파티", "잔치", "돌잔치", "축하"]],
  ["medical", ["병원", "치과", "진료", "검진", "예방접종", "주사", "한의원", "안과", "이비인후과", "소아과"]],
  ["exam", ["시험", "평가", "받아쓰기", "단원평가", "쪽지", "테스트", "검정", "승급"]],
  ["performance", ["발표", "공연", "연주", "학예회", "무대", "리허설", "오디션", "전시"]],
  ["sports", ["시합", "경기", "대회", "운동회", "체육대회", "훈련", "연습경기"]],
  ["lesson", ["학원", "수업", "과외", "피아노", "태권도", "미술", "수영", "발레", "영어", "수학", "논술", "코딩", "바이올린", "축구교실"]],
  ["school", ["학교", "등교", "하교", "방과후", "돌봄", "유치원", "어린이집", "급식"]],
  ["outing", ["여행", "소풍", "캠핑", "견학", "나들이", "체험", "박물관", "동물원", "놀이공원", "바다", "산"]],
  ["playdate", ["놀기", "놀이터", "친구", "약속", "생파", "만나기"]],
  ["family", ["외식", "할머니", "할아버지", "이모", "삼촌", "고모", "가족", "성묘", "제사"]],
];

/** 성격별 인사 꼬리말(반말). "준비물"은 실제로 챙길 게 있는 성격에만 쓴다. */
const KIND_ASK: Record<EventCompanionKind, string> = {
  birthday: "선물은 정했어?",
  medical: "조금 긴장돼? 내가 같이 있어 줄게.",
  exam: "떨리지? 넌 잘할 수 있어.",
  performance: "연습한 대로만 하면 돼!",
  sports: "오늘도 파이팅!",
  lesson: "챙길 거 다 넣었어?",
  school: "오늘 학교에서 뭐 할 거야?",
  outing: "우와, 재밌겠다! 뭐 가져갈까?",
  playdate: "누구랑 놀아?",
  family: "누구 만나러 가?",
  general: "어떤 날이 될까?",
};

/** 성격별 제안 칩(대화를 먼저 열어 주는 말). */
const KIND_SUGGESTIONS: Record<EventCompanionKind, readonly string[]> = {
  birthday: ["생일 선물 뭐가 좋을까?", "축하 편지 같이 쓸래?"],
  medical: ["병원 무서워", "안 아프게 하는 방법 있어?"],
  exam: ["시험 잘 보는 방법 알려줘", "너무 떨려"],
  performance: ["떨릴 때 어떡해?", "연습 도와줘"],
  sports: ["오늘 시합 있어!", "이기고 싶어"],
  lesson: ["오늘 뭐 챙겨야 해?", "학원 가기 싫어"],
  school: ["학교에서 있었던 일 들어줘", "오늘 급식 뭐야?"],
  outing: ["뭐 가져가면 좋아?", "빨리 가고 싶어!"],
  playdate: ["친구랑 뭐 하고 놀까?", "친구랑 싸웠어"],
  family: ["할머니한테 무슨 말 할까?", "오늘 뭐 먹을까?"],
  general: ["오늘 일정 알려줘", "오늘 뭐 하고 놀까?"],
};

function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

/**
 * 챙길 물건을 물어봐도 되는 일정 성격.
 * "학교 생일 파티"처럼 제목에 활동 낱말이 섞여 있어도 성격이 생일·병원이면 묻지 않는다.
 */
export const BELONGINGS_EVENT_KINDS: readonly EventCompanionKind[] = [
  "lesson",
  "sports",
  "school",
  "outing",
  "performance",
];

/**
 * 인사말에서 "챙길 거 다 넣었어?" 대신 물건 이름으로 바꿔도 되는 성격.
 * 시합·발표는 물건보다 **응원**이 먼저다("오늘도 파이팅!") — 떨리는 날 준비물부터 묻지 않는다.
 * 학교는 "오늘 뭐 할 거야?"라는 관계 질문이 더 낫다. 물건은 출발할 때 따로 확인해 준다.
 */
const BELONGINGS_GREETING_KINDS: readonly EventCompanionKind[] = ["lesson"];

/** 일정 제목(+메모)으로 성격을 읽는다. 못 읽으면 general. */
export function resolveEventCompanionKind(title: unknown, extra?: unknown): EventCompanionKind {
  const text = `${normalize(title)}${normalize(extra)}`;
  if (!text) return "general";
  for (const [kind, words] of EVENT_COMPANION_KEYWORDS) {
    if (words.some((word) => text.includes(normalize(word)))) return kind;
  }
  return "general";
}

/**
 * 이 일정에서 챙길 물건. 성격 게이트를 통과한 일정만 물건을 돌려준다
 * (생일·병원 일정에 "알림장 챙겼어?"라고 묻지 않기 위한 이중 방어).
 */
export function belongingsForEvent(title: unknown, extra?: unknown): readonly string[] {
  if (!BELONGINGS_EVENT_KINDS.includes(resolveEventCompanionKind(title, extra))) return [];
  return belongingsForActivity(title, extra);
}

/** 그 일정에 맞는 "도복이랑 띠를 챙겼어?" 한 마디. 모르는 활동이면 빈 문자열. */
export function buildBelongingsQuestion(title: unknown, extra?: unknown): string {
  return belongingsQuestionForItems(belongingsForEvent(title, extra));
}

export interface EventCompanionInput {
  title: unknown;
  /** "HH:MM" 표기. 없으면 시간을 말하지 않는다(지어내지 않는다). */
  time?: unknown;
  memo?: unknown;
}

/** 다음 일정에 대해 친구가 먼저 건네는 말(반말). */
export function buildEventCompanionGreeting(
  input: EventCompanionInput,
  openingLine: string,
): string {
  const title = String(input.title ?? "").trim();
  const opening = String(openingLine ?? "").trim() || "안녕";
  if (!title) return `${opening}! 오늘은 뭐 하고 놀까?`;
  const kind = resolveEventCompanionKind(title, input.memo);
  const time = String(input.time ?? "").trim();
  const when = time ? `${time}에 ` : "";
  // 무엇을 챙길지 아는 학원·수업이면 "챙길 거 다 넣었어?" 대신 그 물건 이름으로 묻는다.
  const ask = (BELONGINGS_GREETING_KINDS.includes(kind)
    ? buildBelongingsQuestion(title, input.memo)
    : "") || KIND_ASK[kind];
  return `${opening}! 오늘 ${when}${title} 있네. ${ask}`;
}

/** 일정 성격에 맞는 제안 칩. 없으면 일반 제안. */
export function eventCompanionSuggestions(input: EventCompanionInput | null): readonly string[] {
  if (!input) return KIND_SUGGESTIONS.general;
  const base = KIND_SUGGESTIONS[resolveEventCompanionKind(input.title, input.memo)];
  // 챙길 물건을 아는 활동이면 그 물건을 첫 칩으로 올린다("도복 챙겼나?").
  const items = belongingsForEvent(input.title, input.memo);
  if (items.length === 0) return base;
  return [`${items[0]} 챙겼는지 봐줘`, ...base];
}

/** 아이 홈 모험 지도 말풍선 꼬리말 — 이동이 필요 없는 일정에 "같이 가자"라고 하지 않는다. */
export function eventCompanionGoLine(title: unknown, memo?: unknown): string {
  const kind = resolveEventCompanionKind(title, memo);
  switch (kind) {
    case "birthday":
      return "축하해 주자!";
    case "medical":
      return "내가 같이 있어 줄게.";
    case "exam":
      return "넌 잘할 수 있어!";
    case "performance":
      return "연습한 대로 하면 돼!";
    case "sports":
      return "파이팅!";
    case "family":
      return "재밌게 다녀와!";
    case "playdate":
      return "재밌게 놀아!";
    default:
      return "나랑 같이 가자 🎒";
  }
}

// 일정 성격 판정(서버) — 아이 화면 인사와 LLM 답변이 같은 성격으로 말하게 한다.
//
// ⚠️ 키워드 표는 `src/transform/eventCompanionPrompt.ts` 의 EVENT_COMPANION_KEYWORDS 와 같아야 한다.
// 한쪽만 고치면 아이 홈에서는 "선물 정했어?"라고 하고 대화에서는 "준비물 챙겼어?"라고 하는
// 앞뒤 안 맞는 친구가 된다. 동기화는 tests/eventCompanionPrompt.test.ts 가 고정한다.

export const EVENT_COMPANION_KEYWORDS = [
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

/** 프롬프트에 적어 줄 한국어 성격 라벨과 "이 일정에서 아이에게 도움이 되는 것". */
const KIND_PROMPT_HINT = {
  birthday: "생일·축하 자리 — 선물·축하 인사를 함께 고민한다. 준비물 이야기는 하지 않는다.",
  medical: "병원 — 무서움을 먼저 달래 준다. 진단·치료 조언은 하지 않는다.",
  exam: "시험·평가 — 긴장을 낮추고 할 수 있다고 북돋운다. 점수로 다그치지 않는다.",
  performance: "발표·공연 — 연습한 것을 믿게 해 준다.",
  sports: "시합·운동 — 응원하고 몸 상태를 챙기게 한다.",
  lesson: "학원·수업 — 챙길 물건과 시간을 함께 확인한다.",
  school: "학교 — 오늘 학교에서 있을 일을 물어본다.",
  outing: "나들이·여행 — 기대를 함께 나누고 챙길 것을 묻는다.",
  playdate: "친구와 놀기 — 누구와 무엇을 할지 물어본다.",
  family: "가족 일정 — 누구를 만나는지 물어본다.",
  general: "일반 일정 — 어떤 일정인지 먼저 물어보고 넘겨짚지 않는다.",
};

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

export function resolveEventCompanionKind(title, extra) {
  const text = `${normalize(title)}${normalize(extra)}`;
  if (!text) return "general";
  for (const [kind, words] of EVENT_COMPANION_KEYWORDS) {
    if (words.some((word) => text.includes(normalize(word)))) return kind;
  }
  return "general";
}

/**
 * 오늘 일정 목록 → 프롬프트에 넣을 성격 힌트 줄.
 * 일정이 없으면 빈 배열(없는 걸 지어내지 않는다).
 */
export function buildEventCompanionHints(events, limit = 4) {
  const rows = Array.isArray(events) ? events.slice(0, Math.max(0, limit)) : [];
  const hints = [];
  const seen = new Set();
  for (const event of rows) {
    const title = String(event?.title ?? "").trim();
    if (!title) continue;
    const kind = resolveEventCompanionKind(title, event?.memo);
    const key = `${title}|${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hints.push(`${title}: ${KIND_PROMPT_HINT[kind] ?? KIND_PROMPT_HINT.general}`);
  }
  return hints;
}

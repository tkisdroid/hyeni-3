// 아이 하루 대시보드 정본(순수 계산, 2026-08-19 TK 지시).
//
// 무엇인가: 프리미엄 보호자에게 **하루에 한 번만** 가는 요약 알림. 탭하면 대시보드 화면이 열려
// ①AI 친구와 어떤 이야기를 했는지 ②하루 일과가 어떻게 흘러갔는지를 한 화면에서 본다.
//
// 원칙
//  · **아이 대화 원문은 절대 담지 않는다.** 무엇을 말했는지가 아니라 어떤 주제였는지만 남긴다.
//    (아이가 부모에게 감시당한다고 느끼면 AI 친구에게 마음을 열지 않는다.)
//  · 없는 건 지어내지 않는다. 기록이 없으면 0/빈 배열이고 화면이 정직하게 "기록 없음"이라 쓴다.
//  · 알릴 게 없으면 알리지 않는다(빈 대시보드로 하루 한 번 울리는 건 소음이다).
//  · 순수 함수다 — DB·시계·환경을 읽지 않는다. 호출부가 조회한 행을 넘긴다.

/** 대화 주제 분류표. 아이 말에서 "어떤 이야기였는지"만 뽑는 데 쓴다. */
export const CHILD_CHAT_TOPICS = [
  ["학교생활", ["학교", "수업", "선생님", "급식", "시험", "받아쓰기", "발표", "숙제", "알림장", "방과후"]],
  ["친구", ["친구", "같이 놀", "놀았", "싸웠", "짝꿍", "단짝"]],
  ["가족", ["엄마", "아빠", "동생", "형아", "누나", "언니", "오빠", "할머니", "할아버지"]],
  ["기분·감정", ["속상", "슬퍼", "화나", "짜증", "무서", "걱정", "기뻐", "행복", "신나", "재밌", "외로"]],
  ["몸 상태", ["아파", "아팠", "다쳤", "배고파", "졸려", "피곤", "열나"]],
  ["일정·준비물", ["일정", "준비물", "학원", "시간표", "몇 시", "언제"]],
  ["놀이·취미", ["게임", "유튜브", "만화", "그림", "레고", "축구", "노래", "춤", "책"]],
  ["먹는 이야기", ["먹고", "맛있", "간식", "치킨", "피자", "떡볶이", "라면"]],
];

/** 대시보드에 보여 줄 최대 주제 수. 다 보여 주면 요약이 아니다. */
export const MAX_DIGEST_TOPICS = 3;
/** "새로 알게 된 것" 최대 줄 수. */
export const MAX_DIGEST_DISCOVERIES = 4;
/** 일정·알림 목록 최대 줄 수. */
export const MAX_DIGEST_ROWS = 6;

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * 아이 메시지 목록 → 주제별 횟수(많은 순).
 * 원문은 돌려주지 않는다 — 분류 결과만 남는다.
 */
export function summarizeChatTopics(messages) {
  const counts = new Map();
  for (const message of asArray(messages)) {
    const content = text(message?.content ?? message);
    if (!content) continue;
    for (const [label, words] of CHILD_CHAT_TOPICS) {
      if (!words.some((word) => content.includes(word))) continue;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "ko"))
    .slice(0, MAX_DIGEST_TOPICS);
}

/** 오늘 새로 알게 된 것(부모 공개 장기기억). 민감 판정은 저장 시점에 이미 끝났다. */
export function summarizeDiscoveries(memories) {
  const out = [];
  const seen = new Set();
  for (const memory of asArray(memories)) {
    if (memory?.parent_visible === 0 || memory?.parent_visible === false) continue;
    const value = text(memory?.value ?? memory);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MAX_DIGEST_DISCOVERIES) break;
  }
  return out;
}

/** 오늘 일과 알림(도착·출발·위험 등) → 종류별 횟수. */
export function summarizeAlertCounts(alerts) {
  const counts = { arrived: 0, left: 0, danger: 0, notArrived: 0, other: 0 };
  for (const alert of asArray(alerts)) {
    const type = text(alert?.alert_type ?? alert?.alertType).toLowerCase();
    if (!type) continue;
    if (type.includes("danger")) counts.danger += 1;
    else if (type.includes("not_arrived") || type.includes("late")) counts.notArrived += 1;
    else if (type.includes("left")) counts.left += 1;
    else if (type.includes("arriv")) counts.arrived += 1;
    else counts.other += 1;
  }
  return counts;
}

/**
 * 준비물·숙제 문자열 → 항목 수. 비어 있으면 0.
 * ⚠️ 줄바꿈이 구분자라 `text()`(공백 접기)를 먼저 쓰면 두 항목이 한 항목으로 붙는다.
 */
export function countChecklistItems(value) {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .length;
}

/**
 * 대시보드 payload. 저장(child_daily_digests.payload)과 화면이 같은 모양을 쓴다.
 * 값이 없으면 0·빈 배열로 두고, 화면이 "기록 없음"을 그린다.
 */
export function buildChildDailyDigest({
  dateKey = "",
  childName = "",
  chatMessages = [],
  discoveries = [],
  safetyEvents = [],
  events = [],
  supplies = null,
  alerts = [],
} = {}) {
  const userMessages = asArray(chatMessages).filter((row) => {
    const role = text(row?.role);
    return role === "" || role === "user";
  });
  const eventRows = asArray(events)
    .map((event) => ({ title: text(event?.title), time: text(event?.time ?? event?.start_time) }))
    .filter((event) => event.title)
    .slice(0, MAX_DIGEST_ROWS);
  const safety = asArray(safetyEvents)
    .map((row) => text(row?.severity).toLowerCase())
    .filter(Boolean);

  return {
    dateKey: text(dateKey),
    childName: text(childName),
    chat: {
      count: userMessages.length,
      topics: summarizeChatTopics(userMessages),
      discoveries: summarizeDiscoveries(discoveries),
      // 심각도만 남긴다 — 무슨 말이었는지는 담지 않는다(안전 화면이 따로 있다).
      safetySignals: safety.filter((severity) => severity === "medium" || severity === "high").length,
    },
    day: {
      events: eventRows,
      eventCount: asArray(events).length,
      supplyCount: countChecklistItems(supplies?.supplies),
      homeworkCount: countChecklistItems(supplies?.homework),
      alerts: summarizeAlertCounts(alerts),
    },
  };
}

/**
 * 이 대시보드를 보낼 만한지. 아무 기록도 없는 날에 알림이 울리면 소음이다.
 * 대화 1회 이상 또는 일정·준비물·이동 기록이 하나라도 있어야 보낸다.
 */
export function shouldSendChildDailyDigest(digest) {
  if (!digest) return false;
  const chat = digest.chat ?? {};
  const day = digest.day ?? {};
  const alerts = day.alerts ?? {};
  const movement = Number(alerts.arrived ?? 0) + Number(alerts.left ?? 0)
    + Number(alerts.danger ?? 0) + Number(alerts.notArrived ?? 0);
  return Number(chat.count ?? 0) > 0
    || Number(day.eventCount ?? 0) > 0
    || Number(day.supplyCount ?? 0) > 0
    || Number(day.homeworkCount ?? 0) > 0
    || movement > 0;
}

function josaEun(word) {
  const value = text(word);
  const last = value.charCodeAt(value.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "는";
  return (last - 0xac00) % 28 === 0 ? "는" : "은";
}

/**
 * 알림 제목·본문. 본문은 "무엇을 볼 수 있는지"만 말하고 대화 내용은 넣지 않는다.
 * 숫자는 실제 집계값만 쓴다(0이면 그 항목을 문장에서 뺀다 — 0을 자랑하지 않는다).
 */
export function buildChildDailyDigestAlert(digest) {
  const name = text(digest?.childName) || "아이";
  const chatCount = Number(digest?.chat?.count ?? 0);
  const eventCount = Number(digest?.day?.eventCount ?? 0);
  const parts = [];
  if (chatCount > 0) parts.push(`AI 친구와 ${chatCount}번 이야기했어요`);
  if (eventCount > 0) parts.push(`일정 ${eventCount}개`);
  const alerts = digest?.day?.alerts ?? {};
  const movement = Number(alerts.arrived ?? 0) + Number(alerts.left ?? 0);
  if (movement > 0) parts.push(`이동 기록 ${movement}건`);
  const body = parts.length > 0
    ? `${parts.join(" · ")}. 오늘 하루를 한눈에 볼까요?`
    : "오늘 하루를 한눈에 정리했어요.";
  return {
    title: `${name}${josaEun(name)} 오늘 이렇게 지냈어요`,
    message: body,
  };
}

/** 하루 대시보드의 알림 유형·멱등 키. 하루·아이당 하나만 만들어진다. */
export const CHILD_DAILY_DIGEST_ALERT_TYPE = "child_daily_digest";

export function childDailyDigestEventId(childUserId, dateKey) {
  return `digest-${text(childUserId)}-${text(dateKey)}`;
}

/**
 * 보낼 시각인지. 하루가 거의 끝난 저녁에 한 번만 본다.
 * 시작 시각 이후이고, 그날 아직 보내지 않았으면 보낸다(중복 방지는 DB PK 가 최종 보증).
 */
export const CHILD_DAILY_DIGEST_START_HOUR = 20;
export const CHILD_DAILY_DIGEST_END_HOUR = 23;

export function isChildDailyDigestWindow(nowHHMM) {
  const match = /^(\d{2}):(\d{2})$/.exec(text(nowHHMM));
  if (!match) return false;
  const hour = Number(match[1]);
  return hour >= CHILD_DAILY_DIGEST_START_HOUR && hour < CHILD_DAILY_DIGEST_END_HOUR;
}

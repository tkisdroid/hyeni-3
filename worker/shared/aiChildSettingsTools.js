// 아이가 AI 친구에게 말로 부탁하는 "내 설정 바꾸기" 도구의 해석·검증 정본.
//
// 아이 모드에서 아이가 스스로 바꿀 수 있는 건 자기 것뿐이다.
//  · 일정 알림 켜기/끄기와 "몇 분 전에 알려줘"  → notification_settings 의 본인 행
//  · AI 친구 이름                                 → ai_parent_settings.ai_friend_name(본인 행)
//  · 내 색깔(테마)                                → 기기 로컬 저장이라 클라이언트가 실행
//
// 부모가 정하는 것(알림 쉬는 시간·위치/등록장소/친구놀이 알림·AI 켜기·하루 한도)은 여기서
// 절대 바꾸지 않고 "부모님만 바꿀 수 있어"로 정직하게 돌려준다. 못 하는 걸 했다고 말하지 않는다.

/** 아이가 직접 바꿀 수 있는 알림 항목. 나머지는 부모 소관이다. */
export const CHILD_NOTIFICATION_FIELDS = ["scheduleAlertsEnabled", "minutesBefore"];

/** 부모만 바꿀 수 있는 알림 항목(요청 시 정직하게 거절). */
const PARENT_ONLY_NOTIFICATION_RE = /(쉬는\s*시간|조용한?\s*시간|방해\s*금지|무음\s*시간|위치\s*알림|장소\s*알림|친구놀이\s*알림)/;

const NOTIFICATION_WORD_RE = /(알림|알람|푸시)/;
const NOTIFICATION_OFF_RE = /(꺼|끄|끌래|off|그만|안\s*받|받기\s*싫|받고\s*싶지\s*않|시끄러|조용히)/i;
const NOTIFICATION_ON_RE = /(켜|킬래|on|받을래|받고\s*싶|다시\s*받|알려\s*줘|울리게)/i;

/** "10분 전", "한 시간 전" 처럼 사전 알림 시각을 말한 부분만 뽑는다. */
function extractMinutesBefore(text) {
  const minutes = new Set();
  for (const match of text.matchAll(/(\d{1,3})\s*분\s*전/g)) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0 && value <= 1440) minutes.add(value);
  }
  for (const match of text.matchAll(/(\d{1,2})\s*시간\s*전/g)) {
    const value = Number(match[1]) * 60;
    if (Number.isInteger(value) && value > 0 && value <= 1440) minutes.add(value);
  }
  if (/(한|1)\s*시간\s*전/.test(text)) minutes.add(60);
  if (/반\s*시간\s*전/.test(text)) minutes.add(30);
  return [...minutes].sort((a, b) => b - a);
}

/**
 * 알림 설정 의도 해석.
 * 반환 null = 알림 설정 요청이 아님. `parentOnly: true` = 부모만 바꿀 수 있는 항목 요청.
 */
export function detectChildNotificationIntent(text) {
  const value = String(text || "");
  if (!NOTIFICATION_WORD_RE.test(value)) return null;
  if (PARENT_ONLY_NOTIFICATION_RE.test(value)) return { parentOnly: true };

  const minutesBefore = extractMinutesBefore(value);
  const wantsOff = NOTIFICATION_OFF_RE.test(value);
  // 끄는 말이 함께 있으면 끄기가 우선이다("알림 켜져 있는데 꺼줘").
  const wantsOn = !wantsOff && NOTIFICATION_ON_RE.test(value);

  if (!wantsOff && !wantsOn && minutesBefore.length === 0) return null;
  return {
    parentOnly: false,
    scheduleAlertsEnabled: wantsOff ? false : wantsOn ? true : null,
    minutesBefore: minutesBefore.length > 0 ? minutesBefore : null,
  };
}

/** 저장 직전 정규화 — 정수·양수·중복 제거·내림차순, 최대 4개. */
export function sanitizeChildNotificationMinutes(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  for (const raw of list) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0 || value > 1440) continue;
    seen.add(value);
  }
  if (seen.size === 0) return null;
  return [...seen].sort((a, b) => b - a).slice(0, 4);
}

const NAME_WORD_RE = /이름/;
const NAME_CHANGE_RE = /(바꿔|바꾸|바꿀|해\s*줘|로\s*해|으로\s*해|짓|지어|할래|하고\s*싶|하자|불러)/;
/** 이름 자리에 오면 안 되는 말(대명사·요청어) — 이런 걸 이름으로 저장하면 친구가 이상해진다. */
const NAME_STOP_WORDS = new Set([
  "이름", "너", "네", "니", "나", "내", "우리", "그거", "저거", "이거", "뭐", "무엇",
  "친구", "AI", "ai", "바꿔", "바꾸", "해줘", "하고", "싶어", "지어", "줘",
]);

/** 이름 자리에 잡힌 토큰이 사실은 동사인지(부탁하는 말이 이름으로 저장되는 걸 막는다). */
function looksLikeVerbToken(token) {
  return /^(바꾸|바꿔|바꿀|바꿈|지어|짓|정해|정하|해줘|하고|하자|할래|불러|부르|싶|줘|좀)/.test(token);
}

/** 이름을 바꾸겠다는 요청인지(새 이름이 없어도 true — 되물어야 하므로). */
export function isAiFriendNameChangeRequest(text) {
  const value = String(text || "");
  return NAME_WORD_RE.test(value) && NAME_CHANGE_RE.test(value);
}

/** AI 친구 이름 변경 요청에서 새 이름만 뽑는다. 못 찾으면 null(=이름을 되물어야 함). */
export function extractAiFriendNameRequest(text) {
  const value = String(text || "");
  if (!isAiFriendNameChangeRequest(value)) return null;

  const quoted = /["'“”‘’]([^"'“”‘’]{1,12})["'“”‘’]/.exec(value);
  if (quoted?.[1]) {
    const name = quoted[1].trim();
    if (name && !NAME_STOP_WORDS.has(name)) return name;
  }
  const particle = /([가-힣A-Za-z0-9]{1,12})\s*(?:으로|로)\s*(?:바꿔|바꾸|바꿀|해|짓|지어|할래|하자|불러)/.exec(value);
  if (particle?.[1]) {
    const name = particle[1].trim();
    if (name && !NAME_STOP_WORDS.has(name)) return name;
  }
  const direct = /이름\s*(?:은|는|을|를)?\s*([가-힣A-Za-z0-9]{1,12})/.exec(value);
  if (direct?.[1]) {
    // "이름 바꾸고 싶어" 의 "바꾸고" 처럼 뒤따르는 동사를 이름으로 저장하면 안 된다.
    const name = direct[1].trim().replace(/(?:이야|야|라고|이라고)$/, "");
    if (name && !NAME_STOP_WORDS.has(name) && !looksLikeVerbToken(name)) return name;
  }
  return null;
}

/** 저장 가능한 이름인지. 서버 저장 한도(30자)보다 짧게 잡아 화면에서 잘리지 않게 한다. */
export function sanitizeAiFriendName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 12) return null;
  if (NAME_STOP_WORDS.has(name) || looksLikeVerbToken(name)) return null;
  return name;
}

/** 아이 테마색 — src/transform/childAccent.ts 의 CHILD_ACCENTS 와 같은 키를 쓴다. */
export const CHILD_ACCENT_KEYS = ["rose", "peach", "lavender", "mint", "sky", "lemon"];

const ACCENT_ALIASES = [
  ["rose", ["핑크", "분홍", "핑크색", "로즈"]],
  ["peach", ["살구", "복숭아", "주황", "오렌지", "피치"]],
  ["lavender", ["보라", "라벤더", "퍼플", "보라색"]],
  ["mint", ["민트", "초록", "녹색", "연두"]],
  ["sky", ["하늘", "파랑", "파란", "블루", "스카이"]],
  ["lemon", ["레몬", "노랑", "노란", "옐로", "노란색"]],
];

const ACCENT_WORD_RE = /(색깔|색상|테마|배경색|색)/;
const ACCENT_CHANGE_RE = /(바꿔|바꾸|바꿀|해\s*줘|로\s*해|으로\s*해|할래|하고\s*싶|하자|골라|바꿔줄)/;

/** 테마색 변경 의도. 색 이름을 못 찾으면 null(=어떤 색인지 되물어야 함). */
export function detectChildAccentIntent(text) {
  const value = String(text || "");
  if (!ACCENT_WORD_RE.test(value) || !ACCENT_CHANGE_RE.test(value)) return null;
  for (const [key, aliases] of ACCENT_ALIASES) {
    if (aliases.some((alias) => value.includes(alias))) return { accent: key };
  }
  return { accent: null };
}

export function isChildAccentKey(value) {
  return typeof value === "string" && CHILD_ACCENT_KEYS.includes(value);
}

/** 알림 변경 결과를 아이 말투로. 실제로 바뀐 것만 말한다(빈 약속 금지). */
export function describeChildNotificationChange(applied) {
  const parts = [];
  if (applied?.scheduleAlertsEnabled === true) parts.push("일정 알림을 켰어");
  if (applied?.scheduleAlertsEnabled === false) parts.push("일정 알림을 껐어");
  const minutes = Array.isArray(applied?.minutesBefore) ? applied.minutesBefore : null;
  if (minutes && minutes.length > 0) {
    parts.push(`${minutes.map((m) => `${m}분`).join("·")} 전에 알려줄게`);
  }
  if (parts.length === 0) return "";
  return `${parts.join(", ")}. 다시 바꾸고 싶으면 말해 줘!`;
}

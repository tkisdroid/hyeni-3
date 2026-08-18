// 아이의 생활 습관·챙길 물건 정본(서버) — AI 친구가 "나를 아는 친구"가 되게 하는 재료.
//
// 왜 필요한가(2026-08-19 TK 지시): 아이와의 대화는 관계를 쌓는 데 쓰여야 한다.
//  · 집에 와서 내일 일정을 정리하는 아이라면 → 집에 왔을 때 그 정리를 먼저 제안한다.
//  · 태권도에 간다면 → 도복 챙겼는지 물어본다.
//  · 물건을 잘 잃어버리는 아이라면 → 장소를 옮길 때 두고 온 게 없는지 물어본다.
//
import { resolveEventCompanionKind } from "./aiEventContext.js";

// ⚠️ 활동별 물건 표(ACTIVITY_BELONGINGS)는 `src/transform/childBelongings.ts` 와 같아야 한다.
// 한쪽만 고치면 아이 홈에서는 "도복 챙겼어?", 대화에서는 "준비물 챙겼어?"라고 하는
// 앞뒤 안 맞는 친구가 된다. 동기화는 tests/childRelationshipContext.test.ts 가 고정한다.

/**
 * 활동 키워드 → 그 활동에 실제로 챙겨야 하는 물건.
 * 위에서부터 먼저 맞는 것을 쓴다(구체적인 활동이 앞). 생일·병원처럼 "챙길 물건"을
 * 묻는 게 어색한 일정은 **의도적으로 넣지 않는다**(eventCompanionPrompt 의 성격 계약과 같은 이유).
 */
export const ACTIVITY_BELONGINGS = [
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

function normalize(value) {
    return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

/** 받침에 따라 을/를. 잘못 붙이면 아이가 읽는 문장이 어색해진다. */
function objectParticle(word) {
    const text = String(word || "");
    const last = text.charCodeAt(text.length - 1);
    if (last < 0xac00 || last > 0xd7a3) return "을";
    return (last - 0xac00) % 28 === 0 ? "를" : "을";
}

/** 받침에 따라 이랑/랑. "도복이랑 띠"처럼 물건을 잇는다. */
function andParticle(word) {
    const text = String(word || "");
    const last = text.charCodeAt(text.length - 1);
    if (last < 0xac00 || last > 0xd7a3) return "랑";
    return (last - 0xac00) % 28 === 0 ? "랑" : "이랑";
}

/**
 * 챙길 물건을 물어봐도 되는 일정 성격.
 * "학교 생일 파티"처럼 제목에 활동 낱말이 섞여 있어도 성격이 생일·병원이면 묻지 않는다.
 */
export const BELONGINGS_EVENT_KINDS = ["lesson", "sports", "school", "outing", "performance"];

/** 일정 제목에서 챙길 물건을 읽는다. 표에 없으면 빈 배열(없는 걸 지어내지 않는다). */
export function belongingsForActivity(title, extra) {
    const text = `${normalize(title)}${normalize(extra)}`;
    if (!text) return [];
    for (const [keyword, items] of ACTIVITY_BELONGINGS) {
        if (text.includes(normalize(keyword))) return items;
    }
    return [];
}

/**
 * 일정으로서 챙길 물건. 성격 게이트를 통과한 일정만 물건을 돌려준다.
 * (생일·병원 일정에 "알림장 챙겼어?"라고 묻지 않기 위한 이중 방어.)
 */
export function belongingsForEvent(title, extra) {
    if (!BELONGINGS_EVENT_KINDS.includes(resolveEventCompanionKind(title, extra))) return [];
    return belongingsForActivity(title, extra);
}

/** "도복이랑 띠" 처럼 물건을 잇는다. */
export function joinBelongings(items) {
    const list = (Array.isArray(items) ? items : []).map((item) => String(item || "").trim()).filter(Boolean);
    if (list.length === 0) return "";
    if (list.length === 1) return list[0];
    return list.slice(0, -1).map((item) => `${item}${andParticle(item)}`).join(" ") + ` ${list[list.length - 1]}`;
}

/**
 * 그 활동에 맞는 "챙겼어?" 한 마디(반말). 표에 없는 활동이면 빈 문자열 —
 * 무엇을 챙길지 모르면서 "준비물 챙겼어?"라고 묻지 않는다.
 */
export function buildBelongingsQuestion(title, extra) {
    const items = belongingsForEvent(title, extra);
    if (items.length === 0) return "";
    const joined = joinBelongings(items);
    return `${joined}${objectParticle(items[items.length - 1])} 챙겼어?`;
}

/**
 * 오늘 일정 목록 → 프롬프트에 넣을 "챙길 것" 줄.
 * 표에 있는 활동만 넣는다(생일·병원 일정에 준비물 이야기를 만들지 않는다).
 */
export function buildBelongingsHints(events, limit = 4) {
    const rows = Array.isArray(events) ? events.slice(0, Math.max(0, limit)) : [];
    const hints = [];
    const seen = new Set();
    for (const event of rows) {
        const title = String(event?.title ?? "").trim();
        if (!title) continue;
        const items = belongingsForEvent(title, event?.memo);
        if (items.length === 0) continue;
        const key = `${title}|${items.join(",")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hints.push(`${title}: ${items.join(", ")}`);
    }
    return hints;
}

// ── 대화에서 배우는 습관 ────────────────────────────────────────────────────
// 아이가 지나가듯 말한 습관을 기억해 두면 다음에 "늘 하던 대로 할까?"라고 물을 수 있다.
// 저장은 기존 장기기억(ai_long_term_memories)을 그대로 쓴다 — 새 스키마를 만들지 않는다.

/** 습관이 시작되는 시점(트리거) 표기. 값은 장기기억 문장에 그대로 들어간다. */
const HABIT_TRIGGERS = [
    { key: "home_arrival", pattern: /집에\s*(?:오면|와서|가면|도착하면|들어오면|와선)/, label: "집에 오면" },
    { key: "after_school", pattern: /(?:학교|학원)\s*(?:끝나면|갔다\s*와서|다녀와서|끝나고)/, label: "학교 끝나면" },
    { key: "before_bed", pattern: /(?:자기\s*전에|잠들기\s*전에|밤에\s*자기\s*전)/, label: "자기 전에" },
    { key: "morning", pattern: /(?:아침에\s*일어나면|아침마다|일어나면)/, label: "아침에" },
];

/** 습관의 내용(무엇을 하는지). 구체적인 것이 앞. */
const HABIT_ACTIONS = [
    { pattern: /(?:내일)?\s*일정\s*(?:을|를)?\s*(?:정리|확인|봐|보)/, label: "일정 정리" },
    { pattern: /(?:시간표|알림장)\s*(?:을|를)?\s*(?:확인|봐|보|챙)/, label: "시간표 확인" },
    { pattern: /가방\s*(?:을|를)?\s*(?:싸|챙|정리)/, label: "가방 챙기기" },
    { pattern: /숙제\s*(?:를|을)?\s*(?:먼저)?\s*(?:해|하|끝)/, label: "숙제" },
    { pattern: /준비물\s*(?:을|를)?\s*(?:챙|확인|정리)/, label: "준비물 챙기기" },
    { pattern: /일기\s*(?:를|을)?\s*(?:써|쓰|적)/, label: "일기 쓰기" },
    { pattern: /책\s*(?:을|를)?\s*(?:읽|봐|보)/, label: "책 읽기" },
    { pattern: /(?:피아노|바이올린)\s*(?:을|를)?\s*(?:연습|쳐|치)/, label: "악기 연습" },
    { pattern: /운동\s*(?:을|를)?\s*(?:해|하)/, label: "운동" },
];

/** 물건을 자주 잃어버린다는 신호. 한 번의 실수와 습관을 구분한다. */
const FORGETFUL_PATTERN =
    /(?:자주|맨날|매일|또|계속|잘|항상|툭하면)\s*(?:물건\s*(?:을|를)?\s*)?(?:잃어버|두고\s*(?:와|오|가)|놓고\s*(?:와|오|가)|깜빡|안\s*가져)/;
/** 반대로 "안 잃어버려" 같은 부정문은 습관으로 저장하지 않는다. */
const FORGETFUL_NEGATION = /(?:안|잘\s*안|절대)\s*(?:잃어버|두고|놓고|깜빡)/;

/**
 * 아이 말 → 습관 장기기억 후보.
 * 민감·금지 필터는 호출부(createLongTermMemoryPatch)가 이미 통과시킨 뒤에 부른다.
 * 습관이 아니면 null 을 돌려 기존 판정(관심·싫음·잘하는 것…)이 이어지게 한다.
 */
export function extractChildHabitMemory(message) {
    const text = String(message || "").replace(/\s+/g, " ").trim();
    if (!text) return null;

    if (FORGETFUL_PATTERN.test(text) && !FORGETFUL_NEGATION.test(text)) {
        return {
            type: "habit",
            key: "물건 챙기기",
            value: "물건을 자주 두고 옴(장소를 옮길 때 확인이 필요함)",
            confidence: /항상|맨날|매일|자주/.test(text) ? 0.8 : 0.7,
            parent_visible: true,
        };
    }

    const trigger = HABIT_TRIGGERS.find((item) => item.pattern.test(text));
    if (!trigger) return null;
    const action = HABIT_ACTIONS.find((item) => item.pattern.test(text));
    if (!action) return null;
    return {
        type: "habit",
        key: trigger.key,
        value: `${trigger.label} ${action.label}${objectParticle(action.label)} 함`,
        confidence: /매일|항상|늘|맨날|보통/.test(text) ? 0.8 : 0.7,
        parent_visible: true,
    };
}

// ── 기억한 습관을 다시 쓰기 ────────────────────────────────────────────────

/** 장기기억 목록에서 "물건을 자주 두고 오는 아이"인지 읽는다. */
export function isForgetfulChild(longTermMemories) {
    const rows = Array.isArray(longTermMemories) ? longTermMemories : [];
    return rows.some((row) => {
        const text = typeof row === "string" ? row : String(row?.value ?? "");
        return text.includes("물건을 자주 두고 옴") || text.includes("물건을 자주 잃어버림");
    });
}

/** 장기기억 목록에서 그 트리거에 하는 습관 문장을 찾는다. 없으면 빈 문자열. */
export function findHabitForTrigger(longTermMemories, triggerKey) {
    const trigger = HABIT_TRIGGERS.find((item) => item.key === triggerKey);
    if (!trigger) return "";
    const rows = Array.isArray(longTermMemories) ? longTermMemories : [];
    for (const row of rows) {
        const text = typeof row === "string" ? row : String(row?.value ?? "");
        if (text.startsWith(trigger.label)) return text;
    }
    return "";
}

/** 습관 문장("집에 오면 일정 정리를 함") → 무엇을 하는지만. */
export function habitActionLabel(habitValue) {
    const text = String(habitValue || "").trim();
    if (!text) return "";
    for (const trigger of HABIT_TRIGGERS) {
        if (!text.startsWith(trigger.label)) continue;
        return text.slice(trigger.label.length).replace(/(?:을|를)?\s*함$/, "").trim();
    }
    return "";
}

/**
 * 집에 도착했을 때 건네는 말. 아이가 늘 하던 일이 있으면 그 일을 먼저 제안한다
 * ("집에 왔구나! 늘 하던 대로 일정 정리 같이 할까?"). 없으면 빈 문자열 —
 * 호출부가 기존 일반 인사 풀로 넘어간다.
 */
export function buildHabitHomeArrivalMessage(longTermMemories, childName = "") {
    const habit = findHabitForTrigger(longTermMemories, "home_arrival")
        || findHabitForTrigger(longTermMemories, "after_school");
    const action = habitActionLabel(habit);
    if (!action) return "";
    const name = String(childName || "").trim();
    const line = `집에 왔구나! 늘 하던 대로 ${action} 같이 할까?`;
    return name ? `${name}, ${line}` : line;
}

/**
 * 장소에서 나왔을 때 건네는 말(반말).
 * 우선순위: ①물건을 자주 두고 오는 아이 → 두고 온 게 없는지 ②다음 일정에 챙길 물건이
 * 분명하면 그 물건 ③아니면 아무 말도 하지 않는다(할 말이 없는데 말을 걸지 않는다).
 */
export function buildDepartureBelongingsMessage({
    childName = "",
    placeName = "",
    nextEventTitle = "",
    nextEventMemo = "",
    forgetful = false,
} = {}) {
    const name = String(childName || "").trim();
    const place = String(placeName || "").trim();
    const withName = (line) => (name ? `${name}, ${line}` : line);
    const question = buildBelongingsQuestion(nextEventTitle, nextEventMemo);

    if (forgetful) {
        const where = place ? `${place}에서 나왔네! ` : "";
        return withName(question
            ? `${where}${question} 두고 온 건 없고?`
            : `${where}두고 온 물건 없는지 한 번만 확인해 볼까?`);
    }
    if (question) {
        const title = String(nextEventTitle || "").trim();
        return withName(title ? `이제 ${title} 가는구나! ${question}` : question);
    }
    return "";
}

/**
 * 프롬프트에 넣을 "이 아이는 이런 아이" 블록.
 * 아는 것이 없으면 빈 문자열 — 없는 습관을 지어내 넘겨짚지 않는다.
 */
export function buildChildRelationshipLines({ longTermMemories = [], todaySchedule = [] } = {}) {
    const lines = [];
    const habits = (Array.isArray(longTermMemories) ? longTermMemories : [])
        .map((row) => (typeof row === "string" ? row : String(row?.value ?? "")))
        .filter((text) => HABIT_TRIGGERS.some((trigger) => text.startsWith(trigger.label)));
    for (const habit of habits.slice(0, 4)) {
        lines.push(`${habit} — 그 때가 되면 먼저 물어보고 같이 해 준다.`);
    }
    if (isForgetfulChild(longTermMemories)) {
        lines.push("물건을 자주 두고 온다 — 장소를 옮길 때 두고 온 게 없는지 한 번 물어본다.");
    }
    for (const hint of buildBelongingsHints(todaySchedule)) {
        lines.push(`오늘 ${hint} — 챙겼는지 물어본다(넘겨짚지 말고 물어보는 말투로).`);
    }
    return lines;
}

// supabase/functions/_shared/aiDaySummaryPolicy.js
// 과거 날짜 "하루 이야기" AI 요약 — 순수 신호 추출/병합·빈 판정·프롬프트 빌더.
// React/Supabase/Deno 종속 없음 — vitest 로 직접 단위 테스트.

const NOT_ARRIVED_HINTS = ["not_arrived", "late", "no_show"];
const DANGER_HINTS = ["danger"];
const SOS_HINTS = ["sos", "emergency", "help"];
const PLAYDATE_HINTS = ["playdate"];

// 프롬프트 버전 — 캐시 무효화 키. 톤·구조 변경 시 +1.
// v1: "그날 특징" 1~2 문장 딱딱한 톤
// v2: "하루 이야기" 3~5 문장 친근 존댓말 + chatTopics 주제 요약
export const DAY_SUMMARY_PROMPT_VERSION = 2;

const MAX_CHAT_TOPICS = 8;
const MAX_CHAT_TOPIC_LEN = 60;

export function categorizeAlertType(alertType) {
    const type = String(alertType || "").toLowerCase();
    if (!type) return "other";
    if (DANGER_HINTS.some((h) => type.includes(h))) return "dangerZone";
    if (SOS_HINTS.some((h) => type.includes(h))) return "sos";
    if (PLAYDATE_HINTS.some((h) => type.includes(h))) return "playdate";
    if (NOT_ARRIVED_HINTS.some((h) => type.includes(h))) return "notArrived";
    return "other";
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function cleanText(value, max = 60) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function extractDaySummarySignals({ alerts = [], chatMessages = [], clientSignals = {} } = {}) {
    const counts = { notArrived: 0, dangerZone: 0, sos: 0, playdate: 0 };
    const highlightSet = new Set();
    asArray(alerts).forEach((alert) => {
        const category = categorizeAlertType(alert?.alert_type);
        if (category in counts) counts[category] += 1;
        const title = cleanText(alert?.title);
        if (title && category !== "other") highlightSet.add(title);
    });

    const userMessages = asArray(chatMessages).filter((m) => m?.role === "user");
    const chatCount = userMessages.length;
    // 자녀 user 메시지 마지막 N개의 발췌. GPT 가 주제만 1줄로 요약.
    // 원문 인용·민감내용 노출 금지 지시는 buildDaySummaryPrompt 의 system 에서.
    const chatTopics = userMessages
        .slice(-MAX_CHAT_TOPICS)
        .map((m) => cleanText(m?.content, MAX_CHAT_TOPIC_LEN))
        .filter((text) => text.length > 0);

    const dwellPlaces = asArray(clientSignals?.dwellPlaces)
        .map((place) => ({
            title: cleanText(place?.title || place?.placeLabel || place?.displayTitle, 40),
            durationLabel: cleanText(place?.durationLabel || place?.label, 24),
        }))
        .filter((place) => place.title)
        .slice(0, 6);

    const events = asArray(clientSignals?.events)
        .map((event) => ({
            title: cleanText(event?.title, 40),
            time: cleanText(event?.time, 8),
        }))
        .filter((event) => event.title)
        .slice(0, 8);

    const rawDistance = Number(clientSignals?.totalDistanceM);
    const totalDistanceM = Number.isFinite(rawDistance) && rawDistance > 0 ? Math.round(rawDistance) : 0;

    return {
        ...counts,
        chatCount,
        chatTopics,
        alertHighlights: Array.from(highlightSet).slice(0, 5),
        dwellPlaces,
        events,
        totalDistanceM,
        promptVersion: DAY_SUMMARY_PROMPT_VERSION,
    };
}

const MEANINGFUL_DISTANCE_M = 1000;

export function hasMeaningfulDaySignals(signals) {
    if (!signals) return false;
    const alertTotal = (signals.notArrived || 0) + (signals.dangerZone || 0) + (signals.sos || 0) + (signals.playdate || 0);
    return (
        alertTotal > 0
        || (signals.events || []).length > 0
        || (signals.dwellPlaces || []).length > 0
        || (signals.chatCount || 0) > 0
        || (signals.totalDistanceM || 0) >= MEANINGFUL_DISTANCE_M
    );
}

function formatDistanceLabel(meters) {
    if (!meters) return "";
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
    return `${Math.round(meters / 10) * 10}m`;
}

export function buildDaySummaryPrompt(signals, { childName = "아이", dateLabel = "" } = {}) {
    const name = cleanText(childName, 20) || "아이";
    const facts = [];
    if (signals.dangerZone > 0) facts.push(`위험지역 진입 알림 ${signals.dangerZone}건`);
    if (signals.sos > 0) facts.push(`SOS/긴급 알림 ${signals.sos}건`);
    if (signals.notArrived > 0) facts.push(`미도착/지각 알림 ${signals.notArrived}건`);
    if (signals.playdate > 0) facts.push(`친구와 만남(놀이) ${signals.playdate}건`);
    (signals.alertHighlights || []).forEach((title) => facts.push(`알림: ${title}`));
    (signals.events || []).forEach((event) => facts.push(`일정: ${event.title}${event.time ? ` (${event.time})` : ""}`));
    (signals.dwellPlaces || []).forEach((place) => facts.push(`머문 곳: ${place.title}${place.durationLabel ? ` (${place.durationLabel})` : ""}`));
    if (signals.totalDistanceM > 0) facts.push(`총 이동거리 약 ${formatDistanceLabel(signals.totalDistanceM)}`);
    if (signals.chatCount > 0) facts.push(`AI 친구와 ${signals.chatCount}번 대화`);
    // chatTopics 발췌 — system 프롬프트가 "주제만 1줄, 원문 인용 금지" 라고 명시.
    if ((signals.chatTopics || []).length > 0) {
        facts.push("AI 친구 대화 발췌 (주제만 요약, 원문 인용 금지):");
        signals.chatTopics.forEach((topic) => facts.push(`  · "${topic}"`));
    }

    const system = [
        `너는 자녀 안전 캘린더 앱에서 부모에게 자녀 "${name}"의 하루를 따뜻하게 들려주는 도우미야.`,
        // 톤 정의 — 친근 존댓말, 부모가 자녀 이야기를 듣는 느낌.
        "친근한 존댓말로 한국어 3~5문장 분량으로 자연스럽게 풀어 써.",
        `"${name}는 ~했네요", "~걸어다녔어요^^", "~인 것 같아요" 처럼 부모와 대화하듯 따뜻한 어미를 써.`,
        "사실 위주로 쓰되, 자연스러운 추측·격려 한두 마디(\"편한 하루였을 것 같아요\", \"많이 걸어다녔네요\" 등)는 OK.",
        "이모티콘은 \"^^\" 같은 부드러운 것 한 번 정도만 자연스럽게. 느낌표 남발·과장·강한 경고체는 쓰지 마.",
        "사실 목록에 없는 일은 절대 지어내지 마.",
        // AI 친구 대화 — 주제만 요약.
        "AI 친구 대화 발췌가 있으면 '엄마/학교/친구 이야기를 많이 했어요' 처럼 주제만 1줄로 부드럽게 요약하고, 원문은 그대로 인용하지 마.",
        // 위험 신호 처리.
        "위험지역/SOS 같은 신호도 부모를 불안하게 몰아붙이지 말고 차분하게 사실 위주로 전해.",
    ].join(" ");

    const user = [
        dateLabel ? `${dateLabel}의 ${name} 하루 기록입니다.` : `${name}의 하루 기록입니다.`,
        "사실 목록:",
        facts.length ? facts.map((fact) => fact.startsWith("  ") ? fact : `- ${fact}`).join("\n") : "- 특별한 기록 없음",
        "",
        `위 사실을 바탕으로 부모님께 ${name}의 하루 이야기를 3~5문장 친근 존댓말로 들려주세요.`,
    ].join("\n");

    return { system, user };
}

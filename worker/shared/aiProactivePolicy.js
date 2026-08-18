import {
    buildBelongingsQuestion,
    buildDepartureBelongingsMessage,
    buildHabitHomeArrivalMessage,
    isForgetfulChild,
} from "./aiChildHabits.js";

function parseHHMM(value) {
    const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(value || "").trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
}

function displayHHMM(value) {
    const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(value || "").trim());
    if (!match) return String(value || "").trim();
    return `${match[1]}:${match[2]}`;
}

function parseDateKey(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== month - 1
        || parsed.getUTCDate() !== day
    ) {
        return null;
    }
    return { year, month, day };
}

function birthdayUtcMsForYear(birthday, year) {
    const parsed = new Date(Date.UTC(year, birthday.month - 1, birthday.day));
    if (
        parsed.getUTCMonth() === birthday.month - 1
        && parsed.getUTCDate() === birthday.day
    ) {
        return parsed.getTime();
    }
    return Date.UTC(year, 1, 28);
}

function daysUntilNextBirthday(childBirthday, referenceDate) {
    const birthday = parseDateKey(childBirthday);
    const reference = parseDateKey(referenceDate || new Date().toISOString().slice(0, 10));
    if (!birthday || !reference) return null;
    const referenceUtcMs = Date.UTC(reference.year, reference.month - 1, reference.day);
    let nextBirthdayUtcMs = birthdayUtcMsForYear(birthday, reference.year);
    if (nextBirthdayUtcMs < referenceUtcMs) {
        nextBirthdayUtcMs = birthdayUtcMsForYear(birthday, reference.year + 1);
    }
    return Math.round((nextBirthdayUtcMs - referenceUtcMs) / 86_400_000);
}

function timestampMs(value) {
    if (value == null || value === "") return 0;
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : 0;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
}

function toNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function readSetting(settings, camelKey, snakeKey, fallback = undefined) {
    if (settings && Object.prototype.hasOwnProperty.call(settings, camelKey)) {
        return settings[camelKey];
    }
    if (settings && Object.prototype.hasOwnProperty.call(settings, snakeKey)) {
        return settings[snakeKey];
    }
    return fallback;
}

function normalizeBoolean(value) {
    if (value === true) return true;
    if (typeof value === "string") return value.toLowerCase() === "true";
    return false;
}

function isWithinTimeRange(nowHHMM, startHHMM, endHHMM, invalidDefault = false) {
    const now = parseHHMM(nowHHMM);
    const start = parseHHMM(startHHMM);
    const end = parseHHMM(endHHMM);
    if (now == null || start == null || end == null) return invalidDefault;
    if (start === end) return false;
    if (start < end) return now >= start && now < end;
    return now >= start || now < end;
}

export function isProactiveQuietHours(nowHHMM, quietHoursStart = "21:00", quietHoursEnd = "07:00") {
    const now = parseHHMM(nowHHMM);
    const start = parseHHMM(quietHoursStart);
    const end = parseHHMM(quietHoursEnd);
    if (now == null || start == null || end == null || start === end) return false;
    if (start < end) return now >= start && now < end;
    return now >= start || now < end;
}

export function getProactiveCreditRemaining(creditStatus = {}) {
    if (creditStatus?.canChat === false) return 0;

    const parentDailyRemainingValue = creditStatus.parentDailyRemaining ?? creditStatus.parent_daily_remaining;
    const hasParentDailyRemaining = parentDailyRemainingValue != null;
    const parentDailyRemaining = hasParentDailyRemaining
        ? Math.max(0, toNumber(parentDailyRemainingValue))
        : null;
    if (hasParentDailyRemaining && parentDailyRemaining <= 0) return 0;

    const normalizedDailyRemaining = creditStatus.dailyIncludedRemaining;
    if (normalizedDailyRemaining != null) {
        const dailyRemaining = Math.max(0, toNumber(normalizedDailyRemaining));
        const totalRemaining = dailyRemaining + Math.max(0, toNumber(creditStatus.purchasedCredits));
        return parentDailyRemaining == null ? totalRemaining : Math.min(totalRemaining, parentDailyRemaining);
    }

    const dailyLimit = toNumber(creditStatus.daily_included_limit ?? creditStatus.dailyIncludedLimit);
    const dailyUsed = toNumber(creditStatus.daily_included_used ?? creditStatus.dailyIncludedUsed);
    const purchasedCredits = toNumber(creditStatus.purchased_credits ?? creditStatus.purchasedCredits);
    const totalRemaining = Math.max(0, dailyLimit - dailyUsed) + Math.max(0, purchasedCredits);
    return parentDailyRemaining == null ? totalRemaining : Math.min(totalRemaining, parentDailyRemaining);
}

export function canGenerateProactiveAiMessage({
    parentSettings,
    notificationPermission,
    creditStatus,
    nowHHMM,
    nowMs = Date.now(),
    lastPromptedAt = 0,
    minIntervalMinutes = 360,
} = {}) {
    const proactiveEnabled = normalizeBoolean(readSetting(parentSettings, "proactiveEnabled", "proactive_enabled", false));
    if (!proactiveEnabled) {
        return { ok: false, reason: "parent_disabled" };
    }

    if (notificationPermission !== true && notificationPermission !== "granted") {
        return { ok: false, reason: "notification_not_allowed" };
    }

    const startTime = readSetting(parentSettings, "proactiveStartTime", "proactive_start_time", "08:00");
    const endTime = readSetting(parentSettings, "proactiveEndTime", "proactive_end_time", "20:00");
    if (!isWithinTimeRange(nowHHMM, startTime, endTime, false)) {
        return { ok: false, reason: "outside_allowed_window" };
    }

    const quietStart = readSetting(parentSettings, "quietHoursStart", "quiet_hours_start", "21:00");
    const quietEnd = readSetting(parentSettings, "quietHoursEnd", "quiet_hours_end", "07:00");
    if (isProactiveQuietHours(nowHHMM, quietStart, quietEnd)) {
        return { ok: false, reason: "quiet_hours" };
    }

    if (getProactiveCreditRemaining(creditStatus) <= 0) {
        return { ok: false, reason: "credit_unavailable" };
    }

    const lastMs = timestampMs(lastPromptedAt);
    const intervalMs = Math.max(0, toNumber(minIntervalMinutes)) * 60 * 1000;
    if (lastMs > 0 && toNumber(nowMs, Date.now()) - lastMs < intervalMs) {
        return { ok: false, reason: "too_recent" };
    }

    return { ok: true, reason: "allowed" };
}

/** 지금 시각 이후의 다음 일정(시간 없는 일정은 마지막 후보). 없으면 undefined. */
function resolveNextEvent(todaySchedule, nowHHMM) {
    const events = Array.isArray(todaySchedule) ? todaySchedule : [];
    const nowMinutes = parseHHMM(nowHHMM);
    const titledEvents = events.filter((event) => String(event?.title || "").trim());
    if (nowMinutes == null) return titledEvents[0];
    const upcomingTimedEvents = titledEvents
        .map((event) => ({
            event,
            minutes: parseHHMM(event?.time || event?.startTime || event?.start_time),
        }))
        .filter(({ minutes }) => minutes != null && minutes >= nowMinutes)
        .sort((left, right) => left.minutes - right.minutes);
    return upcomingTimedEvents[0]?.event
        || titledEvents.find((event) => parseHHMM(event?.time || event?.startTime || event?.start_time) == null);
}

export function buildProactiveAiMessage({
    childName = "",
    todaySchedule = [],
    recentSummary = "",
    childBirthday = "",
    referenceDate = "",
    nowHHMM = "",
    arrivalPlaceName = "",
    departurePlaceName = "",
    longTermMemories = [],
} = {}) {
    const name = String(childName || "").trim();

    // 장소를 떠나는 트리거(geofence LEAVE) — 물건을 자주 두고 오는 아이이거나 다음 일정에
    // 챙길 물건이 분명할 때만 말을 건다. 할 말이 없으면 빈 문자열로 조용히 지나간다.
    const departurePlace = String(departurePlaceName || "").trim();
    if (departurePlace) {
        const next = resolveNextEvent(todaySchedule, nowHHMM);
        return buildDepartureBelongingsMessage({
            childName: name,
            placeName: departurePlace,
            nextEventTitle: next?.title || "",
            nextEventMemo: next?.memo || "",
            forgetful: isForgetfulChild(longTermMemories),
        });
    }

    // 집 도착 트리거(geofence ENTER) — 도착 알림을 받은 직후의 맥락이므로
    // 일정·생일보다 우선해 "집에 왔구나" 인사를 만든다. 집이 아닌 장소는 무시.
    const arrivalPlace = String(arrivalPlaceName || "").trim();
    if (arrivalPlace.includes("집")) {
        // 늘 하던 일이 있으면 그 일부터 제안한다("집에 와서 내일 일정 정리하는 아이").
        const habitMessage = buildHabitHomeArrivalMessage(longTermMemories, name);
        if (habitMessage) return habitMessage;
        const arrivalHour = Number(String(nowHHMM || "").slice(0, 2));
        const pool = Number.isFinite(arrivalHour) && arrivalHour >= 19
            ? HOME_ARRIVAL_EVENING_MESSAGES
            : HOME_ARRIVAL_MESSAGES;
        const message = pickDailyVariant(pool, referenceDate);
        return name ? `${name}, ${message}` : message;
    }
    const nextEvent = resolveNextEvent(todaySchedule, nowHHMM);
    if (nextEvent) {
        // 챙길 물건을 아는 활동이면 "준비물"이 아니라 그 물건 이름으로 묻는다.
        const belongings = buildBelongingsQuestion(nextEvent.title, nextEvent.memo);
        if (belongings) {
            const time = displayHHMM(nextEvent.time || nextEvent.startTime || nextEvent.start_time);
            const title = String(nextEvent.title || "").trim();
            return time ? `${time}에 ${title} 있어. ${belongings}` : `오늘 ${title} 있어. ${belongings}`;
        }
    }
    if (nextEvent) {
        const title = String(nextEvent.title || "").trim();
        const time = displayHHMM(nextEvent.time || nextEvent.startTime || nextEvent.start_time);
        return time ? `${time}에 ${title} 있어. 준비물 같이 확인해볼까?` : `오늘 ${title} 있어. 같이 준비해볼까?`;
    }

    const summary = String(recentSummary || "");
    if (summary.includes("속상")) {
        return name ? `${name}, 어제 속상했던 일은 오늘 조금 괜찮아졌어?` : "어제 속상했던 일은 오늘 조금 괜찮아졌어?";
    }

    const daysUntilBirthday = daysUntilNextBirthday(childBirthday, referenceDate);
    if (daysUntilBirthday === 0) {
        return name ? `${name}, 오늘 생일이야. 하고 싶은 게 있어?` : "오늘 생일이야. 하고 싶은 게 있어?";
    }
    if (daysUntilBirthday != null && daysUntilBirthday > 0 && daysUntilBirthday <= 7) {
        return name ? `${name}, 곧 생일이네. 기대되는 게 있어?` : "곧 생일이네. 기대되는 게 있어?";
    }

    const hour = Number(String(nowHHMM || "").slice(0, 2));
    const withName = (message) => (name ? `${name}, ${message}` : message);
    if (Number.isFinite(hour) && hour < 11) {
        return withName(pickDailyVariant(MORNING_PROACTIVE_MESSAGES, referenceDate));
    }
    if (Number.isFinite(hour) && hour >= 15 && hour < 19) {
        return withName(pickDailyVariant(AFTER_SCHOOL_PROACTIVE_MESSAGES, referenceDate));
    }
    if (Number.isFinite(hour) && hour >= 19) {
        return withName(pickDailyVariant(EVENING_PROACTIVE_MESSAGES, referenceDate));
    }
    return "";
}

// 클라이언트 src/lib/aiProactive.js 의 generateProactiveGreeting 과 동일 풀이어야 한다. 동기화 필요.
const MORNING_PROACTIVE_MESSAGES = [
    "오늘 시작 전에 준비할 것 같이 볼까?",
    "좋은 아침! 오늘 기대되는 거 있어?",
];
const AFTER_SCHOOL_PROACTIVE_MESSAGES = [
    "학교 잘 다녀왔어? 오늘 숙제 같이 정리해볼까?",
    "오늘 학교에서 재밌는 일 있었어? 얘기해줘!",
    "숙제 먼저 끝내고 놀까? 뭐부터 할지 같이 정해보자.",
];
const EVENING_PROACTIVE_MESSAGES = [
    "오늘 하루 어땠어? 짧게 얘기해도 돼.",
    "자기 전에 오늘 일을 일기로 남겨볼까? 내가 도와줄게.",
    "오늘 제일 기분 좋았던 순간은 언제야?",
];
// 집 도착 트리거 전용 풀 — 서버에서만 사용(클라이언트 동기화 대상 아님).
const HOME_ARRIVAL_MESSAGES = [
    "집에 왔구나! 오늘 숙제 뭐 있어? 같이 정리해볼까?",
    "집 도착! 조금 쉬고 나서 숙제 같이 볼까?",
    "집에 왔네! 오늘 있었던 일 얘기해줄래?",
];
const HOME_ARRIVAL_EVENING_MESSAGES = [
    "집에 왔구나! 오늘 하루 어땠어?",
    "집 도착! 자기 전에 오늘 일을 일기로 남겨볼까?",
];

// 같은 날에는 항상 같은 문구(결정적), 날짜가 바뀌면 풀에서 회전해 반복감을 줄인다.
function pickDailyVariant(pool, referenceDate) {
    if (!Array.isArray(pool) || pool.length === 0) return "";
    const parsed = parseDateKey(referenceDate || "");
    const index = parsed ? (parsed.year + parsed.month + parsed.day) % pool.length : 0;
    return pool[index];
}

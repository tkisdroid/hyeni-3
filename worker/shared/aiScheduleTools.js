// Shared schedule tool helpers for child AI agent actions.

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
const DB_TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

function parseIsoDate(value) {
    const match = typeof value === "string" ? ISO_DATE_RE.exec(value.trim()) : null;
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (
        date.getFullYear() !== year
        || date.getMonth() !== month - 1
        || date.getDate() !== day
    ) {
        return null;
    }
    return { year, month, day };
}

export function toAppDateKey(isoDate) {
    const parsed = parseIsoDate(isoDate);
    if (!parsed) throw new Error("date required");
    return `${parsed.year}-${parsed.month - 1}-${parsed.day}`;
}

export function toAppDateKeysInWindow(isoDate, {
    daysBefore = 7,
    daysAfter = 7,
    includeReference = false,
} = {}) {
    const parsed = parseIsoDate(isoDate);
    if (!parsed) return [];

    const before = Math.max(0, Math.round(Number(daysBefore) || 0));
    const after = Math.max(0, Math.round(Number(daysAfter) || 0));
    const keys = [];
    for (let offset = -before; offset <= after; offset += 1) {
        if (offset === 0 && !includeReference) continue;
        const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + offset));
        keys.push(toAppDateKey(date.toISOString().slice(0, 10)));
    }
    return keys;
}

export function isValidScheduleDate(value) {
    return parseIsoDate(value) !== null;
}

export function isValidScheduleTime(value) {
    const match = TIME_RE.exec(String(value || "").trim());
    if (!match) return false;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function minutesFromHHMM(value) {
    const match = DB_TIME_RE.exec(String(value || "").trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] || 0);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
        return null;
    }
    return hour * 60 + minute;
}

export function isValidScheduleTimeRange(startTime, endTime) {
    const start = minutesFromHHMM(startTime);
    const end = minutesFromHHMM(endTime);
    if (start == null || end == null) return false;
    return end > start;
}

function readScheduleStartTime(event = {}) {
    return event.time || event.startTime || event.start_time || "";
}

function readScheduleEndTime(event = {}) {
    return event.endTime || event.end_time || "";
}

export function isValidScheduleChangeTimeRange(currentEvent = {}, changes = {}) {
    const hasStartChange = Object.prototype.hasOwnProperty.call(changes || {}, "startTime");
    const hasEndChange = Object.prototype.hasOwnProperty.call(changes || {}, "endTime");
    const nextStart = hasStartChange ? changes.startTime : readScheduleStartTime(currentEvent);
    const nextEnd = hasEndChange ? changes.endTime : readScheduleEndTime(currentEvent);
    if (!nextStart || !nextEnd) return true;
    return isValidScheduleTimeRange(nextStart, nextEnd);
}

function defaultIdFactory() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function buildScheduleEventRow({
    familyId,
    childUserId,
    title,
    date,
    startTime,
    endTime = null,
    category = "other",
    emoji = "📌",
    color = "#EC4899",
    bg = "#FCE7F3",
    memo = "AI 친구가 추가한 일정",
    idFactory = defaultIdFactory,
} = {}) {
    const cleanTitle = String(title || "").trim();
    if (!familyId) throw new Error("familyId required");
    if (!childUserId) throw new Error("childUserId required");
    if (!cleanTitle) throw new Error("title required");
    if (!isValidScheduleTime(startTime)) throw new Error("startTime required");
    if (endTime && !isValidScheduleTime(endTime)) throw new Error("endTime invalid");
    if (endTime && !isValidScheduleTimeRange(startTime, endTime)) {
        throw new Error("endTime must be after startTime");
    }

    return {
        id: idFactory(),
        family_id: familyId,
        created_by: childUserId,
        date_key: toAppDateKey(date),
        title: cleanTitle,
        time: startTime,
        end_time: endTime || null,
        category,
        emoji,
        color,
        bg,
        memo,
        location: null,
        notif_override: null,
        is_family_event: false,
    };
}

import type { ParsedScheduleEvent } from "../lib/api/endpoints/ai";
import type { SaveEventInput } from "../lib/api/endpoints/schedule";
import { dateToDateKey } from "./dateKey.ts";
import type { SupportedLocale } from "../i18n/locale.ts";
import { formatCalendarDay } from "../i18n/format.ts";

const CATEGORY_EMOJI: Readonly<Record<string, string>> = {
  school: "📚",
  sports: "⚽",
  hobby: "🎨",
  family: "👨‍👩‍👧",
  friend: "👫",
  other: "📌",
};
const ALLOWED_CATEGORIES = new Set(Object.keys(CATEGORY_EMOJI));

export interface AiScheduleDraft {
  id: string;
  title: string;
  dateKey: string;
  dateLabel: string;
  time: string | null;
  timeLabel: string;
  category: string;
  memo: string;
}

export interface AiScheduleDraftError {
  code: "invalid_title" | "invalid_date" | "invalid_time";
  title: string;
}

export interface AiScheduleDraftResult {
  drafts: AiScheduleDraft[];
  error: AiScheduleDraftError | null;
}

interface NormalizedDraftFields {
  title: string;
  date: Date;
  time: string | null;
  category: string;
  memo: string;
}

function normalizeDate(
  event: ParsedScheduleEvent,
  currentDate: { year: number; month: number; day: number },
): Date | null {
  const year = event.year ?? currentDate.year;
  const month = event.month ?? currentDate.month;
  const day = event.day ?? currentDate.day;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
  return date;
}

function normalizeTime(raw: ParsedScheduleEvent["time"]): string | null | undefined {
  if (raw == null) return null;
  if (typeof raw !== "string") return undefined;
  const clean = raw.trim();
  if (!clean || clean.toLowerCase() === "null") return null;

  const match = /^(\d{1,2}):(\d{2})$/.exec(clean);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeTitle(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

function normalizeCategory(raw: unknown): string {
  if (typeof raw !== "string") return "other";
  const category = raw.trim();
  return ALLOWED_CATEGORIES.has(category) ? category : "other";
}

function normalizeMemo(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const memo = raw.trim();
  return memo && memo.toLowerCase() !== "null" ? memo : "";
}

export function buildAiScheduleDrafts(
  events: readonly ParsedScheduleEvent[],
  currentDate: { year: number; month: number; day: number },
  createId: () => string,
  locale: SupportedLocale,
): AiScheduleDraftResult {
  const normalized: NormalizedDraftFields[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event) continue;
    const title = normalizeTitle(event.title);
    if (!title) {
      return {
        drafts: [],
        error: { code: "invalid_title", title: `일정 ${index + 1}` },
      };
    }
    const date = normalizeDate(event, currentDate);
    if (!date) {
      return {
        drafts: [],
        error: { code: "invalid_date", title },
      };
    }
    const time = normalizeTime(event.time);
    if (time === undefined) {
      return {
        drafts: [],
        error: { code: "invalid_time", title },
      };
    }
    normalized.push({
      title,
      date,
      time,
      category: normalizeCategory(event.category),
      memo: normalizeMemo(event.memo),
    });
  }

  return {
    drafts: normalized.map((event) => ({
      id: createId(),
      title: event.title,
      dateKey: dateToDateKey(event.date),
      dateLabel: formatCalendarDay(
        Date.UTC(event.date.getFullYear(), event.date.getMonth(), event.date.getDate(), 12),
        { locale, timeZone: "UTC", weekday: "short" },
      ),
      time: event.time,
      timeLabel: event.time ?? "시간 미정",
      category: event.category,
      memo: event.memo,
    })),
    error: null,
  };
}

export function buildAiScheduleSaveInputs(
  drafts: readonly AiScheduleDraft[],
  familyId: string,
  childMemberId: string,
): SaveEventInput[] {
  return drafts.map((draft) => ({
    event: {
      id: draft.id,
      family_id: familyId,
      date_key: draft.dateKey,
      title: draft.title,
      time: draft.time,
      category: draft.category,
      emoji: CATEGORY_EMOJI[draft.category] ?? CATEGORY_EMOJI.other,
      memo: draft.memo,
    },
    childIds: [childMemberId],
    familyAll: false,
    expectedUpdatedAt: null,
  }));
}

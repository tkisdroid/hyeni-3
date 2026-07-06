/**
 * 일정 이벤트 → 화면 뷰모델(순수).
 * 실 이벤트의 category 로 색/이모지를 파생(hyeni-1 CSS 변수는 hyeni-3에 없으므로 재매핑),
 * time("HH:MM") → 한국어 라벨, 진행 상태 태그 계산.
 */
import type { CalendarEvent } from "@/lib/api/endpoints/schedule";
import { parseAppDateKey } from "./dateKey";

interface CategoryStyle {
  color: string;
  soft: string;
  emoji: string;
}

const CATEGORY_STYLE: Record<string, CategoryStyle> = {
  school: { color: "#2E86C1", soft: "#E6F2FB", emoji: "📚" },
  sports: { color: "#F26B3F", soft: "#FFEEE3", emoji: "⚽" },
  hobby: { color: "#E08A1E", soft: "#FFF3D6", emoji: "🎨" },
  family: { color: "var(--hy-accent)", soft: "var(--hy-accent-soft)", emoji: "👨‍👩‍👧" },
  friend: { color: "#31C48D", soft: "#E7F8F0", emoji: "👫" },
  other: { color: "#7C5CE1", soft: "#F1ECFF", emoji: "🌟" },
};

function styleFor(category: string): CategoryStyle {
  return CATEGORY_STYLE[category] ?? CATEGORY_STYLE.other;
}

/** "17:30" → "오후 5:30". 빈 값이면 "하루 종일". */
export function formatTimeLabel(time: string | null | undefined): string {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return "하루 종일";
  const [h, m] = time.split(":").map(Number);
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${String(m).padStart(2, "0")}`;
}

function timeToMinutes(time: string | null | undefined): number | null {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export type ScheduleTagKind = "예정" | "진행 중" | "다녀옴";

interface TagStyle {
  tag: ScheduleTagKind;
  tagText: string;
  tagBg: string;
}

const TAG_STYLES: Record<ScheduleTagKind, TagStyle> = {
  예정: { tag: "예정", tagText: "var(--hy-accent-text)", tagBg: "var(--hy-accent-soft)" },
  "진행 중": { tag: "진행 중", tagText: "#087653", tagBg: "#E7F8F0" },
  다녀옴: { tag: "다녀옴", tagText: "#8B7E84", tagBg: "#F2EEF0" },
};

// 이벤트 날짜/시간 vs now → 진행 상태.
function computeTag(event: CalendarEvent, now: Date): TagStyle {
  const date = parseAppDateKey(event.date_key);
  if (!date) return TAG_STYLES.예정;
  const startMin = timeToMinutes(event.time);
  const endMin = timeToMinutes(event.end_time) ?? (startMin != null ? startMin + 60 : null);
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const evMidnight = date.getTime();
  if (evMidnight < todayMidnight) return TAG_STYLES.다녀옴;
  if (evMidnight > todayMidnight) return TAG_STYLES.예정;
  // 오늘
  if (startMin == null) return TAG_STYLES.예정;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (endMin != null && nowMin >= endMin) return TAG_STYLES.다녀옴;
  if (nowMin >= startMin) return TAG_STYLES["진행 중"];
  return TAG_STYLES.예정;
}

export interface CalEventView {
  id: string;
  color: string;
  soft: string;
  emoji: string;
  time: string;
  title: string;
  place: string;
  tag: ScheduleTagKind;
  tagText: string;
  tagBg: string;
}

export function eventToView(event: CalendarEvent, now: Date): CalEventView {
  const style = styleFor(event.category);
  const tag = computeTag(event, now);
  return {
    id: event.id,
    color: style.color,
    soft: style.soft,
    emoji: event.emoji || style.emoji,
    time: formatTimeLabel(event.time),
    title: event.title || "일정",
    place: event.location?.address ?? "",
    tag: tag.tag,
    tagText: tag.tagText,
    tagBg: tag.tagBg,
  };
}

/** 이벤트 배열 → date_key 별 뷰 목록(각 날짜 내부는 시간순). */
export function groupEventsByDateKey(events: CalendarEvent[], now: Date): Record<string, CalEventView[]> {
  const byKey: Record<string, CalendarEvent[]> = {};
  for (const ev of events) {
    if (!ev?.date_key) continue;
    (byKey[ev.date_key] ??= []).push(ev);
  }
  const out: Record<string, CalEventView[]> = {};
  for (const [key, list] of Object.entries(byKey)) {
    out[key] = list
      .slice()
      .sort((a, b) => (timeToMinutes(a.time) ?? 1e9) - (timeToMinutes(b.time) ?? 1e9))
      .map((ev) => eventToView(ev, now));
  }
  return out;
}

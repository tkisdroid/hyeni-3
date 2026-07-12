/**
 * 일정 이벤트 → 화면 뷰모델(순수).
 * 실 이벤트의 category 로 색/이모지를 파생(hyeni-1 CSS 변수는 hyeni-3에 없으므로 재매핑),
 * time("HH:MM") → 한국어 라벨, 진행 상태 태그 계산.
 */
import type { CalendarEvent } from "@/lib/api/endpoints/schedule";
import type { SavedPlace } from "@/lib/api/endpoints/location";
import { resolveEventPlaceLabel } from "./eventPlaceLabel";
import { resolveEventVisualAsset } from "./placeVisual.ts";
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

export type ScheduleTagKind = "예정" | "진행 중" | "다녀옴" | "확인 필요";

/** 시간상 지나간 일정 태그 집합 — "다음 일정" 탐색 등에서 제외할 때 사용. */
export const PAST_TAGS: ReadonlySet<ScheduleTagKind> = new Set(["다녀옴", "확인 필요"]);

interface TagStyle {
  tag: ScheduleTagKind;
  tagText: string;
  tagBg: string;
}

const TAG_STYLES: Record<ScheduleTagKind, TagStyle> = {
  예정: { tag: "예정", tagText: "var(--hy-accent-text)", tagBg: "var(--hy-accent-soft)" },
  "진행 중": { tag: "진행 중", tagText: "#087653", tagBg: "#E7F8F0" },
  다녀옴: { tag: "다녀옴", tagText: "#8B7E84", tagBg: "#F2EEF0" },
  // 시간은 지났지만 위치 이력으로 방문이 확인되지 않음(앰버=주의 신호색).
  "확인 필요": { tag: "확인 필요", tagText: "#9A6A00", tagBg: "#FFF3D6" },
};

/** 이벤트별 방문 판정(transform/visitVerify) — "다녀옴"을 위치로 확정/보류할 때 주입. */
export type VisitMap = ReadonlyMap<string, "visited" | "unverified">;

// 이벤트 날짜/시간 vs now → 진행 상태. visitMap 이 있으면 시간상 "다녀옴"을
// 위치 검증 결과로 확정(visited=다녀옴 / unverified=확인 필요). 장소가 아예 없어
// 맵에 없는 일정만 기존 시간 기반 "다녀옴"을 유지한다.
function computeTag(event: CalendarEvent, now: Date, visitMap?: VisitMap): TagStyle {
  const donePast = () => {
    const verdict = visitMap?.get(event.id);
    if (verdict === "unverified") return TAG_STYLES["확인 필요"];
    return TAG_STYLES.다녀옴;
  };
  const date = parseAppDateKey(event.date_key);
  if (!date) return TAG_STYLES.예정;
  const startMin = timeToMinutes(event.time);
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const evMidnight = date.getTime();
  if (startMin == null) {
    if (evMidnight < todayMidnight) return donePast();
    return TAG_STYLES.예정;
  }

  const endMinRaw = timeToMinutes(event.end_time) ?? startMin + 60;
  const endMin = endMinRaw <= startMin ? endMinRaw + 24 * 60 : endMinRaw;
  const startAt = evMidnight + startMin * 60_000;
  const endAt = evMidnight + endMin * 60_000;
  const nowAt = now.getTime();
  if (nowAt >= endAt) return donePast();
  if (nowAt >= startAt) return TAG_STYLES["진행 중"];
  return TAG_STYLES.예정;
}

export interface CalEventView {
  id: string;
  color: string;
  soft: string;
  emoji: string;
  /** 3D 아이콘 에셋 경로 — 장소관리와 같은 키워드 출처(태권도 일정=도복 캐릭터). */
  icon: string;
  time: string;
  title: string;
  place: string;
  tag: ScheduleTagKind;
  tagText: string;
  tagBg: string;
}

export function eventToView(
  event: CalendarEvent,
  now: Date,
  visitMap?: VisitMap,
  places?: readonly SavedPlace[],
): CalEventView {
  const style = styleFor(event.category);
  const tag = computeTag(event, now, visitMap);
  return {
    id: event.id,
    color: style.color,
    soft: style.soft,
    emoji: event.emoji || style.emoji,
    icon: resolveEventVisualAsset(event.title, event.category),
    time: formatTimeLabel(event.time),
    title: event.title || "일정",
    place: resolveEventPlaceLabel(event.location, places),
    tag: tag.tag,
    tagText: tag.tagText,
    tagBg: tag.tagBg,
  };
}

/** 이벤트 배열 → date_key 별 뷰 목록(각 날짜 내부는 시간순). */
export function groupEventsByDateKey(
  events: CalendarEvent[],
  now: Date,
  visitMap?: VisitMap,
  places?: readonly SavedPlace[],
): Record<string, CalEventView[]> {
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
      .map((ev) => eventToView(ev, now, visitMap, places));
  }
  return out;
}

/**
 * 일정 이벤트 → 화면 뷰모델(순수).
 * 실 이벤트의 category 로 색/이모지를 파생(hyeni-1 CSS 변수는 hyeni-3에 없으므로 재매핑),
 * time("HH:MM") → 한국어 라벨, 진행 상태 태그 계산.
 */
import type { CalendarEvent } from "@/lib/api/endpoints/schedule";
import type { SavedPlace } from "@/lib/api/endpoints/location";
import { resolveEventPlaceLabel } from "./eventPlaceLabel.ts";
import { resolveEventVisualAsset } from "./placeVisual.ts";
import {
  dateKeyMinuteInTimeZone,
  dateToDateKeyInTimeZone,
  parseAppDateKey,
} from "./dateKey.ts";
import type { SupportedLocale } from "../i18n/locale.ts";
import { formatDateTime } from "../i18n/format.ts";
import type { IntlShape } from "react-intl";
import { withDefaultIntl } from "../i18n/defaultIntl.ts";

interface CategoryStyle {
  color: string;
  soft: string;
  emoji: string;
}

// color 는 soft 채움 위 라벨로 쓰이므로 중간 톤이 아니라 대비를 맞춘 -text 토큰을 쓴다
// (중간 톤은 soft 위에서 3.4~4.0:1 이었다). 값 정본은 tokens.css 의 --cat-* 이다.
const CATEGORY_STYLE: Record<string, CategoryStyle> = {
  school: { color: "var(--cat-school-text)", soft: "var(--cat-school-soft)", emoji: "📚" },
  sports: { color: "var(--cat-sports-text)", soft: "var(--cat-sports-soft)", emoji: "⚽" },
  hobby: { color: "var(--cat-hobby-text)", soft: "var(--cat-hobby-soft)", emoji: "🎨" },
  family: { color: "var(--hy-accent-text)", soft: "var(--hy-accent-soft)", emoji: "👨‍👩‍👧" },
  friend: { color: "var(--cat-friend-text)", soft: "var(--cat-friend-soft)", emoji: "👫" },
  other: { color: "var(--cat-other-text)", soft: "var(--cat-other-soft)", emoji: "🌟" },
};

function styleFor(category: string): CategoryStyle {
  return CATEGORY_STYLE[category] ?? CATEGORY_STYLE.other;
}

/** "17:30" → "오후 5:30". 빈 값이면 "하루 종일". */
export function formatTimeLabel(
  time: string | null | undefined,
  locale: SupportedLocale,
  providedIntl?: IntlShape,
): string {
  const intl = withDefaultIntl(providedIntl);
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return intl.formatMessage({ id: "parent.schedule.allDay" });
  const [h, m] = time.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return intl.formatMessage({ id: "parent.schedule.allDay" });
  }
  // 일정 time은 절대시각이 아닌 wall-clock 값이므로 UTC 합성 시각으로 표시만 지역화한다.
  return formatDateTime(Date.UTC(2026, 0, 1, h, m), {
    locale,
    timeZone: "UTC",
    timeStyle: "short",
  });
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

// 태그 색은 전부 토큰이다 — 하드코딩 중간 톤(#8B7E84 on #F2EEF0 = 3.37:1)이
// "다녀옴" 태그를 읽기 어렵게 만들었다.
const TAG_STYLES: Record<ScheduleTagKind, TagStyle> = {
  예정: { tag: "예정", tagText: "var(--hy-accent-text)", tagBg: "var(--hy-accent-soft)" },
  "진행 중": { tag: "진행 중", tagText: "var(--mint-text)", tagBg: "var(--mint-soft)" },
  다녀옴: { tag: "다녀옴", tagText: "var(--fg-tertiary)", tagBg: "var(--bg-chip-idle)" },
  // 시간은 지났지만 위치 이력으로 방문이 확인되지 않음(앰버=주의 신호색).
  "확인 필요": { tag: "확인 필요", tagText: "var(--gold-text)", tagBg: "var(--cream-soft)" },
};

/** 이벤트별 방문 판정(transform/visitVerify) — "다녀옴"을 위치로 확정/보류할 때 주입. */
export type VisitMap = ReadonlyMap<string, "visited" | "unverified">;

// 이벤트 날짜/시간 vs now → 진행 상태. 방문 검증을 하는 화면(visitMap 주입)에서는
// **위치로 확인된 일정만** "다녀옴"이고 나머지는 "확인 필요"다. 장소를 지정하지 않은 일정도
// 다녀왔는지 확인할 방법이 없으므로 다녀온 것처럼 단정하지 않는다(2026-08-18 TK 제보).
// visitMap 을 주지 않는 화면(아이 홈·리포트)은 기존 시간 기반 표시를 유지한다.
function computeTag(
  event: CalendarEvent,
  now: Date,
  timeZone: string,
  visitMap?: VisitMap,
): TagStyle {
  const donePast = () => {
    if (!visitMap) return TAG_STYLES.다녀옴;
    return visitMap.get(event.id) === "visited" ? TAG_STYLES.다녀옴 : TAG_STYLES["확인 필요"];
  };
  const date = parseAppDateKey(event.date_key);
  if (!date) return TAG_STYLES.예정;
  const startMin = timeToMinutes(event.time);
  const today = parseAppDateKey(dateToDateKeyInTimeZone(now, timeZone));
  if (!today) return TAG_STYLES.예정;
  if (startMin == null) {
    if (date.getTime() < today.getTime()) return donePast();
    return TAG_STYLES.예정;
  }

  const endMinRaw = timeToMinutes(event.end_time) ?? startMin + 60;
  const endMin = endMinRaw <= startMin ? endMinRaw + 24 * 60 : endMinRaw;
  const startAt = dateKeyMinuteInTimeZone(event.date_key, startMin, timeZone)?.getTime();
  const endAt = dateKeyMinuteInTimeZone(event.date_key, endMin, timeZone)?.getTime();
  if (startAt == null || endAt == null) return TAG_STYLES.예정;
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
  tagLabel: string;
  tagText: string;
  tagBg: string;
}

export function eventToView(
  event: CalendarEvent,
  now: Date,
  locale: SupportedLocale,
  timeZone: string,
  visitMap?: VisitMap,
  places?: readonly SavedPlace[],
  providedIntl?: IntlShape,
): CalEventView {
  const intl = withDefaultIntl(providedIntl);
  const style = styleFor(event.category);
  const tag = computeTag(event, now, timeZone, visitMap);
  return {
    id: event.id,
    color: style.color,
    soft: style.soft,
    emoji: event.emoji || style.emoji,
    icon: resolveEventVisualAsset(event.title, event.category),
    time: formatTimeLabel(event.time, locale, intl),
    title: event.title || intl.formatMessage({ id: "parent.schedule.event" }),
    place: resolveEventPlaceLabel(event.location, places),
    tag: tag.tag,
    tagLabel: intl.formatMessage({ id: `parent.schedule.tag.${tag.tag === "진행 중" ? "ongoing" : tag.tag === "다녀옴" ? "visited" : tag.tag === "확인 필요" ? "verify" : "upcoming"}` }),
    tagText: tag.tagText,
    tagBg: tag.tagBg,
  };
}

/** 이벤트 배열 → date_key 별 뷰 목록(각 날짜 내부는 시간순). */
export function groupEventsByDateKey(
  events: CalendarEvent[],
  now: Date,
  locale: SupportedLocale,
  timeZone: string,
  visitMap?: VisitMap,
  places?: readonly SavedPlace[],
  providedIntl?: IntlShape,
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
      .map((ev) => eventToView(ev, now, locale, timeZone, visitMap, places, providedIntl));
  }
  return out;
}

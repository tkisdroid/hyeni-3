/**
 * 아이 홈 "오늘 모험 지도" — 오늘 일정을 지도 위 노드로 배치한다.
 *
 * 시안(아이모드 리디자인 2a)은 390×486 프레임에 노드 4개를 고정 좌표로 두고 곡선 길로 잇는다.
 * 실제 일정에는 지도 좌표가 없을 수 있으므로(가짜 좌표 금지) **시간 순서를 따라 정해진 슬롯에 배치**한다.
 * 즉 이 지도는 지리적 지도가 아니라 "하루의 흐름"을 나타내는 여정 그림이다.
 *
 * 일정이 4개를 넘으면 다음 일정을 반드시 포함하도록 창을 잡는다(아이가 볼 이유가 있는 구간).
 */
import type { SupportedLocale } from "../i18n/locale.ts";
import { formatDateTime, formatRelativeMinutes } from "../i18n/format.ts";
import type { IntlShape } from "react-intl";
import { withDefaultIntl } from "../i18n/defaultIntl.ts";

export interface AdventureEventInput {
  id: string;
  title: string;
  /** 3D 아이콘 에셋 경로(resolveEventVisualAsset 결과). */
  icon: string;
  /** "HH:MM" 을 분으로 환산. 시간 없는 일정은 null. */
  startMinutes: number | null;
  /** 이미 다녀온 일정(PAST_TAGS). */
  isPast: boolean;
}

export type AdventureNodeState = "done" | "next" | "todo";

export interface AdventureNode {
  id: string;
  icon: string;
  title: string;
  /** 노드 아래 pill 문구 — 다녀온 일정은 "학교 ✓", 나머지는 "태권도 4:00". */
  pill: string;
  state: AdventureNodeState;
  /** 지도 폭 대비 중심 x(%) — 시안의 390px 기준 좌표를 비율로 환산. */
  leftPct: number;
  /** 지도 상단에서의 y(px) — 지도 높이는 고정(486px). */
  top: number;
}

export interface AdventureMap {
  nodes: AdventureNode[];
  next: AdventureEventInput | null;
  /** 혜니 말풍선 문구(반말). */
  bubble: string;
}

export const ADVENTURE_MAP_HEIGHT = 486;
export const MAX_ADVENTURE_NODES = 4;

/** 시안 좌표(left px, top px) → 노드 중심 기준 비율. 노드 지름 58px. */
export const ADVENTURE_SLOTS: ReadonlyArray<{ leftPct: number; top: number }> = [
  { leftPct: 74.9, top: 49 },
  { leftPct: 32.3, top: 143 },
  { leftPct: 64.6, top: 277 },
  { leftPct: 32.8, top: 399 },
];

// 숫자로 끝나는 이름은 읽는 소리로 판정한다(영·일·삼·육·칠·팔은 받침이 있다) — "수업 7" → "수업 7이야".
const DIGIT_HAS_FINAL = new Set(["0", "1", "3", "6", "7", "8"]);

/** 받침이 있으면 true — "태권도야" vs "수영이야" 조사 처리. */
export function hasJongseong(word: string): boolean {
  const last = word.trim().replace(/[\s)\]}"'.,!?~]+$/u, "").slice(-1);
  if (!last) return false;
  if (/[0-9]/.test(last)) return DIGIT_HAS_FINAL.has(last);
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

/** 분 → "4:00" (지도 pill 용 짧은 표기). */
export function compactTime(startMinutes: number | null, locale: SupportedLocale): string {
  if (startMinutes == null) return "";
  const h24 = Math.floor(startMinutes / 60) % 24;
  const m = startMinutes % 60;
  // 오전/오후를 빼면 아침 9시와 밤 9시가 같은 "9:00" 이 된다(앱 공통 규약 = scheduleView.formatTimeLabel).
  return formatDateTime(Date.UTC(2026, 0, 1, h24, m), {
    locale,
    timeZone: "UTC",
    timeStyle: "short",
  });
}

/** "HH:MM" → 분. 형식이 아니면 null. */
export function timeLabelToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 4개를 넘는 일정에서 다음 일정을 포함하는 연속 구간을 고른다. */
export function pickAdventureWindow(
  events: readonly AdventureEventInput[],
  maxNodes = MAX_ADVENTURE_NODES,
): AdventureEventInput[] {
  if (events.length <= maxNodes) return [...events];
  const nextIdx = events.findIndex((e) => !e.isPast);
  // 다음 일정이 없으면(전부 다녀옴) 마지막 구간을 보여준다.
  const anchor = nextIdx < 0 ? events.length - 1 : nextIdx;
  const start = Math.min(Math.max(anchor - 2, 0), events.length - maxNodes);
  return events.slice(start, start + maxNodes);
}

function bubbleFor(
  next: AdventureEventInput | null,
  nowMinutes: number,
  locale: SupportedLocale,
  intl: IntlShape,
): string {
  if (!next) return intl.formatMessage({ id: "shared.adventure.complete" });
  const final = hasJongseong(next.title);
  if (next.startMinutes == null) return intl.formatMessage({ id: final ? "shared.adventure.next.final" : "shared.adventure.next.vowel" }, { title: next.title });
  const left = next.startMinutes - nowMinutes;
  if (left <= 0) return intl.formatMessage({ id: "shared.adventure.now" }, { title: next.title });
  // 1시간이 넘으면 "112분 후"처럼 큰 분 단위는 아이가 읽기 어렵다 — 시각("오전 11:30")으로 말한다.
  if (left <= 60) {
    return intl.formatMessage({ id: final ? "shared.adventure.soon.final" : "shared.adventure.soon.vowel" }, { relativeTime: formatRelativeMinutes(left, "future", locale), title: next.title });
  }
  return intl.formatMessage({ id: final ? "shared.adventure.later.final" : "shared.adventure.later.vowel" }, { time: compactTime(next.startMinutes, locale), title: next.title });
}

/**
 * 노드 라벨(pill)은 최대 두 줄까지 접히고, 그보다 긴 제목만 줄인다.
 * 예전에는 한 줄 고정이라 긴 제목이 **시간을 먹어치웠다**("가족 저녁 오후 8:…").
 */
function clampNodeTitle(title: string, max = 8): string {
  const text = String(title ?? "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

/**
 * 오늘 일정(시간순) → 지도 모델.
 * @param events 오늘 일정. 시간순 정렬 전제(groupEventsByDateKey 가 정렬해 준다).
 * @param nowMinutes 지금 시각(자정 기준 분).
 */
export function buildAdventureMap(
  events: readonly AdventureEventInput[],
  nowMinutes: number,
  locale: SupportedLocale,
  providedIntl?: IntlShape,
): AdventureMap {
  const intl = withDefaultIntl(providedIntl);
  const next = events.find((e) => !e.isPast) ?? null;
  const window = pickAdventureWindow(events);
  const nodes = window.map((e, i) => {
    const state: AdventureNodeState = e.isPast ? "done" : e.id === next?.id ? "next" : "todo";
    const slot = ADVENTURE_SLOTS[i] ?? ADVENTURE_SLOTS[ADVENTURE_SLOTS.length - 1];
    const time = compactTime(e.startMinutes, locale);
    const shortTitle = clampNodeTitle(e.title);
    return {
      id: e.id,
      icon: e.icon,
      title: e.title,
      pill: state === "done" ? `${shortTitle} ✓` : time ? `${shortTitle} ${time}` : shortTitle,
      state,
      leftPct: slot.leftPct,
      top: slot.top,
    };
  });
  return { nodes, next, bubble: bubbleFor(next, nowMinutes, locale, intl) };
}

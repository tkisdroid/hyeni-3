import type { IntlShape } from "react-intl";
import type { MessageId } from "../i18n/generated/messageIds.ts";
import { withDefaultIntl } from "../i18n/defaultIntl.ts";

/**
 * 스티커북 — 칭찬 스티커 12칸 도감.
 *
 * 서버 `stickers` 테이블에는 보낸 사람도, 메시지도 없다(컬럼: id,user_id,family_id,event_id,date_key,
 * sticker_type,emoji,title,earned_at). 그래서 시안의 "엄마가 오늘 보냈어 / 태권도 가방을 스스로 챙겼구나!"
 * 같은 문장은 **지어내지 않는다**. 대신 확실히 아는 사실만 쓴다:
 *   - sticker_type='praise' 는 서버 규칙상 부모만 보낼 수 있다 → "부모님이 보내준 칭찬이야"
 *   - 'early'/'on_time' 은 아이가 제때 도착해 스스로 받은 것 → "일찍 도착해서 받은 스티커야"
 *   - 받은 시각(earned_at)으로 "오늘/어제/N일 전"
 *
 * NEW 배지: 최근 7일 안에 받았고 아직 열어보지 않은 스티커. "열어봤다"는 기기 로컬에만 남는다.
 */
import type { SupportedLocale } from "../i18n/locale.ts";
import { formatRelativeTime } from "../i18n/format.ts";
import { calendarDayDifferenceInTimeZone, dateToDateKeyInTimeZone } from "./dateKey.ts";

/** 스티커 전송 payload의 date_key를 명시한 가족 시간대에서 계산한다. */
export function stickerSendDateKey(now: Date, timeZone: string): string {
  return dateToDateKeyInTimeZone(now, timeZone);
}

export interface StickerCatalogEntry {
  key: string;
  img: string;
  label: string;
  /** 전송 화면이 저장하는 종류 식별용 이모지. 사용자 한마디가 title에 저장돼도 같은 칸을 찾는다. */
  emoji: string;
  /** 서버 title 매칭 후보(공백·느낌표 제거 후 비교). */
  titles: readonly string[];
}

/** 시안 BOOK 12종과 1:1. 순서도 시안과 같다. */
export const STICKER_CATALOG: readonly StickerCatalogEntry[] = [
  { key: "best", img: "sticker/best.webp", label: "최고예요", emoji: "🏆", titles: ["최고", "최고예요"] },
  { key: "love", img: "sticker/love.webp", label: "사랑해요", emoji: "💗", titles: ["사랑해요", "사랑해", "사랑둥이"] },
  { key: "brave", img: "sticker/brave.webp", label: "용감해요", emoji: "🙌", titles: ["용감해요", "용감이", "도전성공"] },
  { key: "friend", img: "sticker/friend.webp", label: "사이좋아요", emoji: "💛", titles: ["사이좋게", "친구사랑", "친구배려", "사이좋아요"] },
  { key: "study", img: "sticker/study.webp", label: "공부 열심히", emoji: "📚", titles: ["공부왕", "숙제완료", "공부열심히"] },
  { key: "early", img: "sticker/early.webp", label: "일찍 준비했어요", emoji: "🌟", titles: ["일찍왔어", "일찍왕", "일찍도착", "정시도착", "일찍준비했어요"] },
  { key: "play", img: "sticker/play.webp", label: "신나게 놀았어요", emoji: "🧸", titles: ["신나게", "놀이천재", "신나게놀았어요"] },
  { key: "ready", img: "sticker/ready.webp", label: "준비 완료", emoji: "✅", titles: ["준비완료", "준비왕"] },
  { key: "self", img: "sticker/self.webp", label: "스스로 했어요", emoji: "👍", titles: ["스스로", "스스로했어요"] },
  { key: "sports", img: "sticker/sports.webp", label: "운동 짱", emoji: "🎾", titles: ["운동왕", "운동최고", "운동짱"] },
  { key: "cool", img: "sticker/cool.webp", label: "멋져요", emoji: "😎", titles: ["멋져요", "멋쟁이"] },
  { key: "rest", img: "sticker/rest.webp", label: "푹 쉬었어요", emoji: "🌙", titles: ["푹쉬어요", "푹잘자", "마음충전", "푹쉬었어요"] },
];

export const STICKER_NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** 받은 스티커 1건(서버 계약의 최소 부분집합). */
export interface ReceivedStickerLike {
  id: string;
  title: string;
  emoji?: string;
  sticker_type: string;
  earned_at: string;
}

export interface StickerSlot {
  key: string;
  img: string;
  label: string;
  got: boolean;
  /** 이 칸으로 들어온 스티커 개수. */
  count: number;
  /** 가장 최근에 받은 것(상세 모달용). */
  latestId: string | null;
  latestAt: number | null;
  latestType: string | null;
  isNew: boolean;
}

export interface StickerBookView {
  slots: StickerSlot[];
  gotCount: number;
  total: number;
  /** 진행률 0~100(정수). */
  percent: number;
  newCount: number;
}

const norm = (s: string): string => s.replace(/[!?.\s]/g, "");

/** 받은 스티커 → 도감 칸 key. 매칭 실패는 null(정직하게 도감 밖으로 둔다). */
export function matchStickerSlot(sticker: ReceivedStickerLike): string | null {
  if (sticker.sticker_type === "early" || sticker.sticker_type === "on_time") return "early";
  const t = norm(sticker.title || "");
  const hit = STICKER_CATALOG.find((c) =>
    (t && c.titles.some((k) => norm(k) === t)) || (!!sticker.emoji && c.emoji === sticker.emoji),
  );
  return hit?.key ?? null;
}

function parseTime(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function buildStickerBook(
  received: readonly ReceivedStickerLike[],
  nowMs: number,
  seenIds: ReadonlySet<string>,
): StickerBookView {
  const byKey = new Map<string, { count: number; latestId: string; latestAt: number; type: string }>();
  for (const s of received) {
    const key = matchStickerSlot(s);
    if (!key) continue;
    const at = parseTime(s.earned_at) ?? 0;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { count: 1, latestId: s.id, latestAt: at, type: s.sticker_type });
    else {
      prev.count += 1;
      if (at >= prev.latestAt) {
        prev.latestAt = at;
        prev.latestId = s.id;
        prev.type = s.sticker_type;
      }
    }
  }

  const slots = STICKER_CATALOG.map((c) => {
    const hit = byKey.get(c.key);
    const isNew =
      !!hit && !seenIds.has(hit.latestId) && nowMs - hit.latestAt <= STICKER_NEW_WINDOW_MS;
    return {
      key: c.key,
      img: c.img,
      label: c.label,
      got: !!hit,
      count: hit?.count ?? 0,
      latestId: hit?.latestId ?? null,
      latestAt: hit?.latestAt ?? null,
      latestType: hit?.type ?? null,
      isNew,
    };
  });

  const gotCount = slots.filter((s) => s.got).length;
  return {
    slots,
    gotCount,
    total: slots.length,
    percent: Math.round((gotCount / slots.length) * 100),
    newCount: slots.filter((s) => s.isNew).length,
  };
}

/** 받은 시각 → 아이 말투 상대 표현. */
export function stickerWhenLabel(
  earnedAtMs: number | null,
  nowMs: number,
  locale: SupportedLocale,
  timeZone: string,
  providedIntl?: IntlShape,
): string {
  const intl = withDefaultIntl(providedIntl);
  if (earnedAtMs == null) return "";
  const days = Math.max(0, calendarDayDifferenceInTimeZone(
    new Date(earnedAtMs),
    new Date(nowMs),
    timeZone,
  ));
  if (days <= 0) return intl.formatMessage({ id: "child.sticker.detail.receivedToday" as MessageId });
  if (days === 1) return intl.formatMessage({ id: "child.sticker.detail.receivedYesterday" as MessageId });
  if (days < 7) {
    return intl.formatMessage(
      { id: "child.sticker.detail.receivedRelative" as MessageId },
      { when: formatRelativeTime(-days, "day", locale) },
    );
  }
  if (days < 14) return intl.formatMessage({ id: "child.sticker.detail.receivedLastWeek" as MessageId });
  return intl.formatMessage(
    { id: "child.sticker.detail.receivedRelative" as MessageId },
    { when: formatRelativeTime(-Math.floor(days / 7), "week", locale) },
  );
}

/** 스티커 종류 → 확실히 아는 사실만. 보낸 사람 이름·메시지는 서버에 없으므로 지어내지 않는다. */
export function stickerOriginText(type: string | null, providedIntl?: IntlShape): string {
  const intl = withDefaultIntl(providedIntl);
  if (type === "early" || type === "on_time") {
    return intl.formatMessage({ id: "child.sticker.detail.originEarly" as MessageId });
  }
  if (type === "praise") {
    return intl.formatMessage({ id: "child.sticker.detail.originPraise" as MessageId });
  }
  return intl.formatMessage({ id: "child.sticker.detail.originDefault" as MessageId });
}

const SEEN_KEY = "hyeni-sticker-seen-v1";

export interface SeenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readSeenStickers(storage: SeenStorage, userId: string | null): Set<string> {
  if (!userId) return new Set();
  try {
    const raw = storage.getItem(`${SEEN_KEY}:${userId}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

/** 최근 60개만 보관(도감 12칸이라 넉넉). */
export function writeSeenSticker(
  storage: SeenStorage,
  userId: string | null,
  seen: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(seen);
  next.add(id);
  if (!userId) return next;
  try {
    storage.setItem(`${SEEN_KEY}:${userId}`, JSON.stringify([...next].slice(-60)));
  } catch {
    /* 저장 실패해도 화면 동작에는 영향 없음 */
  }
  return next;
}

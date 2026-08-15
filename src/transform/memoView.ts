/**
 * memo_replies → 대화 화면(MemoChat) 뷰모델 매핑(순수).
 * 도메인 데이터(content/시각/보낸이)는 실값, "내 메모 여부"는 currentUserId 로 판별.
 * 표현(아바타/색)은 화면 CSS 가 mine/peer 로 처리하므로 여기서는 다루지 않는다.
 */
import type { MemoReply } from "@/lib/api/endpoints/memo";
import type { SupportedLocale } from "../i18n/locale.ts";
import { formatDateTime, intlLocaleTag } from "../i18n/format.ts";

export interface ThreadMsg {
  id: string;
  mine: boolean; // true = 내가 보낸 메시지(우측 정렬)
  showMeta: boolean; // 좌측 아바타 노출(peer 메시지)
  senderUserId: string | null; // 발신자 auth user_id — 그룹 대화에서 실제 보낸 사람(아이1/아이2/부모) 표시용
  text: string;
  time: string; // "오전/오후 h:mm"
  /** 로컬 일자 스탬프("yyyy-mm-dd") — 날짜 구분선 렌더용. */
  dayStamp: string;
  /** 리치 메시지 종류 — content 의 [[img:]]·[[loc:]] 마커에서 파생(기본 text). */
  kind: "text" | "image" | "location";
  /** kind=image: R2 키(child-photos 버킷). 표시 시 인증 fetch 후 blob URL로 조립. */
  imagePath?: string;
  /** kind=location: 좌표 + 주소 라벨. */
  location?: { lat: number; lng: number; address: string };
}

// 리치 메시지 마커(content TEXT 재사용 — 서버 스키마 무변경):
//   사진  [[img:{familyId}/memo-....jpg]]
//   위치  [[loc:{lat},{lng}|{주소}]]
const IMG_RE = /^\[\[img:([^\]]+)\]\]$/;
const LOC_RE = /^\[\[loc:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\|([^\]]*)\]\]$/;

/** content → 리치 메시지 필드. 마커가 아니면 text 그대로. */
export function parseRichContent(content: string): Pick<ThreadMsg, "kind" | "text" | "imagePath" | "location"> {
  const raw = (content ?? "").trim();
  const img = raw.match(IMG_RE);
  if (img) return { kind: "image", text: "📷 사진", imagePath: img[1] };
  const loc = raw.match(LOC_RE);
  if (loc) {
    const lat = Number(loc[1]);
    const lng = Number(loc[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { kind: "location", text: loc[3] || "공유한 위치", location: { lat, lng, address: loc[3] || "" } };
    }
  }
  return { kind: "text", text: raw };
}

/** 위치 공유 content 인코딩. */
export function encodeLocationContent(lat: number, lng: number, address: string): string {
  return `[[loc:${lat},${lng}|${address.replace(/[\[\]|]/g, " ").trim()}]]`;
}

/** 사진 공유 content 인코딩(R2 키). */
export function encodeImageContent(path: string): string {
  return `[[img:${path}]]`;
}

/** UTC ISO created_at → 로컬 일자 스탬프("yyyy-mm-dd") — 날짜 구분선 그룹핑용. 무효 시 빈 문자열. */
export function memoDayStamp(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA-u-ca-gregory-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : "";
}

/** 일자 스탬프 → 구분선 라벨. 오늘/어제는 관용 표현, 그 외 "M월 D일 요일". */
export function formatMemoDayLabel(
  dayStamp: string,
  now: Date,
  locale: SupportedLocale,
  timeZone: string,
): string {
  if (!dayStamp) return "";
  const [y, m, d] = dayStamp.split("-").map(Number);
  if (!y || !m || !d) return "";
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const todayStamp = memoDayStamp(now.toISOString(), timeZone);
  const [todayY, todayM, todayD] = todayStamp.split("-").map(Number);
  const todayUtc = Date.UTC(todayY, todayM - 1, todayD);
  const dateUtc = Date.UTC(y, m - 1, d);
  const diffDays = Math.round((todayUtc - dateUtc) / 86_400_000);
  const weekday = new Intl.DateTimeFormat(intlLocaleTag(locale), {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
  if (diffDays === 0) return `오늘 · ${weekday}`;
  if (diffDays === 1) return `어제 · ${weekday}`;
  return new Intl.DateTimeFormat(intlLocaleTag(locale), {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
}

/** UTC ISO created_at → "오전/오후 h:mm"(로컬 시각). 무효 시 빈 문자열. */
export function formatMemoClock(
  iso: string,
  locale: SupportedLocale,
  timeZone: string,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatDateTime(d, { locale, timeZone, timeStyle: "short" });
}

// 대화는 시간순이 자연스러우므로 created_at 오름차순, 동시각은 id 로 안정 정렬.
function compareReplies(a: MemoReply, b: MemoReply): number {
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * replies → ThreadMsg[]. currentUserId 와 user_id 비교로 mine 판별,
 * peer(상대) 메시지에만 아바타(showMeta)를 노출한다. 원본은 뮤테이션하지 않는다.
 */
export function mapRepliesToThread(
  replies: MemoReply[],
  currentUserId: string | null,
  locale: SupportedLocale,
  timeZone: string,
): ThreadMsg[] {
  return [...replies].sort(compareReplies).map((r) => {
    const mine = !!currentUserId && r.user_id === currentUserId;
    const rich = parseRichContent(r.content ?? "");
    return {
      id: r.id,
      mine,
      showMeta: !mine,
      senderUserId: r.user_id ?? null,
      time: formatMemoClock(r.created_at, locale, timeZone),
      dayStamp: memoDayStamp(r.created_at, timeZone),
      ...rich,
    };
  });
}

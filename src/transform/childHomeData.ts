/**
 * 아이 홈에서 쓰는 작은 순수 계산들 — AI 남은 횟수, 길찾기 목적지, 안읽은 부모 메시지 수.
 * 컴포넌트에서 분리해 테스트로 고정한다(가짜 수치가 끼어들 자리를 없앤다).
 */
import type { SavedPlace } from "@/lib/api/endpoints/location";

/**
 * 오늘 AI 친구와 몇 번 더 얘기할 수 있는가.
 *
 * 과거 원시 사용량 화면을 위한 순수 계산이다. 현재 홈·채팅은 구매분과 부모 상한까지 반영한
 * `/api/ai/credits/public-status`의 `available_remaining`을 직접 사용한다.
 * 이 함수를 쓰는 호환 경로도 둘 중 하나라도 모르면 숫자를 지어내지 않고 null을 반환한다.
 */
export function remainingAiChats(
  dailyLimit: number | null | undefined,
  usedToday: number | null | undefined,
): number | null {
  if (typeof dailyLimit !== "number" || dailyLimit <= 0) return null;
  if (typeof usedToday !== "number" || usedToday < 0) return null;
  return Math.max(0, dailyLimit - usedToday);
}

export interface DestinationPoint {
  lat: number;
  lng: number;
}

export interface ChildDestination {
  name: string;
  point: DestinationPoint;
}

export interface EventLocationLike {
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}

const cleanName = (s: string): string => s.replace(/\s/g, "").toLowerCase();

/**
 * 길찾기 목적지 해석(가벼운 경로만).
 *   ① 일정에 좌표가 있으면 그대로
 *   ② 없으면 저장장소 이름/주소 일치로 찾는다
 * Kakao 키워드 검색까지 하는 전체 해석은 RouteView 담당 — 여기서 못 찾으면 null 을 돌려주고
 * 화면은 "지도에서 찾아보기"(RouteView 로 이동)로 정직하게 넘긴다.
 */
export function resolveChildDestination(
  event: { title?: string | null; location?: EventLocationLike | null } | null,
  places: readonly SavedPlace[] | undefined,
): ChildDestination | null {
  if (!event) return null;
  const name = (event.title || "").trim() || "다음 일정";
  const loc = event.location;
  if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
    return { name, point: { lat: loc.lat, lng: loc.lng } };
  }
  const address = (loc?.address || "").trim();
  if (!address || !places?.length) return null;
  const target = cleanName(address);
  const hit = places.find((p) => {
    const pname = cleanName(p.name || "");
    const paddr = cleanName(p.location?.address || "");
    return (pname && pname === target) || (paddr && paddr === target);
  });
  if (!hit?.location) return null;
  const { lat, lng } = hit.location;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { name: hit.name || name, point: { lat, lng } };
}

export interface MemoReplyLike {
  user_role?: string | null;
  user_id?: string | null;
  content?: string | null;
  read_by?: readonly string[] | null;
}

/** 아직 내가 읽지 않은 부모 메시지 수(대화 탭 배지). read_by 에 내 user_id 가 없으면 안읽음. */
export function unreadParentMemoCount(
  replies: readonly MemoReplyLike[] | undefined,
  myUserId: string | null,
): number {
  if (!replies?.length || !myUserId) return 0;
  return replies.filter(
    (r) => r.user_role === "parent" && !(r.read_by ?? []).includes(myUserId),
  ).length;
}

/** 부모의 가장 최근 메시지 내용(홈 타일 미리보기). 없으면 null. */
export function latestParentMemoText(
  replies: readonly MemoReplyLike[] | undefined,
  maxLength = 22,
): string | null {
  if (!replies?.length) return null;
  for (let i = replies.length - 1; i >= 0; i -= 1) {
    const r = replies[i];
    const text = (r.content ?? "").trim();
    if (r.user_role !== "parent" || !text) continue;
    // 사진·위치 마커는 미리보기에서 사람이 읽을 말로 바꾼다.
    if (/^\[\[img:/.test(text)) return "사진을 보냈어";
    if (/^\[\[loc:/.test(text)) return "위치를 보냈어";
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  }
  return null;
}

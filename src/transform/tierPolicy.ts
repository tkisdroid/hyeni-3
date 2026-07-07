/**
 * 구독 티어 정책 — 단일 소스(hyeni-1 tierPolicy.js 이관 + 사용자 확정 정책).
 *
 * 확정 정책(2026-07-05):
 *  - 아이 등록: 무료/리뷰 1명, 프리미엄 2명.
 *  - 위치 보기: 무료 = 잠금, 리뷰 = 지연 위치, 프리미엄 = 실시간.  ← 사용자 확정
 *  - 일정/장소: 1 / 3 / 무제한.
 *  - 프리미엄 전용: 실시간위치·주변소리·AI하루요약·주간리포트·학원시간표·다중위험구역·이동경로연장·다자녀.
 *  - 안전(SOS·위험구역 안전알림)은 항상 무료(티어 무관).
 *  - 가격: 프리미엄 월 2,900원(아이별 구독). 리뷰 티어는 앱 리뷰 보상(일정/장소만 3개).
 */

export const TIERS = {
  UNKNOWN: "unknown",
  FREE: "free",
  REVIEWED: "reviewed",
  PREMIUM: "premium",
} as const;
export type Tier = (typeof TIERS)[keyof typeof TIERS];

export const FEATURES = {
  REALTIME_LOCATION: "realtime_location",
  MULTI_CHILD: "multi_child",
  REMOTE_AUDIO: "remote_audio",
  AI_ANALYSIS: "ai_analysis",
  WEEKLY_REPORT: "weekly_report",
  ACADEMY_SCHEDULE: "academy_schedule",
  MULTI_GEOFENCE: "multi_geofence",
  EXTENDED_HISTORY: "extended_history",
  MULTI_SCHEDULE: "multi_schedule",
  SAVED_PLACES: "saved_places",
} as const;
export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

/** 프리미엄에서만 열리는 기능. */
const PREMIUM_FEATURES: ReadonlySet<Feature> = new Set([
  FEATURES.REALTIME_LOCATION,
  FEATURES.MULTI_CHILD,
  FEATURES.REMOTE_AUDIO,
  FEATURES.AI_ANALYSIS,
  FEATURES.WEEKLY_REPORT,
  FEATURES.ACADEMY_SCHEDULE,
  FEATURES.MULTI_GEOFENCE,
  FEATURES.EXTENDED_HISTORY,
]);

/** 리뷰 티어부터 열리는 기능(무료는 잠금, 리뷰/프리미엄은 열림). */
const REVIEW_FEATURES: ReadonlySet<Feature> = new Set([FEATURES.MULTI_SCHEDULE, FEATURES.SAVED_PLACES]);

/** 아이 등록 상한. */
const MAX_CHILDREN: Record<Tier, number> = {
  [TIERS.UNKNOWN]: 1,
  [TIERS.FREE]: 1,
  [TIERS.REVIEWED]: 1,
  [TIERS.PREMIUM]: 2,
};

/** 일정 저장 상한. */
const SCHEDULE_LIMIT: Record<Tier, number> = {
  [TIERS.UNKNOWN]: 1,
  [TIERS.FREE]: 1,
  [TIERS.REVIEWED]: 3,
  [TIERS.PREMIUM]: Infinity,
};

/** 저장 장소 상한. */
const PLACE_LIMIT: Record<Tier, number> = {
  [TIERS.UNKNOWN]: 1,
  [TIERS.FREE]: 1,
  [TIERS.REVIEWED]: 3,
  [TIERS.PREMIUM]: Infinity,
};

/** 엔타이틀먼트 상태 → 티어. ready=false면 unknown(게이트/강등 금지). */
export function tierFrom(input: { ready?: boolean; isPremium?: boolean; reviewed?: boolean }): Tier {
  if (input?.ready === false) return TIERS.UNKNOWN;
  if (input?.isPremium) return TIERS.PREMIUM;
  if (input?.reviewed) return TIERS.REVIEWED;
  return TIERS.FREE;
}

export function getTierLabel(tier: Tier): string {
  if (tier === TIERS.PREMIUM) return "프리미엄";
  if (tier === TIERS.REVIEWED) return "리뷰 혜택";
  if (tier === TIERS.UNKNOWN) return "확인 중";
  return "무료";
}

/** 아이 등록 상한. unknown/미확정이면 보수적으로 1. */
export function maxChildrenFor(tier: Tier): number {
  return MAX_CHILDREN[tier] ?? 1;
}

/** 이미 childCount 명일 때 한 명 더 추가 가능한가. */
export function canAddChild(tier: Tier, childCount: number): boolean {
  return childCount < maxChildrenFor(tier);
}

export function scheduleLimitFor(tier: Tier): number {
  return SCHEDULE_LIMIT[tier] ?? 1;
}
export function placeLimitFor(tier: Tier): number {
  return PLACE_LIMIT[tier] ?? 1;
}

/** 해당 기능을 이 티어에서 쓸 수 있는가. */
export function canUse(tier: Tier, feature: Feature): boolean {
  if (tier === TIERS.UNKNOWN) return false; // 미확정이면 잠금 표시 안 함(호출부에서 ready 확인)
  if (PREMIUM_FEATURES.has(feature)) return tier === TIERS.PREMIUM;
  if (REVIEW_FEATURES.has(feature)) return tier === TIERS.REVIEWED || tier === TIERS.PREMIUM;
  return true;
}

export type LocationMode = "locked" | "delayed" | "realtime";

/**
 * 자녀 위치 표시 모드.
 * 확정 정책: 무료 = 잠금, 리뷰 = 지연 위치, 프리미엄 = 실시간.
 * 단, SOS·위험구역 등 안전 기능은 이 값과 무관하게 항상 동작(호출부에서 별도 처리).
 * unknown(미확정)은 보수적으로 locked — 단 호출부는 ready 확인 후에만 잠금 UI 노출.
 */
export function locationModeFor(tier: Tier): LocationMode {
  if (tier === TIERS.PREMIUM) return "realtime";
  if (tier === TIERS.REVIEWED) return "delayed";
  return "locked";
}

/** 위치를 조금이라도 볼 수 있는가(리뷰=지연, 프리미엄=실시간). 무료는 false. */
export function isLocationVisible(tier: Tier): boolean {
  return locationModeFor(tier) !== "locked";
}

/** 실시간(지연 없음) 위치인가. 프리미엄만 true. */
export function isRealtimeLocation(tier: Tier): boolean {
  return tier === TIERS.PREMIUM;
}

/** 프리미엄 유도 문구(기능 잠금 시). */
export function lockMessageFor(feature: Feature): string {
  switch (feature) {
    case FEATURES.MULTI_CHILD:
      return "두 번째 아이를 추가하려면 프리미엄을 시작해 주세요";
    case FEATURES.REALTIME_LOCATION:
      return "실시간 위치는 프리미엄에서 볼 수 있어요";
    case FEATURES.REMOTE_AUDIO:
      return "주변 소리 듣기는 프리미엄 기능이에요";
    case FEATURES.AI_ANALYSIS:
      return "AI 하루 요약은 프리미엄 기능이에요";
    case FEATURES.WEEKLY_REPORT:
      return "주간 리포트는 프리미엄에서 사용할 수 있어요";
    default:
      return "프리미엄에서 열리는 기능이에요";
  }
}

/**
 * 초기 출시 구독 티어 정책의 클라이언트 단일 소스.
 *
 * 사용자에게는 Free/Premium 두 단계만 표시한다. `reviewed`는 과거에 이미 지급된
 * 스토어 방문 혜택을 무손실로 읽기 위한 내부 호환 상태이며 신규 상품이 아니다.
 * 일정·메모·스티커는 모든 티어에서 제한 없이 열리고, 준비물·숙제는 모든 티어에서
 * 아이별 하루 각각 8개다(숫자의 실행 정본은 eventSupplies.ts). SOS·긴급 안전 알림도 항상 열린다.
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
  SAFETY_INSIGHTS: "safety_insights",
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
  FEATURES.SAFETY_INSIGHTS,
  FEATURES.MULTI_GEOFENCE,
  FEATURES.EXTENDED_HISTORY,
]);

/** 새 아이 연결 상한. 기존 연결을 해제하거나 숨기는 표시 한도가 아니다. */
const MAX_CHILDREN: Record<Tier, number> = {
  [TIERS.UNKNOWN]: 1,
  [TIERS.FREE]: 1,
  [TIERS.REVIEWED]: 1,
  [TIERS.PREMIUM]: 2,
};

/** 일정 저장 상한. */
const SCHEDULE_LIMIT: Record<Tier, number> = {
  [TIERS.UNKNOWN]: Infinity,
  [TIERS.FREE]: Infinity,
  [TIERS.REVIEWED]: Infinity,
  [TIERS.PREMIUM]: Infinity,
};

/** 저장 장소 상한. */
const PLACE_LIMIT: Record<Tier, number> = {
  [TIERS.UNKNOWN]: 2,
  [TIERS.FREE]: 2,
  [TIERS.REVIEWED]: 3,
  [TIERS.PREMIUM]: Infinity,
};

const HISTORY_DAYS: Record<Tier, number> = {
  [TIERS.UNKNOWN]: 1,
  [TIERS.FREE]: 1,
  [TIERS.REVIEWED]: 1,
  [TIERS.PREMIUM]: 30,
};

const MANUAL_LOCATION_REQUEST_DAILY_LIMIT: Record<Tier, number> = {
  [TIERS.UNKNOWN]: 5,
  [TIERS.FREE]: 5,
  [TIERS.REVIEWED]: 5,
  [TIERS.PREMIUM]: Infinity,
};

const DANGER_ZONE_LIMIT: Record<Tier, number> = {
  [TIERS.UNKNOWN]: 1,
  [TIERS.FREE]: 1,
  [TIERS.REVIEWED]: 1,
  [TIERS.PREMIUM]: Infinity,
};

const FORCE_RING_DAILY_LIMIT: Record<Tier, number> = {
  [TIERS.UNKNOWN]: 1,
  [TIERS.FREE]: 1,
  [TIERS.REVIEWED]: 1,
  [TIERS.PREMIUM]: 10,
};

const AI_FRIEND_DAILY_BASE: Record<Tier, number> = {
  [TIERS.UNKNOWN]: 5,
  [TIERS.FREE]: 5,
  [TIERS.REVIEWED]: 5,
  [TIERS.PREMIUM]: 20,
};

/** 음성·텍스트·사진을 AI로 일정 후보로 정리하는 일일 상한. 직접 일정 저장 상한과는 무관하다. */
const AI_SCHEDULE_DAILY_LIMIT: Record<Tier, number> = {
  [TIERS.UNKNOWN]: 5,
  [TIERS.FREE]: 5,
  [TIERS.REVIEWED]: 5,
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
  if (tier === TIERS.UNKNOWN) return "확인 중";
  return "무료";
}

/** 새 아이 연결 상한. unknown/미확정이면 보수적으로 1. */
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
  return PLACE_LIMIT[tier] ?? 2;
}

export function historyDaysFor(tier: Tier): number {
  return HISTORY_DAYS[tier] ?? 1;
}

export function manualLocationRequestDailyLimitFor(tier: Tier): number {
  return MANUAL_LOCATION_REQUEST_DAILY_LIMIT[tier] ?? 5;
}

export function dangerZoneLimitFor(tier: Tier): number {
  return DANGER_ZONE_LIMIT[tier] ?? 1;
}

export function forceRingDailyLimitFor(tier: Tier): number {
  return FORCE_RING_DAILY_LIMIT[tier] ?? 1;
}

export function aiFriendDailyBaseFor(tier: Tier): number {
  return AI_FRIEND_DAILY_BASE[tier] ?? 5;
}

export function aiScheduleDailyLimitFor(tier: Tier): number {
  return AI_SCHEDULE_DAILY_LIMIT[tier] ?? 5;
}

/** 해당 기능을 이 티어에서 쓸 수 있는가. */
export function canUse(tier: Tier, feature: Feature): boolean {
  if (tier === TIERS.UNKNOWN) return false; // 미확정이면 잠금 표시 안 함(호출부에서 ready 확인)
  if (PREMIUM_FEATURES.has(feature)) return tier === TIERS.PREMIUM;
  return true;
}

export type LocationMode = "locked" | "standard" | "realtime";

/**
 * 자녀 위치 표시 모드.
 * 확정 정책: 무료/기존 혜택 = 최신 보고 위치, 프리미엄 = 실시간.
 * 단, SOS·위험구역 등 안전 기능은 이 값과 무관하게 항상 동작(호출부에서 별도 처리).
 * unknown(미확정)은 보수적으로 locked — 단 호출부는 ready 확인 후에만 잠금 UI 노출.
 */
export function locationModeFor(tier: Tier): LocationMode {
  if (tier === TIERS.PREMIUM) return "realtime";
  if (tier === TIERS.UNKNOWN) return "locked";
  return "standard";
}

/** 위치를 볼 수 있는가. 엔타이틀먼트 확인 실패(unknown)만 fail-closed한다. */
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

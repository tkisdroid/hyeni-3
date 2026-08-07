import type { PremiumUpsellSource } from "./premiumUpsell";

export const PREMIUM_VALUE_MOMENT_STORAGE_KEY = "hyeni:premium-value-moment:v1";

export type PremiumValueMomentSource = Extract<PremiumUpsellSource, "first_location" | "first_arrival">;

export interface PremiumValueAlert {
  id: string;
  alert_type: string;
}

export interface PremiumValueMomentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function premiumValueMomentStorageKey(familyId: string): string {
  return `${PREMIUM_VALUE_MOMENT_STORAGE_KEY}:${encodeURIComponent(familyId)}`;
}

const SUCCESSFUL_ARRIVAL_TYPES = new Set(["arrived", "place_arrived"]);

/** 최신순 부모 알림에서 이번 세션에 새로 생긴 실제 장소 도착만 선택한다. */
export function findNewSuccessfulArrival<T extends PremiumValueAlert>(
  alerts: readonly T[],
  knownIds: ReadonlySet<string>,
): T | null {
  return alerts.find((alert) => (
    alert.id.length > 0
    && !knownIds.has(alert.id)
    && SUCCESSFUL_ARRIVAL_TYPES.has(alert.alert_type)
  )) ?? null;
}

export function wasPremiumValueMomentOffered(
  storage: PremiumValueMomentStorage | null,
  familyId: string,
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(premiumValueMomentStorageKey(familyId)) === "1";
  } catch {
    return false;
  }
}

export function markPremiumValueMomentOffered(
  storage: PremiumValueMomentStorage | null,
  familyId: string,
): void {
  if (!storage) return;
  try {
    storage.setItem(premiumValueMomentStorageKey(familyId), "1");
  } catch {
    // 저장소가 막힌 환경에서도 현재 세션의 in-memory 가드는 유지한다.
  }
}

export function browserPremiumValueMomentStorage(): PremiumValueMomentStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

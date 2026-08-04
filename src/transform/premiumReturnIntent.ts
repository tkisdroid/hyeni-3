import type { PremiumUpsellSource } from "./premiumUpsell";

export interface PremiumReturnIntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PremiumReturnIntent {
  version: 1;
  source: PremiumUpsellSource;
  feature: string;
  returnTo: string;
  createdAt: number;
  draft?: unknown;
}

export interface SavePremiumReturnIntentInput {
  source: PremiumUpsellSource;
  feature: string;
  returnTo: string;
  draft?: unknown;
}

const STORAGE_KEY = "hyeni:premium-return-intent:v1";
const MAX_AGE_MS = 30 * 60_000;
const MAX_SERIALIZED_BYTES = 20_000;
const SOURCES: ReadonlySet<string> = new Set([
  "second_child",
  "saved_place",
  "danger_zone",
  "location_request",
  "location_history",
  "location_live_interval",
  "remote_ring",
  "remote_audio",
  "ai_friend_limit",
  "ai_schedule_limit",
  "ai_daily_summary",
  "weekly_report",
  "academy_schedule",
  "first_location",
  "first_arrival",
]);
const FORBIDDEN_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "purchasetoken",
  "ordertoken",
  "orderid",
  "authorization",
  "password",
  "secret",
  "__proto__",
  "prototype",
  "constructor",
]);

function validReturnPath(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith("/")
    && !value.startsWith("//")
    && !value.includes("\\")
    && value.length <= 300;
}

function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 8) return true;
  if (value == null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKey(item, depth + 1));
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (FORBIDDEN_KEYS.has(normalized)) return true;
    if (hasForbiddenKey(nested, depth + 1)) return true;
  }
  return false;
}

function serializedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function removeQuietly(storage: PremiumReturnIntentStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // sessionStorage가 차단된 환경에서는 결제 흐름 자체를 막지 않는다.
  }
}

export function savePremiumReturnIntent(
  storage: PremiumReturnIntentStorage,
  input: SavePremiumReturnIntentInput,
  now = Date.now(),
): boolean {
  if (!SOURCES.has(input.source) || !validReturnPath(input.returnTo)) return false;
  if (!input.feature.trim() || input.feature.length > 128 || !Number.isFinite(now)) return false;
  if (hasForbiddenKey(input.draft)) return false;

  const value: PremiumReturnIntent = {
    version: 1,
    source: input.source,
    feature: input.feature,
    returnTo: input.returnTo,
    createdAt: now,
    ...(input.draft === undefined ? {} : { draft: input.draft }),
  };
  try {
    const serialized = JSON.stringify(value);
    if (serializedByteLength(serialized) > MAX_SERIALIZED_BYTES) return false;
    storage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function loadPremiumReturnIntent(
  storage: PremiumReturnIntentStorage,
  now = Date.now(),
): PremiumReturnIntent | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw || serializedByteLength(raw) > MAX_SERIALIZED_BYTES) {
      if (raw) removeQuietly(storage);
      return null;
    }
    const value = JSON.parse(raw) as Partial<PremiumReturnIntent>;
    const valid = value.version === 1
      && typeof value.source === "string"
      && SOURCES.has(value.source)
      && typeof value.feature === "string"
      && value.feature.length > 0
      && value.feature.length <= 128
      && validReturnPath(value.returnTo)
      && typeof value.createdAt === "number"
      && Number.isFinite(value.createdAt)
      && value.createdAt <= now
      && now - value.createdAt <= MAX_AGE_MS
      && !hasForbiddenKey(value.draft);
    if (!valid) {
      removeQuietly(storage);
      return null;
    }
    return value as PremiumReturnIntent;
  } catch {
    removeQuietly(storage);
    return null;
  }
}

export function clearPremiumReturnIntent(storage: PremiumReturnIntentStorage): void {
  removeQuietly(storage);
}

export function browserPremiumReturnIntentStorage(): PremiumReturnIntentStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

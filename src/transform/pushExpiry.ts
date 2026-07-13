const EPOCH_MILLISECONDS_THRESHOLD = 1_000_000_000_000;

/** 서버 push data.expiresAt(ISO/epoch seconds/epoch milliseconds)를 표시 시각과 비교할 수 있게 정규화한다. */
export function parsePushExpiryMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) < EPOCH_MILLISECONDS_THRESHOLD ? value * 1_000 : value;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return Math.abs(numeric) < EPOCH_MILLISECONDS_THRESHOLD ? numeric * 1_000 : numeric;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 만료 필드가 없거나 해석 불가한 기존 push는 유지하고, 확실히 만료된 push만 폐기한다. */
export function isPushExpired(value: unknown, nowMs: number = Date.now()): boolean {
  const expiresAtMs = parsePushExpiryMs(value);
  return expiresAtMs !== null && expiresAtMs <= nowMs;
}

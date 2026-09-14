import { LEGACY_TIME_ZONE, normalizeTimeZone } from "../../shared/timeZone.ts";
export * from "../../shared/timeZone.ts";

/** 가족 조회 실패·오염을 한국 시각으로 위장하지 않는다. legacy 행의 기본값은 migration이 책임진다. */
export async function readFamilyTimeZone(db: D1Database, familyId: string): Promise<string> {
  const row = await db.prepare("SELECT time_zone FROM families WHERE id=? LIMIT 1")
    .bind(familyId).first<{ time_zone: string }>();
  if (!row) throw new Error("family_time_zone_unavailable");
  const zone = normalizeTimeZone(row.time_zone);
  if (!zone) throw new Error("family_time_zone_unavailable");
  return zone;
}

export function legacyOrValidTimeZone(value: unknown): string {
  if (value == null) return LEGACY_TIME_ZONE;
  const zone = normalizeTimeZone(value);
  if (!zone) throw new Error("invalid_time_zone");
  return zone;
}

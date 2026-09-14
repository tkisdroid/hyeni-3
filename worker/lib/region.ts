import {
  GOOGLE_MAP_RELEASE_COUNTRIES,
  resolveMapPolicy,
  type MapPolicy,
} from "../../shared/mapPolicy.ts";
import { normalizeServiceCountry } from "./studyMarket.ts";
import { legacyOrValidTimeZone } from "./timeZone.ts";

export interface FamilyRegionSnapshot {
  countryCode: string;
  timeZone: string;
  mapPolicy: MapPolicy;
}

export function normalizeFamilyCountry(value: unknown): string | null {
  return normalizeServiceCountry(value);
}

export function familyRegionSnapshot(countryCode: unknown, timeZone?: unknown): FamilyRegionSnapshot {
  const normalized = normalizeFamilyCountry(countryCode) ?? "ZZ";
  return {
    countryCode: normalized,
    timeZone: legacyOrValidTimeZone(timeZone),
    mapPolicy: resolveMapPolicy(normalized, new Set(GOOGLE_MAP_RELEASE_COUNTRIES)),
  };
}

export async function readFamilyRegion(
  db: D1Database,
  familyId: string,
): Promise<FamilyRegionSnapshot> {
  const row = await db.prepare(
    "SELECT country_code,time_zone FROM families WHERE id=? LIMIT 1",
  ).bind(familyId).first<{ country_code: string; time_zone: string }>();
  return familyRegionSnapshot(row?.country_code, row?.time_zone);
}

export async function readFamilyCountryMigrationState(
  db: D1Database,
): Promise<{ status: "pending" | "applied" }> {
  const { results } = await db.prepare("PRAGMA table_info(families)").all<{ name: string }>();
  return {
    status: (results ?? []).some((column) => column.name === "country_code")
      ? "applied"
      : "pending",
  };
}

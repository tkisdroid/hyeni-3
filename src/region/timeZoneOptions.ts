import { FAMILY_TIME_ZONES } from "../../shared/timeZones";
import { normalizeTimeZone } from "../../shared/timeZone";

export function suggestedTimeZone(): string {
  return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
}

/**
 * 시간대 선택지 라벨. IANA 이름("Africa/Abidjan")만 나열하면 보호자가 자기 시간대를 찾기 어렵다
 * (2026-09-25 브라우저 QA). 현재 언어의 시간대 이름과 도시를 함께 보여 준다. 이름을 못 얻으면 IANA 이름.
 */
export function timeZoneOptionLabel(zone: string, locale: string, now = new Date()): string {
  const city = (zone.split("/").pop() ?? zone).replaceAll("_", " ");
  try {
    const name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "longGeneric" })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value;
    return name && name !== zone ? `${name} · ${city}` : zone.replaceAll("_", " ");
  } catch {
    return zone.replaceAll("_", " ");
  }
}

/** 현재 값과 이 기기의 시간대를 맨 앞에, 나머지는 IANA 이름순으로 둔다. */
export function orderedTimeZones(value: string, suggested: string): string[] {
  const pinned = [...new Set([value, suggested].filter(Boolean))];
  const rest = [...new Set(["UTC", "Asia/Seoul", ...FAMILY_TIME_ZONES])]
    .filter((zone) => !pinned.includes(zone))
    .sort();
  return [...pinned, ...rest];
}

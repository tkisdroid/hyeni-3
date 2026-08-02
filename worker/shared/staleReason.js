// 위치 끊김 원인 판정 — pure 모듈 (Deno edge + Vitest 공용, Supabase import 없음).
//
// (staleness reliability Phase 1, 2026-06-09) 부모 끊김 알림이 "왜 끊겼는지"를
// 구분하게 한다. 실데이터(2026-06-09): 자녀가 학교/집(등록장소)에서 폰을 두고
// 정지하면 Android Doze 로 위치가 멈추는데(절전=정상), 기존 단일 메시지는
// "기기 상태를 확인해 주세요"로 불안을 키웠다. 등록장소 정지는 절전 추정으로,
// 등록장소 밖 끊김은 불안정으로, 배터리 방전 직후는 기기 꺼짐으로 분기한다.

function haversineM(la1, lo1, la2, lo2) {
  const R = 6371000, p1 = la1 * Math.PI / 180, p2 = la2 * Math.PI / 180;
  const dp = (la2 - la1) * Math.PI / 180, dl = (lo2 - lo1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 끊김 원인 분류.
 * @param {object} args
 * @param {number} args.lastLat 마지막 알려진 위도(없으면 NaN)
 * @param {number} args.lastLng 마지막 알려진 경도(없으면 NaN)
 * @param {Array<{name:string,lat:number,lng:number}>} args.registeredPlaces 등록 장소(집·학원 등)
 * @param {boolean} args.hasRecentLowBattery 최근 저배터리 알림이 있었나
 * @param {number} [args.nearRadiusM=200] 등록장소 근접 반경(m)
 * @returns {{reason:('device_off'|'power_save'|'unstable'|'unknown'), placeName:(string|null)}}
 */
export function classifyStaleReason({
  lastLat,
  lastLng,
  registeredPlaces = [],
  hasRecentLowBattery = false,
  nearRadiusM = 200,
}) {
  // 1) 배터리 방전 직후 끊김 = 기기 꺼짐(가장 확실한 "이상"). 등록장소 안이어도 우선.
  if (hasRecentLowBattery) return { reason: "device_off", placeName: null };

  const hasCoord = Number.isFinite(lastLat) && Number.isFinite(lastLng);
  if (!hasCoord) return { reason: "unknown", placeName: null };

  // 2) 마지막 위치가 등록장소 근처 = 한곳에 머묾 → 절전 추정(정상).
  let best = null, bestD = Infinity;
  for (const p of (Array.isArray(registeredPlaces) ? registeredPlaces : [])) {
    const lat = Number(p?.lat), lng = Number(p?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const d = haversineM(lastLat, lastLng, lat, lng);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best && bestD <= nearRadiusM) {
    return { reason: "power_save", placeName: String(best.name || "").trim() || null };
  }

  // 3) 좌표는 있으나 등록장소 밖 = 이동 중/모르는 곳에서 끊김 → 불안정(주의).
  return { reason: "unstable", placeName: null };
}

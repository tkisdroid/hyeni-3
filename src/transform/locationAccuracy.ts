export const MAX_LOCATION_EVIDENCE_ACCURACY_M = 75;

interface LocationEvidenceLike {
  accuracy_m?: number | string | null;
  is_estimated?: boolean | number;
}

/** 머문 곳·일정 방문·출발 시각처럼 확정 문구에 쓸 수 있는 실제 GPS 근거인지 판정한다. */
export function isReliableLocationEvidence(point: LocationEvidenceLike): boolean {
  if (point.is_estimated === true || point.is_estimated === 1) return false;
  if (point.accuracy_m == null) return false;
  const accuracyM = Number(point.accuracy_m);
  return Number.isFinite(accuracyM)
    && accuracyM >= 0
    && accuracyM <= MAX_LOCATION_EVIDENCE_ACCURACY_M;
}

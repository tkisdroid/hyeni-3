export interface LocationRoutePoint {
  lat: number;
  lng: number;
}

interface InterpolatedFillLike {
  is_estimated?: boolean | number;
}

/**
 * 네이티브가 큰 갭(>150m)을 메운 직선 보간 '채움점'인지 판정한다.
 *
 * 이동선은 전 구간 실선 하나로 그린다(2026-07-29 TK 제보 — 차량 이동 구간이 점선으로 끊겨 보였다).
 * 정직성은 선 스타일이 아니라 데이터로 지킨다: 채움점은 두 실측점 사이 직선 위의 합성점이라
 * 경로에서 제외해도 남은 실측점을 이은 선의 기하가 같고, 화면에 올리는 점 수만 크게 줄어든다
 * (실측 확인: 2026-07-29 16시대 1448점 중 1028점이 채움점).
 * 저정확도 실측점은 실제로 기록된 이동이므로 경로에서 숨기지 않는다.
 */
export function isInterpolatedFillPoint(point: InterpolatedFillLike): boolean {
  return point.is_estimated === true || point.is_estimated === 1;
}

export interface LocationRoutePoint {
  lat: number;
  lng: number;
  /** true면 두 실측점 사이를 직선 보간한 추정 채움점. */
  estimated?: boolean;
}

export interface LocationRouteSegment {
  estimated: boolean;
  points: LocationRoutePoint[];
}

/** 추정점에 닿는 간선은 점선, 실측점끼리의 간선만 실선으로 분리한다. */
export function splitLocationRouteSegments(route: LocationRoutePoint[]): LocationRouteSegment[] {
  if (route.length < 2) return [];
  const segments: LocationRouteSegment[] = [];
  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const current = route[index];
    const estimated = previous.estimated === true || current.estimated === true;
    const active = segments[segments.length - 1];
    if (!active || active.estimated !== estimated) {
      segments.push({ estimated, points: [previous, current] });
    } else {
      active.points.push(current);
    }
  }
  return segments;
}

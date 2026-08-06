export interface MapViewportPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function safePadding(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function normalizeMapViewportPadding(
  value: Partial<MapViewportPadding> | undefined,
): MapViewportPadding {
  return {
    top: safePadding(value?.top),
    right: safePadding(value?.right),
    bottom: safePadding(value?.bottom),
    left: safePadding(value?.left),
  };
}

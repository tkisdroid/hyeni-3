export interface MapViewportPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MapViewportRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface HistoryMapViewportInput {
  viewportWidth: number;
  viewportHeight: number;
  toolbarRect: MapViewportRect;
  panelRect: MapViewportRect;
  wideLayout: boolean;
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

export function deriveHistoryMapViewportPadding(
  input: HistoryMapViewportInput,
): MapViewportPadding {
  const minVisible = 96;
  const viewportWidth = safePadding(input.viewportWidth);
  const viewportHeight = safePadding(input.viewportHeight);

  if (input.wideLayout) {
    const right = 24;
    const left = Math.min(
      safePadding(input.panelRect.right + 16),
      Math.max(0, viewportWidth - minVisible - right),
    );
    return { top: 24, right, bottom: 24, left };
  }

  const top = Math.min(
    safePadding(input.toolbarRect.bottom + 16),
    Math.max(0, viewportHeight - minVisible - 24),
  );
  const bottom = Math.min(
    safePadding(viewportHeight - input.panelRect.top + 16),
    Math.max(0, viewportHeight - minVisible - top),
  );
  return { top, right: 24, bottom, left: 24 };
}

export function getMapFocusPanOffset(
  padding: Partial<MapViewportPadding> | undefined,
): { x: number; y: number } {
  const normalized = normalizeMapViewportPadding(padding);
  return {
    x: (normalized.right - normalized.left) / 2,
    y: (normalized.bottom - normalized.top) / 2,
  };
}

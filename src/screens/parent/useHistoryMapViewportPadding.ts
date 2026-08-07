import { useLayoutEffect, useState, type RefObject } from "react";
import {
  deriveHistoryMapViewportPadding,
  type MapViewportPadding,
  type MapViewportRect,
} from "@/transform/mapViewportPadding";

const MOBILE_FALLBACK: MapViewportPadding = { top: 176, right: 24, bottom: 536, left: 24 };
const WIDE_FALLBACK: MapViewportPadding = { top: 24, right: 24, bottom: 24, left: 424 };

function toViewportRect(rect: DOMRect): MapViewportRect {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  };
}

function samePadding(a: MapViewportPadding, b: MapViewportPadding): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

/**
 * 이동기록 도구막대와 패널이 실제로 차지한 영역을 재서 지도에 남은 가시 영역을 계산한다.
 * 기기 높이·가로 회전·머문 곳 상세 접힘에 따라 같은 좌표도 새 중앙으로 다시 맞출 수 있다.
 */
export function useHistoryMapViewportPadding(input: {
  enabled: boolean;
  wideLayout: boolean;
  toolbarRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
}): MapViewportPadding {
  const fallback = input.wideLayout ? WIDE_FALLBACK : MOBILE_FALLBACK;
  const [padding, setPadding] = useState<MapViewportPadding>(fallback);

  useLayoutEffect(() => {
    if (!input.enabled) {
      setPadding((current) => (samePadding(current, fallback) ? current : fallback));
      return;
    }

    const measure = () => {
      const toolbar = input.toolbarRef.current;
      const panel = input.panelRef.current;
      if (!toolbar || !panel) return;
      const next = deriveHistoryMapViewportPadding({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        toolbarRect: toViewportRect(toolbar.getBoundingClientRect()),
        panelRect: toViewportRect(panel.getBoundingClientRect()),
        wideLayout: input.wideLayout,
      });
      setPadding((current) => (samePadding(current, next) ? current : next));
    };

    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    if (observer) {
      if (input.toolbarRef.current) observer.observe(input.toolbarRef.current);
      if (input.panelRef.current) observer.observe(input.panelRef.current);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [fallback, input.enabled, input.panelRef, input.toolbarRef, input.wideLayout]);

  return padding;
}

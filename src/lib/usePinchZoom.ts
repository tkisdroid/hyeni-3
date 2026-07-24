import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface ZoomTransform {
  scale: number;
  x: number;
  y: number;
}

const IDENTITY: ZoomTransform = { scale: 1, x: 0, y: 0 };

/**
 * 이미지 확대 보기용 핀치 줌 / 더블탭 줌 / 팬.
 *
 * 컨테이너에 `handlers` 를 펼치고 안쪽 이미지에 `transform` 을 적용한다. 컨테이너에는
 * `touch-action: none` 이 필요하다 — 브라우저 기본 제스처와 경합하면 핀치가 끊긴다.
 *
 * 팬 범위는 확대된 이미지가 컨테이너 밖으로 완전히 빠져나가지 않도록 클램프한다.
 */
export function usePinchZoom(options?: {
  maxScale?: number;
  doubleTapScale?: number;
  doubleTapMs?: number;
}) {
  const maxScale = options?.maxScale ?? 4;
  const doubleTapScale = options?.doubleTapScale ?? 2.5;
  const doubleTapMs = options?.doubleTapMs ?? 300;

  const [transform, setTransform] = useState<ZoomTransform>(IDENTITY);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const lastTapRef = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const clampOffset = useCallback((next: ZoomTransform): ZoomTransform => {
    const el = containerRef.current;
    if (!el || next.scale <= 1) return { scale: next.scale, x: 0, y: 0 };
    const maxX = (el.clientWidth * (next.scale - 1)) / 2;
    const maxY = (el.clientHeight * (next.scale - 1)) / 2;
    return {
      scale: next.scale,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }, []);

  const reset = useCallback(() => {
    pointersRef.current.clear();
    pinchRef.current = null;
    panRef.current = null;
    setTransform(IDENTITY);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchRef.current = { distance: Math.hypot(b.x - a.x, b.y - a.y), scale: transform.scale };
      panRef.current = null;
      return;
    }
    if (pointers.size === 1) {
      // 더블탭 → 확대/원래대로 토글.
      const now = Date.now();
      if (now - lastTapRef.current < doubleTapMs) {
        lastTapRef.current = 0;
        setTransform((prev) => (prev.scale > 1 ? IDENTITY : { scale: doubleTapScale, x: 0, y: 0 }));
        return;
      }
      lastTapRef.current = now;
      if (transform.scale > 1) {
        panRef.current = {
          x: event.clientX,
          y: event.clientY,
          originX: transform.x,
          originY: transform.y,
        };
      }
    }
  }, [doubleTapMs, doubleTapScale, transform]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const pinch = pinchRef.current;
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (pinch.distance <= 0) return;
      const nextScale = Math.max(1, Math.min(maxScale, (distance / pinch.distance) * pinch.scale));
      setTransform((prev) => clampOffset({ ...prev, scale: nextScale }));
      return;
    }

    const pan = panRef.current;
    if (pan && pointers.size === 1) {
      setTransform((prev) => clampOffset({
        scale: prev.scale,
        x: pan.originX + (event.clientX - pan.x),
        y: pan.originY + (event.clientY - pan.y),
      }));
    }
  }, [clampOffset, maxScale]);

  const endPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchRef.current = null;
    if (pointers.size === 0) {
      panRef.current = null;
      // 원래 크기 이하로 줄이면 위치도 가운데로 되돌린다.
      setTransform((prev) => (prev.scale <= 1 ? IDENTITY : prev));
    }
  }, []);

  return {
    containerRef,
    transform,
    isZoomed: transform.scale > 1,
    reset,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
    },
  };
}

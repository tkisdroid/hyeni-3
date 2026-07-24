import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";

/**
 * 요소에 연결할 핸들러 묶음. JSX spread 는 이 저장소의 디자인 시스템 정적 분석
 * (tests/designSystemUsage)이 해석할 수 없어 금지되므로, 소비처는 prop 을 하나씩 연결한다.
 * 모두 optional 이라 "길게 누르기 대상이 아닌" 요소에는 onClick 만 담아 넘길 수 있다.
 */
export interface LongPressHandlers {
  onPointerDown?: (event: ReactPointerEvent) => void;
  onPointerMove?: (event: ReactPointerEvent) => void;
  onPointerUp?: (event: ReactPointerEvent) => void;
  onPointerCancel?: (event: ReactPointerEvent) => void;
  onPointerLeave?: (event: ReactPointerEvent) => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
  onClick?: (event: ReactMouseEvent) => void;
}

/**
 * 길게 누르기(long-press) 핸들러 바인더.
 *
 * 목록 안에서 항목마다 써야 하므로 훅 자체는 컴포넌트 최상위에서 한 번만 호출하고,
 * 반환된 `bind(payload)` 를 map 안에서 호출한다(Rules of Hooks 준수). 동시에 눌리는
 * 항목은 하나뿐이라 타이머·기준점은 ref 하나를 공유한다.
 *
 * - 이동 임계(기본 10px)를 넘으면 취소한다 — 목록 스크롤 중 오발동 방지.
 * - long-press 가 발동하면 뒤따르는 click 을 1회 삼킨다(사진 버블이 함께 열리지 않게).
 * - 데스크톱에서는 우클릭(contextmenu)도 같은 동작으로 연결하고 기본 메뉴를 막는다.
 */
export function useLongPress<T>(
  onLongPress: (payload: T) => void,
  options?: { delayMs?: number; moveTolerancePx?: number },
) {
  const delayMs = options?.delayMs ?? 500;
  const moveTolerancePx = options?.moveTolerancePx ?? 10;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  // 최신 콜백을 참조해 bind 결과가 매 렌더 바뀌지 않게 한다.
  const callbackRef = useRef(onLongPress);
  callbackRef.current = onLongPress;

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const bind = useCallback(
    (payload: T, onClick?: (event: ReactMouseEvent) => void): LongPressHandlers => ({
      onPointerDown: (event: ReactPointerEvent) => {
        // 보조 버튼(우클릭)은 contextmenu 가 처리한다.
        if (event.button !== 0 && event.pointerType === "mouse") return;
        cancel();
        firedRef.current = false;
        originRef.current = { x: event.clientX, y: event.clientY };
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          firedRef.current = true;
          callbackRef.current(payload);
        }, delayMs);
      },
      onPointerMove: (event: ReactPointerEvent) => {
        const origin = originRef.current;
        if (!origin || timerRef.current === null) return;
        const dx = event.clientX - origin.x;
        const dy = event.clientY - origin.y;
        if (Math.hypot(dx, dy) > moveTolerancePx) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (event: ReactMouseEvent) => {
        event.preventDefault();
        cancel();
        firedRef.current = true;
        callbackRef.current(payload);
      },
      onClick: (event: ReactMouseEvent) => {
        if (firedRef.current) {
          firedRef.current = false;
          return;
        }
        onClick?.(event);
      },
    }),
    [cancel, delayMs, moveTolerancePx],
  );

  return bind;
}

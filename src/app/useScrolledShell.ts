import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router";

/**
 * 셸의 스크롤 영역 하나를 맡아 두 가지를 한다.
 *
 * ① 맨 위인지 아닌지를 `data-scrolled`로 알린다.
 *    헤더 배경은 이 상태와 관계없이 투명하게 유지한다.
 *
 * ② 화면별 스크롤 위치를 기억한다(2026-08-21 TK 지시).
 *    처음 들어가는 화면은 **최상단부터** 읽을 수 있어야 하고,
 *    다시 찾은 화면은 **보던 자리로** 돌아가야 한다.
 *
 * 스크롤 상태와 위치 저장을 passive 리스너 하나로 처리한다.
 */
const SCROLLED_THRESHOLD_PX = 4;

/** 되돌아갈 자리를 다시 잡아 보는 시간. 지연 청크·쿼리로 내용이 늦게 자라기 때문이다. */
const RESTORE_WINDOW_MS = 600;

/** 기억해 둘 화면 수. 무한히 쌓이지 않게 오래된 것부터 버린다. */
const MAX_REMEMBERED = 30;

const savedPositions = new Map<string, number>();

function rememberPosition(key: string, top: number): void {
  // Map 은 삽입 순서를 지키므로 다시 넣어 '최근 사용'으로 올린다.
  savedPositions.delete(key);
  savedPositions.set(key, top);
  while (savedPositions.size > MAX_REMEMBERED) {
    const oldest = savedPositions.keys().next().value;
    if (oldest === undefined) break;
    savedPositions.delete(oldest);
  }
}

export function useScrolledShell(): (node: HTMLElement | null) => void {
  const nodeRef = useRef<HTMLElement | null>(null);
  const scrolledRef = useRef(false);
  const { pathname, search } = useLocation();
  const screenKey = `${pathname}${search}`;
  const activeScreenKeyRef = useRef(screenKey);

  /** 현재 위치를 저장하지 않고 스크롤 상태만 맞춘다. */
  const syncScrolledState = useCallback((node: HTMLElement) => {
    const scrolled = node.scrollTop > SCROLLED_THRESHOLD_PX;
    // 매 스크롤 프레임마다 DOM 을 건드리지 않는다 — 상태가 실제로 바뀔 때만 쓴다.
    if (scrolled === scrolledRef.current) return;
    scrolledRef.current = scrolled;
    if (scrolled) node.dataset.scrolled = "true";
    else delete node.dataset.scrolled;
  }, []);

  /** 실제 스크롤 이벤트에서만 현재 화면의 위치를 새 값으로 기억한다. */
  const rememberAndSync = useCallback(() => {
    const node = nodeRef.current;
    if (!node) return;
    rememberPosition(activeScreenKeyRef.current, node.scrollTop);
    syncScrolledState(node);
  }, [syncScrolledState]);

  // 화면이 바뀌면 기억해 둔 자리로 돌아가고, 처음 보는 화면이면 맨 위에서 시작한다.
  // ref 연결 직후, 브라우저가 첫 프레임을 그리기 전에 적용해 최상단이 번쩍이는 것도 줄인다.
  useLayoutEffect(() => {
    activeScreenKeyRef.current = screenKey;
    const node = nodeRef.current;
    if (!node) return undefined;
    const saved = savedPositions.get(screenKey);
    if (saved === undefined || saved <= 0) {
      node.scrollTop = 0;
      syncScrolledState(node);
      return undefined;
    }

    // ⚠️ 한 번에 되지 않는다 — route 청크와 쿼리가 늦게 도착해 그 시점엔 아직 짧다.
    //    내용이 자랄 때까지 짧게 다시 시도하되, 사용자가 손대면 즉시 그만둔다.
    let cancelled = false;
    const deadline = Date.now() + RESTORE_WINDOW_MS;
    const stop = () => { cancelled = true; };
    node.addEventListener("pointerdown", stop, { once: true, passive: true });
    node.addEventListener("wheel", stop, { once: true, passive: true });

    const apply = () => {
      const current = nodeRef.current;
      if (cancelled || !current) return;
      const max = Math.max(0, current.scrollHeight - current.clientHeight);
      current.scrollTop = Math.min(saved, max);
      syncScrolledState(current);
      if (current.scrollTop < saved && Date.now() < deadline) {
        requestAnimationFrame(apply);
      }
    };
    apply();

    return () => {
      cancelled = true;
      node.removeEventListener("pointerdown", stop);
      node.removeEventListener("wheel", stop);
    };
  }, [screenKey, syncScrolledState]);

  useEffect(() => () => {
    const node = nodeRef.current;
    if (!node) return;
    rememberPosition(activeScreenKeyRef.current, node.scrollTop);
    node.removeEventListener("scroll", rememberAndSync);
  }, [rememberAndSync]);

  return useCallback(
    (node: HTMLElement | null) => {
      const previous = nodeRef.current;
      if (previous) {
        // ParentShell ↔ PushShell처럼 스크롤 DOM 자체가 바뀌는 경우에도 마지막 위치를 보존한다.
        rememberPosition(activeScreenKeyRef.current, previous.scrollTop);
        previous.removeEventListener("scroll", rememberAndSync);
      }
      nodeRef.current = node;
      scrolledRef.current = false;
      if (!node) return;
      node.addEventListener("scroll", rememberAndSync, { passive: true });
      // 중요: 새 셸의 초기 scrollTop=0은 저장하지 않는다. 저장하면 복원할 과거 위치를 덮어쓴다.
      syncScrolledState(node);
    },
    [rememberAndSync, syncScrolledState],
  );
}

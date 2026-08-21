import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router";

/**
 * 셸의 스크롤 영역 하나를 맡아 두 가지를 한다.
 *
 * ① 맨 위인지 아닌지를 `data-scrolled` 로 알린다(2026-08-21 TK 제보 "필터와 오늘 섹션 사이 경계").
 *    sticky 헤더의 서리 스크림은 두 가지를 동시에 만족할 수 없다 —
 *    맨 위에서는 가릴 내용이 없어 스크림이 **납작한 사각형**으로 읽히고,
 *    스크롤 중에는 스크림이 옅으면 목록이 헤더 뒤로 **비쳐 보인다**.
 *    그래서 "가릴 것이 생겼을 때만" 켠다.
 *
 * ② 화면별 스크롤 위치를 기억한다(2026-08-21 TK 지시).
 *    처음 들어가는 화면은 **최상단부터** 읽을 수 있어야 하고,
 *    다시 찾은 화면은 **보던 자리로** 돌아가야 한다.
 *
 * 순수 CSS(animation-timeline: scroll())로도 ①은 되지만 PWA Safari 가 아직 지원하지 않아
 * 어느 환경에서나 같게 동작하도록 passive 리스너 하나로 처리한다.
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
  const keyRef = useRef(screenKey);
  keyRef.current = screenKey;

  const sync = useCallback(() => {
    const node = nodeRef.current;
    if (!node) return;
    rememberPosition(keyRef.current, node.scrollTop);
    const scrolled = node.scrollTop > SCROLLED_THRESHOLD_PX;
    // 매 스크롤 프레임마다 DOM 을 건드리지 않는다 — 상태가 실제로 바뀔 때만 쓴다.
    if (scrolled === scrolledRef.current) return;
    scrolledRef.current = scrolled;
    if (scrolled) node.dataset.scrolled = "true";
    else delete node.dataset.scrolled;
  }, []);

  // 화면이 바뀌면 기억해 둔 자리로 돌아가고, 처음 보는 화면이면 맨 위에서 시작한다.
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return undefined;
    const saved = savedPositions.get(screenKey);
    if (saved === undefined || saved <= 0) {
      node.scrollTop = 0;
      sync();
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
  }, [screenKey, sync]);

  useEffect(() => () => {
    const node = nodeRef.current;
    if (node) node.removeEventListener("scroll", sync);
  }, [sync]);

  return useCallback(
    (node: HTMLElement | null) => {
      const previous = nodeRef.current;
      if (previous) previous.removeEventListener("scroll", sync);
      nodeRef.current = node;
      scrolledRef.current = false;
      if (!node) return;
      node.addEventListener("scroll", sync, { passive: true });
      // 화면을 바꿔 들어왔을 때 이미 스크롤돼 있을 수 있다.
      sync();
    },
    [sync],
  );
}

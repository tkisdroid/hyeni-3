import { useCallback, useEffect, useRef } from "react";

/**
 * 스크롤 영역이 맨 위인지 아닌지를 `data-scrolled` 로 알린다.
 *
 * 왜 필요한가(2026-08-21 TK 제보 "필터 버튼과 오늘 섹션 사이 경계"):
 * sticky 헤더의 서리 스크림은 두 가지를 동시에 만족할 수 없다.
 *  · 맨 위에서는 가릴 내용이 없으므로 스크림이 있으면 오로라 위에 **납작한 사각형**으로 읽힌다.
 *  · 스크롤 중에는 스크림이 옅으면 목록이 헤더 뒤로 **비쳐 보인다**.
 * 그래서 "가릴 것이 생겼을 때만" 스크림을 켠다.
 *
 * 순수 CSS(animation-timeline: scroll())로도 가능하지만 PWA Safari 가 아직 지원하지 않아,
 * 어느 환경에서나 같게 동작하도록 passive 리스너 하나로 처리한다.
 */
const SCROLLED_THRESHOLD_PX = 4;

export function useScrolledShell(): (node: HTMLElement | null) => void {
  const nodeRef = useRef<HTMLElement | null>(null);
  const scrolledRef = useRef(false);

  const sync = useCallback(() => {
    const node = nodeRef.current;
    if (!node) return;
    const scrolled = node.scrollTop > SCROLLED_THRESHOLD_PX;
    // 매 스크롤 프레임마다 DOM 을 건드리지 않는다 — 상태가 실제로 바뀔 때만 쓴다.
    if (scrolled === scrolledRef.current) return;
    scrolledRef.current = scrolled;
    if (scrolled) node.dataset.scrolled = "true";
    else delete node.dataset.scrolled;
  }, []);

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

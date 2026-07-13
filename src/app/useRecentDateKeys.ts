import { useEffect, useMemo, useState } from "react";
import { addDaysToDateKey, todayDateKey } from "@/transform/dateKey";

/** 다음 로컬 날짜가 시작될 때까지 남은 시간. DST가 있어도 Date 생성자가 현지 자정을 계산한다. */
export function millisecondsUntilNextLocalDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1, next.getTime() - now.getTime());
}

export function recentDateKeysFor(anchorDateKey: string, days: number): string[] {
  const count = Math.max(1, Math.floor(days));
  return Array.from({ length: count }, (_, index) =>
    addDaysToDateKey(anchorDateKey, index - (count - 1)));
}

/**
 * 자정 또는 백그라운드에서 화면으로 돌아온 뒤 최근 date_key 범위를 다시 계산한다.
 * 메모 전송일과 조회 캐시 범위가 다른 날짜를 가리키는 상태를 방지한다.
 */
export function useRecentDateKeys(days: number): string[] {
  const [anchorDateKey, setAnchorDateKey] = useState(() => todayDateKey());

  useEffect(() => {
    let timer: number | null = null;
    const refreshAnchor = () => {
      const next = todayDateKey();
      setAnchorDateKey((current) => (current === next ? current : next));
    };
    const scheduleMidnightRefresh = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        refreshAnchor();
        scheduleMidnightRefresh();
      }, millisecondsUntilNextLocalDay(new Date()) + 250);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      refreshAnchor();
      scheduleMidnightRefresh();
    };

    scheduleMidnightRefresh();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return useMemo(() => recentDateKeysFor(anchorDateKey, days), [anchorDateKey, days]);
}

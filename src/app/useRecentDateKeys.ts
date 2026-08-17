import { useEffect, useMemo, useState } from "react";
import {
  dateToDateKeyInTimeZone,
  millisecondsUntilNextDayInTimeZone,
  recentDateKeysFor,
} from "@/transform/dateKey";

export { recentDateKeysFor } from "@/transform/dateKey";

/**
 * 자정 또는 백그라운드에서 화면으로 돌아온 뒤 최근 date_key 범위를 다시 계산한다.
 * 메모 전송일과 조회 캐시 범위가 다른 날짜를 가리키는 상태를 방지한다.
 */
export function useRecentDateKeys(days: number, timeZone: string): string[] {
  const [anchorDateKey, setAnchorDateKey] = useState(() => (
    dateToDateKeyInTimeZone(new Date(), timeZone)
  ));

  useEffect(() => {
    let timer: number | null = null;
    const refreshAnchor = () => {
      const next = dateToDateKeyInTimeZone(new Date(), timeZone);
      setAnchorDateKey((current) => (current === next ? current : next));
    };
    const scheduleMidnightRefresh = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        refreshAnchor();
        scheduleMidnightRefresh();
      }, millisecondsUntilNextDayInTimeZone(new Date(), timeZone) + 250);
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
  }, [timeZone]);

  return useMemo(() => recentDateKeysFor(anchorDateKey, days), [anchorDateKey, days]);
}

/**
 * 특정 날짜(date_key) 일정들의 "다녀옴" 위치 검증 훅.
 * 그 날짜의 아이 위치 이력을 1회 조회해 이벤트별 방문 판정 맵을 만든다
 * (scheduleView 의 visitMap 으로 주입 → visited=다녀옴 / unverified=확인 필요).
 *
 * - 미래 날짜·이벤트 없음이면 이력 조회를 하지 않는다(disabled).
 * - childScope=string 은 특정 아이 user_id 만 대조한다.
 * - childScope=Map 은 member id → user id 로, 이벤트 배정 아이의 위치만 대조한다.
 * - childScope=null 은 가족의 아무 아이나 대조한다.
 */
import { useMemo } from "react";
import type { CalendarEvent } from "@/lib/api/endpoints/schedule";
import { dateKeyDayRangeIso } from "@/transform/dateKey";
import { verifyVisits, type VisitChildScope, type VisitVerdict } from "@/transform/visitVerify";
import { useLocationHistory } from "./useLocation";

export function useVisitVerify(
  dateKey: string,
  timeZone: string,
  events: CalendarEvent[] | undefined,
  childScope: VisitChildScope,
  locationHistoryAllowed: boolean,
): Map<string, VisitVerdict> {
  const range = useMemo(() => dateKeyDayRangeIso(dateKey, timeZone), [dateKey, timeZone]);
  // 좌표 있는 이벤트가 그 날짜에 있고, 하루가 이미 시작됐을 때만 이력 조회.
  const dayEvents = useMemo(
    () => (events ?? []).filter((e) => e.date_key === dateKey),
    [events, dateKey],
  );
  const hasTarget = dayEvents.some(
    (e) => Number.isFinite(Number(e.location?.lat)) && Number.isFinite(Number(e.location?.lng)),
  );
  const dayStarted = !!range && new Date(range.start).getTime() <= Date.now();
  const { data: history } = useLocationHistory(
    range?.start ?? "",
    range?.end ?? "",
    locationHistoryAllowed && !!range && hasTarget && dayStarted,
  );

  return useMemo(
    () => verifyVisits(dayEvents, locationHistoryAllowed ? history ?? [] : [], childScope),
    [dayEvents, history, childScope, locationHistoryAllowed],
  );
}

import { useFamilyTimeZone } from "@/region/FamilyTimeZone";
import { useIntl, type IntlShape } from "react-intl";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, Plus, Clock, MapPin, Bell, Pencil, Trash2, StickyNote } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { Loading } from "@/components/ui/Loading";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { useEvents, useDeleteEvent } from "@/queries/useSchedule";
import { useMyFamily } from "@/queries/useFamily";
import { useSavedPlaces } from "@/queries/useLocation";
import { eventToView, formatTimeLabel, groupEventsByDateKey } from "@/transform/scheduleView";
import { useVisitVerify } from "@/queries/useVisitVerify";
import { useEntitlement } from "@/queries/useEntitlement";
import { addDaysToDateKey, addMonthsToDateKey, dateTimeScopeInTimeZone, parseAppDateKey, ymdToDateKey } from "@/transform/dateKey";
import { locationModeFor } from "@/transform/tierPolicy";
import { eventChildMemberIds, eventNeedsChildAssignment, eventScopeLabel } from "@/transform/eventScope";
import { notifOverrideToReminderMinutes, type CalendarEvent } from "@/lib/api/endpoints/schedule";
import { useLocale } from "@/i18n/useLocale";
import {
  formatCalendarDay,
  formatCalendarMonth,
  formatRelativeMinutes,
  formatWeekday,
} from "@/i18n/format";
import type { SupportedLocale } from "@/i18n/locale";

/** 사전알림(분) → 사람이 읽는 라벨. */
function reminderLabel(minutes: number, locale: SupportedLocale, intl: IntlShape): string {
  return intl.formatMessage(
    { id: "parent.calendar.reminderLabel" },
    { time: formatRelativeMinutes(minutes, "past", locale) },
  );
}
import "./ParentCalendar.css";

type SwipeSide = "edit" | "delete";

/** 카테고리 한국어 라벨(태그 표시용 — 색은 이벤트 뷰의 tag 색을 재사용). */
const CATEGORY_LABEL_IDS: Record<string, string> = {
  school: "parent.category.school",
  sports: "parent.category.sports",
  hobby: "parent.category.hobby",
  family: "parent.category.family",
  friend: "parent.category.friend",
  other: "parent.category.other",
};

/** 주말 신호색: 일요일 레드, 토요일 파랑, 평일 본문색.
 *  중간 톤(#E5484D·#2E86C1)은 흰 배경에서 3.9:1 이라 14px 날짜 숫자에 미달했다 → 문구용 토큰. */
const weekendColor = (dow: number): string =>
  dow === 0 ? "var(--danger-text)" : dow === 6 ? "var(--blue-text)" : "var(--fg-body)";

/** 해당 월의 셀 배열 = 앞 공백(null) + 1..말일. */
const buildCells = (year: number, month: number): (number | null)[] => {
  const first = new Date(year, month - 1, 1).getDay();
  const total = new Date(year, month, 0).getDate();
  return [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
};

export function ParentCalendar() {
  const familyTimeZone = useFamilyTimeZone();
  const intl = useIntl();
  const { locale } = useLocale();
  const { show } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const now = useMemo(() => new Date(), []);
  const weekdayLabels = useMemo(
    () => Array.from({ length: 7 }, (_, index) => formatWeekday(
      Date.UTC(2026, 0, 4 + index, 12),
      { locale, timeZone: "UTC", width: "short" },
    )),
    [locale],
  );
  const TODAY = useMemo(() => {
    const date = parseAppDateKey(dateTimeScopeInTimeZone(now, familyTimeZone).dateKey);
    return date
      ? { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
      : { year: 1970, month: 1, day: 1 };
  }, [familyTimeZone, now]);

  const dateParam = searchParams.get("date");
  const selectedDate = dateParam ? parseAppDateKey(dateParam) : null;
  const selected = selectedDate
    ? { year: selectedDate.getFullYear(), month: selectedDate.getMonth() + 1, day: selectedDate.getDate() }
    : TODAY;
  // 표시한 달과 일정 작성 날짜는 같은 선택일을 사용한다. URL에 남겨 폼에서 돌아와도 복원한다.
  const view = selected;
  const selectDate = (dateKey: string) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("date", dateKey);
      return next;
    }, { replace: true, preventScrollReset: true });
  };

  const { data: events, isLoading, isError, refetch: refetchEvents } = useEvents();
  const { data: family } = useMyFamily();
  const { data: savedPlaces } = useSavedPlaces();
  const entitlement = useEntitlement();
  const deleteEvent = useDeleteEvent();
  // 선택 날짜의 지난 일정 "다녀옴"을 위치 이력로 검증(미확인=확인 필요).
  // 캘린더는 여러 아이 일정이 섞이므로 이벤트 배정 아이의 user_id 로 정확히 대조한다.
  const selectedKey = ymdToDateKey(selected.year, selected.month, selected.day);
  const calendarTitleId = useId();
  const calendarGridRef = useRef<HTMLDivElement>(null);
  const pendingDateFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (pendingDateFocus.current !== selectedKey) return;
    calendarGridRef.current?.querySelector<HTMLButtonElement>(`[data-date-key="${selectedKey}"]`)
      ?.focus({ preventScroll: true });
    pendingDateFocus.current = null;
  }, [selectedKey]);
  const childUserByMemberId = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of family?.members ?? []) {
      if (member.role === "child" && member.user_id) map.set(member.id, member.user_id);
    }
    return map;
  }, [family]);
  const canVerifyVisits = !entitlement.isError && locationModeFor(entitlement.tier) === "realtime";
  const visitMap = useVisitVerify(
    selectedKey,
    familyTimeZone,
    events,
    childUserByMemberId,
    canVerifyVisits,
  );
  const byKey = useMemo(
    () => groupEventsByDateKey(
      events ?? [],
      now,
      locale,
      familyTimeZone,
      visitMap,
      savedPlaces,
      intl,
    ),
    [familyTimeZone, events, locale, now, visitMap, savedPlaces, intl],
  );
  const rawById = useMemo(() => {
    const map = new Map<string, CalendarEvent>();
    for (const e of events ?? []) map.set(e.id, e);
    return map;
  }, [events]);

  const cells = useMemo(() => buildCells(view.year, view.month), [view.year, view.month]);

  // ── 일정 상세 바텀시트(P-08) ──
  const [sheetEvent, setSheetEvent] = useState<CalendarEvent | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);
  const [openSwipe, setOpenSwipe] = useState<{ id: string; side: SwipeSide } | null>(null);
  const [confirmSwipeDeleteId, setConfirmSwipeDeleteId] = useState<string | null>(null);
  const swipeStart = useRef<{ id: string; x: number; y: number } | null>(null);
  const suppressCardClick = useRef(false);
  const sheetTitleId = useId();
  const sheetDescriptionId = useId();
  const sheetContentRef = useRef<HTMLDivElement>(null);

  const openSheet = (id: string) => {
    const raw = rawById.get(id);
    if (!raw) return;
    setSheetEvent(raw);
    setConfirmDelete(false);
    setDragY(0);
  };
  const closeSheet = () => {
    setSheetEvent(null);
    setConfirmDelete(false);
    setDragY(0);
    dragStart.current = null;
  };
  const sheetDialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: sheetEvent !== null,
    onClose: closeSheet,
    initialFocusRef: sheetContentRef,
    canClose: () => !deleteEvent.isPending,
  });

  // 시트 손잡이 아래로 드래그 → 임계값 넘으면 닫기(탭아웃은 스크림 클릭).
  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragStart.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onGripMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStart.current == null) return;
    const dy = e.clientY - dragStart.current;
    setDragY(dy > 0 ? dy : 0);
  };
  const onGripUp = () => {
    if (dragStart.current == null) return;
    if (dragY > 90 && !deleteEvent.isPending) closeSheet();
    else setDragY(0);
    dragStart.current = null;
  };

  const sheetView = sheetEvent
    ? eventToView(
      sheetEvent,
      now,
      locale,
      familyTimeZone,
      visitMap,
      savedPlaces,
      intl,
    )
    : null;
  const sheetTimeLabel = useMemo(() => {
    if (!sheetEvent) return "";
    const start = formatTimeLabel(sheetEvent.time, locale, intl);
    return sheetEvent.end_time ? `${start} – ${formatTimeLabel(sheetEvent.end_time, locale, intl)}` : start;
  }, [locale, sheetEvent, intl]);
  const sheetChildLabel = useMemo(() => {
    if (!sheetEvent) return "";
    const names = eventChildMemberIds(sheetEvent)
      .map((id) => family?.members.find((m) => m.id === id)?.name)
      .filter((n): n is string => !!n);
    if (names.length) return names.join(" · ");
    return eventScopeLabel(sheetEvent, intl);
  }, [sheetEvent, family, intl]);
  const sheetNeedsAssignment = sheetEvent ? eventNeedsChildAssignment(sheetEvent) : false;
  const sheetReminder = useMemo(() => {
    if (!sheetEvent) return null;
    return notifOverrideToReminderMinutes(sheetEvent.notif_override);
  }, [sheetEvent]);

  const editEvent = (event: CalendarEvent) => {
    setOpenSwipe(null);
    setConfirmSwipeDeleteId(null);
    navigate("/event-form", { state: { mode: "edit", event } });
  };
  const handleEdit = () => {
    if (!sheetEvent) return;
    editEvent(sheetEvent);
  };
  const deleteEventById = (id: string, closeAfter = false) => {
    if (deleteEvent.isPending) return;
    deleteEvent.mutate(id, {
      onSuccess: () => {
        show(intl.formatMessage({ id: "parent.parentCalendar.copy001" }), "🗑️");
        setOpenSwipe(null);
        setConfirmSwipeDeleteId(null);
        if (closeAfter) closeSheet();
      },
      onError: () => show(intl.formatMessage({ id: "parent.parentCalendar.copy002" }), "⚠️"),
    });
  };
  const handleDelete = () => {
    if (!sheetEvent) return;
    deleteEventById(sheetEvent.id, true);
  };
  // 반복 일정: 선택한 날짜와 그 이후 반복을 서버에서 한 번에 지운다(캐시에 없는 먼 날짜 포함).
  const handleDeleteFollowing = () => {
    if (!sheetEvent || deleteEvent.isPending) return;
    deleteEvent.mutate({ id: sheetEvent.id, scope: "following" }, {
      onSuccess: () => {
        show(intl.formatMessage({ id: "parent.parentCalendar.seriesDeleted" }), "🗑️");
        closeSheet();
      },
      onError: () => show(intl.formatMessage({ id: "parent.parentCalendar.copy002" }), "⚠️"),
    });
  };
  const sheetIsSeries = Boolean(sheetEvent?.series_id);

  const onCardPointerDown = (id: string, e: ReactPointerEvent<HTMLButtonElement>) => {
    swipeStart.current = { id, x: e.clientX, y: e.clientY };
    suppressCardClick.current = false;
  };
  const onCardPointerUp = (id: string, e: ReactPointerEvent<HTMLButtonElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || start.id !== id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    suppressCardClick.current = true;
    setConfirmSwipeDeleteId(null);
    setOpenSwipe({ id, side: dx > 0 ? "edit" : "delete" });
  };
  const onCardClick = (id: string) => {
    if (suppressCardClick.current) {
      suppressCardClick.current = false;
      return;
    }
    if (openSwipe?.id === id) {
      setOpenSwipe(null);
      setConfirmSwipeDeleteId(null);
      return;
    }
    openSheet(id);
  };

  const isCurrentMonth = view.year === TODAY.year && view.month === TODAY.month;
  const selIsToday =
    selected.year === TODAY.year && selected.month === TODAY.month && selected.day === TODAY.day;
  const selEvents = byKey[ymdToDateKey(selected.year, selected.month, selected.day)] ?? [];

  // 이벤트별 배정 아이 이름(다자녀 리스트 구분 배지). 배정 누락은 숨기지 않고 표시.
  // 아이가 2명 이상일 때만 노출(1명이면 소음).
  const multiChild = (family?.members ?? []).filter((m) => m.role === "child").length > 1;
  const childLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of events ?? []) {
      const names = eventChildMemberIds(e)
        .map((id) => family?.members.find((m) => m.id === id)?.name)
        .filter((n): n is string => !!n);
      if (names.length) {
        if (multiChild) map.set(e.id, names.join("·"));
      }
      else {
        const label = eventScopeLabel(e, intl);
        if (label) map.set(e.id, label);
      }
    }
    return map;
  }, [events, family, multiChild, intl]);

  const selLabel = formatCalendarDay(
    Date.UTC(selected.year, selected.month - 1, selected.day, 12),
    { locale, timeZone: "UTC", weekday: "long" },
  );

  const shiftMonth = (delta: number) => selectDate(addMonthsToDateKey(selectedKey, delta));
  const onDateKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, dateKey: string) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const dayOffsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let nextKey: string;
    if (event.key in dayOffsets) nextKey = addDaysToDateKey(dateKey, dayOffsets[event.key]);
    else if (event.key === "PageUp" || event.key === "PageDown") {
      nextKey = addMonthsToDateKey(dateKey, event.key === "PageUp" ? -1 : 1);
    } else if (event.key === "Home" || event.key === "End") {
      const weekday = parseAppDateKey(dateKey)?.getDay() ?? 0;
      nextKey = addDaysToDateKey(dateKey, event.key === "Home" ? -weekday : 6 - weekday);
    } else return;
    event.preventDefault();
    if (nextKey === selectedKey) return;
    pendingDateFocus.current = nextKey;
    selectDate(nextKey);
  };

  return (
    <div className="hy-rise-in">
      {/* 월 헤더 */}
      <header className="pc-header">
        <div id={calendarTitleId} aria-live="polite" aria-atomic="true">
          <div className="pc-year">{view.year}</div>
          <div className="pc-month">
            {formatCalendarMonth(Date.UTC(view.year, view.month - 1, 1, 12), {
              locale,
              timeZone: "UTC",
            })}
          </div>
        </div>
        <div className="pc-header__nav">
          <button
            type="button"
            className="pc-navbtn pc-todaybtn hy-press"
            onClick={() => selectDate(ymdToDateKey(TODAY.year, TODAY.month, TODAY.day))}
          >
            {intl.formatMessage({ id: "parent.parentCalendar.copy006" })}
          </button>
          <button type="button" aria-label={intl.formatMessage({ id: "parent.parentCalendar.copy003" })} className="pc-navbtn hy-press" onClick={() => shiftMonth(-1)}>
            <ChevronLeft size={18} strokeWidth={2.4} color="#6D6469" />
          </button>
          <button type="button" aria-label={intl.formatMessage({ id: "parent.parentCalendar.copy004" })} className="pc-navbtn hy-press" onClick={() => shiftMonth(1)}>
            <ChevronRight size={18} strokeWidth={2.4} color="#6D6469" />
          </button>
          <button
            type="button"
            aria-label={intl.formatMessage({ id: "parent.parentCalendar.copy005" })}
            className="pc-addbtn hy-press"
            onClick={() =>
              navigate("/event-form", {
                state: {
                  mode: "create",
                  dateKey: ymdToDateKey(selected.year, selected.month, selected.day),
                },
              })
            }
          >
            <Plus size={20} strokeWidth={2.6} color="#fff" />
          </button>
        </div>
      </header>

      <div className="pc-body">
        {/* 월간 그리드 */}
        <div className="pc-card">
          <div className="pc-weekdays">
            {weekdayLabels.map((w, index) => (
              <div key={`${index}-${w}`} className="pc-weekday">
                {w}
              </div>
            ))}
          </div>
          {/* 달이 바뀌면 격자를 새로 그려 넘김 모션을 한 번 재생한다. */}
          <div
            key={`${view.year}-${view.month}`}
            className="pc-grid"
            ref={calendarGridRef}
            role="group"
            aria-labelledby={calendarTitleId}
          >
            {cells.map((d, i) => {
              if (d === null) {
                return <div key={`e${i}`} className="pc-cell-empty" aria-hidden="true" />;
              }
              const dow = new Date(view.year, view.month - 1, d).getDay();
              const isToday = isCurrentMonth && d === TODAY.day;
              const isSel = selected.day === d;
              const dayKey = ymdToDateKey(view.year, view.month, d);
              const dayViews = byKey[dayKey] ?? [];
              const dots = dayViews.slice(0, 3);
              const extra = dayViews.length - dots.length;
              // 오늘(채운 원)·선택(렌즈 원)의 색은 CSS 가 aria 상태로 칠한다. 나머지 날만 주말 신호색을 받는다.
              const numStyle = isSel || isToday ? undefined : { color: weekendColor(dow) };
              return (
                <button
                  key={d}
                  type="button"
                  className="pc-day hy-press"
                  data-date-key={dayKey}
                  tabIndex={isSel ? 0 : -1}
                  aria-label={intl.formatDate(Date.UTC(view.year, view.month - 1, d, 12), {
                    timeZone: "UTC", year: "numeric", month: "long", day: "numeric", weekday: "long",
                  })}
                  aria-pressed={isSel}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => selectDate(dayKey)}
                  onKeyDown={(event) => onDateKeyDown(event, dayKey)}
                >
                  <span className="pc-day__num" style={numStyle}>
                    {d}
                  </span>
                  <span className="pc-day__dots" aria-hidden="true">
                    {dots.map((ev) => (
                      <span key={ev.id} className="pc-dot" style={{ background: ev.color }} />
                    ))}
                    {extra > 0 && <span className="pc-day__more">+{extra}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 선택일 헤더 */}
        <div className="pc-sel">
          <span className="pc-sel__label">{selLabel}</span>
          {selIsToday && <span className="pc-today-badge">{intl.formatMessage({ id: "parent.parentCalendar.copy006" })}</span>}
        </div>

        {/* 선택일 일정 */}
        {isLoading ? (
          <div className="pc-empty">
            <Loading label={intl.formatMessage({ id: "parent.parentHome.copy020" })} />
          </div>
        ) : isError ? (
          <div className="pc-empty">
            <div className="pc-empty__title">{intl.formatMessage({ id: "parent.parentHome.copy021" })}</div>
            <button type="button" className="hy-section-action hy-press" onClick={() => void refetchEvents()}>
              {intl.formatMessage({ id: "parent.parentHome.copy017" })}
            </button>
          </div>
        ) : selEvents.length > 0 ? (
          <div className="pc-events">
            {selEvents.map((e) => {
              const childLabel = childLabelById.get(e.id);
              const raw = rawById.get(e.id);
              const childWarn = raw ? eventNeedsChildAssignment(raw) : false;
              const swipeSide = openSwipe?.id === e.id ? openSwipe.side : null;
              const confirmSwipeDelete = confirmSwipeDeleteId === e.id;
              const swipeDeletePending = deleteEvent.isPending && deleteEvent.variables === e.id;
              return (
                <div key={e.id} className="pc-event">
                  <div className="pc-event__rail">
                    <span className="pc-event__node" style={{ background: e.color, boxShadow: `0 0 0 4px ${e.soft}` }} />
                    <span className="pc-event__line" />
                  </div>
                  <div className={`pc-swipe${swipeSide ? ` pc-swipe--${swipeSide}` : ""}`}>
                    <div className="pc-swipe__actions pc-swipe__actions--left" aria-hidden={swipeSide !== "edit"}>
                      <button
                        type="button"
                        className="pc-swipe__action pc-swipe__action--edit hy-press"
                        onClick={() => raw && editEvent(raw)}
                        disabled={!raw}
                      >
                        <Pencil size={16} strokeWidth={2.2} />
                        {intl.formatMessage({ id: "parent.parentCalendar.copy007" })}
                      </button>
                    </div>
                    <div className="pc-swipe__actions pc-swipe__actions--right" aria-hidden={swipeSide !== "delete"}>
                      {confirmSwipeDelete ? (
                        <>
                          <button
                            type="button"
                            className="pc-swipe__action pc-swipe__action--cancel hy-press"
                            onClick={() => setConfirmSwipeDeleteId(null)}
                          >
                            {intl.formatMessage({ id: "parent.parentSettings.copy031" })}
                          </button>
                          <button
                            type="button"
                            className="pc-swipe__action pc-swipe__action--delete hy-press"
                            onClick={() => deleteEventById(e.id)}
                            disabled={deleteEvent.isPending}
                            aria-busy={swipeDeletePending}
                          >
                            {swipeDeletePending ? intl.formatMessage({ id: "parent.parentCalendar.copy008" }) : intl.formatMessage({ id: "parent.parentCalendar.copy009" })}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="pc-swipe__action pc-swipe__action--delete hy-press"
                          onClick={() => setConfirmSwipeDeleteId(e.id)}
                        >
                          <Trash2 size={16} strokeWidth={2.2} />
                          {intl.formatMessage({ id: "parent.parentCalendar.copy009" })}
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      className="pc-event__card hy-press"
                      onPointerDown={(ev) => onCardPointerDown(e.id, ev)}
                      onPointerUp={(ev) => onCardPointerUp(e.id, ev)}
                      onPointerCancel={() => {
                        swipeStart.current = null;
                      }}
                      onClick={() => onCardClick(e.id)}
                    >
                      <span className="pc-event__icon" style={{ background: e.soft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <img src={asset(e.icon)} alt="" style={{ width: 32, height: 32, objectFit: "contain" }} />
                      </span>
                      <span className="pc-event__body">
                        <span className="pc-event__time">
                          {e.time}
                          {childLabel && (
                            <span className={`pc-event__child${childWarn ? " pc-event__child--warn" : ""}`}>
                              {childLabel}
                            </span>
                          )}
                        </span>
                        <span className="pc-event__title">{e.title}</span>
                        {e.place && <span className="pc-event__place">{e.place}</span>}
                      </span>
                      <span className="pc-event__tag" style={{ color: e.tagText, background: e.tagBg }}>
                        {e.tagLabel}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="pc-empty">
            <img src={asset("cat/other.webp")} alt="" />
            <div className="pc-empty__title">{intl.formatMessage({ id: "parent.parentCalendar.copy010" })}</div>
            <div className="pc-empty__sub">{intl.formatMessage({ id: "parent.parentCalendar.copy011" })}</div>
          </div>
        )}
      </div>

      {/* 일정 상세 바텀시트(P-08) */}
      {sheetEvent && sheetView && (
        <div
          ref={sheetDialogRef}
          className="pc-sheet-root"
          role="dialog"
          aria-modal="true"
          aria-labelledby={sheetTitleId}
          aria-describedby={sheetDescriptionId}
        >
          <button
            type="button"
            className="pc-scrim"
            tabIndex={-1}
            aria-label={intl.formatMessage({ id: "parent.parentSettings.copy027" })}
            onClick={() => !deleteEvent.isPending && closeSheet()}
          />
          <div
            ref={sheetContentRef}
            className="pc-sheet"
            tabIndex={-1}
            style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
          >
            <div
              className="pc-sheet__grip"
              onPointerDown={onGripDown}
              onPointerMove={onGripMove}
              onPointerUp={onGripUp}
              onPointerCancel={onGripUp}
            >
              <span className="pc-sheet__handle" />
            </div>

            <div className="pc-sheet__head">
              <span className="pc-sheet__icon" style={{ background: sheetView.soft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <img src={asset(sheetView.icon)} alt="" style={{ width: 32, height: 32, objectFit: "contain" }} />
              </span>
              <div className="pc-sheet__headtext">
                <div id={sheetTitleId} className="pc-sheet__title">{sheetView.title}</div>
                {sheetChildLabel && (
                  <div className={`pc-sheet__sub${sheetNeedsAssignment ? " pc-sheet__sub--warn" : ""}`}>
                    {sheetChildLabel}
                  </div>
                )}
              </div>
              <span
                className="pc-sheet__tag"
                style={{ color: sheetView.tagText, background: sheetView.tagBg }}
              >
                {intl.formatMessage({ id: CATEGORY_LABEL_IDS[sheetEvent.category] ?? "parent.category.other" })}
              </span>
            </div>

            <div id={sheetDescriptionId} className="pc-sheet__rows">
              <div className="pc-sheet__row">
                <Clock size={17} strokeWidth={2} color="var(--fg-muted)" />
                <span>{sheetTimeLabel}</span>
              </div>
              {sheetView.place && (
                <div className="pc-sheet__row">
                  <MapPin size={17} strokeWidth={2} color="var(--fg-muted)" />
                  <span>{sheetView.place}</span>
                </div>
              )}
              {sheetReminder != null && (
                <div className="pc-sheet__row">
                  <Bell size={17} strokeWidth={2} color="var(--fg-muted)" />
                  <span>{reminderLabel(sheetReminder, locale, intl)}</span>
                </div>
              )}
              {sheetEvent.memo && (
                <div className="pc-sheet__row pc-sheet__row--memo">
                  <span className="pc-sheet__memo-ic" aria-hidden="true">
                    <StickyNote size={17} strokeWidth={2.2} />
                  </span>
                  <span>{sheetEvent.memo}</span>
                </div>
              )}
            </div>

            {confirmDelete ? (
              <div className="pc-sheet__confirm">
                <div className="pc-sheet__confirm-text">
                  {intl.formatMessage({
                    id: sheetIsSeries ? "parent.parentCalendar.seriesDeleteQuestion" : "parent.parentCalendar.copy013",
                  })}
                </div>
                {sheetIsSeries && (
                  <div className="pc-sheet__actions">
                    <button
                      type="button"
                      className="pc-btn pc-btn--danger hy-press"
                      onClick={handleDelete}
                      disabled={deleteEvent.isPending}
                      aria-busy={deleteEvent.isPending && typeof deleteEvent.variables === "string"}
                    >
                      {intl.formatMessage({ id: "parent.parentCalendar.seriesDeleteOne" })}
                    </button>
                    <button
                      type="button"
                      className="pc-btn pc-btn--danger hy-press"
                      onClick={handleDeleteFollowing}
                      disabled={deleteEvent.isPending}
                      aria-busy={deleteEvent.isPending && typeof deleteEvent.variables !== "string"}
                    >
                      {intl.formatMessage({ id: "parent.parentCalendar.seriesDeleteFollowing" })}
                    </button>
                  </div>
                )}
                <div className="pc-sheet__actions">
                  <button
                    type="button"
                    className="pc-btn pc-btn--ghost hy-press"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleteEvent.isPending}
                    data-progress-owner="confirm-action"
                  >
                    {intl.formatMessage({ id: "parent.parentSettings.copy031" })}
                  </button>
                  {!sheetIsSeries && (
                    <button
                      type="button"
                      className="pc-btn pc-btn--danger hy-press"
                      onClick={handleDelete}
                      disabled={deleteEvent.isPending} aria-busy={deleteEvent.isPending}
                    >
                      {deleteEvent.isPending ? intl.formatMessage({ id: "parent.parentSettings.copy032" }) : intl.formatMessage({ id: "parent.parentCalendar.copy009" })}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="pc-sheet__actions">
                <button
                  type="button"
                  className="pc-btn pc-btn--ghost hy-press"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={16} strokeWidth={2.2} /> {intl.formatMessage({ id: "parent.parentCalendar.copy009" })}
                </button>
                <button
                  type="button"
                  className="pc-btn pc-btn--primary hy-press"
                  onClick={handleEdit}
                >
                  <Pencil size={16} strokeWidth={2.2} /> {sheetNeedsAssignment ? intl.formatMessage({ id: "parent.parentCalendar.copy014" }) : intl.formatMessage({ id: "parent.parentCalendar.copy007" })}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

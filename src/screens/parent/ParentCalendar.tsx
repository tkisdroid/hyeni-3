import { useId, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router";
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
import { dateTimeScopeInTimeZone, parseAppDateKey, ymdToDateKey } from "@/transform/dateKey";
import { locationModeFor } from "@/transform/tierPolicy";
import { eventChildMemberIds, eventScopeLabel } from "@/transform/eventScope";
import { notifOverrideToReminderMinutes, type CalendarEvent } from "@/lib/api/endpoints/schedule";
import { useLocale } from "@/i18n/useLocale";
import {
  formatCalendarDay,
  formatCalendarMonth,
  formatRelativeMinutes,
  formatWeekday,
  LEGACY_FAMILY_TIME_ZONE,
} from "@/i18n/format";
import type { SupportedLocale } from "@/i18n/locale";

/** 사전알림(분) → 사람이 읽는 라벨. */
function reminderLabel(minutes: number, locale: SupportedLocale): string {
  return `${formatRelativeMinutes(minutes, "past", locale)} 알림`;
}
import "./ParentCalendar.css";

type ViewMonth = { year: number; month: number };
type SelDate = { year: number; month: number; day: number };
type SwipeSide = "edit" | "delete";

/** 카테고리 한국어 라벨(태그 표시용 — 색은 이벤트 뷰의 tag 색을 재사용). */
const CATEGORY_LABELS: Record<string, string> = {
  school: "학교",
  sports: "운동",
  hobby: "취미",
  family: "가족",
  friend: "친구",
  other: "기타",
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
  const { locale } = useLocale();
  const { show } = useToast();
  const navigate = useNavigate();
  const now = useMemo(() => new Date(), []);
  const weekdayLabels = useMemo(
    () => Array.from({ length: 7 }, (_, index) => formatWeekday(
      Date.UTC(2026, 0, 4 + index, 12),
      { locale, timeZone: "UTC", width: "short" },
    )),
    [locale],
  );
  const TODAY = useMemo(() => {
    const date = parseAppDateKey(dateTimeScopeInTimeZone(now, LEGACY_FAMILY_TIME_ZONE).dateKey);
    return date
      ? { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
      : { year: 1970, month: 1, day: 1 };
  }, [now]);

  const [view, setView] = useState<ViewMonth>({ year: TODAY.year, month: TODAY.month });
  const [selected, setSelected] = useState<SelDate>({ ...TODAY });

  const { data: events, isLoading, isError, refetch: refetchEvents } = useEvents();
  const { data: family } = useMyFamily();
  const { data: savedPlaces } = useSavedPlaces();
  const entitlement = useEntitlement();
  const deleteEvent = useDeleteEvent();
  // 선택 날짜의 지난 일정 "다녀옴"을 위치 이력로 검증(미확인=확인 필요).
  // 캘린더는 여러 아이 일정이 섞이므로 이벤트 배정 아이의 user_id 로 정확히 대조한다.
  const selectedKey = ymdToDateKey(selected.year, selected.month, selected.day);
  const childUserByMemberId = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of family?.members ?? []) {
      if (member.role === "child" && member.user_id) map.set(member.id, member.user_id);
    }
    return map;
  }, [family]);
  const canVerifyVisits = !entitlement.isError && locationModeFor(entitlement.tier) === "realtime";
  const visitMap = useVisitVerify(selectedKey, events, childUserByMemberId, canVerifyVisits);
  const byKey = useMemo(
    () => groupEventsByDateKey(
      events ?? [],
      now,
      locale,
      LEGACY_FAMILY_TIME_ZONE,
      visitMap,
      savedPlaces,
    ),
    [events, locale, now, visitMap, savedPlaces],
  );
  const rawById = useMemo(() => {
    const map = new Map<string, CalendarEvent>();
    for (const e of events ?? []) map.set(e.id, e);
    return map;
  }, [events]);

  const cells = useMemo(() => buildCells(view.year, view.month), [view]);

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
      LEGACY_FAMILY_TIME_ZONE,
      visitMap,
      savedPlaces,
    )
    : null;
  const sheetTimeLabel = useMemo(() => {
    if (!sheetEvent) return "";
    const start = formatTimeLabel(sheetEvent.time, locale);
    return sheetEvent.end_time ? `${start} – ${formatTimeLabel(sheetEvent.end_time, locale)}` : start;
  }, [locale, sheetEvent]);
  const sheetChildLabel = useMemo(() => {
    if (!sheetEvent) return "";
    const names = eventChildMemberIds(sheetEvent)
      .map((id) => family?.members.find((m) => m.id === id)?.name)
      .filter((n): n is string => !!n);
    if (names.length) return names.join(" · ");
    return eventScopeLabel(sheetEvent);
  }, [sheetEvent, family]);
  const sheetNeedsAssignment = sheetEvent ? eventScopeLabel(sheetEvent) === "배정 필요" : false;
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
        show("일정을 삭제했어요", "🗑️");
        setOpenSwipe(null);
        setConfirmSwipeDeleteId(null);
        if (closeAfter) closeSheet();
      },
      onError: () => show("삭제에 실패했어요. 다시 시도해 주세요", "⚠️"),
    });
  };
  const handleDelete = () => {
    if (!sheetEvent) return;
    deleteEventById(sheetEvent.id, true);
  };

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
  const selInView = selected.year === view.year && selected.month === view.month;
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
        const label = eventScopeLabel(e);
        if (label) map.set(e.id, label);
      }
    }
    return map;
  }, [events, family, multiChild]);

  const selLabel = formatCalendarDay(
    Date.UTC(selected.year, selected.month - 1, selected.day, 12),
    { locale, timeZone: "UTC", weekday: "long" },
  );

  const shiftMonth = (delta: number) =>
    setView((v) => {
      const m = v.month + delta;
      if (m < 1) return { year: v.year - 1, month: 12 };
      if (m > 12) return { year: v.year + 1, month: 1 };
      return { year: v.year, month: m };
    });

  return (
    <div className="hy-rise-in">
      {/* 월 헤더 */}
      <header className="pc-header">
        <div>
          <div className="pc-year">{view.year}</div>
          <div className="pc-month">
            {formatCalendarMonth(Date.UTC(view.year, view.month - 1, 1, 12), {
              locale,
              timeZone: "UTC",
            })}
          </div>
        </div>
        <div className="pc-header__nav">
          <button type="button" aria-label="이전 달" className="pc-navbtn hy-press" onClick={() => shiftMonth(-1)}>
            <ChevronLeft size={18} strokeWidth={2.4} color="#6D6469" />
          </button>
          <button type="button" aria-label="다음 달" className="pc-navbtn hy-press" onClick={() => shiftMonth(1)}>
            <ChevronRight size={18} strokeWidth={2.4} color="#6D6469" />
          </button>
          <button
            type="button"
            aria-label="일정 추가"
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
          <div className="pc-grid">
            {cells.map((d, i) => {
              if (d === null) {
                return <div key={`e${i}`} className="pc-cell-empty" aria-hidden="true" />;
              }
              const dow = new Date(view.year, view.month - 1, d).getDay();
              const isToday = isCurrentMonth && d === TODAY.day;
              const isSel = selInView && selected.day === d;
              const dayViews = byKey[ymdToDateKey(view.year, view.month, d)] ?? [];
              const dots = dayViews.slice(0, 3);
              const extra = dayViews.length - dots.length;
              const numStyle = isSel
                ? {
                    // 흰 숫자를 올리므로 두 stop 모두 4.5:1 을 넘는 채움을 쓴다
                    // (accent-light stop 은 2.0:1 이라 선택한 날짜가 가장 안 읽혔다).
                    color: "#fff",
                    background: "linear-gradient(135deg, var(--hy-accent-cta), var(--hy-accent-text))",
                    boxShadow: "0 6px 14px -4px rgba(240,81,143,.5)",
                  }
                : isToday
                  ? { color: "var(--hy-accent-text)", background: "var(--hy-accent-soft)" }
                  : { color: weekendColor(dow), background: "transparent" };
              return (
                <button
                  key={d}
                  type="button"
                  className="pc-day hy-press"
                  onClick={() => setSelected({ year: view.year, month: view.month, day: d })}
                >
                  <span className="pc-day__num" style={numStyle}>
                    {d}
                  </span>
                  <span className="pc-day__dots">
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
          {selIsToday && <span className="pc-today-badge">오늘</span>}
        </div>

        {/* 선택일 일정 */}
        {isLoading ? (
          <div className="pc-empty">
            <Loading label="일정을 불러오는 중" />
          </div>
        ) : isError ? (
          <div className="pc-empty">
            <div className="pc-empty__title">일정을 불러오지 못했어요</div>
            <button type="button" className="hy-section-action hy-press" onClick={() => void refetchEvents()}>
              다시 시도
            </button>
          </div>
        ) : selEvents.length > 0 ? (
          <div className="pc-events">
            {selEvents.map((e) => {
              const childLabel = childLabelById.get(e.id);
              const childWarn = childLabel === "배정 필요";
              const raw = rawById.get(e.id);
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
                        수정
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
                            취소
                          </button>
                          <button
                            type="button"
                            className="pc-swipe__action pc-swipe__action--delete hy-press"
                            onClick={() => deleteEventById(e.id)}
                            disabled={deleteEvent.isPending}
                            aria-busy={swipeDeletePending}
                          >
                            {swipeDeletePending ? "삭제 중" : "삭제"}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="pc-swipe__action pc-swipe__action--delete hy-press"
                          onClick={() => setConfirmSwipeDeleteId(e.id)}
                        >
                          <Trash2 size={16} strokeWidth={2.2} />
                          삭제
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
                        {e.tag}
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
            <div className="pc-empty__title">이 날은 일정이 없어요</div>
            <div className="pc-empty__sub">+ 버튼으로 새 일정을 더해 보세요</div>
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
            aria-label="닫기"
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
                {CATEGORY_LABELS[sheetEvent.category] ?? "기타"}
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
                  <span>{reminderLabel(sheetReminder, locale)}</span>
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
                <div className="pc-sheet__confirm-text">이 일정을 삭제할까요?</div>
                <div className="pc-sheet__actions">
                  <button
                    type="button"
                    className="pc-btn pc-btn--ghost hy-press"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleteEvent.isPending}
                    data-progress-owner="confirm-action"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="pc-btn pc-btn--danger hy-press"
                    onClick={handleDelete}
                    disabled={deleteEvent.isPending} aria-busy={deleteEvent.isPending}
                  >
                    {deleteEvent.isPending ? "삭제 중…" : "삭제"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="pc-sheet__actions">
                <button
                  type="button"
                  className="pc-btn pc-btn--ghost hy-press"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={16} strokeWidth={2.2} /> 삭제
                </button>
                <button
                  type="button"
                  className="pc-btn pc-btn--primary hy-press"
                  onClick={handleEdit}
                >
                  <Pencil size={16} strokeWidth={2.2} /> {sheetNeedsAssignment ? "배정하기" : "수정"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

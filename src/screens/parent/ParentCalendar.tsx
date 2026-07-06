import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus, Clock, MapPin, Bell, Pencil, Trash2 } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useEvents, useDeleteEvent } from "@/queries/useSchedule";
import { useMyFamily } from "@/queries/useFamily";
import { eventToView, formatTimeLabel, groupEventsByDateKey } from "@/transform/scheduleView";
import { ymdToDateKey } from "@/transform/dateKey";
import { notifOverrideToReminderMinutes, type CalendarEvent } from "@/lib/api/endpoints/schedule";

/** 사전알림(분) → 사람이 읽는 라벨. */
function reminderLabel(minutes: number): string {
  return minutes >= 60 ? `${minutes / 60}시간 전 알림` : `${minutes}분 전 알림`;
}
import "./ParentCalendar.css";

type ViewMonth = { year: number; month: number };
type SelDate = { year: number; month: number; day: number };

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 카테고리 한국어 라벨(태그 표시용 — 색은 이벤트 뷰의 tag 색을 재사용). */
const CATEGORY_LABELS: Record<string, string> = {
  school: "학교",
  sports: "운동",
  hobby: "취미",
  family: "가족",
  friend: "친구",
  other: "기타",
};

/** 주말 신호색: 일요일 레드, 토요일 파랑, 평일 본문색. */
const weekendColor = (dow: number): string =>
  dow === 0 ? "#E5484D" : dow === 6 ? "#2E86C1" : "#3A3236";

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
  const { show } = useToast();
  const navigate = useNavigate();
  const now = useMemo(() => new Date(), []);
  const TODAY = useMemo(
    () => ({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }),
    [now],
  );

  const [view, setView] = useState<ViewMonth>({ year: TODAY.year, month: TODAY.month });
  const [selected, setSelected] = useState<SelDate>({ ...TODAY });

  const { data: events, isLoading, isError } = useEvents();
  const { data: family } = useMyFamily();
  const deleteEvent = useDeleteEvent();
  const byKey = useMemo(() => groupEventsByDateKey(events ?? [], now), [events, now]);
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
    if (dragY > 90) closeSheet();
    else setDragY(0);
    dragStart.current = null;
  };

  const sheetView = sheetEvent ? eventToView(sheetEvent, now) : null;
  const sheetTimeLabel = useMemo(() => {
    if (!sheetEvent) return "";
    const start = formatTimeLabel(sheetEvent.time);
    return sheetEvent.end_time ? `${start} – ${formatTimeLabel(sheetEvent.end_time)}` : start;
  }, [sheetEvent]);
  const sheetChildLabel = useMemo(() => {
    if (!sheetEvent) return "";
    const ids = (sheetEvent.events_children ?? [])
      .map((c) => c.child_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const names = ids
      .map((id) => family?.members.find((m) => m.id === id)?.name)
      .filter((n): n is string => !!n);
    if (names.length) return names.join(" · ");
    if (sheetEvent.is_family_event) return "가족 일정";
    return "";
  }, [sheetEvent, family]);
  const sheetReminder = useMemo(() => {
    if (!sheetEvent) return null;
    return notifOverrideToReminderMinutes(sheetEvent.notif_override);
  }, [sheetEvent]);

  const handleEdit = () => {
    if (!sheetEvent) return;
    navigate("/event-form", { state: { mode: "edit", event: sheetEvent } });
  };
  const handleDelete = () => {
    if (!sheetEvent || deleteEvent.isPending) return;
    deleteEvent.mutate(sheetEvent.id, {
      onSuccess: () => {
        show("일정을 삭제했어요", "🗑️");
        closeSheet();
      },
      onError: () => show("삭제에 실패했어요. 다시 시도해 주세요", "⚠️"),
    });
  };

  const isCurrentMonth = view.year === TODAY.year && view.month === TODAY.month;
  const selInView = selected.year === view.year && selected.month === view.month;
  const selIsToday =
    selected.year === TODAY.year && selected.month === TODAY.month && selected.day === TODAY.day;
  const selEvents = byKey[ymdToDateKey(selected.year, selected.month, selected.day)] ?? [];

  // 이벤트별 배정 아이 이름(다자녀 리스트 구분 배지). 배정 없으면 가족 공유 → 배지 없음.
  // 아이가 2명 이상일 때만 노출(1명이면 소음).
  const multiChild = (family?.members ?? []).filter((m) => m.role === "child").length > 1;
  const childLabelById = useMemo(() => {
    const map = new Map<string, string>();
    if (!multiChild) return map;
    for (const e of events ?? []) {
      const names = (e.events_children ?? [])
        .map((c) => family?.members.find((m) => m.id === c.child_id)?.name)
        .filter((n): n is string => !!n);
      if (names.length) map.set(e.id, names.join("·"));
    }
    return map;
  }, [events, family, multiChild]);

  const selDow = new Date(selected.year, selected.month - 1, selected.day).getDay();
  const selLabel = `${selected.month}월 ${selected.day}일 ${WEEKDAYS[selDow]}요일`;

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
          <div className="pc-month">{view.month}월</div>
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
            {WEEKDAYS.map((w) => (
              <div key={w} className="pc-weekday">
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
                    color: "#fff",
                    background: "linear-gradient(135deg, var(--hy-accent-light), var(--hy-accent-deep))",
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
            <div className="pc-empty__title">일정을 불러오는 중…</div>
          </div>
        ) : isError ? (
          <div className="pc-empty">
            <div className="pc-empty__title">일정을 불러오지 못했어요</div>
          </div>
        ) : selEvents.length > 0 ? (
          <div className="pc-events">
            {selEvents.map((e) => (
              <div key={e.id} className="pc-event">
                <div className="pc-event__rail">
                  <span className="pc-event__node" style={{ background: e.color, boxShadow: `0 0 0 4px ${e.soft}` }} />
                  <span className="pc-event__line" />
                </div>
                <button
                  type="button"
                  className="pc-event__card hy-press"
                  onClick={() => openSheet(e.id)}
                >
                  <span className="pc-event__icon" style={{ background: e.soft, fontSize: 22, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {e.emoji}
                  </span>
                  <span className="pc-event__body">
                    <span className="pc-event__time">
                      {e.time}
                      {childLabelById.get(e.id) && (
                        <span className="pc-event__child">{childLabelById.get(e.id)}</span>
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
            ))}
          </div>
        ) : (
          <div className="pc-empty">
            <img src={asset("cat/other.webp")} alt="" />
            <div className="pc-empty__title">이 날은 일정이 없어요</div>
            <div className="pc-empty__sub">+ 버튼으로 새 일정을 더해보세요</div>
          </div>
        )}
      </div>

      {/* 일정 상세 바텀시트(P-08) */}
      {sheetEvent && sheetView && (
        <div className="pc-sheet-root" role="dialog" aria-modal="true">
          <button type="button" className="pc-scrim" aria-label="닫기" onClick={closeSheet} />
          <div
            className="pc-sheet"
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
              <span className="pc-sheet__icon" style={{ background: sheetView.soft }}>
                {sheetView.emoji}
              </span>
              <div className="pc-sheet__headtext">
                <div className="pc-sheet__title">{sheetView.title}</div>
                {sheetChildLabel && <div className="pc-sheet__sub">{sheetChildLabel}</div>}
              </div>
              <span
                className="pc-sheet__tag"
                style={{ color: sheetView.tagText, background: sheetView.tagBg }}
              >
                {CATEGORY_LABELS[sheetEvent.category] ?? "기타"}
              </span>
            </div>

            <div className="pc-sheet__rows">
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
                  <span>{reminderLabel(sheetReminder)}</span>
                </div>
              )}
              {sheetEvent.memo && (
                <div className="pc-sheet__row pc-sheet__row--memo">
                  <span className="pc-sheet__memo-ic" aria-hidden="true">
                    📝
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
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    className="pc-btn pc-btn--danger hy-press"
                    onClick={handleDelete}
                    disabled={deleteEvent.isPending}
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
                  <Pencil size={16} strokeWidth={2.2} /> 수정
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

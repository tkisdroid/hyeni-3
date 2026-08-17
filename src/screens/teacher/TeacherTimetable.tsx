import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Plus, MapPin, Copy, CalendarDays } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useTeacherClasses, useRoster, useClassSchedule, useCopyClassWeekSchedule } from "@/queries/useTeacher";
import { isMissingFunction } from "@/lib/api/errors";
import { dateToDateKey } from "@/transform/dateKey";
import { isoDateKey } from "@/transform/teacherView";
import type { ClassScheduleRow } from "@/lib/api/endpoints/teacher";
import { useLocale } from "@/i18n/useLocale";
import { formatCalendarDay } from "@/i18n/format";
import "./TeacherTimetable.css";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";

// events.category → 반 시간표용 안내 문구 ID(school/sports/hobby/other).
const CATEGORY_MESSAGE_IDS: Record<string, string> = {
  school: "shared.teacherTimetable.category.school",
  sports: "shared.teacherTimetable.category.sports",
  hobby: "shared.teacherTimetable.category.hobby",
  other: "shared.teacherTimetable.category.other",
};

// "HH:MM" → 자정 기준 분(정수). 형식 어긋나면 null(시간 미정).
function hhmmToMinutes(value: string | null): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}

// 반 일정 행을 시간순으로 안정 정렬(시간 미정은 뒤, 동시각은 아이 이름 → 입력 순서).
function sortByTime(rows: ClassScheduleRow[]): ClassScheduleRow[] {
  return rows
    .map((row, index) => ({ row, index, min: hhmmToMinutes(row.time) }))
    .sort((a, b) => {
      if (a.min === null && b.min !== null) return 1;
      if (a.min !== null && b.min === null) return -1;
      if (a.min !== null && b.min !== null && a.min !== b.min) return a.min - b.min;
      const byName = a.row.childName.localeCompare(b.row.childName, "ko");
      return byName !== 0 ? byName : a.index - b.index;
    })
    .map((entry) => entry.row);
}

export function TeacherTimetable() {
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { show } = useToast();

  const classesQ = useTeacherClasses();
  const firstClass = classesQ.data?.[0] ?? null;
  const classId = firstClass?.classId ?? null;
  const className = firstClass?.className
    ?? intl.formatMessage({ id: "shared.teacherTimetable.classFallback" });

  const rosterQ = useRoster(classId);
  const studentCount = rosterQ.data?.length ?? 0;
  const copyWeek = useCopyClassWeekSchedule();

  // 이번 주(월~일) 날짜 스트립 + 오늘 키. 마운트 시 고정(쿼리키 churn 방지).
  const { weekDays, todayKey } = useMemo(() => {
    const now = new Date();
    const dow = now.getDay(); // 0=일 … 6=토
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
    const days = Array.from(
      { length: 7 },
      (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i),
    );
    return { weekDays: days, todayKey: dateToDateKey(now) };
  }, []);

  // 선택 날짜(기본 오늘). events 도메인 date_key 로 반 일정을 조회한다.
  const [selectedKey, setSelectedKey] = useState<string>(todayKey);
  const selectedDate = useMemo(() => {
    const found = weekDays.find((d) => dateToDateKey(d) === selectedKey);
    return found ?? new Date();
  }, [weekDays, selectedKey]);

  const selectedLabel = formatCalendarDay(
    Date.UTC(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 12),
    { locale, timeZone: "UTC", weekday: "short" },
  );

  const scheduleQ = useClassSchedule(classId, selectedKey);
  const rows = useMemo(() => sortByTime(scheduleQ.data ?? []), [scheduleQ.data]);
  const weekStartKey = useMemo(() => dateToDateKey(weekDays[0]), [weekDays]);

  const loading = classesQ.isLoading;
  const genuineError = classesQ.isError && !isMissingFunction(classesQ.error);
  const notReady = !loading && !classId;

  // '일정 추가' = 반 일정 편집의 실경로. 알림장(events 자동등록)으로 부모 캘린더에 반영된다.
  // 선택 날짜(ISO 입력값)를 넘겨 알림장 반영일을 미리 채운다.
  const goAddSchedule = () => {
    if (!classId) {
      show(intl.formatMessage({ id: "shared.teacherTimetable.add.needClass" }), "🧑‍🏫");
      return;
    }
    navigate("/teacher/notice", { state: { dateInput: isoDateKey(selectedDate) } });
  };

  const copyCurrentWeek = () => {
    if (!classId || copyWeek.isPending) return;
    copyWeek.mutate(
      { classId, weekStartDateKey: weekStartKey },
      {
        onSuccess: (res) => {
          if (res.copied > 0) {
            show(
              intl.formatMessage(
                {
                  id: res.skipped > 0
                    ? "shared.teacherTimetable.copy.successWithSkipped"
                    : "shared.teacherTimetable.copy.success",
                },
                { copied: res.copied, skipped: res.skipped },
              ),
              "🗓️",
            );
          } else if (res.sourceCount > 0) {
            show(intl.formatMessage({ id: "shared.teacherTimetable.copy.duplicate" }), "🗓️");
          } else {
            show(intl.formatMessage({ id: "shared.teacherTimetable.copy.empty" }), "🗓️");
          }
        },
        onError: (err) => show(localizeApiError(err, intl, "formal"), "⚠️"),
      },
    );
  };

  return (
    <div className="hy-rise-in">
      <header className="tt-topbar">
        <span className="tt-topbar__title">
          {intl.formatMessage({ id: "shared.teacherTimetable.title" })}
        </span>
        <button type="button" className="tt-add hy-press" onClick={goAddSchedule}>
          <Plus size={15} strokeWidth={2.6} />
          {intl.formatMessage({ id: "shared.teacherTimetable.add.action" })}
        </button>
      </header>

      <div className="tt-body">
        {loading && (
          <div className="tt-empty tt-empty--soft">
            {intl.formatMessage({ id: "shared.teacherTimetable.loading" })}
          </div>
        )}

        {notReady && (
          <div className="tt-empty">
            <span className="tt-empty__emoji"><img src={asset("mascot/teacher-glasses.webp")} alt="" style={{ width: 48, height: 48, objectFit: "contain", borderRadius: 12 }} /></span>
            <span className="tt-empty__title">
              {intl.formatMessage({
                id: genuineError
                  ? "shared.teacherTimetable.empty.error.heading"
                  : "shared.teacherTimetable.empty.class.heading",
              })}
            </span>
            <span className="tt-empty__sub">
              {intl.formatMessage({
                id: genuineError
                  ? "shared.teacherTimetable.empty.error.description"
                  : "shared.teacherTimetable.empty.class.description",
              })}
            </span>
          </div>
        )}

        {!loading && !notReady && (
          <>
            <div className="tt-meta">
              {className} · <span className="tt-meta__count">
                {intl.formatMessage(
                  { id: "shared.teacherTimetable.meta.students" },
                  { count: studentCount },
                )}
              </span>
            </div>

            {/* 주간 날짜 스트립 — 요일을 눌러 그날의 반 일정을 본다(실데이터). */}
            <div
              className="tt-week"
              role="tablist"
              aria-label={intl.formatMessage({ id: "shared.teacherTimetable.week.aria" })}
            >
              {weekDays.map((d) => {
                const key = dateToDateKey(d);
                const active = key === selectedKey;
                const isToday = key === todayKey;
                const weekdayLabel = formatCalendarDay(
                  Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12),
                  { locale, timeZone: "UTC", weekday: "short" },
                );
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`tt-day-chip hy-press${active ? " tt-day-chip--on" : ""}${
                      isToday ? " tt-day-chip--today" : ""
                    }`}
                    onClick={() => setSelectedKey(key)}
                  >
                    <span className="tt-day-chip__dow">{weekdayLabel}</span>
                    <span className="tt-day-chip__num">{d.getDate()}</span>
                  </button>
                );
              })}
            </div>

            {/* 선택한 날의 반 일정 */}
            <div className="hy-card tt-day-card">
              <div className="tt-day-head">
                {selectedLabel}{intl.formatMessage({ id: "shared.teacherTimetable.day.scheduleSuffix" })}
              </div>

              {scheduleQ.isLoading ? (
                <div className="tt-day-state">
                  {intl.formatMessage({ id: "shared.teacherTimetable.schedule.loading" })}
                </div>
              ) : scheduleQ.isError ? (
                <div className="tt-day-state tt-day-state--err">
                  {intl.formatMessage({ id: "shared.teacherTimetable.schedule.error" })}
                  <button
                    type="button"
                    className="tt-retry hy-press"
                    onClick={() => scheduleQ.refetch()}
                  >
                    {intl.formatMessage({ id: "shared.teacherTimetable.schedule.retry" })}
                  </button>
                </div>
              ) : rows.length === 0 ? (
                <div className="tt-day-state">
                  {intl.formatMessage({ id: "shared.teacherTimetable.schedule.empty" })}
                </div>
              ) : (
                <ul className="tt-list">
                  {rows.map((row) => (
                    <li key={row.eventId} className="tt-item">
                      <span className="tt-item__time">
                        {row.time ?? intl.formatMessage({ id: "shared.teacherTimetable.schedule.timeUnknown" })}
                        {row.time && row.endTime ? (
                          <span className="tt-item__end">~{row.endTime}</span>
                        ) : null}
                      </span>
                      <span className="tt-item__body">
                        <span className="tt-item__title">{row.title}</span>
                        <span className="tt-item__sub">
                          {row.childName}
                          {row.location ? (
                            <span className="tt-item__loc">
                              <MapPin size={11} strokeWidth={2.2} />
                              {row.location}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      {row.category ? (
                        <span className="tt-item__cat">
                          {CATEGORY_MESSAGE_IDS[row.category]
                            ? intl.formatMessage({ id: CATEGORY_MESSAGE_IDS[row.category] })
                            : row.category}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 반 일정은 알림장으로 추가하고, 현재 주간은 서버에서 다음 주로 복사한다. */}
            <div className="tt-note hy-explain">
              <span className="tt-note__ico"><CalendarDays size={15} strokeWidth={2.2} /></span>
              <span className="hy-explain__lines">
                <span className="hy-explain__line">
                  {intl.formatMessage({ id: "shared.teacherTimetable.note.summary" })}
                </span>
                <span className="hy-explain__line">
                  {intl.formatMessage({ id: "shared.teacherTimetable.note.beforeAction" })}
                  <b>{intl.formatMessage({ id: "shared.teacherTimetable.note.action" })}</b>
                  {intl.formatMessage({ id: "shared.teacherTimetable.note.afterAction" })}
                </span>
              </span>
              <button
                type="button"
                className="tt-copy hy-press"
                onClick={copyCurrentWeek}
                disabled={copyWeek.isPending} aria-busy={copyWeek.isPending}
              >
                <Copy size={14} strokeWidth={2.4} />
                {copyWeek.isPending
                  ? intl.formatMessage({ id: "shared.teacherTimetable.copy.pending" })
                  : intl.formatMessage({ id: "shared.teacherTimetable.copy.action" })}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

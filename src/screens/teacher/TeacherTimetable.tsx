import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, MapPin, Copy, CalendarDays } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useTeacherClasses, useRoster, useClassSchedule, useCopyClassWeekSchedule } from "@/queries/useTeacher";
import { isMissingFunction } from "@/lib/api/errors";
import { dateToDateKey } from "@/transform/dateKey";
import { isoDateKey } from "@/transform/teacherView";
import type { ClassScheduleRow } from "@/lib/api/endpoints/teacher";
import "./TeacherTimetable.css";

// 월요일 시작 요일 라벨(주간 스트립). 반 일정은 events 도메인(0-index date_key) 기준.
const DOW_MON_FIRST = ["월", "화", "수", "목", "금", "토", "일"] as const;
const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

// events.category → 반 시간표용 한글 라벨(school/sports/hobby/other).
const CATEGORY_LABEL: Record<string, string> = {
  school: "수업",
  sports: "운동",
  hobby: "취미",
  other: "기타",
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
  const navigate = useNavigate();
  const { show } = useToast();

  const classesQ = useTeacherClasses();
  const firstClass = classesQ.data?.[0] ?? null;
  const classId = firstClass?.classId ?? null;
  const className = firstClass?.className ?? "우리 반";

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

  const selectedLabel = `${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일 (${
    DOW_KO[selectedDate.getDay()]
  })`;

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
      show("먼저 반을 만들고 학생을 연결해 주세요", "🧑‍🏫");
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
            const skipped = res.skipped > 0 ? ` · 중복 ${res.skipped}건 제외` : "";
            show(`다음 주로 ${res.copied}건 복사했어요${skipped}`, "🗓️");
          } else if (res.sourceCount > 0) {
            show("이미 다음 주에 같은 일정이 있어요", "🗓️");
          } else {
            show("복사할 반 일정이 없어요", "🗓️");
          }
        },
        onError: (err) => show(err instanceof Error ? err.message : "주간 복사에 실패했어요", "⚠️"),
      },
    );
  };

  return (
    <div className="hy-rise-in">
      <header className="tt-topbar">
        <span className="tt-topbar__title">주간 시간표</span>
        <button type="button" className="tt-add hy-press" onClick={goAddSchedule}>
          <Plus size={15} strokeWidth={2.6} />
          일정 추가
        </button>
      </header>

      <div className="tt-body">
        {loading && <div className="tt-empty tt-empty--soft">반 정보를 불러오는 중…</div>}

        {notReady && (
          <div className="tt-empty">
            <span className="tt-empty__emoji"><img src={asset("mascot/teacher-glasses.webp")} alt="" style={{ width: 48, height: 48, objectFit: "contain", borderRadius: 12 }} /></span>
            <span className="tt-empty__title">
              {genuineError ? "잠시 후 다시 시도해 주세요" : "연결된 반이 없어요"}
            </span>
            <span className="tt-empty__sub">
              {genuineError
                ? "반 정보를 불러오지 못했어요."
                : "홈에서 반을 만들고 학생을 연결하면 반 시간표가 여기에 표시돼요."}
            </span>
          </div>
        )}

        {!loading && !notReady && (
          <>
            <div className="tt-meta">
              {className} · 학생 <span className="tt-meta__count">{studentCount}명</span>
            </div>

            {/* 주간 날짜 스트립 — 요일을 눌러 그날의 반 일정을 본다(실데이터). */}
            <div className="tt-week" role="tablist" aria-label="요일 선택">
              {weekDays.map((d, i) => {
                const key = dateToDateKey(d);
                const active = key === selectedKey;
                const isToday = key === todayKey;
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
                    <span className="tt-day-chip__dow">{DOW_MON_FIRST[i]}</span>
                    <span className="tt-day-chip__num">{d.getDate()}</span>
                  </button>
                );
              })}
            </div>

            {/* 선택한 날의 반 일정 */}
            <div className="hy-card tt-day-card">
              <div className="tt-day-head">{selectedLabel} 반 일정</div>

              {scheduleQ.isLoading ? (
                <div className="tt-day-state">반 일정을 불러오는 중…</div>
              ) : scheduleQ.isError ? (
                <div className="tt-day-state tt-day-state--err">
                  반 일정을 불러오지 못했어요.
                  <button
                    type="button"
                    className="tt-retry hy-press"
                    onClick={() => scheduleQ.refetch()}
                  >
                    다시 시도
                  </button>
                </div>
              ) : rows.length === 0 ? (
                <div className="tt-day-state">이 날은 등록된 반 일정이 없어요</div>
              ) : (
                <ul className="tt-list">
                  {rows.map((row) => (
                    <li key={row.eventId} className="tt-item">
                      <span className="tt-item__time">
                        {row.time ?? "시간 미정"}
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
                          {CATEGORY_LABEL[row.category] ?? row.category}
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
                <span className="hy-explain__line">반 일정은 아이별 캘린더에서 모여요.</span>
                <span className="hy-explain__line">
                  새 일정은 <b>‘일정 추가’(알림장)</b>로 보내면 학부모 캘린더에 함께 반영돼요.
                </span>
              </span>
              <button
                type="button"
                className="tt-copy hy-press"
                onClick={copyCurrentWeek}
                disabled={copyWeek.isPending} aria-busy={copyWeek.isPending}
              >
                <Copy size={14} strokeWidth={2.4} />
                {copyWeek.isPending ? "복사 중" : "다음 주로 복사"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

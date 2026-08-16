import { useId, useMemo, useRef, useState } from "react";
import { Link2, Plus, X } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import {
  useTeacherClasses,
  useRoster,
  useAttendance,
  useSetAttendance,
  useRequestPairing,
} from "@/queries/useTeacher";
import { isMissingFunction } from "@/lib/api/errors";
import { isoDateKey, mapRosterToStudents, type StudentView } from "@/transform/teacherView";
import "./TeacherStudents.css";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";

// 선생님이 기록 가능한 참석 상태(백엔드 enum 중 의미 있는 3종). '지각'은 서버 상태가 없어 미노출.
const ATTEND_ACTIONS = [
  { status: "attended", labelId: "shared.teacherStudents.attendance.attended" },
  { status: "left", labelId: "shared.teacherStudents.attendance.left" },
  { status: "absent", labelId: "shared.teacherStudents.attendance.absent" },
] as const;

// 연결 요청 결과 status → 안내 문구 ID(서버 jsonb status 계약).
const PAIRING_MESSAGE_IDS: Record<string, string> = {
  not_found: "shared.teacherStudents.pairing.notFound",
  rate_limited: "shared.teacherStudents.pairing.rateLimited",
  duplicate: "shared.teacherStudents.pairing.duplicate",
  revoked_blocked: "shared.teacherStudents.pairing.revokedBlocked",
};

const ATTENDANCE_MESSAGE_IDS: Record<StudentView["status"], string> = {
  attended: "shared.teacherStudents.attendance.attended",
  left: "shared.teacherStudents.attendance.left",
  absent: "shared.teacherStudents.attendance.absent",
  unknown: "shared.teacherStudents.attendance.unknown",
  pending: "shared.teacherStudents.attendance.pending",
};

const SCOPE_MESSAGE_IDS: Record<string, string> = {
  "일정 공유": "shared.teacherStudents.scope.schedule",
  "일정·출석": "shared.teacherStudents.scope.scheduleAttendance",
  "일정·출석·위치": "shared.teacherStudents.scope.scheduleAttendanceLocation",
  "연결됨": "shared.teacherStudents.scope.connected",
};

export function TeacherStudents() {
  const { show } = useToast();
  const intl = useIntl();

  // 출석 태그·기록 기준일(표준 ISO). 마운트 시 고정해 쿼리키 churn 방지.
  const todayIso = useMemo(() => isoDateKey(new Date()), []);

  const classesQ = useTeacherClasses();
  const firstClass = classesQ.data?.[0] ?? null;
  const classId = firstClass?.classId ?? null;
  const className = firstClass?.className
    ?? intl.formatMessage({ id: "shared.teacherStudents.classFallback" });

  const rosterQ = useRoster(classId);
  const attendanceQ = useAttendance(classId, todayIso);

  const students = useMemo(
    () => mapRosterToStudents(rosterQ.data ?? [], attendanceQ.data ?? []),
    [rosterQ.data, attendanceQ.data],
  );

  // ── 출석 기록(출석·하교·결석) ──
  const setAttendance = useSetAttendance();
  const [savingAttendance, setSavingAttendance] = useState<{
    childMemberId: string;
    status: (typeof ATTEND_ACTIONS)[number]["status"];
  } | null>(null);

  const saveAttendance = (s: StudentView, status: (typeof ATTEND_ACTIONS)[number]["status"]) => {
    if (s.status === status && savingAttendance?.childMemberId !== s.childMemberId) {
      // 이미 같은 상태면 재저장 불필요.
      return;
    }
    if (setAttendance.isPending) return;
    setSavingAttendance({ childMemberId: s.childMemberId, status });
    setAttendance.mutate(
      { childMemberId: s.childMemberId, dateKey: todayIso, status, scheduleId: null },
      {
        onSuccess: () => show(
          `${s.name}${intl.formatMessage({ id: "shared.teacherStudents.attendance.saved" })}`,
          "✅",
        ),
        onError: (err) =>
          show(localizeApiError(err, intl, "formal"), "⚠️"),
        onSettled: () => setSavingAttendance(null),
      },
    );
  };

  // ── 학생 초대(선생님 → 부모 연결 요청) ──
  const requestPairing = useRequestPairing();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteChild, setInviteChild] = useState("");
  const inviteTitleId = useId();
  const inviteDescriptionId = useId();
  const inviteCloseRef = useRef<HTMLButtonElement>(null);
  const inviteDialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: inviteOpen,
    onClose: () => setInviteOpen(false),
    initialFocusRef: inviteCloseRef,
    canClose: () => !requestPairing.isPending,
  });

  const openInvite = () => {
    if (!classId) {
      show(intl.formatMessage({ id: "shared.teacherStudents.invite.needClass" }), "🧑‍🏫");
      return;
    }
    setInvitePhone("");
    setInviteChild("");
    setInviteOpen(true);
  };

  const sendInvite = () => {
    if (!classId) return;
    const phone = invitePhone.trim();
    if (!phone) {
      show(intl.formatMessage({ id: "shared.teacherStudents.invite.phoneRequired" }), "📞");
      return;
    }
    requestPairing.mutate(
      { classId, phone, childName: inviteChild.trim() || null },
      {
        onSuccess: (data) => {
          if (data.status === "ok") {
            show(intl.formatMessage({ id: "shared.teacherStudents.pairing.success" }), "🔗");
            setInviteOpen(false);
            setInvitePhone("");
            setInviteChild("");
          } else {
            show(
              intl.formatMessage({
                id: PAIRING_MESSAGE_IDS[data.status ?? ""]
                  ?? "shared.teacherStudents.pairing.fallback",
              }),
              "⚠️",
            );
          }
        },
        onError: (err) => {
          show(localizeApiError(err, intl, "formal"), "⚠️");
        },
      },
    );
  };

  const studentsLoading = classesQ.isLoading
    || (!!classId && (rosterQ.isLoading || attendanceQ.isLoading));
  const studentsError = (classesQ.isError && !isMissingFunction(classesQ.error))
    || rosterQ.isError
    || attendanceQ.isError;
  const notReady = !studentsLoading && !classId;
  const retryTeacherStudents = async () => {
    await Promise.all([classesQ.refetch(), rosterQ.refetch(), attendanceQ.refetch()]);
  };
  const [filterNotArrivedOnly, setFilterNotArrivedOnly] = useState(false);

  const isNotArrived = (status: StudentView["status"]) =>
    status !== "attended" && status !== "left";

  const visibleStudents = useMemo(
    () => (filterNotArrivedOnly ? students.filter((s) => isNotArrived(s.status)) : students),
    [students, filterNotArrivedOnly],
  );

  return (
    <div className="hy-rise-in">
      <div className="ts-header">
        <span className="ts-title">
          {intl.formatMessage({ id: "shared.teacherStudents.title" })}
        </span>
        <button
          type="button"
          className="ts-invite hy-press"
          aria-label={intl.formatMessage({ id: "shared.teacherStudents.invite.aria" })}
          onClick={openInvite}
        >
          <Plus size={22} strokeWidth={2.4} color="#23A876" />
        </button>
      </div>

      <div className="ts-body">
        {studentsLoading && (
          <div className="ts-empty ts-empty--soft">
            {intl.formatMessage({ id: "shared.teacherStudents.loading" })}
          </div>
        )}

        {!studentsLoading && studentsError && (
          <div className="ts-empty" role="alert">
            <span className="ts-empty__title">
              {intl.formatMessage({ id: "shared.teacherStudents.error.heading" })}
            </span>
            <span className="ts-empty__sub">
              {intl.formatMessage({ id: "shared.teacherStudents.error.description" })}
            </span>
            <button type="button" className="ts-filter__btn hy-press" onClick={() => void retryTeacherStudents()}>
              {intl.formatMessage({ id: "shared.teacherStudents.error.retry" })}
            </button>
          </div>
        )}

        {notReady && !studentsError && (
          <div className="ts-empty">
            <span className="ts-empty__emoji"><img src={asset("mascot/teacher-glasses.webp")} alt="" style={{ width: 48, height: 48, objectFit: "contain", borderRadius: 12 }} /></span>
            <span className="ts-empty__title">
              {intl.formatMessage({ id: "shared.teacherStudents.empty.class.heading" })}
            </span>
            <span className="ts-empty__sub">
              {intl.formatMessage({ id: "shared.teacherStudents.empty.class.description" })}
            </span>
          </div>
        )}

        {!studentsLoading && !studentsError && !notReady && (
          <>
            <div className="ts-meta">
              {className} · <span className="ts-meta__count">
                {intl.formatMessage(
                  { id: "shared.teacherStudents.meta.students" },
                  { count: students.length },
                )}
              </span>
            </div>
            <div className="ts-meta ts-meta-row">
              <span className="ts-subtitle">
                {filterNotArrivedOnly
                  ? intl.formatMessage(
                      { id: "shared.teacherStudents.filter.notArrivedCount" },
                      { count: visibleStudents.length },
                    )
                  : intl.formatMessage(
                      { id: "shared.teacherStudents.filter.displayedCount" },
                      { count: visibleStudents.length },
                    )}
              </span>
              <div
                className="ts-filter"
                role="group"
                aria-label={intl.formatMessage({ id: "shared.teacherStudents.filter.aria" })}
              >
                <button
                  type="button"
                  className={`ts-filter__btn hy-press${!filterNotArrivedOnly ? " ts-filter__btn--on" : ""}`}
                  onClick={() => setFilterNotArrivedOnly(false)}
                  aria-pressed={!filterNotArrivedOnly}
                >
                  {intl.formatMessage({ id: "shared.teacherStudents.filter.all" })}
                </button>
                <button
                  type="button"
                  className={`ts-filter__btn hy-press${filterNotArrivedOnly ? " ts-filter__btn--on" : ""}`}
                  onClick={() => setFilterNotArrivedOnly(true)}
                  aria-pressed={filterNotArrivedOnly}
                >
                  {intl.formatMessage({ id: "shared.teacherStudents.filter.notArrived" })}
                </button>
              </div>
            </div>

            <div className="hy-card ts-list">
              {visibleStudents.length === 0 && (
                <div className="ts-row--empty">
                  {intl.formatMessage({
                    id: filterNotArrivedOnly
                      ? "shared.teacherStudents.empty.notArrived"
                      : "shared.teacherStudents.empty.students",
                  })}
                </div>
              )}
              {visibleStudents.map((s) => {
                return (
                  <div key={s.id} className="ts-row">
                    <div className="ts-row__top">
                      <span className="ts-avatar" style={{ background: s.soft }}>
                        <img src={asset(s.avatar)} alt="" />
                      </span>
                      <span className="ts-main">
                        <span className="ts-name">{s.name}</span>
                        <span className="ts-parent">
                          {SCOPE_MESSAGE_IDS[s.subtitle]
                            ? intl.formatMessage({ id: SCOPE_MESSAGE_IDS[s.subtitle] })
                            : s.subtitle}
                        </span>
                      </span>
                      <span
                        className="ts-tag"
                        style={{ color: s.attend.tone, background: s.attend.bg }}
                      >
                        {intl.formatMessage({ id: ATTENDANCE_MESSAGE_IDS[s.status] })}
                      </span>
                    </div>
                    <div
                      className="ts-attend"
                      role="group"
                      aria-label={`${s.name}${intl.formatMessage({ id: "shared.teacherStudents.attendance.aria" })}`}
                    >
                      {ATTEND_ACTIONS.map((a) => {
                        const active = s.status === a.status;
                        const savingThisAction = savingAttendance?.childMemberId === s.childMemberId
                          && savingAttendance.status === a.status;
                        return (
                          <button
                            key={a.status}
                            type="button"
                            className={`ts-attend__btn${active ? " ts-attend__btn--on" : ""} hy-press`}
                            data-status={a.status}
                            aria-pressed={active}
                            onClick={() => saveAttendance(s, a.status)}
                            disabled={setAttendance.isPending}
                            aria-busy={savingThisAction}
                          >
                            {intl.formatMessage({ id: a.labelId })}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="ts-hint hy-explain">
              <span className="ts-hint__ico"><Link2 size={15} strokeWidth={2.2} /></span>
              {intl.formatMessage({ id: "shared.teacherStudents.invite.description" })}
            </div>
          </>
        )}
      </div>

      {/* 학생 초대 시트 — 부모 전화번호로 연결 요청(useRequestPairing) */}
      {inviteOpen && (
        <div
          className="ts-sheet-overlay"
          role="presentation"
          onClick={() => !requestPairing.isPending && setInviteOpen(false)}
        >
          <div
            ref={inviteDialogRef}
            className="ts-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={inviteTitleId}
            aria-describedby={inviteDescriptionId}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ts-sheet__head">
              <span id={inviteTitleId} className="ts-sheet__title">
                {intl.formatMessage({ id: "shared.teacherStudents.invite.title" })}
              </span>
              <button
                ref={inviteCloseRef}
                type="button"
                className="ts-sheet__x hy-press"
                aria-label={intl.formatMessage({ id: "shared.teacherStudents.invite.close" })}
                onClick={() => setInviteOpen(false)}
                disabled={requestPairing.isPending}
                data-progress-owner="sheet-submit"
              >
                <X size={20} strokeWidth={2.4} color="#6D6469" />
              </button>
            </div>
            <p id={inviteDescriptionId} className="ts-sheet__desc">
              {intl.formatMessage({ id: "shared.teacherStudents.invite.description" })}
            </p>
            <div className="ts-sheet__label">
              {intl.formatMessage({ id: "shared.teacherStudents.invite.phoneLabel" })}
            </div>
            <input
              className="ts-sheet__input"
              type="tel"
              aria-label={intl.formatMessage({ id: "shared.teacherStudents.invite.phoneAria" })}
              inputMode="tel"
              value={invitePhone}
              onChange={(e) => setInvitePhone(e.target.value)}
              placeholder={intl.formatMessage({ id: "shared.teacherStudents.invite.phonePlaceholder" })}
            />
            <div className="ts-sheet__label">
              {intl.formatMessage({ id: "shared.teacherStudents.invite.childLabel" })}
            </div>
            <input
              className="ts-sheet__input"
              aria-label={intl.formatMessage({ id: "shared.teacherStudents.invite.childAria" })}
              value={inviteChild}
              onChange={(e) => setInviteChild(e.target.value)}
              placeholder={intl.formatMessage({ id: "shared.teacherStudents.invite.childPlaceholder" })}
            />
            <button
              type="button"
              className="ts-sheet__send hy-press"
              onClick={sendInvite}
              disabled={requestPairing.isPending} aria-busy={requestPairing.isPending}
            >
              {requestPairing.isPending
                ? intl.formatMessage({ id: "shared.teacherStudents.invite.pending" })
                : intl.formatMessage({ id: "shared.teacherStudents.invite.send" })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

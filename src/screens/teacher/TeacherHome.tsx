import { useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Settings, ChevronRight, X } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import {
  useTeacherMe,
  useTeacherClasses,
  useRoster,
  useAttendance,
  useRequestPairing,
  useCreateClass,
} from "@/queries/useTeacher";
import { isMissingFunction } from "@/lib/api/errors";
import { isoDateKey, mapRosterToStudents, countPresent } from "@/transform/teacherView";
import "./TeacherHome.css";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";

// 홈 미리보기에 노출할 출석 카드 수(전체는 /teacher/students).
const HOME_PREVIEW_LIMIT = 5;

// 연결 요청 결과 status → 번역 문구 ID(서버 jsonb status 계약).
const PAIRING_MESSAGE_IDS: Record<string, string> = {
  not_found: "shared.teacherHome.pairing.notFound",
  rate_limited: "shared.teacherHome.pairing.rateLimited",
  duplicate: "shared.teacherHome.pairing.duplicate",
  revoked_blocked: "shared.teacherHome.pairing.revokedBlocked",
};

export function TeacherHome() {
  const navigate = useNavigate();
  const { show } = useToast();
  const intl = useIntl();

  // 출석 조회 기준일(표준 ISO). 렌더마다 새 Date 생성 → 쿼리키 churn 방지 위해 마운트 시 고정.
  const todayIso = useMemo(() => isoDateKey(new Date()), []);

  const meQ = useTeacherMe();
  const classesQ = useTeacherClasses();
  const firstClass = classesQ.data?.[0] ?? null;
  const classId = firstClass?.classId ?? null;
  const className = firstClass?.className
    ?? intl.formatMessage({ id: "shared.teacherHome.classFallback" });

  const rosterQ = useRoster(classId);
  const attendanceQ = useAttendance(classId, todayIso);

  const students = useMemo(
    () => mapRosterToStudents(rosterQ.data ?? [], attendanceQ.data ?? []),
    [rosterQ.data, attendanceQ.data],
  );
  const presentCount = countPresent(students);
  const preview = students.slice(0, HOME_PREVIEW_LIMIT);

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
    setInvitePhone("");
    setInviteChild("");
    setInviteOpen(true);
  };

  const sendInvite = () => {
    if (!classId) {
      show(intl.formatMessage({ id: "shared.teacherHome.invite.classRequired" }), "🧑‍🏫");
      return;
    }
    const phone = invitePhone.trim();
    if (!phone) {
      show(intl.formatMessage({ id: "shared.teacherHome.invite.phoneRequired" }), "📞");
      return;
    }
    requestPairing.mutate(
      { classId, phone, childName: inviteChild.trim() || null },
      {
        onSuccess: (data) => {
          if (data.status === "ok") {
            show(intl.formatMessage({ id: "shared.teacherHome.invite.success" }), "🔗");
            setInviteOpen(false);
            setInvitePhone("");
            setInviteChild("");
          } else {
            show(
              intl.formatMessage({
                id: PAIRING_MESSAGE_IDS[data.status ?? ""]
                  ?? "shared.teacherHome.pairing.failed",
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

  // ── 반 만들기(선생님 프로필 보장 + 반 생성) ──
  const createClass = useCreateClass();
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const createTitleId = useId();
  const createDescriptionId = useId();
  const createCloseRef = useRef<HTMLButtonElement>(null);
  const createDialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: createOpen,
    onClose: () => setCreateOpen(false),
    initialFocusRef: createCloseRef,
    canClose: () => !createClass.isPending,
  });

  const openCreate = () => {
    setCreateName("");
    setCreateOpen(true);
  };

  const submitCreate = () => {
    const name = createName.trim();
    if (!name) {
      show(intl.formatMessage({ id: "shared.teacherHome.create.nameRequired" }), "🏫");
      return;
    }
    createClass.mutate(
      { className: name },
      {
        onSuccess: () => {
          show(intl.formatMessage({ id: "shared.teacherHome.create.success" }), "🎉");
          setCreateOpen(false);
          setCreateName("");
        },
        onError: (err) => {
          show(localizeApiError(err, intl, "formal"), "⚠️");
        },
      },
    );
  };

  const loading = meQ.isLoading
    || classesQ.isLoading
    || (!!classId && (rosterQ.isLoading || attendanceQ.isLoading));
  // 반이 없으면 반 생성 CTA를 보여준다. 진짜 오류(미배포 아님)는 재시도 안내.
  const genuineError = (classesQ.isError && !isMissingFunction(classesQ.error))
    || meQ.isError
    || rosterQ.isError
    || attendanceQ.isError;
  const notReady = !loading && !classId;
  const retryTeacherHome = async () => {
    await Promise.all([
      meQ.refetch(),
      classesQ.refetch(),
      rosterQ.refetch(),
      attendanceQ.refetch(),
    ]);
  };

  return (
    <div className="hy-rise-in">
      {/* 상단 헤더 (담당 반 브랜드 · 민트 틴트) */}
      <header className="th-topbar">
        <div className="th-brand">
          <span className="th-brand__icon">
            <img src={asset("cat/study.webp")} alt="" />
          </span>
          <span className="th-brand__title">
            {intl.formatMessage({ id: "shared.teacherHome.brand" })}
          </span>
        </div>
        <button
          type="button"
          className="hy-iconbtn hy-press th-settings"
          aria-label={intl.formatMessage({ id: "shared.teacherHome.settings" })}
          onClick={() => navigate("/teacher/settings")}
        >
          <Settings size={21} strokeWidth={1.9} />
        </button>
      </header>

      <div className="hy-content th-content">
        {loading && (
          <div className="th-empty th-empty--soft">
            {intl.formatMessage({ id: "shared.teacherHome.loading" })}
          </div>
        )}

        {!loading && genuineError && (
          <div className="th-empty" role="alert">
            <span className="th-empty__title">
              {intl.formatMessage({ id: "shared.teacherHome.loadError.title" })}
            </span>
            <span className="th-empty__sub">
              {intl.formatMessage({ id: "shared.teacherHome.loadError.description" })}
            </span>
            <button type="button" className="th-empty__cta hy-press" onClick={() => void retryTeacherHome()}>
              {intl.formatMessage({ id: "shared.teacherHome.loadError.retry" })}
            </button>
          </div>
        )}

        {notReady && !genuineError && (
          <div className="th-empty">
            <span className="th-empty__emoji"><img src={asset("mascot/teacher-glasses.webp")} alt="" style={{ width: 48, height: 48, objectFit: "contain", borderRadius: 12 }} /></span>
            <span className="th-empty__title">
              {intl.formatMessage({ id: "shared.teacherHome.empty.title" })}
            </span>
            <span className="th-empty__sub">
              {intl.formatMessage({ id: "shared.teacherHome.empty.description" })}
            </span>
            <button type="button" className="th-empty__cta hy-press" onClick={openCreate}>
              {intl.formatMessage({ id: "shared.teacherHome.create.action" })}
            </button>
          </div>
        )}

        {!loading && !genuineError && !notReady && (
          <>
            {/* 반 요약 히어로 */}
            <div className="th-hero">
              <span className="th-hero__sheen" />
              <div className="th-hero__school">
                {intl.formatMessage({ id: "shared.teacherHome.classLabel" })}
              </div>
              <div className="th-hero__name">{className}</div>
              <div className="th-hero__attend">
                {intl.formatMessage(
                  { id: "shared.teacherHome.attendanceToday" },
                  { present: presentCount, total: students.length },
                )}
              </div>
            </div>

            {/* 오늘 알림장 보내기 → 작성 화면(T-03) */}
            <button
              type="button"
              className="th-note hy-press"
              onClick={() => navigate("/teacher/notice")}
            >
              <span className="th-note__icon">
                <img src={asset("ui/megaphone.webp")} alt="" />
              </span>
              <span className="th-note__main">
                <span className="th-note__title">
                  {intl.formatMessage({ id: "shared.teacherHome.notice.title" })}
                </span>
                <span className="th-note__sub">
                  {intl.formatMessage({ id: "shared.teacherHome.notice.description" })}
                </span>
              </span>
              <ChevronRight size={20} strokeWidth={2.4} color="#B7A6E0" style={{ flex: "none" }} />
            </button>

            {/* 출석 현황 */}
            <section>
              <SectionHeader
                iconBg="#E7F8F0"
                icon={<img src={asset("ui/pin-heart.webp")} alt="" />}
                title={intl.formatMessage({ id: "shared.teacherHome.attendance.title" })}
                action={
                  <button
                    type="button"
                    className="hy-section-action th-viewall"
                    onClick={() => navigate("/teacher/students")}
                  >
                    {intl.formatMessage({ id: "shared.teacherHome.attendance.viewAll" })}
                  </button>
                }
              />
              <div className="hy-card th-students">
                {preview.length === 0 && (
                  <div className="th-student th-student--empty">
                    {intl.formatMessage({ id: "shared.teacherHome.attendance.empty" })}
                  </div>
                )}
                {preview.map((s) => (
                  <div key={s.id} className="th-student">
                    <span className="th-student__avatar" style={{ background: s.soft }}>
                      <img src={asset(s.avatar)} alt="" />
                    </span>
                    <span className="th-student__main">
                      <span className="th-student__name">{s.name}</span>
                      <span className="th-student__parent">{s.subtitle}</span>
                    </span>
                    <span
                      className="th-student__tag"
                      style={{ color: s.attend.tone, background: s.attend.bg }}
                    >
                      {s.attend.label}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* 하단 2열 바로가기 */}
            <div className="th-grid">
              <button type="button" className="th-tile hy-press" onClick={openInvite}>
                <span className="th-tile__icon" style={{ background: "#E7F8F0" }}>
                  <img src={asset("ui/friend-pair.webp")} alt="" />
                </span>
                <span className="th-tile__label">
                  {intl.formatMessage({ id: "shared.teacherHome.invite.title" })}
                </span>
              </button>
              <button
                type="button"
                className="th-tile hy-press"
                onClick={() => navigate("/teacher/timetable")}
              >
                <span className="th-tile__icon" style={{ background: "#FDE7F1" }}>
                  <img src={asset("ui/calendar-heart.webp")} alt="" />
                </span>
                <span className="th-tile__label">
                  {intl.formatMessage({ id: "shared.teacherHome.timetable" })}
                </span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* 학생 초대 시트 — 부모 전화번호로 연결 요청(useRequestPairing) */}
      {inviteOpen && (
        <div
          className="th-sheet-overlay"
          role="presentation"
          onClick={() => !requestPairing.isPending && setInviteOpen(false)}
        >
          <div
            ref={inviteDialogRef}
            className="th-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={inviteTitleId}
            aria-describedby={inviteDescriptionId}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="th-sheet__head">
              <span id={inviteTitleId} className="th-sheet__title">
                {intl.formatMessage({ id: "shared.teacherHome.invite.title" })}
              </span>
              <button
                ref={inviteCloseRef}
                type="button"
                className="th-sheet__x hy-press"
                aria-label={intl.formatMessage({ id: "shared.teacherHome.close" })}
                onClick={() => setInviteOpen(false)}
                disabled={requestPairing.isPending}
                data-progress-owner="sheet-submit"
              >
                <X size={20} strokeWidth={2.4} color="#6D6469" />
              </button>
            </div>
            <p id={inviteDescriptionId} className="th-sheet__desc">
              {intl.formatMessage({ id: "shared.teacherHome.invite.description" })}
            </p>
            <div className="th-sheet__label">
              {intl.formatMessage({ id: "shared.teacherHome.invite.phoneLabel" })}
            </div>
            <input
              className="th-sheet__input"
              type="tel"
              aria-label={intl.formatMessage({ id: "shared.teacherHome.invite.phoneLabel" })}
              inputMode="tel"
              value={invitePhone}
              onChange={(e) => setInvitePhone(e.target.value)}
              placeholder={intl.formatMessage({ id: "shared.teacherHome.invite.phonePlaceholder" })}
            />
            <div className="th-sheet__label">
              {intl.formatMessage({ id: "shared.teacherHome.invite.childNameLabel" })}
            </div>
            <input
              className="th-sheet__input"
              aria-label={intl.formatMessage({ id: "shared.teacherHome.invite.childNameAria" })}
              value={inviteChild}
              onChange={(e) => setInviteChild(e.target.value)}
              placeholder={intl.formatMessage({ id: "shared.teacherHome.invite.childNamePlaceholder" })}
            />
            <button
              type="button"
              className="th-sheet__send hy-press"
              onClick={sendInvite}
              disabled={requestPairing.isPending} aria-busy={requestPairing.isPending}
            >
              {requestPairing.isPending
                ? intl.formatMessage({ id: "shared.teacherHome.invite.pending" })
                : intl.formatMessage({ id: "shared.teacherHome.invite.send" })}
            </button>
          </div>
        </div>
      )}

      {/* 반 만들기 시트 — 선생님 프로필 보장 + 반 생성(useCreateClass) */}
      {createOpen && (
        <div
          className="th-sheet-overlay"
          role="presentation"
          onClick={() => !createClass.isPending && setCreateOpen(false)}
        >
          <div
            ref={createDialogRef}
            className="th-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={createTitleId}
            aria-describedby={createDescriptionId}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="th-sheet__head">
              <span id={createTitleId} className="th-sheet__title">
                {intl.formatMessage({ id: "shared.teacherHome.create.action" })}
              </span>
              <button
                ref={createCloseRef}
                type="button"
                className="th-sheet__x hy-press"
                aria-label={intl.formatMessage({ id: "shared.teacherHome.close" })}
                onClick={() => setCreateOpen(false)}
                disabled={createClass.isPending}
                data-progress-owner="sheet-submit"
              >
                <X size={20} strokeWidth={2.4} color="#6D6469" />
              </button>
            </div>
            <p id={createDescriptionId} className="th-sheet__desc">
              {intl.formatMessage({ id: "shared.teacherHome.create.description" })}
            </p>
            <div className="th-sheet__label">
              {intl.formatMessage({ id: "shared.teacherHome.create.nameLabel" })}
            </div>
            <input
              className="th-sheet__input"
              aria-label={intl.formatMessage({ id: "shared.teacherHome.create.nameLabel" })}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder={intl.formatMessage({ id: "shared.teacherHome.create.namePlaceholder" })}
              maxLength={40}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitCreate();
                }
              }}
            />
            <button
              type="button"
              className="th-sheet__send hy-press"
              onClick={submitCreate}
              disabled={createClass.isPending} aria-busy={createClass.isPending}
            >
              {createClass.isPending
                ? intl.formatMessage({ id: "shared.teacherHome.create.pending" })
                : intl.formatMessage({ id: "shared.teacherHome.create.action" })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

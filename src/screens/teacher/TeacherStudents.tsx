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
  { status: "attended", label: "출석" },
  { status: "left", label: "하교" },
  { status: "absent", label: "결석" },
] as const;

// 연결 요청 결과 status → 학부모용 한글 안내(서버 jsonb status 계약).
const PAIRING_MESSAGES: Record<string, string> = {
  not_found: "입력한 번호로 연결할 보호자·아이를 찾지 못했어요. 번호를 다시 확인해 주세요",
  rate_limited: "연결 요청이 많아요. 잠시 후 다시 시도해 주세요",
  duplicate: "이미 연결 요청을 보냈어요",
  revoked_blocked: "부모님이 연결을 해제하셨어요. 부모님께 직접 요청해 주세요",
};

export function TeacherStudents() {
  const { show } = useToast();
  const intl = useIntl();

  // 출석 태그·기록 기준일(표준 ISO). 마운트 시 고정해 쿼리키 churn 방지.
  const todayIso = useMemo(() => isoDateKey(new Date()), []);

  const classesQ = useTeacherClasses();
  const firstClass = classesQ.data?.[0] ?? null;
  const classId = firstClass?.classId ?? null;
  const className = firstClass?.className ?? "우리 반";

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
        onSuccess: () => show(`${s.name} 참석 상태를 저장했어요`, "✅"),
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
      show("먼저 반을 만들어야 학생을 초대할 수 있어요", "🧑‍🏫");
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
      show("부모님 전화번호를 입력해 주세요", "📞");
      return;
    }
    requestPairing.mutate(
      { classId, phone, childName: inviteChild.trim() || null },
      {
        onSuccess: (data) => {
          if (data.status === "ok") {
            show("부모님께 연결 요청을 보냈어요", "🔗");
            setInviteOpen(false);
            setInvitePhone("");
            setInviteChild("");
          } else {
            show(
              PAIRING_MESSAGES[data.status ?? ""] ??
                "연결 요청을 보내지 못했어요. 번호를 다시 확인해 주세요",
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
        <span className="ts-title">학생</span>
        <button
          type="button"
          className="ts-invite hy-press"
          aria-label="학생 초대"
          onClick={openInvite}
        >
          <Plus size={22} strokeWidth={2.4} color="#23A876" />
        </button>
      </div>

      <div className="ts-body">
        {studentsLoading && <div className="ts-empty ts-empty--soft">학생 명단을 불러오는 중…</div>}

        {!studentsLoading && studentsError && (
          <div className="ts-empty" role="alert">
            <span className="ts-empty__title">학생 명단을 불러오지 못했어요</span>
            <span className="ts-empty__sub">네트워크 연결을 확인한 뒤 다시 시도해 주세요.</span>
            <button type="button" className="ts-filter__btn hy-press" onClick={() => void retryTeacherStudents()}>
              다시 시도
            </button>
          </div>
        )}

        {notReady && !studentsError && (
          <div className="ts-empty">
            <span className="ts-empty__emoji"><img src={asset("mascot/teacher-glasses.webp")} alt="" style={{ width: 48, height: 48, objectFit: "contain", borderRadius: 12 }} /></span>
            <span className="ts-empty__title">
              연결된 반이 없어요
            </span>
            <span className="ts-empty__sub">
              반을 만들고 학생을 연결하면 여기에 명단이 표시돼요.
            </span>
          </div>
        )}

        {!studentsLoading && !studentsError && !notReady && (
          <>
            <div className="ts-meta">
              {className} · 학생 <span className="ts-meta__count">{students.length}명</span>
            </div>
            <div className="ts-meta ts-meta-row">
              <span className="ts-subtitle">
                {filterNotArrivedOnly
                  ? `미도착만 ${visibleStudents.length}명`
                  : `표시 학생 ${visibleStudents.length}명`}
              </span>
              <div className="ts-filter" role="group" aria-label="학생 보기 필터">
                <button
                  type="button"
                  className={`ts-filter__btn hy-press${!filterNotArrivedOnly ? " ts-filter__btn--on" : ""}`}
                  onClick={() => setFilterNotArrivedOnly(false)}
                  aria-pressed={!filterNotArrivedOnly}
                >
                  전체
                </button>
                <button
                  type="button"
                  className={`ts-filter__btn hy-press${filterNotArrivedOnly ? " ts-filter__btn--on" : ""}`}
                  onClick={() => setFilterNotArrivedOnly(true)}
                  aria-pressed={filterNotArrivedOnly}
                >
                  미도착만
                </button>
              </div>
            </div>

            <div className="hy-card ts-list">
              {visibleStudents.length === 0 && (
                <div className="ts-row--empty">
                  {filterNotArrivedOnly ? "현재 미도착 아이가 없어요" : "아직 등록된 학생이 없어요"}
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
                        <span className="ts-parent">{s.subtitle}</span>
                      </span>
                      <span
                        className="ts-tag"
                        style={{ color: s.attend.tone, background: s.attend.bg }}
                      >
                        {s.attend.label}
                      </span>
                    </div>
                    <div className="ts-attend" role="group" aria-label={`${s.name} 출결`}>
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
                            {a.label}
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
              부모님 전화번호로 초대하면, 부모님 승인 후 학생이 자동으로 연결돼요.
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
              <span id={inviteTitleId} className="ts-sheet__title">학생 초대</span>
              <button
                ref={inviteCloseRef}
                type="button"
                className="ts-sheet__x hy-press"
                aria-label="닫기"
                onClick={() => setInviteOpen(false)}
                disabled={requestPairing.isPending}
                data-progress-owner="sheet-submit"
              >
                <X size={20} strokeWidth={2.4} color="#6D6469" />
              </button>
            </div>
            <p id={inviteDescriptionId} className="ts-sheet__desc">
              부모님 전화번호로 초대하면, 부모님 승인 후 학생이 자동으로 연결돼요.
            </p>
            <div className="ts-sheet__label">부모님 전화번호</div>
            <input
              className="ts-sheet__input"
              type="tel"
              aria-label="부모님 전화번호"
              inputMode="tel"
              value={invitePhone}
              onChange={(e) => setInvitePhone(e.target.value)}
              placeholder="010-1234-5678"
            />
            <div className="ts-sheet__label">아이 이름 (선택)</div>
            <input
              className="ts-sheet__input"
              aria-label="아이 이름"
              value={inviteChild}
              onChange={(e) => setInviteChild(e.target.value)}
              placeholder="자녀가 여럿일 때 특정을 도와요"
            />
            <button
              type="button"
              className="ts-sheet__send hy-press"
              onClick={sendInvite}
              disabled={requestPairing.isPending} aria-busy={requestPairing.isPending}
            >
              {requestPairing.isPending ? "요청 보내는 중…" : "연결 요청 보내기"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

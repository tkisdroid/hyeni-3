import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings, ChevronRight, X } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { SectionHeader } from "@/components/ui/SectionHeader";
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

// 홈 미리보기에 노출할 출석 카드 수(전체는 /teacher/students).
const HOME_PREVIEW_LIMIT = 5;

// 연결 요청 결과 status → 학부모용 한글 안내(서버 jsonb status 계약).
const PAIRING_MESSAGES: Record<string, string> = {
  not_found: "입력한 번호로 연결할 보호자·아이를 찾지 못했어요. 번호를 다시 확인해 주세요",
  rate_limited: "연결 요청이 많아요. 잠시 후 다시 시도해 주세요",
  duplicate: "이미 연결 요청을 보냈어요",
  revoked_blocked: "부모님이 연결을 해제하셨어요. 부모님께 직접 요청해 주세요",
};

export function TeacherHome() {
  const navigate = useNavigate();
  const { show } = useToast();

  // 출석 조회 기준일(표준 ISO). 렌더마다 새 Date 생성 → 쿼리키 churn 방지 위해 마운트 시 고정.
  const todayIso = useMemo(() => isoDateKey(new Date()), []);

  const meQ = useTeacherMe();
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
  const presentCount = countPresent(students);
  const preview = students.slice(0, HOME_PREVIEW_LIMIT);

  // ── 학생 초대(선생님 → 부모 연결 요청) ──
  const requestPairing = useRequestPairing();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteChild, setInviteChild] = useState("");

  const openInvite = () => {
    setInvitePhone("");
    setInviteChild("");
    setInviteOpen(true);
  };

  const sendInvite = () => {
    if (!classId) {
      show("먼저 반을 만들어야 학생을 초대할 수 있어요", "🧑‍🏫");
      return;
    }
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
          show(err instanceof Error ? err.message : "연결 요청을 보내지 못했어요", "⚠️");
        },
      },
    );
  };

  // ── 반 만들기(선생님 프로필 보장 + 반 생성) ──
  const createClass = useCreateClass();
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");

  const openCreate = () => {
    setCreateName("");
    setCreateOpen(true);
  };

  const submitCreate = () => {
    const name = createName.trim();
    if (!name) {
      show("반 이름을 입력해 주세요", "🏫");
      return;
    }
    createClass.mutate(
      { className: name },
      {
        onSuccess: () => {
          show("반을 만들었어요. 이제 학생을 초대해 보세요", "🎉");
          setCreateOpen(false);
          setCreateName("");
        },
        onError: (err) => {
          show(err instanceof Error ? err.message : "반을 만들지 못했어요", "⚠️");
        },
      },
    );
  };

  const loading = meQ.isLoading || classesQ.isLoading;
  // 반이 없으면 반 생성 CTA를 보여준다. 진짜 오류(미배포 아님)는 재시도 안내.
  const genuineError = classesQ.isError && !isMissingFunction(classesQ.error);
  const notReady = !loading && !classId;

  return (
    <div className="hy-rise-in">
      {/* 상단 헤더 (담당 반 브랜드 · 민트 틴트) */}
      <header className="th-topbar">
        <div className="th-brand">
          <span className="th-brand__icon">
            <img src={asset("cat/study.webp")} alt="" />
          </span>
          <span className="th-brand__title">우리 반</span>
        </div>
        <button
          type="button"
          className="hy-iconbtn hy-press th-settings"
          aria-label="설정"
          onClick={() => navigate("/teacher/settings")}
        >
          <Settings size={21} strokeWidth={1.9} />
        </button>
      </header>

      <div className="hy-content th-content">
        {loading && <div className="th-empty th-empty--soft">반 정보를 불러오는 중…</div>}

        {notReady && (
          <div className="th-empty">
            <span className="th-empty__emoji"><img src={asset("mascot/teacher-glasses.webp")} alt="" style={{ width: 48, height: 48, objectFit: "contain", borderRadius: 12 }} /></span>
            <span className="th-empty__title">
              {genuineError ? "잠시 후 다시 시도해 주세요" : "연결된 반이 없어요"}
            </span>
            <span className="th-empty__sub">
              {genuineError
                ? "선생님 정보를 불러오지 못했어요."
                : "반을 만들고 학생을 연결하면 오늘 출석과 알림장이 여기에 표시돼요."}
            </span>
            {!genuineError && (
              <button type="button" className="th-empty__cta hy-press" onClick={openCreate}>
                반 만들기
              </button>
            )}
          </div>
        )}

        {!loading && !notReady && (
          <>
            {/* 반 요약 히어로 */}
            <div className="th-hero">
              <span className="th-hero__sheen" />
              <div className="th-hero__school">담당 학급</div>
              <div className="th-hero__name">{className}</div>
              <div className="th-hero__attend">
                오늘 출석 {presentCount}/{students.length}
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
                <span className="th-note__title">오늘 알림장 보내기</span>
                <span className="th-note__sub">준비물·숙제·공지를 반 전체에 전달</span>
              </span>
              <ChevronRight size={20} strokeWidth={2.4} color="#B7A6E0" style={{ flex: "none" }} />
            </button>

            {/* 출석 현황 */}
            <section>
              <SectionHeader
                iconBg="#E7F8F0"
                icon={<img src={asset("ui/pin-heart.webp")} alt="" />}
                title="출석 현황"
                action={
                  <button
                    type="button"
                    className="hy-section-action th-viewall"
                    onClick={() => navigate("/teacher/students")}
                  >
                    전체보기 ›
                  </button>
                }
              />
              <div className="hy-card th-students">
                {preview.length === 0 && (
                  <div className="th-student th-student--empty">아직 등록된 학생이 없어요</div>
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
                <span className="th-tile__label">학생 초대</span>
              </button>
              <button
                type="button"
                className="th-tile hy-press"
                onClick={() => navigate("/teacher/timetable")}
              >
                <span className="th-tile__icon" style={{ background: "#FDE7F1" }}>
                  <img src={asset("ui/calendar-heart.webp")} alt="" />
                </span>
                <span className="th-tile__label">반 시간표</span>
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
          onClick={() => setInviteOpen(false)}
        >
          <div className="th-sheet" role="dialog" aria-label="학생 초대" onClick={(e) => e.stopPropagation()}>
            <div className="th-sheet__head">
              <span className="th-sheet__title">학생 초대</span>
              <button
                type="button"
                className="th-sheet__x hy-press"
                aria-label="닫기"
                onClick={() => setInviteOpen(false)}
              >
                <X size={20} strokeWidth={2.4} color="#6D6469" />
              </button>
            </div>
            <p className="th-sheet__desc">
              부모님 전화번호로 초대하면, 부모님 승인 후 학생이 자동으로 연결돼요.
            </p>
            <div className="th-sheet__label">부모님 전화번호</div>
            <input
              className="th-sheet__input"
              type="tel"
              inputMode="tel"
              value={invitePhone}
              onChange={(e) => setInvitePhone(e.target.value)}
              placeholder="010-1234-5678"
            />
            <div className="th-sheet__label">아이 이름 (선택)</div>
            <input
              className="th-sheet__input"
              value={inviteChild}
              onChange={(e) => setInviteChild(e.target.value)}
              placeholder="자녀가 여럿일 때 특정을 도와요"
            />
            <button
              type="button"
              className="th-sheet__send hy-press"
              onClick={sendInvite}
              disabled={requestPairing.isPending}
            >
              {requestPairing.isPending ? "요청 보내는 중…" : "연결 요청 보내기"}
            </button>
          </div>
        </div>
      )}

      {/* 반 만들기 시트 — 선생님 프로필 보장 + 반 생성(useCreateClass) */}
      {createOpen && (
        <div
          className="th-sheet-overlay"
          role="presentation"
          onClick={() => setCreateOpen(false)}
        >
          <div
            className="th-sheet"
            role="dialog"
            aria-label="반 만들기"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="th-sheet__head">
              <span className="th-sheet__title">반 만들기</span>
              <button
                type="button"
                className="th-sheet__x hy-press"
                aria-label="닫기"
                onClick={() => setCreateOpen(false)}
              >
                <X size={20} strokeWidth={2.4} color="#6D6469" />
              </button>
            </div>
            <p className="th-sheet__desc">
              반을 만들면 학생을 초대하고 오늘 출석·알림장을 관리할 수 있어요.
            </p>
            <div className="th-sheet__label">반 이름</div>
            <input
              className="th-sheet__input"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="예) 햇살반, 방과후 A반"
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
              disabled={createClass.isPending}
            >
              {createClass.isPending ? "만드는 중…" : "반 만들기"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

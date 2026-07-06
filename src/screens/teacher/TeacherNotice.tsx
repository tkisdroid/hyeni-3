import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, X, Paperclip } from "lucide-react";
import { useToast } from "@/app/toast";
import { useTeacherClasses, useRoster, usePublishNotice } from "@/queries/useTeacher";
import { isMissingFunction } from "@/lib/api/errors";
import { isoDateKey } from "@/transform/teacherView";
import { dateInputValueToDateKey } from "@/transform/dateKey";
import "./TeacherNotice.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function TeacherNotice() {
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();

  const classesQ = useTeacherClasses();
  const firstClass = classesQ.data?.[0] ?? null;
  const classId = firstClass?.classId ?? null;
  const className = firstClass?.className ?? "우리 반";

  const rosterQ = useRoster(classId);
  const recipientCount = rosterQ.data?.length ?? 0;

  const publish = usePublishNotice();

  // 마운트 시 오늘로 고정(입력값 형식 "YYYY-MM-DD").
  const today = useMemo(() => isoDateKey(new Date()), []);
  const todayLabel = useMemo(() => {
    const now = new Date();
    return `${now.getMonth() + 1}월 ${now.getDate()}일 ${WEEKDAYS[now.getDay()]}요일`;
  }, []);

  // 반 시간표 '일정 추가'에서 넘어온 날짜(state.dateInput, ISO "YYYY-MM-DD")를 반영일 초깃값으로.
  const prefillDate = useMemo(() => {
    const st = location.state as { dateInput?: unknown } | null;
    const di = st && typeof st.dateInput === "string" ? st.dateInput : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(di) ? di : today;
  }, [location.state, today]);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [supplies, setSupplies] = useState<string[]>([]);
  const [supplyInput, setSupplyInput] = useState("");
  const [reflect, setReflect] = useState(true);
  const [reflectDate, setReflectDate] = useState(prefillDate);

  const loading = classesQ.isLoading;
  const genuineError = classesQ.isError && !isMissingFunction(classesQ.error);
  const notReady = !loading && !classId;

  const addSupply = () => {
    const item = supplyInput.trim();
    if (!item) return;
    if (supplies.includes(item)) {
      setSupplyInput("");
      return;
    }
    setSupplies((list) => [...list, item]);
    setSupplyInput("");
  };
  const removeSupply = (item: string) =>
    setSupplies((list) => list.filter((s) => s !== item));

  const canSend = !!classId && title.trim().length > 0 && !publish.isPending;

  const handleSend = () => {
    if (!classId) {
      show("연결된 반이 없어 알림장을 보낼 수 없어요", "🧑‍🏫");
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      show("알림장 제목을 입력해 주세요", "✏️");
      return;
    }

    // 준비물은 본문 끝에 한 줄로 덧붙인다(별도 서버 필드가 없어 본문 통합).
    const bodyText = body.trim();
    const suppliesLine = supplies.length > 0 ? `준비물: ${supplies.join(", ")}` : "";
    const composedBody = [bodyText, suppliesLine].filter(Boolean).join("\n");

    // "학부모 캘린더에 반영" ON → 선택 날짜에 알림장 제목으로 일정 1건을 함께 등록.
    // publishNotice 의 events 파라미터가 각 가족 캘린더에 실제로 생성한다(0-index 월 date_key).
    const reflectKey = reflect ? dateInputValueToDateKey(reflectDate) : null;
    const events = reflectKey
      ? [{ dateKey: reflectKey, title: trimmedTitle, time: "", category: "school" }]
      : [];

    publish.mutate(
      { classId, title: trimmedTitle, body: composedBody, sourceType: "text", events },
      {
        onSuccess: (res) => {
          const reached = res.recipients;
          const msg =
            res.eventsCreated > 0
              ? `${reached}명에게 보냈어요 · 학부모 캘린더에 반영됐어요`
              : `${reached}명에게 알림장을 보냈어요`;
          show(msg, "📣");
          navigate(-1);
        },
        onError: (err) => {
          show(
            err instanceof Error ? err.message : "알림장 보내기에 실패했어요. 잠시 후 다시 시도해 주세요",
            "⚠️",
          );
        },
      },
    );
  };

  return (
    <div className="tn-screen">
      <header className="tn-header">
        <button
          type="button"
          className="tn-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="tn-title">알림장</span>
      </header>

      <div className="tn-body">
        {loading && <div className="tn-empty tn-empty--soft">반 정보를 불러오는 중…</div>}

        {notReady && (
          <div className="tn-empty">
            <span className="tn-empty__emoji">🧑‍🏫</span>
            <span className="tn-empty__title">
              {genuineError ? "잠시 후 다시 시도해 주세요" : "연결된 반이 없어요"}
            </span>
            <span className="tn-empty__sub">
              {genuineError
                ? "반 정보를 불러오지 못했어요."
                : "반을 만들고 학생을 연결하면 알림장을 보낼 수 있어요."}
            </span>
          </div>
        )}

        {!loading && !notReady && (
          <>
            <div className="tn-meta">
              {todayLabel} · {className}
            </div>

            <div>
              <div className="tn-label">제목</div>
              <input
                className="tn-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예) 내일 준비물 안내"
                maxLength={80}
              />
            </div>

            <div>
              <div className="tn-label">내용</div>
              <textarea
                className="tn-textarea"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="예) 내일 수학 단원평가 있어요. 교과서 32–40p 복습해 오세요."
                rows={4}
              />
            </div>

            <div>
              <div className="tn-label">준비물</div>
              <div className="tn-chips">
                {supplies.map((item) => (
                  <span key={item} className="tn-chip">
                    {item}
                    <button
                      type="button"
                      className="tn-chip__x hy-press"
                      aria-label={`${item} 삭제`}
                      onClick={() => removeSupply(item)}
                    >
                      <X size={13} strokeWidth={2.6} />
                    </button>
                  </span>
                ))}
                <input
                  className="tn-chip-input"
                  value={supplyInput}
                  onChange={(e) => setSupplyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSupply();
                    }
                  }}
                  placeholder="＋ 추가 (예: 체육복)"
                />
              </div>
            </div>

            {/* 첨부 — R2 업로드는 준비 중(Wave 2). 정직하게 비활성 안내. */}
            <div>
              <div className="tn-label">첨부</div>
              <div className="tn-attach" aria-disabled="true">
                <span className="tn-attach__icon">
                  <Paperclip size={18} strokeWidth={2} color="#8B7E84" />
                </span>
                <span className="tn-attach__main">
                  <span className="tn-attach__title">파일 첨부</span>
                  <span className="tn-attach__sub">가정통신문 사진·PDF 첨부는 준비 중이에요</span>
                </span>
                <span className="tn-attach__badge">준비 중</span>
              </div>
            </div>

            {/* 학부모 캘린더에 반영 — ON 이면 선택 날짜에 알림장 일정을 함께 등록(실동작). */}
            <div className="tn-reflect">
              <div className="tn-reflect__row">
                <span className="tn-reflect__main">
                  <span className="tn-reflect__title">학부모 캘린더에 반영</span>
                  <span className="tn-reflect__sub">켜면 아래 날짜에 이 알림장 일정이 등록돼요</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={reflect}
                  aria-label="학부모 캘린더에 반영"
                  className={`tn-toggle${reflect ? " tn-toggle--on" : ""}`}
                  onClick={() => setReflect((v) => !v)}
                >
                  <span className="tn-toggle__knob" />
                </button>
              </div>
              {reflect && (
                <input
                  type="date"
                  className="tn-date"
                  value={reflectDate}
                  onChange={(e) => setReflectDate(e.target.value)}
                />
              )}
            </div>

            <button
              type="button"
              className="tn-send hy-press"
              onClick={handleSend}
              disabled={!canSend}
            >
              {publish.isPending
                ? "보내는 중…"
                : recipientCount > 0
                  ? `${recipientCount}명에게 발송`
                  : "반 전체에 발송"}
            </button>

            {recipientCount === 0 && (
              <div className="tn-hint">
                아직 연결된 학생이 없어요. 학생이 연결되면 알림장이 학부모에게 전달돼요.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

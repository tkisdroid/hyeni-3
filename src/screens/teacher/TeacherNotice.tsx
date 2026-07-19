import { useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, X, Paperclip } from "lucide-react";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useTeacherClasses, useRoster, usePublishNotice } from "@/queries/useTeacher";
import { isMissingFunction } from "@/lib/api/errors";
import { apiUploadTeacherNoticeFile } from "@/lib/api/client";
import { isoDateKey } from "@/transform/teacherView";
import { dateInputValueToDateKey } from "@/transform/dateKey";
import type { TeacherNoticeAttachment } from "@/lib/api/endpoints/teacher";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "./TeacherNotice.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

interface AttachmentDraft {
  id: string;
  file: File;
  name: string;
  size: number;
  contentType: string;
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\-가-힣]/g, "_").replace(/_+/g, "_");
  return cleaned || "attachment";
}

export function TeacherNotice() {
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();
  const { userId } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const classesQ = useTeacherClasses();
  const firstClass = classesQ.data?.[0] ?? null;
  const classId = firstClass?.classId ?? null;
  const className = firstClass?.className ?? "우리 반";

  const rosterQ = useRoster(classId);
  const recipientCount = rosterQ.data?.length ?? 0;
  const classesFeatureMissing = classesQ.isError && isMissingFunction(classesQ.error);
  const teacherNoticeQueryState = resolveQueryTruthState([
    { isLoading: classesQ.isLoading, isError: classesQ.isError && !classesFeatureMissing },
    { isLoading: !!classId && rosterQ.isLoading, isError: !!classId && rosterQ.isError },
  ]);
  const teacherNoticeDataMissing = teacherNoticeQueryState === "ready"
    && !classesFeatureMissing
    && (classesQ.data === undefined || (!!classId && rosterQ.data === undefined));
  const teacherNoticeDataEmpty = teacherNoticeQueryState === "ready" && (
    classesFeatureMissing
    || classesQ.data?.length === 0
    || (!!classId && rosterQ.data?.length === 0)
  );
  const teacherNoticeDataReady = teacherNoticeQueryState === "ready"
    && !teacherNoticeDataMissing
    && !teacherNoticeDataEmpty
    && !!classId;
  const teacherNoticeRefetching = classesQ.isFetching || rosterQ.isFetching;
  const retryTeacherNotice = async (): Promise<void> => {
    const retries: Array<Promise<unknown>> = [classesQ.refetch()];
    if (classId) retries.push(rosterQ.refetch());
    await Promise.all(retries);
  };

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
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [uploading, setUploading] = useState(false);

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

  const canSend = teacherNoticeDataReady
    && title.trim().length > 0
    && !publish.isPending
    && !uploading;

  const addAttachments = (files: FileList | null) => {
    if (!files?.length) return;
    const next: AttachmentDraft[] = [];
    for (const file of Array.from(files)) {
      if (attachments.length + next.length >= MAX_ATTACHMENTS) {
        show(`첨부는 ${MAX_ATTACHMENTS}개까지 가능해요`, "📎");
        break;
      }
      const contentType = file.type || "application/octet-stream";
      const supported = contentType.startsWith("image/") || contentType === "application/pdf";
      if (!supported) {
        show("사진 또는 PDF만 첨부할 수 있어요", "📎");
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        show("첨부 파일은 8MB 이하만 가능해요", "📎");
        continue;
      }
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        name: file.name || "첨부파일",
        size: file.size,
        contentType,
      });
    }
    if (next.length) setAttachments((list) => [...list, ...next]);
  };

  const uploadAttachments = async (): Promise<TeacherNoticeAttachment[]> => {
    if (!attachments.length) return [];
    if (!userId) throw new Error("선생님 계정 정보를 확인하지 못했어요");
    const stamp = Date.now();
    return Promise.all(
      attachments.map(async (a, index) => {
        const path = `${userId}/notice-${stamp}-${index}-${safeFileName(a.name)}`;
        const uploaded = await apiUploadTeacherNoticeFile(path, a.file, a.contentType);
        return {
          name: a.name,
          path: uploaded.path,
          contentType: a.contentType,
          size: a.size,
        };
      }),
    );
  };

  const handleSend = async () => {
    if (!teacherNoticeDataReady || !classId || recipientCount === 0) {
      show("연결된 반과 학생을 확인한 뒤 다시 시도해 주세요", "🧑‍🏫");
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

    let uploadedAttachments: TeacherNoticeAttachment[] = [];
    setUploading(true);
    try {
      uploadedAttachments = await uploadAttachments();
    } catch (err) {
      setUploading(false);
      show(err instanceof Error ? err.message : "첨부 파일 업로드에 실패했어요", "⚠️");
      return;
    }
    setUploading(false);

    publish.mutate(
      {
        classId,
        title: trimmedTitle,
        body: composedBody,
        sourceType: uploadedAttachments.length ? "photo" : "text",
        events,
        attachments: uploadedAttachments,
      },
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

  if (teacherNoticeQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle="알림장"
        state="loading"
        heading="반과 학생 정보를 불러오고 있어요"
        description="알림장을 받을 학생과 반 정보를 확인하는 중이에요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (teacherNoticeQueryState === "error" || teacherNoticeDataMissing) {
    return (
      <ScreenQueryState
        screenTitle="알림장"
        state="error"
        heading="알림장 대상을 확인하지 못했어요"
        description="수신자가 확인되지 않은 상태에서는 파일 업로드와 발송을 시작하지 않아요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryTeacherNotice()}
        retrying={teacherNoticeRefetching}
      />
    );
  }

  if (teacherNoticeDataEmpty) {
    const hasClass = !!classId;
    const emptyHeading = classesFeatureMissing
      ? "알림장 서버 기능이 준비되지 않았어요"
      : hasClass
        ? "연결된 학생이 없어요"
        : "연결된 반이 없어요";
    const emptyDescription = classesFeatureMissing
      ? "개발 환경의 선생님 기능을 확인한 뒤 다시 시도해 주세요."
      : hasClass
        ? "학생이 연결되면 학부모에게 알림장과 준비물을 보낼 수 있어요."
        : "반을 만들고 학생을 연결하면 알림장을 보낼 수 있어요.";
    return (
      <ScreenQueryState
        screenTitle="알림장"
        state="empty"
        heading={emptyHeading}
        description={emptyDescription}
        onBack={() => navigate(-1)}
        onRetry={() => void retryTeacherNotice()}
        retrying={teacherNoticeRefetching}
        retryLabel="반 정보 다시 확인"
      />
    );
  }

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

            {/* 첨부 — R2 업로드 후 알림장 metadata 로 저장. */}
            <div>
              <div className="tn-label">첨부</div>
              <button
                type="button"
                className="tn-attach hy-press"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || publish.isPending || attachments.length >= MAX_ATTACHMENTS}
              >
                <span className="tn-attach__icon">
                  <Paperclip size={18} strokeWidth={2} color="#8B7E84" />
                </span>
                <span className="tn-attach__main">
                  <span className="tn-attach__title">파일 첨부</span>
                  <span className="tn-attach__sub">사진·PDF를 {MAX_ATTACHMENTS}개까지 보낼 수 있어요</span>
                </span>
                <span className="tn-attach__badge">{attachments.length}개</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                hidden
                onChange={(e) => {
                  addAttachments(e.target.files);
                  e.target.value = "";
                }}
              />
              {attachments.length > 0 && (
                <div className="tn-attach-list">
                  {attachments.map((a) => (
                    <span key={a.id} className="tn-file-chip">
                      <Paperclip size={13} strokeWidth={2.2} />
                      <span className="tn-file-chip__name">{a.name}</span>
                      <button
                        type="button"
                        className="tn-file-chip__x hy-press"
                        aria-label={`${a.name} 첨부 삭제`}
                        onClick={() => setAttachments((list) => list.filter((item) => item.id !== a.id))}
                      >
                        <X size={13} strokeWidth={2.6} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
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
              onClick={() => void handleSend()}
              disabled={!canSend}
            >
              {uploading
                ? "첨부 올리는 중…"
                : publish.isPending
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
      </div>
    </div>
  );
}

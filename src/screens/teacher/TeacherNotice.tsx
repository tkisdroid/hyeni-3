import { useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
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
import { useLocale } from "@/i18n/useLocale";
import { formatCalendarDay, LEGACY_FAMILY_TIME_ZONE } from "@/i18n/format";
import "./TeacherNotice.css";
import { useIntl } from "react-intl";
import { localizeApiError } from "@/i18n/apiError";
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
  const { locale } = useLocale();
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();
  const { userId } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const classesQ = useTeacherClasses();
  const firstClass = classesQ.data?.[0] ?? null;
  const classId = firstClass?.classId ?? null;
  const className = firstClass?.className
    ?? intl.formatMessage({ id: "shared.teacherNotice.classFallback" });

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
    return formatCalendarDay(now, {
      locale,
      timeZone: LEGACY_FAMILY_TIME_ZONE,
      weekday: "long",
    });
  }, [locale]);

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
        show(intl.formatMessage(
          { id: "shared.teacherNotice.attachment.limit" },
          { max: MAX_ATTACHMENTS },
        ), "📎");
        break;
      }
      const contentType = file.type || "application/octet-stream";
      const supported = contentType.startsWith("image/") || contentType === "application/pdf";
      if (!supported) {
        show(intl.formatMessage({ id: "shared.teacherNotice.attachment.type" }), "📎");
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        show(intl.formatMessage({ id: "shared.teacherNotice.attachment.size" }), "📎");
        continue;
      }
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        name: file.name || intl.formatMessage({ id: "shared.teacherNotice.attachment.defaultName" }),
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
      show(intl.formatMessage({ id: "shared.teacherNotice.targetRequired" }), "🧑‍🏫");
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      show(intl.formatMessage({ id: "shared.teacherNotice.titleRequired" }), "✏️");
      return;
    }

    // 준비물은 본문 끝에 한 줄로 덧붙인다(별도 서버 필드가 없어 본문 통합).
    const bodyText = body.trim();
    const suppliesLine = supplies.length > 0
      ? `${intl.formatMessage({ id: "shared.teacherNotice.suppliesPrefix" })}: ${supplies.join(", ")}`
      : "";
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
      show(localizeApiError(err, intl, "formal"), "⚠️");
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
          const msg = intl.formatMessage(
            {
              id: res.eventsCreated > 0
                ? "shared.teacherNotice.sent.withCalendar"
                : "shared.teacherNotice.sent.noticeOnly",
            },
            { count: reached },
          );
          show(msg, "📣");
          navigate(-1);
        },
        onError: (err) => {
          show(
            localizeApiError(err, intl, "formal"),
            "⚠️",
          );
        },
      },
    );
  };

  if (teacherNoticeQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "shared.teacherNotice.screenTitle" })}
        state="loading"
        heading={intl.formatMessage({ id: "shared.teacherNotice.loading.heading" })}
        description={intl.formatMessage({ id: "shared.teacherNotice.loading.description" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (teacherNoticeQueryState === "error" || teacherNoticeDataMissing) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "shared.teacherNotice.screenTitle" })}
        state="error"
        heading={intl.formatMessage({ id: "shared.teacherNotice.error.heading" })}
        description={intl.formatMessage({ id: "shared.teacherNotice.error.description" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryTeacherNotice()}
        retrying={teacherNoticeRefetching}
      />
    );
  }

  if (teacherNoticeDataEmpty) {
    const hasClass = !!classId;
    const emptyHeading = classesFeatureMissing
      ? intl.formatMessage({ id: "shared.teacherNotice.empty.server.heading" })
      : hasClass
        ? intl.formatMessage({ id: "shared.teacherNotice.empty.students.heading" })
        : intl.formatMessage({ id: "shared.teacherNotice.empty.class.heading" });
    const emptyDescription = classesFeatureMissing
      ? intl.formatMessage({ id: "shared.teacherNotice.empty.server.description" })
      : hasClass
        ? intl.formatMessage({ id: "shared.teacherNotice.empty.students.description" })
        : intl.formatMessage({ id: "shared.teacherNotice.empty.class.description" });
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "shared.teacherNotice.screenTitle" })}
        state="empty"
        heading={emptyHeading}
        description={emptyDescription}
        onBack={() => navigate(-1)}
        onRetry={() => void retryTeacherNotice()}
        retrying={teacherNoticeRefetching}
        retryLabel={intl.formatMessage({ id: "shared.teacherNotice.empty.retry" })}
      />
    );
  }

  return (
    <div className="tn-screen">
      <header className="tn-header">
        <button
          type="button"
          className="tn-back hy-press"
          aria-label={intl.formatMessage({ id: "shared.teacherNotice.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="tn-title">
          {intl.formatMessage({ id: "shared.teacherNotice.screenTitle" })}
        </span>
      </header>

      <div className="tn-body">
        <>
            <div className="tn-meta">
              {todayLabel} · {className}
            </div>

            <div>
              <div className="tn-label">
                {intl.formatMessage({ id: "shared.teacherNotice.title.label" })}
              </div>
              <input
                className="tn-input"
                aria-label={intl.formatMessage({ id: "shared.teacherNotice.title.aria" })}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={intl.formatMessage({ id: "shared.teacherNotice.title.placeholder" })}
                maxLength={80}
              />
            </div>

            <div>
              <div className="tn-label">
                {intl.formatMessage({ id: "shared.teacherNotice.body.label" })}
              </div>
              <textarea
                className="tn-textarea"
                aria-label={intl.formatMessage({ id: "shared.teacherNotice.body.aria" })}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={intl.formatMessage({ id: "shared.teacherNotice.body.placeholder" })}
                rows={4}
              />
            </div>

            <div>
              <div className="tn-label">
                {intl.formatMessage({ id: "shared.teacherNotice.supplies.label" })}
              </div>
              <div className="tn-chips">
                {supplies.map((item) => (
                  <span key={item} className="tn-chip">
                    {item}
                    <button
                      type="button"
                      className="tn-chip__x hy-press"
                      aria-label={`${item} ${intl.formatMessage({ id: "shared.teacherNotice.supplies.remove" })}`}
                      onClick={() => removeSupply(item)}
                    >
                      <X size={13} strokeWidth={2.6} />
                    </button>
                  </span>
                ))}
                <input
                  className="tn-chip-input"
                  aria-label={intl.formatMessage({ id: "shared.teacherNotice.supplies.addAria" })}
                  value={supplyInput}
                  onChange={(e) => setSupplyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSupply();
                    }
                  }}
                  placeholder={intl.formatMessage({ id: "shared.teacherNotice.supplies.placeholder" })}
                />
              </div>
            </div>

            {/* 첨부 — R2 업로드 후 알림장 metadata 로 저장. */}
            <div>
              <div className="tn-label">
                {intl.formatMessage({ id: "shared.teacherNotice.attachment.label" })}
              </div>
              <button
                type="button"
                className="tn-attach hy-press"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || publish.isPending || attachments.length >= MAX_ATTACHMENTS}
                aria-busy={uploading}
              >
                <span className="tn-attach__icon">
                  <Paperclip size={18} strokeWidth={2} color="#8B7E84" />
                </span>
                <span className="tn-attach__main">
                  <span className="tn-attach__title">
                    {intl.formatMessage({ id: "shared.teacherNotice.attachment.title" })}
                  </span>
                  <span className="tn-attach__sub">
                    {intl.formatMessage(
                      { id: "shared.teacherNotice.attachment.description" },
                      { max: MAX_ATTACHMENTS },
                    )}
                  </span>
                </span>
                <span className="tn-attach__badge">
                  {intl.formatMessage(
                    { id: "shared.teacherNotice.attachment.count" },
                    { count: attachments.length },
                  )}
                </span>
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
                        aria-label={`${a.name} ${intl.formatMessage({ id: "shared.teacherNotice.attachment.remove" })}`}
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
                  <span className="tn-reflect__title">
                    {intl.formatMessage({ id: "shared.teacherNotice.reflect.title" })}
                  </span>
                  <span className="tn-reflect__sub">
                    {intl.formatMessage({ id: "shared.teacherNotice.reflect.description" })}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={reflect}
                  aria-label={intl.formatMessage({ id: "shared.teacherNotice.reflect.title" })}
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
                  aria-label={intl.formatMessage({ id: "shared.teacherNotice.reflect.dateAria" })}
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
              aria-busy={publish.isPending}
            >
              {uploading
                ? intl.formatMessage({ id: "shared.teacherNotice.send.uploading" })
                : publish.isPending
                ? intl.formatMessage({ id: "shared.teacherNotice.send.pending" })
                : recipientCount > 0
                  ? intl.formatMessage(
                      { id: "shared.teacherNotice.send.toCount" },
                      { count: recipientCount },
                    )
                  : intl.formatMessage({ id: "shared.teacherNotice.send.all" })}
            </button>

            {recipientCount === 0 && (
              <div className="tn-hint hy-explain">
                <span className="hy-explain__lines">
                  <span className="hy-explain__line">
                    {intl.formatMessage({ id: "shared.teacherNotice.hint.empty" })}
                  </span>
                  <span className="hy-explain__line">
                    {intl.formatMessage({ id: "shared.teacherNotice.hint.delivery" })}
                  </span>
                </span>
              </div>
            )}
        </>
      </div>
    </div>
  );
}

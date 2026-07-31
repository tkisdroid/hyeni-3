import { useEffect, useId, useRef, useState } from "react";
import { Ban, Flag, X } from "lucide-react";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import "./MessageSafetyDialog.css";

export interface ReportReasonOption<TReason extends string> {
  value: TReason;
  label: string;
}

interface MessageSafetyDialogProps<TReason extends string> {
  open: boolean;
  tone: "child" | "parent";
  title: string;
  description: string;
  reasons: readonly ReportReasonOption<TReason>[];
  onClose: () => void;
  onReport: (reason: TReason, detail: string) => Promise<void>;
  blockLabel?: string;
  blockDescription?: string;
  onBlock?: () => Promise<void>;
}

export function MessageSafetyDialog<TReason extends string>({
  open,
  tone,
  title,
  description,
  reasons,
  onClose,
  onReport,
  blockLabel,
  blockDescription,
  onBlock,
}: MessageSafetyDialogProps<TReason>) {
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState<TReason | null>(null);
  const [detail, setDetail] = useState("");
  const [action, setAction] = useState<"report" | "block" | null>(null);
  const [error, setError] = useState("");
  const pending = action !== null;
  const dialogRef = useDialogFocusLifecycle<HTMLElement>({
    open,
    onClose,
    initialFocusRef: closeRef,
    canClose: () => !pending,
  });

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setDetail("");
    setAction(null);
    setError("");
  }, [open]);

  if (!open) return null;

  const submitReport = async () => {
    if (!reason || pending) {
      if (!reason) setError(tone === "child" ? "왜 신고하는지 하나 골라줘." : "신고 사유를 선택해 주세요.");
      return;
    }
    setAction("report");
    setError("");
    try {
      await onReport(reason, detail);
      onClose();
    } catch {
      setError(tone === "child" ? "지금은 신고를 보내지 못했어. 다시 눌러줘." : "신고를 보내지 못했어요. 다시 시도해 주세요.");
    } finally {
      setAction(null);
    }
  };

  const submitBlock = async () => {
    if (!onBlock || pending) return;
    setAction("block");
    setError("");
    try {
      await onBlock();
      // 차단 뒤에도 이 dialog를 유지한다. 메시지가 목록에서 즉시 숨겨져도 사용자는
      // 같은 콘텐츠 신고를 이어서 완료하거나 직접 닫을 수 있어야 한다.
    } catch {
      setError(tone === "child" ? "지금은 차단하지 못했어. 다시 눌러줘." : "차단하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setAction(null);
    }
  };

  return (
    <div
      className="msd-layer"
      data-tone={tone}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !pending) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="msd-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <button
          ref={closeRef}
          type="button"
          className="msd-close hy-press"
          aria-label={tone === "child" ? "닫기" : "창 닫기"}
          onClick={onClose}
          disabled={pending}
          data-progress-owner="dialog-action"
        >
          <X size={21} strokeWidth={2.3} />
        </button>

        <div className="msd-heading">
          <span className="msd-icon" aria-hidden="true"><Flag size={21} strokeWidth={2.2} /></span>
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
          </div>
        </div>

        <fieldset className="msd-reasons" disabled={pending}>
          <legend>{tone === "child" ? "왜 불편했어?" : "신고 사유"}</legend>
          {reasons.map((option) => (
            <label key={option.value} className="msd-reason">
              <input
                type="radio"
                name={`content-report-${titleId}`}
                value={option.value}
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>

        <label className="msd-detail">
          <span>{tone === "child" ? "더 알려주고 싶으면 적어줘 (선택)" : "추가 설명 (선택)"}</span>
          <textarea
            value={detail}
            maxLength={500}
            rows={3}
            disabled={pending}
            placeholder={tone === "child" ? "어떤 점이 불편했는지 적어줘" : "검토에 필요한 내용을 적어 주세요"}
            onChange={(event) => setDetail(event.target.value)}
          />
          <small>{detail.length}/500</small>
        </label>

        {error && <p className="msd-error" role="alert">{error}</p>}

        <button
          type="button"
          className="msd-report hy-press"
          onClick={() => void submitReport()}
          disabled={pending}
          aria-busy={action === "report"}
        >
          {action === "report" ? (tone === "child" ? "보내는 중…" : "신고하는 중…") : (tone === "child" ? "이 내용 신고하기" : "이 메시지 신고하기")}
        </button>

        {onBlock && blockLabel && (
          <div className="msd-block-area">
            <div>
              <strong><Ban size={16} strokeWidth={2.3} aria-hidden="true" /> {blockLabel}</strong>
              {blockDescription && <p>{blockDescription}</p>}
            </div>
            <button
              type="button"
              className="msd-block hy-press"
              onClick={() => void submitBlock()}
              disabled={pending}
              aria-busy={action === "block"}
            >
              {action === "block" ? (tone === "child" ? "차단 중…" : "차단하는 중…") : "차단하기"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

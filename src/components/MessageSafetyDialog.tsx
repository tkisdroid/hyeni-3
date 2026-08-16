import { useIntl } from "react-intl";
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
  const intl = useIntl();
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
      if (!reason) setError(tone === "child" ? intl.formatMessage({ id: "shared.messageSafetyDialog.copy001" }) : intl.formatMessage({ id: "shared.messageSafetyDialog.copy002" }));
      return;
    }
    setAction("report");
    setError("");
    try {
      await onReport(reason, detail);
      onClose();
    } catch {
      setError(tone === "child" ? intl.formatMessage({ id: "shared.messageSafetyDialog.copy003" }) : intl.formatMessage({ id: "shared.messageSafetyDialog.copy004" }));
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
      setError(tone === "child" ? intl.formatMessage({ id: "shared.messageSafetyDialog.copy005" }) : intl.formatMessage({ id: "shared.messageSafetyDialog.copy006" }));
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
          aria-label={tone === "child" ? intl.formatMessage({ id: "shared.messageSafetyDialog.copy007" }) : intl.formatMessage({ id: "shared.messageSafetyDialog.copy008" })}
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
          <legend>{tone === "child" ? intl.formatMessage({ id: "shared.messageSafetyDialog.copy009" }) : intl.formatMessage({ id: "shared.messageSafetyDialog.copy010" })}</legend>
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
          <span>{tone === "child" ? intl.formatMessage({ id: "shared.messageSafetyDialog.copy011" }) : intl.formatMessage({ id: "shared.messageSafetyDialog.copy012" })}</span>
          <textarea
            value={detail}
            maxLength={500}
            rows={3}
            disabled={pending}
            placeholder={tone === "child" ? intl.formatMessage({ id: "shared.messageSafetyDialog.copy013" }) : intl.formatMessage({ id: "shared.messageSafetyDialog.copy014" })}
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
          {action === "report" ? (tone === "child" ? intl.formatMessage({ id: "shared.messageSafetyDialog.copy015" }) : intl.formatMessage({ id: "shared.messageSafetyDialog.copy016" })) : (tone === "child" ? intl.formatMessage({ id: "shared.messageSafetyDialog.copy017" }) : intl.formatMessage({ id: "shared.messageSafetyDialog.copy018" }))}
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
              {action === "block" ? (tone === "child" ? intl.formatMessage({ id: "shared.messageSafetyDialog.copy019" }) : intl.formatMessage({ id: "shared.messageSafetyDialog.copy020" })) : intl.formatMessage({ id: "shared.messageSafetyDialog.copy021" })}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

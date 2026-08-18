import { AlertTriangle, ChevronLeft, Inbox, RefreshCw } from "lucide-react";
import "./ScreenQueryState.css";
import { useIntl } from "react-intl";
import { LoaderMark } from "./LoaderMark";

export type ScreenQueryStateKind = "loading" | "error" | "empty";

interface ScreenQueryStateProps {
  screenTitle: string;
  state: ScreenQueryStateKind;
  heading: string;
  description: string;
  onBack?: () => void;
  onRetry?: () => void;
  retrying?: boolean;
  retryLabel?: string;
  retryingLabel?: string;
}

/** 조회 화면의 로딩·오류·빈 상태를 같은 간격과 터치 크기로 표시한다. */
export function ScreenQueryState({
  screenTitle,
  state,
  heading,
  description,
  onBack,
  onRetry,
  retrying = false,
  retryLabel,
  retryingLabel,
}: ScreenQueryStateProps) {
  const intl = useIntl();
  const resolvedRetryLabel = retryLabel ?? intl.formatMessage({ id: "core.action.reload" });
  const resolvedRetryingLabel = retryingLabel ?? intl.formatMessage({ id: "core.state.retrying" });
  // 로딩은 공용 로딩 마크(그림)를 쓰고, 오류·빈 상태만 lucide 글리프 칩을 쓴다.
  const Icon = state === "error" ? AlertTriangle : Inbox;
  return (
    <div className="sqs-screen">
      <header className="sqs-header">
        {onBack ? (
          <button type="button" className="sqs-back hy-press" aria-label={intl.formatMessage({ id: "core.action.back" })} onClick={onBack}>
            <ChevronLeft size={22} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : (
          <span className="sqs-header-spacer" aria-hidden="true" />
        )}
        <span className="sqs-title">{screenTitle}</span>
        <span className="sqs-header-spacer" aria-hidden="true" />
      </header>

      <section
        className={`sqs-card sqs-card--${state}`}
        role={state === "error" ? "alert" : undefined}
        aria-live={state === "error" ? "assertive" : "polite"}
        aria-busy={state === "loading" ? "true" : undefined}
      >
        {state === "loading" ? (
          <span className="sqs-loader" aria-hidden="true">
            <LoaderMark />
          </span>
        ) : (
          <span className="sqs-icon" aria-hidden="true">
            <Icon size={32} strokeWidth={2.1} />
          </span>
        )}
        <h1>{heading}</h1>
        <p>{description}</p>
        {state !== "loading" && onRetry && (
          <button
            type="button"
            className="sqs-retry hy-press hy-busy-quiet"
            onClick={onRetry}
            disabled={retrying}
            aria-busy={retrying}
          >
            <RefreshCw
              className={retrying ? "sqs-spin" : undefined}
              size={18}
              strokeWidth={2.4}
              aria-hidden="true"
            />
            {retrying ? resolvedRetryingLabel : resolvedRetryLabel}
          </button>
        )}
      </section>
    </div>
  );
}

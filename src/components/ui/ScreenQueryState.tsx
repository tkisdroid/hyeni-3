import { AlertTriangle, ChevronLeft, Inbox, LoaderCircle, RefreshCw } from "lucide-react";
import "./ScreenQueryState.css";

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
  retryLabel = "다시 불러오기",
  retryingLabel = "다시 확인하고 있어요…",
}: ScreenQueryStateProps) {
  const Icon = state === "loading" ? LoaderCircle : state === "error" ? AlertTriangle : Inbox;
  return (
    <div className="sqs-screen">
      <header className="sqs-header">
        {onBack ? (
          <button type="button" className="sqs-back hy-press" aria-label="뒤로" onClick={onBack}>
            <ChevronLeft size={22} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : (
          <span className="sqs-header-spacer" aria-hidden="true" />
        )}
        <span className="sqs-title">{screenTitle}</span>
        <span className="sqs-header-spacer" aria-hidden="true" />
      </header>

      <main
        className={`sqs-card sqs-card--${state}`}
        role={state === "error" ? "alert" : undefined}
        aria-live={state === "error" ? "assertive" : "polite"}
        aria-busy={state === "loading" ? "true" : undefined}
      >
        <span className="sqs-icon" aria-hidden="true">
          <Icon className={state === "loading" ? "sqs-spin" : undefined} size={32} strokeWidth={2.1} />
        </span>
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
            {retrying ? retryingLabel : retryLabel}
          </button>
        )}
      </main>
    </div>
  );
}

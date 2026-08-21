import { MapPin, RefreshCw } from "lucide-react";
import type { Ref } from "react";
import { useIntl } from "react-intl";
import type { JourneyContentState } from "@/transform/locationJourneyView";

export interface StayTimelineItem {
  id: string;
  order: number;
  placeLabel: string;
  timeLabel: string;
  dwellLabel: string;
  selected: boolean;
}

export interface LocationJourneyPanelProps {
  containerRef?: Ref<HTMLElement>;
  childName: string;
  dayLabel: string;
  state: JourneyContentState;
  expanded: boolean;
  recordedRangeLabel: string | null;
  stayCount: number;
  currentTimeLabel: string;
  currentWhere: string;
  sliderMin: number;
  sliderMax: number;
  sliderValue: number;
  followsLatest: boolean;
  stays: readonly StayTimelineItem[];
  onToggleExpanded: () => void;
  onSliderChange: (value: number) => void;
  onFollowLatest: () => void;
  onSelectStay: (index: number) => void;
  onRetry: () => void;
}

const stateCopyId = {
  loading: "parent.location.history.loadingShort",
  error: "parent.parentLocation.copy016",
  empty: "parent.location.history.emptyDay",
  moving_only: "parent.location.history.noStay",
  ready: null,
} as const;

export function LocationJourneyPanel({
  containerRef,
  childName,
  dayLabel,
  state,
  stayCount,
  stays,
  onSelectStay,
  onRetry,
}: LocationJourneyPanelProps) {
  const intl = useIntl();
  const copyId = stateCopyId[state];
  const copy = copyId ? intl.formatMessage({ id: copyId }) : null;

  return (
    <section
      ref={containerRef}
      className="pl-visited"
      aria-label={intl.formatMessage({ id: "parent.location.history.visitedListAria" }, { childName, dayLabel })}
    >
      <header className="pl-visited__head">
        <strong>{intl.formatMessage({ id: "parent.location.history.visitedPlaces" })}</strong>
        {state === "ready" && (
          <span>{intl.formatMessage({ id: "parent.location.history.stayCountShort" }, { count: stayCount })}</span>
        )}
      </header>

      <div className="pl-visited__body">
        {copy && (
          <div className={`pl-visited__state pl-visited__state--${state}`} role={state === "error" ? "alert" : "status"}>
            <MapPin size={22} strokeWidth={2.2} aria-hidden="true" />
            <div>
              <strong>{copy}</strong>
              {state === "empty" && <p>{intl.formatMessage({ id: "parent.location.history.emptyHint" })}</p>}
              {state === "moving_only" && <p>{intl.formatMessage({ id: "parent.location.history.movingHint" })}</p>}
              {state === "error" && <p>{intl.formatMessage({ id: "core.error.api.network.formal" })}</p>}
            </div>
            {state === "error" && (
              <button type="button" className="pl-visited__retry hy-press" onClick={onRetry}>
                <RefreshCw size={17} strokeWidth={2.3} aria-hidden="true" />
                {intl.formatMessage({ id: "parent.location.history.reload" })}
              </button>
            )}
          </div>
        )}

        {state === "loading" && (
          <div className="pl-visited__skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}

        {state === "ready" && (
          <ol className="pl-visited__list">
              {stays.map((stay, index) => (
                <li key={stay.id}>
                  <button
                    type="button"
                    className={`pl-visited__row hy-press${stay.selected ? " pl-visited__row--selected" : ""}`}
                    aria-pressed={stay.selected}
                    onClick={() => onSelectStay(index)}
                  >
                    <time>{stay.timeLabel}</time>
                    <strong>{stay.placeLabel}</strong>
                  </button>
                </li>
              ))}
          </ol>
        )}
      </div>
    </section>
  );
}

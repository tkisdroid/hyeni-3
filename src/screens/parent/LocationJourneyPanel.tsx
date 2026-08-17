import { ChevronDown, Clock3, LocateFixed, MapPin, RefreshCw } from "lucide-react";
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
  expanded,
  recordedRangeLabel,
  stayCount,
  currentTimeLabel,
  currentWhere,
  sliderMin,
  sliderMax,
  sliderValue,
  followsLatest,
  stays,
  onToggleExpanded,
  onSliderChange,
  onFollowLatest,
  onSelectStay,
  onRetry,
}: LocationJourneyPanelProps) {
  const intl = useIntl();
  const copyId = stateCopyId[state];
  const copy = copyId ? intl.formatMessage({ id: copyId }) : null;
  const replayAvailable = state === "moving_only" || state === "ready";
  const hasStayDetails = state === "ready";
  const headerContent = (
    <>
      <span className="pl-journey__toggle-copy">
        <strong>{intl.formatMessage({ id: "parent.location.history.heading" }, { day: dayLabel })}</strong>
        <span>{copy ?? recordedRangeLabel ?? intl.formatMessage({ id: "parent.location.history.stayCount" }, { count: stayCount })}</span>
      </span>
      {hasStayDetails && (
        <ChevronDown className="pl-journey__toggle-icon" size={22} strokeWidth={2.3} aria-hidden="true" />
      )}
    </>
  );

  return (
    <section
      ref={containerRef}
      className={`pl-journey${expanded ? " pl-journey--expanded" : ""}`}
      aria-label={intl.formatMessage({ id: "parent.location.history.timelineAria" }, { childName, dayLabel })}
    >
      {hasStayDetails ? (
        <button
          type="button"
          className="pl-journey__toggle hy-press"
          aria-expanded={expanded}
          aria-controls="location-journey-stays"
          onClick={onToggleExpanded}
        >
          {headerContent}
        </button>
      ) : (
        <div className="pl-journey__toggle">{headerContent}</div>
      )}

      <div className="pl-journey__body">
        {copy && (
          <div className={`pl-journey__state pl-journey__status pl-journey__state--${state}`} role={state === "error" ? "alert" : "status"}>
            <MapPin size={22} strokeWidth={2.2} aria-hidden="true" />
            <div>
              <strong>{copy}</strong>
              {state === "empty" && <p>{intl.formatMessage({ id: "parent.location.history.emptyHint" })}</p>}
              {state === "moving_only" && <p>{intl.formatMessage({ id: "parent.location.history.movingHint" })}</p>}
              {state === "error" && <p>{intl.formatMessage({ id: "core.error.api.network.formal" })}</p>}
            </div>
            {state === "error" && (
              <button type="button" className="pl-journey__retry hy-press" onClick={onRetry}>
                <RefreshCw size={17} strokeWidth={2.3} aria-hidden="true" />
                {intl.formatMessage({ id: "parent.location.history.reload" })}
              </button>
            )}
          </div>
        )}

        {state === "loading" && (
          <div className="pl-journey__skeleton" aria-hidden="true">
            <span className="pl-journey__skeleton-row pl-journey__skeleton-row--label" />
            <span className="pl-journey__skeleton-row pl-journey__skeleton-row--range" />
            <span className="pl-journey__skeleton-row pl-journey__skeleton-row--stay" />
          </div>
        )}

        {replayAvailable && (
          <div className="pl-journey__replay">
            <div className="pl-journey__replay-head">
              <div>
                <span className="pl-journey__eyebrow">
                  {intl.formatMessage({ id: followsLatest ? "parent.location.history.latest" : "parent.location.history.selectedTime" })}
                </span>
                <strong>{currentTimeLabel}</strong>
              </div>
              <button
                type="button"
                className={`pl-journey__follow hy-press${followsLatest ? " is-active" : ""}`}
                aria-pressed={followsLatest}
                onClick={onFollowLatest}
              >
                <LocateFixed size={17} strokeWidth={2.3} aria-hidden="true" />
                {intl.formatMessage({ id: "parent.location.history.latestPoint" })}
              </button>
            </div>
            <p className="pl-journey__where">
              <MapPin size={17} strokeWidth={2.3} aria-hidden="true" />
              {currentWhere}
            </p>
            <input
              className="pl-journey__range"
              type="range"
              min={sliderMin}
              max={sliderMax}
              step="any"
              value={sliderValue}
              disabled={sliderMax <= sliderMin}
              aria-label={intl.formatMessage({ id: "parent.location.history.scrubAria" }, { childName })}
              aria-valuetext={`${currentTimeLabel} · ${currentWhere}`}
              onChange={(event) => onSliderChange(Number(event.currentTarget.value))}
            />
            {recordedRangeLabel && (
              <span className="pl-journey__range-label">
                <Clock3 size={15} strokeWidth={2.2} aria-hidden="true" />
                {recordedRangeLabel}
              </span>
            )}
          </div>
        )}

        {state === "ready" && (
          <div id="location-journey-stays" className="pl-journey__stays" hidden={!expanded}>
            <div className="pl-journey__section-head">
              <strong>{intl.formatMessage({ id: "parent.parentLocation.copy027" })}</strong>
              <span>{intl.formatMessage({ id: "parent.location.history.stayCountShort" }, { count: stayCount })}</span>
            </div>
            <ol className="pl-journey__timeline">
              {stays.map((stay, index) => (
                <li key={stay.id} className={stay.selected ? "is-selected" : undefined}>
                  <button
                    type="button"
                    className={`pl-journey__stay hy-press${stay.selected ? " pl-journey__stay--selected" : ""}`}
                    aria-pressed={stay.selected}
                    onClick={() => onSelectStay(index)}
                  >
                    <span className="pl-journey__order" aria-hidden="true">{stay.order}</span>
                    <span className="pl-journey__stay-copy">
                      <strong>{stay.placeLabel}</strong>
                      <span>{stay.timeLabel}</span>
                    </span>
                    <span className="pl-journey__dwell">{stay.dwellLabel}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

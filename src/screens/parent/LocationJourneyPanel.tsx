import { ChevronDown, Clock3, LocateFixed, MapPin, RefreshCw } from "lucide-react";
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
  childName: string;
  dayLabel: string;
  state: JourneyContentState;
  expanded: boolean;
  recordedRangeLabel: string | null;
  stayCount: number;
  currentTimeLabel: string;
  currentWhere: string;
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

const stateCopy = {
  loading: "이동 기록을 불러오는 중…",
  error: "이동 기록을 불러오지 못했어요",
  empty: "이 날은 확인된 이동 기록이 없어요",
  moving_only: "8분 이상 머문 것으로 확인된 장소가 없어요",
  ready: null,
} as const;

export function LocationJourneyPanel({
  childName,
  dayLabel,
  state,
  expanded,
  recordedRangeLabel,
  stayCount,
  currentTimeLabel,
  currentWhere,
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
  const copy = stateCopy[state];
  const replayAvailable = state === "moving_only" || state === "ready";
  const hasStayDetails = state === "ready";
  const headerContent = (
    <>
      <span className="pl-journey__toggle-copy">
        <strong>{dayLabel} 이동 기록</strong>
        <span>{copy ?? recordedRangeLabel ?? `${stayCount}곳에 머물렀어요`}</span>
      </span>
      {hasStayDetails && (
        <ChevronDown className="pl-journey__toggle-icon" size={22} strokeWidth={2.3} aria-hidden="true" />
      )}
    </>
  );

  return (
    <section className={`pl-journey${expanded ? " pl-journey--expanded" : ""}`} aria-label={`${childName}의 ${dayLabel} 이동 타임라인`}>
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
              {state === "empty" && <p>아직 이 날의 위치 확인 기록이 남지 않았어요.</p>}
              {state === "moving_only" && <p>아래 시간 막대로 이동 위치를 확인할 수 있어요.</p>}
              {state === "error" && <p>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>}
            </div>
            {state === "error" && (
              <button type="button" className="pl-journey__retry hy-press" onClick={onRetry}>
                <RefreshCw size={17} strokeWidth={2.3} aria-hidden="true" />
                다시 불러오기
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
                <span className="pl-journey__eyebrow">선택한 시각</span>
                <strong>{currentTimeLabel}</strong>
              </div>
              <button
                type="button"
                className={`pl-journey__follow hy-press${followsLatest ? " is-active" : ""}`}
                aria-pressed={followsLatest}
                onClick={onFollowLatest}
              >
                <LocateFixed size={17} strokeWidth={2.3} aria-hidden="true" />
                최신 위치
              </button>
            </div>
            <p className="pl-journey__where">
              <MapPin size={17} strokeWidth={2.3} aria-hidden="true" />
              {currentWhere}
            </p>
            <input
              className="pl-journey__range"
              type="range"
              min={0}
              max={sliderMax}
              step={1}
              value={sliderValue}
              disabled={sliderMax <= 0}
              aria-label={`${childName}의 이동 시간 따라보기`}
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
              <strong>머문 곳</strong>
              <span>{stayCount}곳</span>
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

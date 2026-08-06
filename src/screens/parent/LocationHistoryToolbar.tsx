import { ChevronLeft, ChevronRight } from "lucide-react";

export interface LocationHistoryToolbarProps {
  childName: string;
  childAvatarSrc: string;
  dayLabel: string;
  dateValue: string;
  minDateValue: string;
  maxDateValue: string;
  premiumOpen: boolean;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onDateChange: (value: string) => void;
}

export function LocationHistoryToolbar({
  childName,
  childAvatarSrc,
  dayLabel,
  dateValue,
  minDateValue,
  maxDateValue,
  premiumOpen,
  previousDisabled,
  nextDisabled,
  onPrevious,
  onNext,
  onDateChange,
}: LocationHistoryToolbarProps) {
  return (
    <section
      className="pl-history-toolbar"
      aria-label={`${childName}의 이동 기록 날짜`}
      data-history-access={premiumOpen ? "premium" : "today"}
    >
      <div className="pl-history-toolbar__child">
        <img
          className="pl-history-toolbar__avatar hy-network-avatar"
          src={childAvatarSrc}
          alt=""
          loading="eager"
          decoding="async"
        />
        <span className="pl-history-toolbar__child-name">{childName}</span>
      </div>

      <div className="pl-history-toolbar__date-controls">
        <button
          type="button"
          className="pl-history-toolbar__date-button hy-press"
          aria-label="이전 날짜 이동 기록"
          disabled={previousDisabled}
          onClick={onPrevious}
        >
          <ChevronLeft size={20} strokeWidth={2.4} aria-hidden="true" />
        </button>
        <label className="pl-history-toolbar__date-picker">
          <span className="pl-history-toolbar__day">{dayLabel}</span>
          <input
            type="date"
            aria-label="이동 기록 날짜 선택"
            value={dateValue}
            min={minDateValue}
            max={maxDateValue}
            onChange={(event) => onDateChange(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="pl-history-toolbar__date-button hy-press"
          aria-label="다음 날짜 이동 기록"
          disabled={nextDisabled}
          onClick={onNext}
        >
          <ChevronRight size={20} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useIntl } from "react-intl";
import type { Ref } from "react";

export interface LocationHistoryToolbarProps {
  containerRef?: Ref<HTMLElement>;
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
  containerRef,
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
  const intl = useIntl();
  return (
    <section
      ref={containerRef}
      className="pl-history-toolbar"
      aria-label={intl.formatMessage({ id: "parent.location.history.dayAria" }, { childName })}
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
          aria-label={intl.formatMessage({ id: "parent.location.history.prevDay" })}
          disabled={previousDisabled}
          onClick={onPrevious}
        >
          <ChevronLeft size={20} strokeWidth={2.4} aria-hidden="true" />
        </button>
        <label className="pl-history-toolbar__date-picker">
          <span className="pl-history-toolbar__day">{dayLabel}</span>
          <input
            type="date"
            aria-label={intl.formatMessage({ id: "parent.location.history.pickDay" })}
            value={dateValue}
            min={minDateValue}
            max={maxDateValue}
            onChange={(event) => onDateChange(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="pl-history-toolbar__date-button hy-press"
          aria-label={intl.formatMessage({ id: "parent.location.history.nextDay" })}
          disabled={nextDisabled}
          onClick={onNext}
        >
          <ChevronRight size={20} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

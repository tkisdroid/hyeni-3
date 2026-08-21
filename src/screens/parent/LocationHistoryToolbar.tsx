import { CalendarDays } from "lucide-react";
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
  onDateChange: (value: string) => void;
}

/**
 * 이동 기록 상단 도구막대 — 아이 한 명과 날짜 하나.
 *
 * 2026-08-21 TK 지시로 좌우 화살표를 없앴다. 하루씩 밟아 가는 버튼은 30일 전으로
 * 가려면 29번을 눌러야 하고, 도구막대 폭의 절반을 차지하면서 정작 "며칠인지"는
 * 가운데 작은 알약에만 있었다. 이제 날짜 자체가 버튼이라 한 번 눌러 달력에서 고른다.
 */
export function LocationHistoryToolbar({
  containerRef,
  childName,
  childAvatarSrc,
  dayLabel,
  dateValue,
  minDateValue,
  maxDateValue,
  premiumOpen,
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

      {/* 날짜 전체가 하나의 조작 면이다. 보이는 것은 날짜 글자와 달력 아이콘뿐이고
          실제 선택은 그 위를 덮은 투명한 <input type="date"> 가 받는다. */}
      <label className="pl-history-toolbar__date">
        <CalendarDays size={17} strokeWidth={2.3} aria-hidden="true" />
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
    </section>
  );
}

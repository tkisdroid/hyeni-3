/**
 * 오늘 시간표 목록 — 홈 카드와 시간표 시트가 같은 컴포넌트를 쓴다(두 벌 만들지 않는다).
 */
import { Check } from "lucide-react";
import { useIntl } from "react-intl";
import { asset } from "@/lib/assets";

export interface ChildTimetableRow {
  id: string;
  time: string;
  icon: string;
  soft: string;
  title: string;
  place: string;
  /** 이미 다녀온 일정. */
  done: boolean;
  /** 바로 다음에 갈 일정. */
  next: boolean;
}

export function ChildTimetableList({
  rows,
  compact = false,
}: {
  rows: readonly ChildTimetableRow[];
  compact?: boolean;
}) {
  const intl = useIntl();
  if (rows.length === 0) {
    return <div className="kd-tt__empty">{intl.formatMessage({ id: "child.timetable.empty" })}</div>;
  }
  return (
    <>
      {rows.map((r) => (
        <div
          key={r.id}
          className="kd-tt__row"
          data-next={r.next}
          data-todo={!r.done && !r.next}
          style={compact ? { minHeight: 56 } : undefined}
        >
          <span className="kd-tt__time">{r.time}</span>
          <span className="kd-tt__icon" style={{ background: r.soft }}>
            <img src={asset(r.icon)} alt="" />
          </span>
          <span className="kd-tt__main">
            <span className="kd-tt__title">{r.title}</span>
            {r.place && <span className="kd-tt__place">{r.place}</span>}
          </span>
          {r.done && (
            <span className="kd-tt__done" aria-label={intl.formatMessage({ id: "child.timetable.done" })}>
              <Check size={16} strokeWidth={3.2} color="var(--mint-text)" />
            </span>
          )}
          {r.next && <span className="kd-tt__next">{intl.formatMessage({ id: "child.timetable.next" })}</span>}
        </div>
      ))}
    </>
  );
}

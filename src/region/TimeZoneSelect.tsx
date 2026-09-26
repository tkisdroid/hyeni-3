import { useId, useMemo } from "react";
import { useIntl } from "react-intl";
import { orderedTimeZones, suggestedTimeZone, timeZoneOptionLabel } from "./timeZoneOptions";
import "./TimeZoneSelect.css";

export { suggestedTimeZone } from "./timeZoneOptions";

/** 시간대는 국가만으로 추정하지 않고 보호자가 목록에서 확인한다. */
export function TimeZoneSelect({ value, onChange, disabled, recipient = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; recipient?: boolean;
}) {
  const id = useId();
  const intl = useIntl();
  const options = useMemo(
    () => orderedTimeZones(value, suggestedTimeZone()).map((zone) => ({ zone, label: timeZoneOptionLabel(zone, intl.locale) })),
    [intl.locale, value],
  );
  // 배치·모양은 클래스가 맡는다(공용 컴포넌트에 인라인 style 을 두면 소비 화면이 덮을 수 없다).
  return <label htmlFor={id} className="hy-tz">
    <span className="hy-tz__label">{intl.formatMessage({ id: recipient ? "core.recipientTimeZone.label" : "core.familyTimeZone.label" })}</span>
    <select id={id} className="hy-tz__select" value={value} onChange={event => onChange(event.target.value)} disabled={disabled}>
      {options.map(({ zone, label }) => <option key={zone} value={zone}>{label}</option>)}
    </select>
  </label>;
}

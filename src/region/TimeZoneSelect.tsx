import { useId, useMemo } from "react";
import { useIntl } from "react-intl";
import { orderedTimeZones, suggestedTimeZone, timeZoneOptionLabel } from "./timeZoneOptions";

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
  return <label htmlFor={id} style={{ display: "grid", gap: 8, marginBlock: 12, minWidth: 0 }}>
    <span>{intl.formatMessage({ id: recipient ? "core.recipientTimeZone.label" : "core.familyTimeZone.label" })}</span>
    <select id={id} value={value} onChange={event => onChange(event.target.value)} disabled={disabled}
      style={{ width: "100%", minWidth: 0, minHeight: 44, font: "inherit" }}>
      {options.map(({ zone, label }) => <option key={zone} value={zone}>{label}</option>)}
    </select>
  </label>;
}

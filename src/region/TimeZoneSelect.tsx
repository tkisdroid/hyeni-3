import { useId } from "react";
import { useIntl } from "react-intl";
import { FAMILY_TIME_ZONES } from "../../shared/timeZones";
import { normalizeTimeZone } from "../../shared/timeZone";

export function suggestedTimeZone(): string {
  return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
}

/** 시간대는 국가만으로 추정하지 않고 보호자가 목록에서 확인한다. */
export function TimeZoneSelect({ value, onChange, disabled, recipient = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; recipient?: boolean;
}) {
  const id = useId();
  const intl = useIntl();
  const zones = [...new Set([value, suggestedTimeZone(), "UTC", "Asia/Seoul", ...FAMILY_TIME_ZONES])].sort();
  return <label htmlFor={id} style={{ display: "grid", gap: 8, marginBlock: 12, minWidth: 0 }}>
    <span>{intl.formatMessage({ id: recipient ? "core.recipientTimeZone.label" : "core.familyTimeZone.label" })}</span>
    <select id={id} value={value} onChange={event => onChange(event.target.value)} disabled={disabled}
      style={{ width: "100%", minWidth: 0, minHeight: 44, font: "inherit" }}>
      {zones.map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
    </select>
  </label>;
}

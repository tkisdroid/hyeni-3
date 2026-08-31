import { useIntl } from "react-intl";
import type { FamilyMapProps } from "@/maps/contracts";
import type { MapPolicy } from "../../../../shared/mapPolicy";

export function UnsupportedMapAdapter({
  policy,
  child,
  picked,
  className,
}: FamilyMapProps & { policy: Extract<MapPolicy, { provider: "unsupported" }> }) {
  const intl = useIntl();
  const point = picked ?? child ?? null;
  const reasonId = policy.reason === "country_unresolved"
    ? "shared.map.countryUnresolved"
    : "shared.map.countryUnsupported";
  return (
    <section className={[className, "fm-unavailable"].filter(Boolean).join(" ")} role="status">
      <strong>{intl.formatMessage({ id: reasonId })}</strong>
      {point && <code>{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</code>}
      {child?.measuredAt && <time dateTime={child.measuredAt}>{child.measuredAt}</time>}
      {child?.accuracyM != null && <span>±{Math.round(child.accuracyM)}m</span>}
      <a href="#/parent/settings">{intl.formatMessage({ id: "shared.map.openCountrySettings" })}</a>
    </section>
  );
}

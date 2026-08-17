import "./RouteLoading.css";
import { useIntl } from "react-intl";

export function RouteLoading() {
  const intl = useIntl();
  return (
    <div className="route-loading" role="status" aria-live="polite" aria-label={intl.formatMessage({ id: "core.state.loadingScreen" })}>
      <span className="route-loading__visual" aria-hidden="true">
        <span className="route-loading__shimmer" />
      </span>
      <span className="route-loading__label">{intl.formatMessage({ id: "core.state.loadingScreen" })}</span>
    </div>
  );
}

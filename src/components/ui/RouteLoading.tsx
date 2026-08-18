import "./RouteLoading.css";
import { useIntl } from "react-intl";
import { LoaderMark } from "./LoaderMark";

/** 라우트 청크를 받는 동안의 화면 자리표시 — 공용 로딩 마크로 다른 로딩과 같은 그림을 쓴다. */
export function RouteLoading() {
  const intl = useIntl();
  return (
    <div className="route-loading" role="status" aria-live="polite" aria-label={intl.formatMessage({ id: "core.state.loadingScreen" })}>
      <LoaderMark />
      <span className="route-loading__label">{intl.formatMessage({ id: "core.state.loadingScreen" })}</span>
    </div>
  );
}

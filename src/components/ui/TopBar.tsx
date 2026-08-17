import type { ReactNode } from "react";
import { asset } from "@/lib/assets";
import { useIntl } from "react-intl";

/** 앱 상단바: 로고 + 타이틀 + 우측 액션 슬롯. */
export function TopBar({ actions }: { actions?: ReactNode }) {
  const intl = useIntl();
  return (
    <header className="hy-topbar">
      <div className="hy-topbar__brand">
        <img className="hy-topbar__logo" src={asset("mascot/wave.webp")} alt="" />
        <span className="hy-topbar__title">{intl.formatMessage({ id: "core.brand.name" })}</span>
      </div>
      {actions && <div className="hy-topbar__actions">{actions}</div>}
    </header>
  );
}

import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import type { LucideIcon } from "lucide-react";
import { preloadRoute, preloadRoutesWhenIdle } from "./routePreload";

export type TabItem = {
  to: string;
  label: string;
  Icon: LucideIcon;
  dot?: boolean;
};

/** 역할별 하단 탭바. tabs 설정을 받아 렌더. */
export function TabBar({ tabs, iconOnly = false }: { tabs: TabItem[]; iconOnly?: boolean }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // 탭은 곧 누를 목적지다 — 한가할 때 미리 받아 두면 첫 진입에서 화면이 한 번 비지 않는다.
  const tabPathKey = tabs.map((tab) => tab.to).join("|");
  const navigationLabel = tabs.map((tab) => tab.label).join(", ");
  useEffect(() => preloadRoutesWhenIdle(tabPathKey.split("|")), [tabPathKey]);

  return (
    <nav className="hy-tabbar" aria-label={navigationLabel} data-icon-only={iconOnly ? "true" : undefined}>
      <div className="hy-tabbar__inner">
        {tabs.map((t) => {
          const active = pathname === t.to || pathname.startsWith(t.to + "/");
          return (
            <button
              key={t.to}
              type="button"
              className="hy-tab hy-press"
              data-active={active}
              aria-current={active ? "page" : undefined}
              aria-label={t.label}
              onPointerDown={() => preloadRoute(t.to)}
              onClick={() => navigate(t.to)}
            >
              <span className="hy-tab__icon">
                <t.Icon size={22} strokeWidth={active ? 2.4 : 2.2} />
                {t.dot && <span className="hy-tab__dot" />}
              </span>
              {!iconOnly && <span className="hy-tab__label">{t.label}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

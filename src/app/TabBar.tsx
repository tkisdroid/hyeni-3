import { useLocation, useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

export type TabItem = {
  to: string;
  label: string;
  Icon: LucideIcon;
  dot?: boolean;
};

/** 역할별 하단 탭바. tabs 설정을 받아 렌더. */
export function TabBar({ tabs }: { tabs: TabItem[] }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="hy-tabbar" aria-label="주 메뉴">
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
              onClick={() => navigate(t.to)}
            >
              <span className="hy-tab__icon">
                <t.Icon size={21} strokeWidth={active ? 2.4 : 2} />
                {t.dot && <span className="hy-tab__dot" />}
              </span>
              <span className="hy-tab__label">{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * 아이 모드 하단 독 — 홈 · 스티커 · 대화 3탭 + 오른쪽 SOS 버튼(시안 2a).
 *
 * SOS 는 탭이 아니라 별도 버튼이다: 누르면 SOS 화면으로 가고, 실제 발사는 그 화면에서
 * 3초 홀드해야 한다(오발사 방지). 대화 탭 배지는 아직 안 읽은 부모님 메시지 수.
 */
import { useEffect } from "react";
import { NavLink, useNavigate } from "react-router";
import { useIntl } from "react-intl";
import { asset } from "@/lib/assets";
import { preloadRoute, preloadRoutesWhenIdle } from "./routePreload";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "@/queries/useFamily";
import { useMemoThread } from "@/queries/useMemo";
import { unreadParentMemoCount } from "@/transform/childHomeData";
import { useRecentDateKeys } from "./useRecentDateKeys";
import { LEGACY_FAMILY_TIME_ZONE } from "@/i18n/format";
import "./ChildDock.css";

const TABS = [
  { to: "/child/home", labelId: "core.childDock.tab.home", icon: "ui/place-home.webp" },
  { to: "/child/sticker", labelId: "core.childDock.tab.sticker", icon: "ui/menu-sticker.webp" },
  { to: "/child/memo", labelId: "core.childDock.tab.memo", icon: "ui/chat-heart.webp" },
] as const;

export function ChildDock() {
  const navigate = useNavigate();
  const intl = useIntl();
  const { userId } = useAuth();
  const { data: family } = useMyFamily();
  const myMember = family?.members.find((m) => m.role === "child" && m.user_id === userId) ?? null;
  const dateKeys = useRecentDateKeys(7, LEGACY_FAMILY_TIME_ZONE);
  const memoThread = useMemoThread(dateKeys, myMember?.id ?? null);
  const unread = unreadParentMemoCount(memoThread.data, userId);

  // 아이가 곧 누를 화면(대화·스티커·SOS)을 한가할 때 미리 받아 첫 진입에서 화면이 비지 않게 한다.
  useEffect(() => preloadRoutesWhenIdle([...TABS.map((tab) => tab.to), "/child/sos"]), []);

  return (
    <nav className="kdock" aria-label={intl.formatMessage({ id: "core.childDock.nav" })}>
      <div className="kdock__bar">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className="kdock__tab hy-press"
            aria-label={intl.formatMessage({ id: tab.labelId })}
            onPointerDown={() => preloadRoute(tab.to)}
          >
            {tab.to === "/child/memo" && unread > 0 && <span className="kdock__badge">{unread}</span>}
            <img src={asset(tab.icon)} alt="" />
          </NavLink>
        ))}
      </div>
      <button
        type="button"
        className="kdock__sos hy-press"
        aria-label={intl.formatMessage({ id: "core.childDock.sos" })}
        onPointerDown={() => preloadRoute("/child/sos")}
        onClick={() => navigate("/child/sos")}
      >
        <img src={asset("ui/sos-shield.webp")} alt="" />
        <span>SOS</span>
      </button>
    </nav>
  );
}

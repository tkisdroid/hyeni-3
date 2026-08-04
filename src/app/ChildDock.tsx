/**
 * 아이 모드 하단 독 — 홈 · 스티커 · 대화 3탭 + 오른쪽 SOS 버튼(시안 2a).
 *
 * SOS 는 탭이 아니라 별도 버튼이다: 누르면 SOS 화면으로 가고, 실제 발사는 그 화면에서
 * 3초 홀드해야 한다(오발사 방지). 대화 탭 배지는 아직 안 읽은 부모님 메시지 수.
 */
import { NavLink, useNavigate } from "react-router";
import { asset } from "@/lib/assets";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "@/queries/useFamily";
import { useMemoThread } from "@/queries/useMemo";
import { unreadParentMemoCount } from "@/transform/childHomeData";
import { useRecentDateKeys } from "./useRecentDateKeys";
import "./ChildDock.css";

const TABS = [
  { to: "/child/home", label: "홈", icon: "ui/place-home.webp" },
  { to: "/child/sticker", label: "스티커", icon: "ui/menu-sticker.webp" },
  { to: "/child/memo", label: "대화", icon: "ui/chat-heart.webp" },
] as const;

export function ChildDock() {
  const navigate = useNavigate();
  const { userId } = useAuth();
  const { data: family } = useMyFamily();
  const myMember = family?.members.find((m) => m.role === "child" && m.user_id === userId) ?? null;
  const dateKeys = useRecentDateKeys(7);
  const memoThread = useMemoThread(dateKeys, myMember?.id ?? null);
  const unread = unreadParentMemoCount(memoThread.data, userId);

  return (
    <nav className="kdock" aria-label="아이 메뉴">
      <div className="kdock__bar">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} className="kdock__tab hy-press" aria-label={tab.label}>
            {tab.to === "/child/memo" && unread > 0 && <span className="kdock__badge">{unread}</span>}
            <img src={asset(tab.icon)} alt="" />
          </NavLink>
        ))}
      </div>
      <button type="button" className="kdock__sos hy-press" aria-label="도움 요청" onClick={() => navigate("/child/sos")}>
        <img src={asset("ui/sos-shield.webp")} alt="" />
        <span>SOS</span>
      </button>
    </nav>
  );
}

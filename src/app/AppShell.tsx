import { Outlet } from "react-router-dom";
import { Home, CalendarDays, MapPin, MessageCircle, Settings, Users } from "lucide-react";
import { useMemo } from "react";
import { useAccent } from "./accent";
import { ChildDock } from "./ChildDock";
import { TabBar, type TabItem } from "./TabBar";
import { ToastHost } from "./toast";
import { useParentAlerts } from "@/queries/useNotifications";
import { useActiveChild } from "./activeChild";

const PARENT_TABS: TabItem[] = [
  { to: "/parent/home", label: "홈", Icon: Home },
  { to: "/parent/calendar", label: "캘린더", Icon: CalendarDays },
  { to: "/parent/location", label: "위치", Icon: MapPin },
  { to: "/parent/memo", label: "대화", Icon: MessageCircle },
  { to: "/parent/settings", label: "설정", Icon: Settings },
];

/** 대화 탭 빨간 점 — 활성 아이의 미읽음 메모 알림(parent_alerts alert_type=memo_*)이 있을 때만.
 *  child_user_id 없는(legacy) 메모 알림은 포함(놓치는 것보다 안전). */
function useMemoDotTabs(baseTabs: TabItem[], memoPath: string): TabItem[] {
  const { data: alerts } = useParentAlerts();
  const { activeChild } = useActiveChild();
  const activeUserId = activeChild?.user_id ?? null;
  const hasUnreadMemo = useMemo(
    () =>
      (alerts ?? []).some(
        (a) =>
          !a.read &&
          (a.alert_type ?? "").startsWith("memo") &&
          (!a.child_user_id || !activeUserId || a.child_user_id === activeUserId),
      ),
    [alerts, activeUserId],
  );
  return useMemo(
    () => baseTabs.map((t) => (t.to === memoPath ? { ...t, dot: hasUnreadMemo } : t)),
    [baseTabs, memoPath, hasUnreadMemo],
  );
}

const TEACHER_TABS: TabItem[] = [
  { to: "/teacher/home", label: "반 홈", Icon: Home },
  { to: "/teacher/students", label: "학생", Icon: Users },
  { to: "/teacher/timetable", label: "시간표", Icon: CalendarDays },
  { to: "/teacher/settings", label: "설정", Icon: Settings },
];

/** 부모 모드 셸: 폰 프레임 + 스크롤 + 부모 탭바. */
export function ParentShell() {
  const { accent } = useAccent();
  const tabs = useMemoDotTabs(PARENT_TABS, "/parent/memo");
  return (
    <div className="hy-app" data-accent={accent}>
      <div className="hy-screen">
        <Outlet />
      </div>
      <TabBar tabs={tabs} />
      <ToastHost />
    </div>
  );
}

/** 아이 모드 셸: 시안 2a 의 하단 독(홈·스티커·대화 + SOS). 색은 아이가 고른 강조색. */
export function ChildShell() {
  const { accent } = useAccent();
  return (
    <div className="hy-app" data-accent={accent}>
      <div className="hy-screen hy-screen--dock">
        <Outlet />
      </div>
      <ChildDock />
      <ToastHost />
    </div>
  );
}

/** 선생님 모드 셸: 강조색 민트 고정 + 선생님 탭바. */
export function TeacherShell() {
  return (
    <div className="hy-app" data-accent="mint">
      <div className="hy-screen">
        <Outlet />
      </div>
      <TabBar tabs={TEACHER_TABS} />
      <ToastHost />
    </div>
  );
}

/** 푸시/상세 화면 셸: 탭바 없음(화면 자체 헤더의 뒤로가기 사용). */
export function PushShell() {
  const { accent } = useAccent();
  return (
    <div className="hy-app" data-accent={accent}>
      <div className="hy-screen">
        <Outlet />
      </div>
      <ToastHost />
    </div>
  );
}

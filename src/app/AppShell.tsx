import { Outlet } from "react-router";
import { Home, CalendarDays, MapPin, MessageCircle, Settings, Users } from "lucide-react";
import { lazy, Suspense, useMemo } from "react";
import { useAccent } from "./accent";
import { useEffect } from "react";
import { warmKakaoMaps } from "@/lib/kakaoMap";
import { ChildDock } from "./ChildDock";
import { TabBar, type TabItem } from "./TabBar";
import { ToastHost } from "./toast";
import { useMyFamily } from "@/queries/useFamily";
import { useUnreadMemoForChildren } from "@/queries/useMemo";
import { useRecentDateKeys } from "./useRecentDateKeys";
import { LEGACY_FAMILY_TIME_ZONE } from "@/i18n/format";
import { useIntl } from "react-intl";

/**
 * AI 친구 플로팅 버튼은 첫 화면을 그리는 데 필요하지 않다.
 * 진입 번들 예산(500KB) 안에 머물도록 지연 로드하고, 도착 전에는 아무것도 그리지 않는다.
 */
const AiBuddyFab = lazy(async () => ({ default: (await import("./AiBuddyFab")).AiBuddyFab }));

/** 셸마다 다른 하단 여유(독·탭바 높이)를 넘겨 버튼이 가려지지 않게 한다. */
function AiBuddyFabSlot({ bottomInset }: { bottomInset: number }) {
  return (
    <Suspense fallback={null}>
      <AiBuddyFab bottomInset={bottomInset} />
    </Suspense>
  );
}

function useParentTabs(): TabItem[] {
  const intl = useIntl();
  return useMemo(() => [
    { to: "/parent/home", label: intl.formatMessage({ id: "core.nav.home" }), Icon: Home },
    { to: "/parent/calendar", label: intl.formatMessage({ id: "core.nav.calendar" }), Icon: CalendarDays },
    { to: "/parent/location", label: intl.formatMessage({ id: "core.nav.location" }), Icon: MapPin },
    { to: "/parent/memo", label: intl.formatMessage({ id: "core.nav.chat" }), Icon: MessageCircle },
    { to: "/parent/settings", label: intl.formatMessage({ id: "core.nav.settings" }), Icon: Settings },
  ], [intl]);
}

/** 대화 탭 빨간 점 — 모든 아이의 실제 1:1 스레드 read_by 기준. */
function useMemoDotTabs(baseTabs: TabItem[], memoPath: string): TabItem[] {
  const { data: family } = useMyFamily();
  const dateKeys = useRecentDateKeys(7, LEGACY_FAMILY_TIME_ZONE);
  const childIds = useMemo(
    () => (family?.members ?? []).filter((member) => member.role === "child").map((member) => member.id),
    [family],
  );
  const hasUnreadMemo = useUnreadMemoForChildren(dateKeys, childIds);
  return useMemo(
    () => baseTabs.map((t) => (t.to === memoPath ? { ...t, dot: hasUnreadMemo } : t)),
    [baseTabs, memoPath, hasUnreadMemo],
  );
}

function useTeacherTabs(): TabItem[] {
  const intl = useIntl();
  return useMemo(() => [
    { to: "/teacher/home", label: intl.formatMessage({ id: "core.nav.classHome" }), Icon: Home },
    { to: "/teacher/students", label: intl.formatMessage({ id: "core.nav.students" }), Icon: Users },
    { to: "/teacher/timetable", label: intl.formatMessage({ id: "core.nav.timetable" }), Icon: CalendarDays },
    { to: "/teacher/settings", label: intl.formatMessage({ id: "core.nav.settings" }), Icon: Settings },
  ], [intl]);
}

/**
 * 앱이 한가할 때 Kakao 지도 SDK 를 미리 받아 둔다.
 * 위치·경로 화면에 들어가는 순간 스크립트를 받기 시작하면 그만큼 흰 화면이 길어진다.
 */
function useWarmKakaoMaps(): void {
  useEffect(() => {
    warmKakaoMaps();
  }, []);
}

/** 부모 모드 셸: 폰 프레임 + 스크롤 + 부모 탭바. */
export function ParentShell() {
  const { accent } = useAccent();
  const tabs = useMemoDotTabs(useParentTabs(), "/parent/memo");
  useWarmKakaoMaps();
  return (
    <div className="hy-app" data-accent={accent}>
      <main className="hy-screen">
        <Outlet />
      </main>
      <TabBar tabs={tabs} />
      <ToastHost />
    </div>
  );
}

/** 아이 모드 셸: 시안 2a 의 하단 독(홈·스티커·대화 + SOS). 색은 아이가 고른 강조색. */
export function ChildShell() {
  const { accent } = useAccent();
  useWarmKakaoMaps();
  return (
    <div className="hy-app" data-role="child" data-accent={accent}>
      <main className="hy-screen hy-screen--dock">
        <Outlet />
      </main>
      <ChildDock />
      {/* 하단 독(패딩 24 + 바 66 + 12)을 피해서만 놓이도록 여유를 알려 준다. */}
      <AiBuddyFabSlot bottomInset={112} />
      <ToastHost />
    </div>
  );
}

/** 선생님 모드 셸: 강조색 민트 고정 + 선생님 탭바. */
export function TeacherShell() {
  const tabs = useTeacherTabs();
  return (
    <div className="hy-app" data-accent="mint">
      <main className="hy-screen">
        <Outlet />
      </main>
      <TabBar tabs={tabs} />
      <ToastHost />
    </div>
  );
}

/** 푸시/상세 화면 셸: 탭바 없음(화면 자체 헤더의 뒤로가기 사용). */
export function PushShell() {
  const { accent } = useAccent();
  return (
    <div className="hy-app" data-accent={accent}>
      <main className="hy-screen">
        <Outlet />
      </main>
      {/* 아이가 상세 화면에 있어도 AI 친구는 계속 대기한다(부모·선생님 세션에서는 렌더되지 않음). */}
      <AiBuddyFabSlot bottomInset={20} />
      <ToastHost />
    </div>
  );
}

import { useFamilyTimeZone } from "@/region/FamilyTimeZone";
import { Outlet, useLocation } from "react-router";
import { Home, CalendarDays, MapPin, MessageCircle, Settings, Users } from "lucide-react";
import { lazy, Suspense, useMemo } from "react";
import { useAccent } from "./accent";
import { useAuth } from "@/auth/AuthContext";
import { useScrolledShell } from "./useScrolledShell";
import { ChildDock } from "./ChildDock";
import { TabBar, type TabItem } from "./TabBar";
import { ToastHost } from "./toast";
import { useMyFamily } from "@/queries/useFamily";
import { useUnreadMemoForChildren } from "@/queries/useMemo";
import { useRecentDateKeys } from "./useRecentDateKeys";

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

/**
 * 대화 탭 빨간 점 — 모든 아이의 실제 1:1 스레드 read_by 기준.
 *
 * ⚠️ `enabled` 는 "탭바를 그리는가"가 아니라 **"모든 아이 스레드를 조회해도 되는가"**다.
 *    아이 세션은 자기 스레드만 보므로 여기서 꺼야 한다 — 2026-09-22 R3CN400MGNW 실기기 E2E 에서
 *    아이 기기가 push 상세 화면(`#/supplies`·`#/route`)에 들어갈 때 `child_id=<다른 아이>` 로
 *    403 이 났다. PushShell 이 탭바 **렌더**만 role 로 막고 이 조회는 막지 않아, 아이 기기가
 *    `children[0]`(다른 아이) 스레드를 받아오려 했다(AGENTS.md: children[0] 폴백 금지).
 */
function useMemoDotTabs(baseTabs: TabItem[], memoPath: string, enabled: boolean): TabItem[] {
  const familyTimeZone = useFamilyTimeZone();
  const { data: family } = useMyFamily();
  const dateKeys = useRecentDateKeys(7, familyTimeZone);
  const childIds = useMemo(
    () => (enabled
      ? (family?.members ?? []).filter((member) => member.role === "child").map((member) => member.id)
      : []),
    [family, enabled],
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
 * 대화 화면은 메신저처럼 화면 전체를 쓴다 — 입력줄 아래에 하단 메뉴와 휴대폰 내비게이션이 겹겹이 쌓여
 * 이상해 보였다(2026-09-26 TK 제보). 대화 헤더의 뒤로가기가 이동 수단이다.
 */
const CHAT_PATHS = new Set(["/parent/memo", "/child/memo"]);

/** 부모 모드 셸: 폰 프레임 + 스크롤 + 부모 탭바. */
export function ParentShell() {
  const { accent } = useAccent();
  const { pathname } = useLocation();
  const chat = CHAT_PATHS.has(pathname);
  // 이 셸은 부모 전용이라 모든 아이 스레드를 조회해도 된다.
  const tabs = useMemoDotTabs(useParentTabs(), "/parent/memo", true);
  const scrolledRef = useScrolledShell();
  return (
    <div className="hy-app hy-adult" data-role="parent" data-accent={accent} data-chat={chat ? "true" : undefined}>
      <main className="hy-screen" ref={scrolledRef}>
        <Outlet />
      </main>
      {!chat && <TabBar tabs={tabs} />}
      <ToastHost />
    </div>
  );
}

/** 아이 모드 셸: 시안 2a 의 하단 독(홈·스티커·대화 + SOS). 색은 아이가 고른 강조색. */
export function ChildShell() {
  const { accent } = useAccent();
  const { pathname } = useLocation();
  const chat = CHAT_PATHS.has(pathname);
  return (
    <div className="hy-app" data-role="child" data-accent={accent} data-chat={chat ? "true" : undefined}>
      <main className="hy-screen hy-screen--dock">
        <Outlet />
      </main>
      {/* 대화 화면은 AI 친구 대화처럼 자기 입력줄이 바닥을 쓴다 — 독(SOS 포함)은 홈·스티커에서 쓴다. */}
      {chat ? (
        <AiBuddyFabSlot bottomInset={20} />
      ) : (
        <>
          <ChildDock />
          {/* 하단 독(패딩 24 + 바 66 + 12)을 피해서만 놓이도록 여유를 알려 준다. */}
          <AiBuddyFabSlot bottomInset={112} />
        </>
      )}
      <ToastHost />
    </div>
  );
}

/** 선생님 모드 셸: 강조색 민트 고정 + 선생님 탭바. */
export function TeacherShell() {
  const tabs = useTeacherTabs();
  const scrolledRef = useScrolledShell();
  return (
    <div className="hy-app hy-adult" data-accent="mint">
      <main className="hy-screen" ref={scrolledRef}>
        <Outlet />
      </main>
      <TabBar tabs={tabs} />
      <ToastHost />
    </div>
  );
}

/**
 * 아직 앱 안으로 들어오지 않았거나, 들어와서는 안 되는 화면들.
 * 여기서는 하단 메뉴를 숨긴다 — 누르면 갈 곳이 없거나(온보딩: 가족 미연결),
 * 일부러 가둬 둔 게이트(권한 거부·강제 업데이트)이기 때문이다.
 */
const NAVLESS_PUSH_PATHS = new Set([
  "/onboarding",
  "/app-update",
  "/perm-denied",
  "/crash-test",
]);

/**
 * 푸시/상세 화면 셸. 바로가기로 들어간 화면에서도 하단 메뉴가 보이도록
 * 부모·선생님 탭바를 함께 렌더한다(2026-08-21 TK 지시).
 *
 * ⚠️ 아이 세션은 제외한다. 아이 상세 화면은 SOS 3초 홀드처럼 화면을 통째로 쓰거나
 *    AI 친구 대화처럼 하단에 자기 입력줄을 두고 있어, 독을 겹치면 그 화면이 무너진다.
 *    아이의 이동 수단은 플로팅 AI 친구와 화면 헤더의 뒤로가기다.
 */
export function PushShell() {
  const { accent } = useAccent();
  // 아이도 쓰는 셸이라 .hy-adult 는 role 로 정한다.
  const { role } = useAuth();
  const scrolledRef = useScrolledShell();
  const { pathname } = useLocation();
  // 탭바를 그리는 것과 남의 스레드를 조회하는 것은 다르다 — 아이 세션은 두 다 하지 않는다.
  const parentTabs = useMemoDotTabs(useParentTabs(), "/parent/memo", role === "parent");
  const teacherTabs = useTeacherTabs();
  const showNav = !NAVLESS_PUSH_PATHS.has(pathname);
  const isChild = role === "child";
  return (
    <div className={`hy-app${isChild ? "" : " hy-adult"}`} data-accent={accent}>
      <main className="hy-screen" ref={scrolledRef} data-nav={showNav && !isChild ? "push" : undefined} data-shell="push">
        <Outlet />
      </main>
      {showNav && role === "parent" && <TabBar tabs={parentTabs} />}
      {showNav && role === "teacher" && <TabBar tabs={teacherTabs} />}
      {/* 아이 세션에서만 렌더된다. */}
      <AiBuddyFabSlot bottomInset={20} />
      <ToastHost />
    </div>
  );
}

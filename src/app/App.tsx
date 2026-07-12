import { useEffect, useState } from "react";
import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";
import { ParentShell, ChildShell, TeacherShell, PushShell } from "./AppShell";
import { Splash } from "@/screens/Splash";
import { AccentProvider } from "./accent";
import { ToastProvider } from "./toast";
import { QueryProvider } from "@/queries/QueryProvider";
import { AuthProvider } from "@/auth/AuthProvider";
import { RequireRole } from "@/auth/RequireRole";
import { RequireGuest } from "@/auth/RequireGuest";
import { useFamilyRealtime } from "@/queries/useFamilyRealtime";
import { NativeBootstrap } from "./NativeBootstrap";
import { ActiveChildProvider } from "./activeChild";

// 부모
import { ParentHome } from "@/screens/parent/ParentHome";
import { ParentCalendar } from "@/screens/parent/ParentCalendar";
import { ParentLocation } from "@/screens/parent/ParentLocation";
import { ParentFamily } from "@/screens/parent/ParentFamily";
import { ParentSettings } from "@/screens/parent/ParentSettings";
// 공용
import { MemoChat } from "@/screens/shared/MemoChat";
// 아이
import { ChildHome } from "@/screens/child/ChildHome";
import { StickerBook } from "@/screens/child/StickerBook";
import { ChildSos } from "@/screens/child/ChildSos";
import { AiFriendChat } from "@/screens/child/AiFriendChat";
// 선생님
import { TeacherHome } from "@/screens/teacher/TeacherHome";
import { TeacherStudents } from "@/screens/teacher/TeacherStudents";
import { TeacherSettings } from "@/screens/teacher/TeacherSettings";
// 온보딩·기능(푸시)
import { Onboarding } from "@/screens/onboarding/Onboarding";
import { Subscription } from "@/screens/feature/Subscription";
import { Notifications } from "@/screens/feature/Notifications";
import { RemoteAudio } from "@/screens/feature/RemoteAudio";
import { PlaceManager } from "@/screens/feature/PlaceManager";
import { FriendPlay } from "@/screens/feature/FriendPlay";
import { AiSchedule } from "@/screens/feature/AiSchedule";
import { AiCredit } from "@/screens/feature/AiCredit";
import { Feedback } from "@/screens/feature/Feedback";
import { PhoneSetup } from "@/screens/feature/PhoneSetup";
import { PlaydateAccept } from "@/screens/feature/PlaydateAccept";
import { StickerSend } from "@/screens/feature/StickerSend";
import { ProfileEdit } from "@/screens/feature/ProfileEdit";
import { PlaceForm } from "@/screens/feature/PlaceForm";
import { ChildInvite } from "@/screens/feature/ChildInvite";
import { RouteView } from "@/screens/feature/RouteView";
// Wave 1 신규 화면
import { EventForm } from "@/screens/parent/EventForm";
import { Supplies } from "@/screens/feature/Supplies";
import { DangerZoneForm } from "@/screens/feature/DangerZoneForm";
import { LocationStatus } from "@/screens/feature/LocationStatus";
import { ChildDetail } from "@/screens/parent/ChildDetail";
import { PairingWizard } from "@/screens/feature/PairingWizard";
import { TeacherNotice } from "@/screens/teacher/TeacherNotice";
import { TeacherTimetable } from "@/screens/teacher/TeacherTimetable";
// Wave 2 신규 화면
import { FamilyConnection } from "@/screens/feature/FamilyConnection";
import { LocationSettings } from "@/screens/feature/LocationSettings";
import { ChildLocationStatus } from "@/screens/child/ChildLocationStatus";
import { ChildSettings } from "@/screens/child/ChildSettings";
import { ParentAccount } from "@/screens/parent/ParentAccount";
import { DataSync } from "@/screens/feature/DataSync";
import { TrialLock } from "@/screens/feature/TrialLock";
import { NotificationSettings } from "@/screens/feature/NotificationSettings";
import { ArrivalAlerts } from "@/screens/feature/ArrivalAlerts";
import { DangerAlert } from "@/screens/feature/DangerAlert";
import { DaySummary } from "@/screens/feature/DaySummary";
import { DailySafetyReport } from "@/screens/feature/DailySafetyReport";
import { WeeklyFamilyReport } from "@/screens/feature/WeeklyFamilyReport";
import { RemoteAudioAudit } from "@/screens/feature/RemoteAudioAudit";
import { AiFriendSetup } from "@/screens/child/AiFriendSetup";
import { RemoteRing } from "@/screens/feature/RemoteRing";
import { SosReceive } from "@/screens/feature/SosReceive";
// 앱레벨 골격
import { AppUpdate } from "@/screens/feature/AppUpdate";
import { PermDenied } from "@/screens/feature/PermDenied";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { StickerCelebrationHost } from "@/components/ui/StickerCelebration";
import { RootErrorBoundary, RouteErrorScreen } from "./ErrorBoundary";
import { GlobalErrorListeners } from "./GlobalErrorListeners";

// 전 라우트를 pathless 루트로 감싸 렌더 에러가 흰 화면 대신 복구 화면(RouteErrorScreen)으로 간다.
const router = createHashRouter([
  {
    errorElement: <RouteErrorScreen />,
    children: [
  { index: true, element: <Navigate to="/parent/home" replace /> },

  // 부모 탭 (인증 + role=parent 가드)
  {
    element: <RequireRole role="parent" />,
    children: [
      {
        element: <ParentShell />,
        children: [
          { path: "parent/home", element: <ParentHome /> },
          { path: "parent/calendar", element: <ParentCalendar /> },
          { path: "parent/location", element: <ParentLocation /> },
          { path: "parent/memo", element: <MemoChat /> },
          { path: "parent/settings", element: <ParentSettings /> },
        ],
      },
    ],
  },

  // 아이 탭 (인증 + role=child 가드)
  {
    element: <RequireRole role="child" />,
    children: [
      {
        element: <ChildShell />,
        children: [
          { path: "child/home", element: <ChildHome /> },
          { path: "child/sticker", element: <StickerBook /> },
          { path: "child/memo", element: <MemoChat /> },
        ],
      },
    ],
  },

  // 선생님 탭
  {
    element: <TeacherShell />,
    children: [
      { path: "teacher/home", element: <TeacherHome /> },
      { path: "teacher/students", element: <TeacherStudents /> },
      { path: "teacher/timetable", element: <TeacherTimetable /> },
      { path: "teacher/settings", element: <TeacherSettings /> },
    ],
  },

  // 푸시/상세(탭바 없음)
  {
    element: <PushShell />,
    children: [
      {
        // 인증된(가족 연결된) 세션은 온보딩에 들어올 수 없다 — 딥링크·오작동으로 기존
        // 세션이 익명 로그인에 덮여 로그아웃되던 사고 방지(RequireGuest 주석 참조).
        path: "onboarding",
        element: (
          <RequireGuest>
            <Onboarding />
          </RequireGuest>
        ),
      },
      { path: "parent/family", element: <ParentFamily /> },
      { path: "child/sos", element: <ChildSos /> },
      { path: "child/ai-friend", element: <AiFriendChat /> },
      {
        // 실제 Google Play 결제와 구독 상태 화면은 부모 전용이다. 아이가 결제창을 먼저
        // 완료한 뒤 서버 parent gate에서 403을 받는 유실 경로를 라우트에서 차단한다.
        element: <RequireRole role="parent" />,
        children: [
          { path: "subscription", element: <Subscription /> },
          { path: "trial-lock", element: <TrialLock /> },
        ],
      },
      { path: "notifications", element: <Notifications /> },
      { path: "remote-audio", element: <RemoteAudio /> },
      { path: "place-manager", element: <PlaceManager /> },
      { path: "friend-play", element: <FriendPlay /> },
      { path: "ai-schedule", element: <AiSchedule /> },
      { path: "ai-credit", element: <AiCredit /> },
      { path: "feedback", element: <Feedback /> },
      { path: "phone-setup", element: <PhoneSetup /> },
      { path: "playdate-accept", element: <PlaydateAccept /> },
      { path: "sticker-send", element: <StickerSend /> },
      { path: "profile-edit", element: <ProfileEdit /> },
      { path: "place-form", element: <PlaceForm /> },
      { path: "child-invite", element: <ChildInvite /> },
      { path: "route", element: <RouteView /> },
      // Wave 1 신규 상세/기능 화면
      { path: "event-form", element: <EventForm /> },
      { path: "supplies", element: <Supplies /> },
      { path: "danger-zone-form", element: <DangerZoneForm /> },
      { path: "location-status", element: <LocationStatus /> },
      { path: "child-detail", element: <ChildDetail /> },
      { path: "pairing-wizard", element: <PairingWizard /> },
      { path: "teacher/notice", element: <TeacherNotice /> },
      // Wave 2 신규 상세/기능 화면
      { path: "family-connection", element: <FamilyConnection /> },
      { path: "location-settings", element: <LocationSettings /> },
      { path: "child/location-status", element: <ChildLocationStatus /> },
      { path: "child/settings", element: <ChildSettings /> },
      { path: "account", element: <ParentAccount /> },
      { path: "data-sync", element: <DataSync /> },
      { path: "notification-settings", element: <NotificationSettings /> },
      { path: "arrival-alerts", element: <ArrivalAlerts /> },
      { path: "danger-alert", element: <DangerAlert /> },
      { path: "day-summary", element: <DaySummary /> },
      { path: "daily-report", element: <DailySafetyReport /> },
      { path: "weekly-report", element: <WeeklyFamilyReport /> },
      { path: "remote-audio-audit", element: <RemoteAudioAudit /> },
      { path: "child/ai-friend-setup", element: <AiFriendSetup /> },
      { path: "remote-ring", element: <RemoteRing /> },
      { path: "sos-receive", element: <SosReceive /> },
      // 앱레벨 골격 화면
      { path: "app-update", element: <AppUpdate /> },
      { path: "perm-denied", element: <PermDenied /> },
    ],
  },

  // DEV 전용 — 복구 화면(RouteErrorScreen) E2E 확인용. 프로덕션 번들에서는 빠진다.
  ...(import.meta.env.DEV ? [{ path: "crash-test", element: <CrashProbe /> }] : []),

  { path: "*", element: <Navigate to="/parent/home" replace /> },
    ],
  },
]);

function CrashProbe(): never {
  throw new Error("crash-probe: 복구 화면 검증용 의도적 크래시");
}

// 인증 세션 동안 가족소켓(WS)을 1회 연결·유지(라우트 이동에 영향 없음).
function RealtimeBridge() {
  useFamilyRealtime();
  return null;
}

// 부팅 스플래시 게이트 — 콜드스타트(새 프로세스)에서만 브랜드 스플래시를 잠깐 보여주고
// 페이드아웃 후 제거. 같은 세션의 새로고침/재마운트에는 다시 띄우지 않는다
// (스플래시가 매번 떠서 "로딩 화면"처럼 보이던 문제 — TK 제보 2026-07-06).
// 데이터 로딩 표시는 각 화면의 소형 로더(components/ui/Loading)가 담당한다.
const SPLASH_SHOW_MS = 1600;
const SPLASH_FADE_MS = 300;
const SPLASH_SEEN_KEY = "hy_splash_seen";

function splashAlreadySeen(): boolean {
  try {
    return sessionStorage.getItem(SPLASH_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function BootSplash() {
  const [phase, setPhase] = useState<"show" | "exit" | "done">(() =>
    splashAlreadySeen() ? "done" : "show",
  );
  useEffect(() => {
    if (phase === "done") return;
    try {
      sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
    } catch {
      // sessionStorage 불가 환경이면 매번 표시(무해)
    }
    const t1 = window.setTimeout(() => setPhase("exit"), SPLASH_SHOW_MS);
    const t2 = window.setTimeout(() => setPhase("done"), SPLASH_SHOW_MS + SPLASH_FADE_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (phase === "done") return null;
  return <Splash exiting={phase === "exit"} />;
}

export function App() {
  return (
    <QueryProvider>
      <AuthProvider>
        <RealtimeBridge />
        <NativeBootstrap />
        <ActiveChildProvider>
          <AccentProvider initial="rose">
            <ToastProvider>
              <GlobalErrorListeners />
              <OfflineBanner />
              <BootSplash />
              <StickerCelebrationHost />
              <RootErrorBoundary>
                <RouterProvider router={router} />
              </RootErrorBoundary>
            </ToastProvider>
          </AccentProvider>
        </ActiveChildProvider>
      </AuthProvider>
    </QueryProvider>
  );
}

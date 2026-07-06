import { useEffect, useState } from "react";
import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";
import { ParentShell, ChildShell, TeacherShell, PushShell } from "./AppShell";
import { Splash } from "@/screens/Splash";
import { AccentProvider } from "./accent";
import { ToastProvider } from "./toast";
import { QueryProvider } from "@/queries/QueryProvider";
import { AuthProvider } from "@/auth/AuthProvider";
import { RequireRole } from "@/auth/RequireRole";
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
import { AiFriendSetup } from "@/screens/child/AiFriendSetup";
import { RemoteRing } from "@/screens/feature/RemoteRing";
import { SosReceive } from "@/screens/feature/SosReceive";
// 앱레벨 골격
import { AppUpdate } from "@/screens/feature/AppUpdate";
import { PermDenied } from "@/screens/feature/PermDenied";
import { OfflineBanner } from "@/components/ui/OfflineBanner";

const router = createHashRouter([
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
      { path: "onboarding", element: <Onboarding /> },
      { path: "parent/family", element: <ParentFamily /> },
      { path: "child/sos", element: <ChildSos /> },
      { path: "child/ai-friend", element: <AiFriendChat /> },
      { path: "subscription", element: <Subscription /> },
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
      { path: "trial-lock", element: <TrialLock /> },
      { path: "notification-settings", element: <NotificationSettings /> },
      { path: "arrival-alerts", element: <ArrivalAlerts /> },
      { path: "danger-alert", element: <DangerAlert /> },
      { path: "day-summary", element: <DaySummary /> },
      { path: "child/ai-friend-setup", element: <AiFriendSetup /> },
      { path: "remote-ring", element: <RemoteRing /> },
      { path: "sos-receive", element: <SosReceive /> },
      // 앱레벨 골격 화면
      { path: "app-update", element: <AppUpdate /> },
      { path: "perm-denied", element: <PermDenied /> },
    ],
  },

  { path: "*", element: <Navigate to="/parent/home" replace /> },
]);

// 인증 세션 동안 가족소켓(WS)을 1회 연결·유지(라우트 이동에 영향 없음).
function RealtimeBridge() {
  useFamilyRealtime();
  return null;
}

// 부팅 스플래시 게이트 — 앱 시작 시 브랜드 스플래시(로딩 점 포함)를 잠깐 보여주고
// 페이드아웃 후 제거. 첫 화면 데이터는 그 사이 뒤에서 로드된다(표시 전용, 라우팅 무관).
const SPLASH_SHOW_MS = 1600;
const SPLASH_FADE_MS = 300;
function BootSplash() {
  const [phase, setPhase] = useState<"show" | "exit" | "done">("show");
  useEffect(() => {
    const t1 = window.setTimeout(() => setPhase("exit"), SPLASH_SHOW_MS);
    const t2 = window.setTimeout(() => setPhase("done"), SPLASH_SHOW_MS + SPLASH_FADE_MS);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
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
              <OfflineBanner />
              <BootSplash />
              <RouterProvider router={router} />
            </ToastProvider>
          </AccentProvider>
        </ActiveChildProvider>
      </AuthProvider>
    </QueryProvider>
  );
}

import { Suspense, useEffect, useState, type ReactElement } from "react";
import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";
import { ParentShell, ChildShell, TeacherShell, PushShell } from "./AppShell";
import { Splash } from "@/screens/Splash";
import { AccentProvider } from "./accent";
import { ToastProvider } from "./toast";
import { QueryProvider } from "@/queries/QueryProvider";
import { AuthProvider } from "@/auth/AuthProvider";
import { RequireAnyRole, RequireAuthenticated, RequireRole } from "@/auth/RequireRole";
import { RequireGuest } from "@/auth/RequireGuest";
import { useFamilyRealtime } from "@/queries/useFamilyRealtime";
import { NativeBootstrap } from "./NativeBootstrap";
import { ActiveChildProvider } from "./activeChild";
import { TEACHER_MODE_ENABLED } from "@/config/releaseFeatures";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { StickerCelebrationHost } from "@/components/ui/StickerCelebration";
import { RouteLoading } from "@/components/ui/RouteLoading";
import { RootErrorBoundary, RouteErrorScreen } from "./ErrorBoundary";
import { GlobalErrorListeners } from "./GlobalErrorListeners";
import { lazyScreen } from "./lazyScreen";

// Provider·shell·오류 경계는 즉시 로드하고 사용자 화면만 route 단위로 분리한다.
const ParentHome = lazyScreen(() => import("@/screens/parent/ParentHome"), "ParentHome");
const ParentCalendar = lazyScreen(() => import("@/screens/parent/ParentCalendar"), "ParentCalendar");
const ParentLocation = lazyScreen(() => import("@/screens/parent/ParentLocation"), "ParentLocation");
const ParentFamily = lazyScreen(() => import("@/screens/parent/ParentFamily"), "ParentFamily");
const ParentSettings = lazyScreen(() => import("@/screens/parent/ParentSettings"), "ParentSettings");
const MemoChat = lazyScreen(() => import("@/screens/shared/MemoChat"), "MemoChat");
const ChildHome = lazyScreen(() => import("@/screens/child/ChildHome"), "ChildHome");
const StickerBook = lazyScreen(() => import("@/screens/child/StickerBook"), "StickerBook");
const ChildSos = lazyScreen(() => import("@/screens/child/ChildSos"), "ChildSos");
const AiFriendChat = lazyScreen(() => import("@/screens/child/AiFriendChat"), "AiFriendChat");
const TeacherHome = lazyScreen(() => import("@/screens/teacher/TeacherHome"), "TeacherHome");
const TeacherStudents = lazyScreen(() => import("@/screens/teacher/TeacherStudents"), "TeacherStudents");
const TeacherSettings = lazyScreen(() => import("@/screens/teacher/TeacherSettings"), "TeacherSettings");
const TeacherReleaseGate = lazyScreen(() => import("@/screens/teacher/TeacherReleaseGate"), "TeacherReleaseGate");
const Onboarding = lazyScreen(() => import("@/screens/onboarding/Onboarding"), "Onboarding");
const Subscription = lazyScreen(() => import("@/screens/feature/Subscription"), "Subscription");
const Notifications = lazyScreen(() => import("@/screens/feature/Notifications"), "Notifications");
const RemoteAudio = lazyScreen(() => import("@/screens/feature/RemoteAudio"), "RemoteAudio");
const PlaceManager = lazyScreen(() => import("@/screens/feature/PlaceManager"), "PlaceManager");
const FriendPlay = lazyScreen(() => import("@/screens/feature/FriendPlay"), "FriendPlay");
const AiSchedule = lazyScreen(() => import("@/screens/feature/AiSchedule"), "AiSchedule");
const AiCredit = lazyScreen(() => import("@/screens/feature/AiCredit"), "AiCredit");
const Feedback = lazyScreen(() => import("@/screens/feature/Feedback"), "Feedback");
const PhoneSetup = lazyScreen(() => import("@/screens/feature/PhoneSetup"), "PhoneSetup");
const PlaydateAccept = lazyScreen(() => import("@/screens/feature/PlaydateAccept"), "PlaydateAccept");
const StickerSend = lazyScreen(() => import("@/screens/feature/StickerSend"), "StickerSend");
const ProfileEdit = lazyScreen(() => import("@/screens/feature/ProfileEdit"), "ProfileEdit");
const PlaceForm = lazyScreen(() => import("@/screens/feature/PlaceForm"), "PlaceForm");
const ChildInvite = lazyScreen(() => import("@/screens/feature/ChildInvite"), "ChildInvite");
const RouteView = lazyScreen(() => import("@/screens/feature/RouteView"), "RouteView");
const EventForm = lazyScreen(() => import("@/screens/parent/EventForm"), "EventForm");
const Supplies = lazyScreen(() => import("@/screens/feature/Supplies"), "Supplies");
const DangerZoneForm = lazyScreen(() => import("@/screens/feature/DangerZoneForm"), "DangerZoneForm");
const LocationStatus = lazyScreen(() => import("@/screens/feature/LocationStatus"), "LocationStatus");
const ChildDetail = lazyScreen(() => import("@/screens/parent/ChildDetail"), "ChildDetail");
const PairingWizard = lazyScreen(() => import("@/screens/feature/PairingWizard"), "PairingWizard");
const TeacherNotice = lazyScreen(() => import("@/screens/teacher/TeacherNotice"), "TeacherNotice");
const TeacherTimetable = lazyScreen(() => import("@/screens/teacher/TeacherTimetable"), "TeacherTimetable");
const FamilyConnection = lazyScreen(() => import("@/screens/feature/FamilyConnection"), "FamilyConnection");
const LocationSettings = lazyScreen(() => import("@/screens/feature/LocationSettings"), "LocationSettings");
const ChildLocationStatus = lazyScreen(() => import("@/screens/child/ChildLocationStatus"), "ChildLocationStatus");
const ChildSettings = lazyScreen(() => import("@/screens/child/ChildSettings"), "ChildSettings");
const ParentAccount = lazyScreen(() => import("@/screens/parent/ParentAccount"), "ParentAccount");
const DataSync = lazyScreen(() => import("@/screens/feature/DataSync"), "DataSync");
const TrialLock = lazyScreen(() => import("@/screens/feature/TrialLock"), "TrialLock");
const NotificationSettings = lazyScreen(() => import("@/screens/feature/NotificationSettings"), "NotificationSettings");
const ArrivalAlerts = lazyScreen(() => import("@/screens/feature/ArrivalAlerts"), "ArrivalAlerts");
const DangerAlert = lazyScreen(() => import("@/screens/feature/DangerAlert"), "DangerAlert");
const DaySummary = lazyScreen(() => import("@/screens/feature/DaySummary"), "DaySummary");
const DailySafetyReport = lazyScreen(() => import("@/screens/feature/DailySafetyReport"), "DailySafetyReport");
const WeeklyFamilyReport = lazyScreen(() => import("@/screens/feature/WeeklyFamilyReport"), "WeeklyFamilyReport");
const RemoteAudioAudit = lazyScreen(() => import("@/screens/feature/RemoteAudioAudit"), "RemoteAudioAudit");
const AiFriendSetup = lazyScreen(() => import("@/screens/child/AiFriendSetup"), "AiFriendSetup");
const RemoteRing = lazyScreen(() => import("@/screens/feature/RemoteRing"), "RemoteRing");
const SosReceive = lazyScreen(() => import("@/screens/feature/SosReceive"), "SosReceive");
const AppUpdate = lazyScreen(() => import("@/screens/feature/AppUpdate"), "AppUpdate");
const PermDenied = lazyScreen(() => import("@/screens/feature/PermDenied"), "PermDenied");

function routeElement(element: ReactElement): ReactElement {
  return <Suspense fallback={<RouteLoading />}>{element}</Suspense>;
}

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
          { path: "parent/home", element: routeElement(<ParentHome />) },
          { path: "parent/calendar", element: routeElement(<ParentCalendar />) },
          { path: "parent/location", element: routeElement(<ParentLocation />) },
          { path: "parent/memo", element: routeElement(<MemoChat />) },
          { path: "parent/settings", element: routeElement(<ParentSettings />) },
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
          { path: "child/home", element: routeElement(<ChildHome />) },
          { path: "child/sticker", element: routeElement(<StickerBook />) },
          { path: "child/memo", element: routeElement(<MemoChat />) },
        ],
      },
    ],
  },

  // 선생님 탭 (인증 + role=teacher 가드)
  {
    element: <RequireRole role="teacher" />,
    children: TEACHER_MODE_ENABLED ? [
      {
        element: <TeacherShell />,
        children: [
          { path: "teacher/home", element: routeElement(<TeacherHome />) },
          { path: "teacher/students", element: routeElement(<TeacherStudents />) },
          { path: "teacher/timetable", element: routeElement(<TeacherTimetable />) },
          { path: "teacher/settings", element: routeElement(<TeacherSettings />) },
        ],
      },
    ] : [
      { path: "teacher/*", element: routeElement(<TeacherReleaseGate />) },
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
            {routeElement(<Onboarding />)}
          </RequireGuest>
        ),
      },
      // 부모 전용 푸시/상세 — URL 직접 입력·잘못된 푸시 딥링크도 role 경계에서 차단한다.
      {
        element: <RequireRole role="parent" />,
        children: [
          { path: "parent/family", element: routeElement(<ParentFamily />) },
          { path: "subscription", element: routeElement(<Subscription />) },
          { path: "trial-lock", element: routeElement(<TrialLock />) },
          { path: "notifications", element: routeElement(<Notifications />) },
          { path: "remote-audio", element: routeElement(<RemoteAudio />) },
          { path: "place-manager", element: routeElement(<PlaceManager />) },
          { path: "friend-play", element: routeElement(<FriendPlay />) },
          { path: "ai-schedule", element: routeElement(<AiSchedule />) },
          { path: "ai-credit", element: routeElement(<AiCredit />) },
          { path: "phone-setup", element: routeElement(<PhoneSetup />) },
          { path: "sticker-send", element: routeElement(<StickerSend />) },
          { path: "profile-edit", element: routeElement(<ProfileEdit />) },
          { path: "place-form", element: routeElement(<PlaceForm />) },
          { path: "child-invite", element: routeElement(<ChildInvite />) },
          { path: "event-form", element: routeElement(<EventForm />) },
          { path: "danger-zone-form", element: routeElement(<DangerZoneForm />) },
          { path: "location-status", element: routeElement(<LocationStatus />) },
          { path: "child-detail", element: routeElement(<ChildDetail />) },
          { path: "pairing-wizard", element: routeElement(<PairingWizard />) },
          { path: "family-connection", element: routeElement(<FamilyConnection />) },
          { path: "location-settings", element: routeElement(<LocationSettings />) },
          { path: "account", element: routeElement(<ParentAccount />) },
          { path: "data-sync", element: routeElement(<DataSync />) },
          { path: "notification-settings", element: routeElement(<NotificationSettings />) },
          { path: "arrival-alerts", element: routeElement(<ArrivalAlerts />) },
          { path: "danger-alert", element: routeElement(<DangerAlert />) },
          { path: "day-summary", element: routeElement(<DaySummary />) },
          { path: "daily-report", element: routeElement(<DailySafetyReport />) },
          { path: "weekly-report", element: routeElement(<WeeklyFamilyReport />) },
          { path: "remote-audio-audit", element: routeElement(<RemoteAudioAudit />) },
          { path: "remote-ring", element: routeElement(<RemoteRing />) },
          { path: "sos-receive", element: routeElement(<SosReceive />) },
        ],
      },

      // 아이 전용 푸시/상세 — 부모·선생님 세션에서 아이 전용 액션을 열지 않는다.
      {
        element: <RequireRole role="child" />,
        children: [
          { path: "child/sos", element: routeElement(<ChildSos />) },
          { path: "child/ai-friend", element: routeElement(<AiFriendChat />) },
          { path: "child/location-status", element: routeElement(<ChildLocationStatus />) },
          { path: "child/settings", element: routeElement(<ChildSettings />) },
          { path: "child/ai-friend-setup", element: routeElement(<AiFriendSetup />) },
          { path: "playdate-accept", element: routeElement(<PlaydateAccept />) },
        ],
      },

      // 선생님 전용 푸시/상세 — v1.2.0 프로덕션에서는 위 teacher/* gate가 먼저 막는다.
      ...(TEACHER_MODE_ENABLED ? [{
        element: <RequireRole role="teacher" />,
        children: [
          { path: "teacher/notice", element: routeElement(<TeacherNotice />) },
        ],
      }] : []),

      // 인증 역할 공용 푸시/상세 — 공개 URL에서 피드백 relay를 열지 않는다.
      {
        element: <RequireAuthenticated />,
        children: [
          { path: "feedback", element: routeElement(<Feedback />) },
        ],
      },

      // 부모·아이 공용 상세 — 선생님·공개 URL에서 가족 준비물 데이터를 열지 않는다.
      {
        element: <RequireAnyRole roles={["parent", "child"]} />,
        children: [
          { path: "supplies", element: routeElement(<Supplies />) },
          { path: "route", element: routeElement(<RouteView />) },
        ],
      },
      // 앱레벨 골격 화면
      { path: "app-update", element: routeElement(<AppUpdate />) },
      { path: "perm-denied", element: routeElement(<PermDenied />) },
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

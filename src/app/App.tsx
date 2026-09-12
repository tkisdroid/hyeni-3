import { Suspense, useEffect, useState, type ReactElement } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { createHashRouter, Navigate, Outlet, useLocation } from "react-router";
import { RouterProvider } from "react-router/dom";
import { ParentShell, ChildShell, TeacherShell, PushShell } from "./AppShell";
import { Splash } from "@/screens/Splash";
import { AccentProvider } from "./accent";
import { ToastProvider } from "./toast";
import { QueryProvider } from "@/queries/QueryProvider";
import { AuthProvider } from "@/auth/AuthProvider";
import { useAuth } from "@/auth/AuthContext";
import { RequireAnyRole, RequireAuthenticated, RequireRole } from "@/auth/RequireRole";
import { RequireGuest } from "@/auth/RequireGuest";
import {
  getApiAccessTokenJti,
  getApiLoginGenerationId,
  getApiSessionInstanceId,
} from "@/lib/api/session";
import { readNativeOAuthLoginCompletionForSession } from "@/transform/nativeOAuthLoginCompletion";
import { useFamilyRealtime } from "@/queries/useFamilyRealtime";
import { NativeBootstrap } from "./NativeBootstrap";
import { ActiveChildProvider } from "./activeChild";
import { AiBuddyMoodProvider } from "./aiBuddyMood";
import { TEACHER_MODE_ENABLED } from "@/config/releaseFeatures";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { StickerCelebrationHost } from "@/components/ui/StickerCelebration";
import { RouteLoading } from "@/components/ui/RouteLoading";
import { RootErrorBoundary, RouteErrorScreen } from "./ErrorBoundary";
import { GlobalErrorListeners } from "./GlobalErrorListeners";
import { lazyScreen } from "./lazyScreen";
import { registerRoutePreload } from "./routePreload";
import { AppVersionGate } from "./AppVersionGate";
import { usePwaUpdateCriticalSection } from "@/lib/usePwaUpdateCriticalSection";
import { LocaleBoundary } from "@/i18n/LocaleBoundary";
import type { MessageNamespace } from "@/i18n/generated/messageIds";

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
const ParentStudy = lazyScreen(() => import("@/screens/study/ParentStudy"), "ParentStudy");
const ChildStudy = lazyScreen(() => import("@/screens/study/ChildStudy"), "ChildStudy");
const ChildVocabulary = lazyScreen(() => import("@/screens/study/ChildVocabulary"), "ChildVocabulary");
const ParentVocabulary = lazyScreen(() => import("@/screens/study/ParentVocabulary"), "ParentVocabulary");
const MiniApps = lazyScreen(() => import("@/screens/miniapps/MiniApps"), "MiniApps");
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
// 운영자 전용 숨은 라우트 — 메뉴·탭에 노출하지 않는다.
const AdminAiPrompt = lazyScreen(() => import("@/screens/admin/AdminAiPrompt"), "AdminAiPrompt");
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
const ChildDailyDigest = lazyScreen(() => import("@/screens/feature/ChildDailyDigest"), "ChildDailyDigest");
const WeeklyFamilyReport = lazyScreen(() => import("@/screens/feature/WeeklyFamilyReport"), "WeeklyFamilyReport");
const RemoteAudioAudit = lazyScreen(() => import("@/screens/feature/RemoteAudioAudit"), "RemoteAudioAudit");
const AiFriendSetup = lazyScreen(() => import("@/screens/child/AiFriendSetup"), "AiFriendSetup");
const RemoteRing = lazyScreen(() => import("@/screens/feature/RemoteRing"), "RemoteRing");
const SosReceive = lazyScreen(() => import("@/screens/feature/SosReceive"), "SosReceive");
const AppUpdate = lazyScreen(() => import("@/screens/feature/AppUpdate"), "AppUpdate");
const PermDenied = lazyScreen(() => import("@/screens/feature/PermDenied"), "PermDenied");

/**
 * 탭·독처럼 곧 누를 목적지는 미리 받아 둔다(2026-08-18 TK 제보).
 * 화면 청크는 route 단위라 처음 들어갈 때 "화면을 불러오는 중"이 한 번 지나가는데,
 * 대화·설정처럼 매일 쓰는 화면에서는 그게 "앱이 새로고침됐다"로 읽힌다.
 * 경로 문자열은 아래 라우터 정의와 같아야 한다(`tests/routePreload.test.ts` 가 대조한다).
 */
for (const [path, screen] of [
  ["/parent/home", ParentHome],
  ["/parent/calendar", ParentCalendar],
  ["/parent/location", ParentLocation],
  ["/parent/memo", MemoChat],
  ["/parent/settings", ParentSettings],
  ["/child/home", ChildHome],
  ["/child/sticker", StickerBook],
  ["/child/memo", MemoChat],
  ["/child/sos", ChildSos],
  ["/child/settings", ChildSettings],
  ["/child/ai-friend", AiFriendChat],
  ["/child/ai-friend-setup", AiFriendSetup],
  ["/teacher/home", TeacherHome],
  ["/teacher/students", TeacherStudents],
  ["/teacher/timetable", TeacherTimetable],
  ["/teacher/settings", TeacherSettings],
] as const) {
  registerRoutePreload(path, screen.preload);
}

const ONBOARDING_NAMESPACES = ["core", "onboarding", "shared"] as const;
const PARENT_NAMESPACES = ["core", "parent", "shared"] as const;
// 부모 홈 구독 카드는 `entitlement.planLabelId`(billing namespace)를 번역해 표시한다.
// billing 을 빼면 콜드 스타트에서 카드 설명이 원시 message id 로 보인다(2026-08-25 A17 실측).
const PARENT_HOME_NAMESPACES = ["core", "parent", "billing", "shared"] as const;
const CHILD_NAMESPACES = ["core", "child", "shared"] as const;
const PARENT_STUDY_NAMESPACES = ["core", "onboarding", "parent", "shared"] as const;
const CHILD_STUDY_NAMESPACES = ["core", "onboarding", "child", "shared"] as const;
// 결제 화면도 parent 를 함께 싣는다 — 티어 라벨·잠금 안내(transform/tierPolicy, premiumUpsell)가
// `parent.tier.*`·`parent.upsell.*` 를 쓰므로, 없으면 플랜 비교 열 제목이 "parent.tier.free" 원문 id로 보인다
// (2026-08-17 브라우저 스윕에서 실제로 확인).
const BILLING_NAMESPACES = ["core", "billing", "parent", "shared"] as const;
const REPORT_NAMESPACES = ["core", "reports", "parent", "shared"] as const;
const PARENT_NOTIFICATION_NAMESPACES = ["core", "notifications", "parent", "shared"] as const;
const CHILD_NOTIFICATION_NAMESPACES = ["core", "notifications", "child", "shared"] as const;
// 위치 탭은 위치·장소 문구(notifications)와 프리미엄 안내(billing)를 함께 쓴다 —
// 2026-08-17 실기기 콜드 스타트에서 상태 칩이 원문 id 로 보이던 원인이다.
const PARENT_LOCATION_NAMESPACES = ["core", "parent", "notifications", "billing", "shared"] as const;
const SHARED_NAMESPACES = ["core", "shared"] as const;

function routeElement(
  element: ReactElement,
  namespaces: readonly MessageNamespace[] = ["core"],
): ReactElement {
  return (
    <Suspense fallback={<RouteLoading />}>
      <LocaleBoundary namespaces={namespaces}>{element}</LocaleBoundary>
    </Suspense>
  );
}

/** 자동 업데이트로 입력 중인 초안이 사라지면 안 되는 편집 전용 화면. */
const PWA_DRAFT_PROTECTED_ROUTES = new Set([
  "/onboarding",
  "/ai-schedule",
  "/phone-setup",
  "/sticker-send",
  "/profile-edit",
  "/place-form",
  "/event-form",
  "/danger-zone-form",
  "/pairing-wizard",
  "/location-settings",
  "/remote-ring",
  "/child/sos",
  "/child/ai-friend-setup",
  "/study/learn",
  "/study/vocabulary/learn",
  "/feedback",
  "/supplies",
  "/teacher/notice",
]);

function AppRouteServices() {
  const location = useLocation();
  const auth = useAuth();
  const activeMutationCount = useIsMutating();
  const nativeOAuthCompletion = readNativeOAuthLoginCompletionForSession(
    auth.userId,
    getApiSessionInstanceId(),
    getApiAccessTokenJti(),
    getApiLoginGenerationId(),
  );
  usePwaUpdateCriticalSection(
    activeMutationCount > 0 || PWA_DRAFT_PROTECTED_ROUTES.has(location.pathname),
  );

  return (
    <>
      <AppVersionGate />
      {nativeOAuthCompletion && location.pathname !== "/onboarding"
        ? <Navigate to="/onboarding" replace />
        : <Outlet />}
    </>
  );
}

// 전 라우트를 pathless 루트로 감싸 렌더 에러가 흰 화면 대신 복구 화면(RouteErrorScreen)으로 간다.
const router = createHashRouter([
  {
    element: <AppRouteServices />,
    children: [
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
          { path: "parent/home", element: routeElement(<ParentHome />, PARENT_HOME_NAMESPACES) },
          { path: "parent/calendar", element: routeElement(<ParentCalendar />, PARENT_NAMESPACES) },
          { path: "parent/location", element: routeElement(<ParentLocation />, PARENT_LOCATION_NAMESPACES) },
          { path: "parent/memo", element: routeElement(<MemoChat />, PARENT_NAMESPACES) },
          { path: "parent/settings", element: routeElement(<ParentSettings />, PARENT_NAMESPACES) },
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
          { path: "child/home", element: routeElement(<ChildHome />, CHILD_NAMESPACES) },
          { path: "child/sticker", element: routeElement(<StickerBook />, CHILD_NAMESPACES) },
          { path: "child/memo", element: routeElement(<MemoChat />, CHILD_NAMESPACES) },
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
          { path: "teacher/home", element: routeElement(<TeacherHome />, SHARED_NAMESPACES) },
          { path: "teacher/students", element: routeElement(<TeacherStudents />, SHARED_NAMESPACES) },
          { path: "teacher/timetable", element: routeElement(<TeacherTimetable />, SHARED_NAMESPACES) },
          { path: "teacher/settings", element: routeElement(<TeacherSettings />, SHARED_NAMESPACES) },
        ],
      },
    ] : [
      { path: "teacher/*", element: routeElement(<TeacherReleaseGate />, SHARED_NAMESPACES) },
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
            {routeElement(<Onboarding />, ONBOARDING_NAMESPACES)}
          </RequireGuest>
        ),
      },
      // 부모 전용 푸시/상세 — URL 직접 입력·잘못된 푸시 딥링크도 role 경계에서 차단한다.
      {
        element: <RequireRole role="parent" />,
        children: [
          { path: "parent/family", element: routeElement(<ParentFamily />, PARENT_NAMESPACES) },
          { path: "subscription", element: routeElement(<Subscription />, BILLING_NAMESPACES) },
          { path: "trial-lock", element: routeElement(<TrialLock />, BILLING_NAMESPACES) },
          { path: "notifications", element: routeElement(<Notifications />, PARENT_NOTIFICATION_NAMESPACES) },
          { path: "remote-audio", element: routeElement(<RemoteAudio />, PARENT_NOTIFICATION_NAMESPACES) },
          { path: "place-manager", element: routeElement(<PlaceManager />, PARENT_NOTIFICATION_NAMESPACES) },
          { path: "friend-play", element: routeElement(<FriendPlay />, PARENT_NAMESPACES) },
          { path: "ai-schedule", element: routeElement(<AiSchedule />, PARENT_NAMESPACES) },
          { path: "ai-credit", element: routeElement(<AiCredit />, BILLING_NAMESPACES) },
          { path: "phone-setup", element: routeElement(<PhoneSetup />, PARENT_NAMESPACES) },
          { path: "sticker-send", element: routeElement(<StickerSend />, PARENT_NAMESPACES) },
          { path: "profile-edit", element: routeElement(<ProfileEdit />, PARENT_NAMESPACES) },
          { path: "place-form", element: routeElement(<PlaceForm />, PARENT_NOTIFICATION_NAMESPACES) },
          { path: "child-invite", element: routeElement(<ChildInvite />, PARENT_NAMESPACES) },
          { path: "event-form", element: routeElement(<EventForm />, PARENT_NAMESPACES) },
          { path: "danger-zone-form", element: routeElement(<DangerZoneForm />, PARENT_NOTIFICATION_NAMESPACES) },
          { path: "location-status", element: routeElement(<LocationStatus />, PARENT_NOTIFICATION_NAMESPACES) },
          { path: "child-detail", element: routeElement(<ChildDetail />, PARENT_NAMESPACES) },
          { path: "pairing-wizard", element: routeElement(<PairingWizard />, PARENT_NAMESPACES) },
          { path: "family-connection", element: routeElement(<FamilyConnection />, PARENT_NAMESPACES) },
          { path: "location-settings", element: routeElement(<LocationSettings />, PARENT_NOTIFICATION_NAMESPACES) },
          { path: "account", element: routeElement(<ParentAccount />, PARENT_NAMESPACES) },
          { path: "data-sync", element: routeElement(<DataSync />, PARENT_NAMESPACES) },
          { path: "notification-settings", element: routeElement(<NotificationSettings />, PARENT_NOTIFICATION_NAMESPACES) },
          { path: "arrival-alerts", element: routeElement(<ArrivalAlerts />, PARENT_NOTIFICATION_NAMESPACES) },
          { path: "danger-alert", element: routeElement(<DangerAlert />, PARENT_NOTIFICATION_NAMESPACES) },
          { path: "day-summary", element: routeElement(<DaySummary />, REPORT_NAMESPACES) },
          { path: "daily-report", element: routeElement(<DailySafetyReport />, REPORT_NAMESPACES) },
          { path: "weekly-report", element: routeElement(<WeeklyFamilyReport />, REPORT_NAMESPACES) },
          { path: "child-digest", element: routeElement(<ChildDailyDigest />, REPORT_NAMESPACES) },
          { path: "remote-audio-audit", element: routeElement(<RemoteAudioAudit />, PARENT_NOTIFICATION_NAMESPACES) },
          { path: "remote-ring", element: routeElement(<RemoteRing />, PARENT_NOTIFICATION_NAMESPACES) },
          { path: "sos-receive", element: routeElement(<SosReceive />, PARENT_NOTIFICATION_NAMESPACES) },
          { path: "study", element: routeElement(<ParentStudy />, PARENT_STUDY_NAMESPACES) },
          { path: "study/vocabulary", element: routeElement(<ParentVocabulary />, PARENT_STUDY_NAMESPACES) },
        ],
      },

      // 아이 전용 푸시/상세 — 부모·선생님 세션에서 아이 전용 액션을 열지 않는다.
      {
        element: <RequireRole role="child" />,
        children: [
          { path: "child/sos", element: routeElement(<ChildSos />, CHILD_NOTIFICATION_NAMESPACES) },
          { path: "child/ai-friend", element: routeElement(<AiFriendChat />, CHILD_NAMESPACES) },
          { path: "child/location-status", element: routeElement(<ChildLocationStatus />, CHILD_NAMESPACES) },
          { path: "child/settings", element: routeElement(<ChildSettings />, CHILD_NAMESPACES) },
          { path: "child/ai-friend-setup", element: routeElement(<AiFriendSetup />, CHILD_NAMESPACES) },
          { path: "playdate-accept", element: routeElement(<PlaydateAccept />, CHILD_NAMESPACES) },
          { path: "study/learn", element: routeElement(<ChildStudy />, CHILD_STUDY_NAMESPACES) },
          { path: "study/vocabulary/learn", element: routeElement(<ChildVocabulary />, CHILD_STUDY_NAMESPACES) },
        ],
      },

      // 선생님 전용 푸시/상세 — v1.4.0 프로덕션에서는 위 teacher/* gate가 먼저 막는다.
      ...(TEACHER_MODE_ENABLED ? [{
        element: <RequireRole role="teacher" />,
        children: [
          { path: "teacher/notice", element: routeElement(<TeacherNotice />, SHARED_NAMESPACES) },
        ],
      }] : []),

      // 인증 역할 공용 푸시/상세 — 공개 URL에서 피드백 relay를 열지 않는다.
      {
        element: <RequireAuthenticated />,
        children: [
          { path: "feedback", element: routeElement(<Feedback />, SHARED_NAMESPACES) },
          { path: "admin/ai-prompt", element: routeElement(<AdminAiPrompt />, SHARED_NAMESPACES) },
        ],
      },

      // 부모·아이 공용 상세 — 선생님·공개 URL에서 가족 준비물 데이터를 열지 않는다.
      {
        element: <RequireAnyRole roles={["parent", "child"]} />,
        children: [
          { path: "miniapps", element: routeElement(<MiniApps />, SHARED_NAMESPACES) },
          { path: "supplies", element: routeElement(<Supplies />, SHARED_NAMESPACES) },
          { path: "route", element: routeElement(<RouteView />, SHARED_NAMESPACES) },
        ],
      },
      // 앱레벨 골격 화면
      { path: "app-update", element: routeElement(<AppUpdate />, SHARED_NAMESPACES) },
      { path: "perm-denied", element: routeElement(<PermDenied />, SHARED_NAMESPACES) },
    ],
  },

  // DEV 전용 — 복구 화면(RouteErrorScreen) E2E 확인용. 프로덕션 번들에서는 빠진다.
  ...(import.meta.env.DEV ? [{ path: "crash-test", element: <CrashProbe /> }] : []),

  { path: "*", element: <Navigate to="/parent/home" replace /> },
        ],
      },
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
const SPLASH_SHOW_MS = 600;
const SPLASH_FADE_MS = 180;
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
            {/* AI 친구 표정은 대화 화면(PushShell)과 플로팅 버튼(ChildShell)이 함께 쓰므로
                라우터 위에서 한 번만 들고 있어야 화면을 옮겨도 표정이 이어진다. */}
            <AiBuddyMoodProvider>
              <ToastProvider>
                <GlobalErrorListeners />
                <OfflineBanner />
                <BootSplash />
                <StickerCelebrationHost />
                <RootErrorBoundary>
                  <RouterProvider router={router} />
                </RootErrorBoundary>
              </ToastProvider>
            </AiBuddyMoodProvider>
          </AccentProvider>
        </ActiveChildProvider>
      </AuthProvider>
    </QueryProvider>
  );
}

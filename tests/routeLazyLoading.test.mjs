import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertAppRouteContract, parseAppRouteContract } from "./helpers/routeContract.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(rootDir, path), "utf8");
const app = read("src/app/App.tsx");

const lazyScreens = [
  { component: "ParentHome", module: "@/screens/parent/ParentHome", namedExport: "ParentHome" },
  { component: "ParentCalendar", module: "@/screens/parent/ParentCalendar", namedExport: "ParentCalendar" },
  { component: "ParentLocation", module: "@/screens/parent/ParentLocation", namedExport: "ParentLocation" },
  { component: "ParentFamily", module: "@/screens/parent/ParentFamily", namedExport: "ParentFamily" },
  { component: "ParentSettings", module: "@/screens/parent/ParentSettings", namedExport: "ParentSettings" },
  { component: "MemoChat", module: "@/screens/shared/MemoChat", namedExport: "MemoChat" },
  { component: "ChildHome", module: "@/screens/child/ChildHome", namedExport: "ChildHome" },
  { component: "StickerBook", module: "@/screens/child/StickerBook", namedExport: "StickerBook" },
  { component: "ChildSos", module: "@/screens/child/ChildSos", namedExport: "ChildSos" },
  { component: "AiFriendChat", module: "@/screens/child/AiFriendChat", namedExport: "AiFriendChat" },
  { component: "ParentStudy", module: "@/screens/study/ParentStudy", namedExport: "ParentStudy" },
  { component: "ChildStudy", module: "@/screens/study/ChildStudy", namedExport: "ChildStudy" },
  { component: "TeacherHome", module: "@/screens/teacher/TeacherHome", namedExport: "TeacherHome" },
  { component: "TeacherStudents", module: "@/screens/teacher/TeacherStudents", namedExport: "TeacherStudents" },
  { component: "TeacherSettings", module: "@/screens/teacher/TeacherSettings", namedExport: "TeacherSettings" },
  { component: "TeacherReleaseGate", module: "@/screens/teacher/TeacherReleaseGate", namedExport: "TeacherReleaseGate" },
  { component: "Onboarding", module: "@/screens/onboarding/Onboarding", namedExport: "Onboarding" },
  { component: "Subscription", module: "@/screens/feature/Subscription", namedExport: "Subscription" },
  { component: "Notifications", module: "@/screens/feature/Notifications", namedExport: "Notifications" },
  { component: "RemoteAudio", module: "@/screens/feature/RemoteAudio", namedExport: "RemoteAudio" },
  { component: "PlaceManager", module: "@/screens/feature/PlaceManager", namedExport: "PlaceManager" },
  { component: "FriendPlay", module: "@/screens/feature/FriendPlay", namedExport: "FriendPlay" },
  { component: "AiSchedule", module: "@/screens/feature/AiSchedule", namedExport: "AiSchedule" },
  { component: "AiCredit", module: "@/screens/feature/AiCredit", namedExport: "AiCredit" },
  { component: "Feedback", module: "@/screens/feature/Feedback", namedExport: "Feedback" },
  { component: "AdminAiPrompt", module: "@/screens/admin/AdminAiPrompt", namedExport: "AdminAiPrompt" },
  { component: "PhoneSetup", module: "@/screens/feature/PhoneSetup", namedExport: "PhoneSetup" },
  { component: "PlaydateAccept", module: "@/screens/feature/PlaydateAccept", namedExport: "PlaydateAccept" },
  { component: "StickerSend", module: "@/screens/feature/StickerSend", namedExport: "StickerSend" },
  { component: "ProfileEdit", module: "@/screens/feature/ProfileEdit", namedExport: "ProfileEdit" },
  { component: "PlaceForm", module: "@/screens/feature/PlaceForm", namedExport: "PlaceForm" },
  { component: "ChildInvite", module: "@/screens/feature/ChildInvite", namedExport: "ChildInvite" },
  { component: "RouteView", module: "@/screens/feature/RouteView", namedExport: "RouteView" },
  { component: "EventForm", module: "@/screens/parent/EventForm", namedExport: "EventForm" },
  { component: "Supplies", module: "@/screens/feature/Supplies", namedExport: "Supplies" },
  { component: "DangerZoneForm", module: "@/screens/feature/DangerZoneForm", namedExport: "DangerZoneForm" },
  { component: "LocationStatus", module: "@/screens/feature/LocationStatus", namedExport: "LocationStatus" },
  { component: "ChildDetail", module: "@/screens/parent/ChildDetail", namedExport: "ChildDetail" },
  { component: "PairingWizard", module: "@/screens/feature/PairingWizard", namedExport: "PairingWizard" },
  { component: "TeacherNotice", module: "@/screens/teacher/TeacherNotice", namedExport: "TeacherNotice" },
  { component: "TeacherTimetable", module: "@/screens/teacher/TeacherTimetable", namedExport: "TeacherTimetable" },
  { component: "FamilyConnection", module: "@/screens/feature/FamilyConnection", namedExport: "FamilyConnection" },
  { component: "LocationSettings", module: "@/screens/feature/LocationSettings", namedExport: "LocationSettings" },
  { component: "ChildLocationStatus", module: "@/screens/child/ChildLocationStatus", namedExport: "ChildLocationStatus" },
  { component: "ChildSettings", module: "@/screens/child/ChildSettings", namedExport: "ChildSettings" },
  { component: "ParentAccount", module: "@/screens/parent/ParentAccount", namedExport: "ParentAccount" },
  { component: "DataSync", module: "@/screens/feature/DataSync", namedExport: "DataSync" },
  { component: "TrialLock", module: "@/screens/feature/TrialLock", namedExport: "TrialLock" },
  { component: "NotificationSettings", module: "@/screens/feature/NotificationSettings", namedExport: "NotificationSettings" },
  { component: "ArrivalAlerts", module: "@/screens/feature/ArrivalAlerts", namedExport: "ArrivalAlerts" },
  { component: "DangerAlert", module: "@/screens/feature/DangerAlert", namedExport: "DangerAlert" },
  { component: "DaySummary", module: "@/screens/feature/DaySummary", namedExport: "DaySummary" },
  { component: "DailySafetyReport", module: "@/screens/feature/DailySafetyReport", namedExport: "DailySafetyReport" },
  { component: "ChildDailyDigest", module: "@/screens/feature/ChildDailyDigest", namedExport: "ChildDailyDigest" },
  { component: "WeeklyFamilyReport", module: "@/screens/feature/WeeklyFamilyReport", namedExport: "WeeklyFamilyReport" },
  { component: "RemoteAudioAudit", module: "@/screens/feature/RemoteAudioAudit", namedExport: "RemoteAudioAudit" },
  { component: "AiFriendSetup", module: "@/screens/child/AiFriendSetup", namedExport: "AiFriendSetup" },
  { component: "RemoteRing", module: "@/screens/feature/RemoteRing", namedExport: "RemoteRing" },
  { component: "SosReceive", module: "@/screens/feature/SosReceive", namedExport: "SosReceive" },
  { component: "AppUpdate", module: "@/screens/feature/AppUpdate", namedExport: "AppUpdate" },
  { component: "PermDenied", module: "@/screens/feature/PermDenied", namedExport: "PermDenied" },
];

const route = (path, component, guard, availability = "always") => ({
  path,
  component,
  guard,
  availability,
});

const routes = [
  route("parent/home", "ParentHome", "parent"),
  route("parent/calendar", "ParentCalendar", "parent"),
  route("parent/location", "ParentLocation", "parent"),
  route("parent/memo", "MemoChat", "parent"),
  route("parent/settings", "ParentSettings", "parent"),
  route("child/home", "ChildHome", "child"),
  route("child/sticker", "StickerBook", "child"),
  route("child/memo", "MemoChat", "child"),
  route("teacher/home", "TeacherHome", "teacher", "teacher-enabled"),
  route("teacher/students", "TeacherStudents", "teacher", "teacher-enabled"),
  route("teacher/timetable", "TeacherTimetable", "teacher", "teacher-enabled"),
  route("teacher/settings", "TeacherSettings", "teacher", "teacher-enabled"),
  route("teacher/*", "TeacherReleaseGate", "teacher", "teacher-disabled"),
  route("onboarding", "Onboarding", "guest"),
  route("parent/family", "ParentFamily", "parent"),
  route("subscription", "Subscription", "parent"),
  route("trial-lock", "TrialLock", "parent"),
  route("notifications", "Notifications", "parent"),
  route("remote-audio", "RemoteAudio", "parent"),
  route("place-manager", "PlaceManager", "parent"),
  route("friend-play", "FriendPlay", "parent"),
  route("ai-schedule", "AiSchedule", "parent"),
  route("ai-credit", "AiCredit", "parent"),
  route("phone-setup", "PhoneSetup", "parent"),
  route("sticker-send", "StickerSend", "parent"),
  route("profile-edit", "ProfileEdit", "parent"),
  route("place-form", "PlaceForm", "parent"),
  route("child-invite", "ChildInvite", "parent"),
  route("event-form", "EventForm", "parent"),
  route("danger-zone-form", "DangerZoneForm", "parent"),
  route("location-status", "LocationStatus", "parent"),
  route("child-detail", "ChildDetail", "parent"),
  route("pairing-wizard", "PairingWizard", "parent"),
  route("family-connection", "FamilyConnection", "parent"),
  route("location-settings", "LocationSettings", "parent"),
  route("account", "ParentAccount", "parent"),
  route("data-sync", "DataSync", "parent"),
  route("notification-settings", "NotificationSettings", "parent"),
  route("arrival-alerts", "ArrivalAlerts", "parent"),
  route("danger-alert", "DangerAlert", "parent"),
  route("day-summary", "DaySummary", "parent"),
  route("daily-report", "DailySafetyReport", "parent"),
  route("weekly-report", "WeeklyFamilyReport", "parent"),
  route("child-digest", "ChildDailyDigest", "parent"),
  route("remote-audio-audit", "RemoteAudioAudit", "parent"),
  route("remote-ring", "RemoteRing", "parent"),
  route("sos-receive", "SosReceive", "parent"),
  route("study", "ParentStudy", "parent"),
  route("child/sos", "ChildSos", "child"),
  route("child/ai-friend", "AiFriendChat", "child"),
  route("child/location-status", "ChildLocationStatus", "child"),
  route("child/settings", "ChildSettings", "child"),
  route("child/ai-friend-setup", "AiFriendSetup", "child"),
  route("playdate-accept", "PlaydateAccept", "child"),
  route("study/learn", "ChildStudy", "child"),
  route("teacher/notice", "TeacherNotice", "teacher", "teacher-enabled"),
  route("feedback", "Feedback", "authenticated"),
  route("admin/ai-prompt", "AdminAiPrompt", "authenticated"),
  route("supplies", "Supplies", "parent|child"),
  route("route", "RouteView", "parent|child"),
  route("app-update", "AppUpdate", "public"),
  route("perm-denied", "PermDenied", "public"),
];

const expected = { lazyScreens, routes };

function assertMutationRejected(replacement, message) {
  const mutated = replacement(app);
  assert.notEqual(mutated, app, `${message}: fixture가 원본을 바꾸지 못했습니다.`);
  assert.throws(() => assertAppRouteContract(mutated, expected), message);
}

test("61개 지연 화면의 component·module·named export 정본을 AST로 고정한다", () => {
  assert.equal(lazyScreens.length, 61);
  assert.deepEqual(parseAppRouteContract(app).lazyScreens, lazyScreens);
});

test("62개 경로의 component·guard·출시 조건 정본을 AST로 고정한다", () => {
  assert.equal(routes.length, 62);
  assert.deepEqual(parseAppRouteContract(app).routes, routes);
  assert.doesNotThrow(() => assertAppRouteContract(app, expected));
});

test("namespace가 있는 routeElement의 첫 JSX 인자에서 화면을 읽는다", () => {
  assert.deepEqual(
    parseAppRouteContract(app).routes.find(({ path }) => path === "parent/home"),
    route("parent/home", "ParentHome", "parent"),
  );
});

test("단일 인자 routeElement도 같은 라우트 정본으로 읽는다", () => {
  const singleArgumentRoute = app.replace(
    'routeElement(<ParentHome />, PARENT_HOME_NAMESPACES)',
    "routeElement(<ParentHome />)",
  );
  assert.notEqual(singleArgumentRoute, app, "단일 인자 fixture가 원본을 바꿔야 합니다.");
  assert.deepEqual(
    parseAppRouteContract(singleArgumentRoute).routes.find(({ path }) => path === "parent/home"),
    route("parent/home", "ParentHome", "parent"),
  );
});

test("routeElement의 지원 계약 밖 인자 형태를 거부한다", () => {
  assert.throws(
    () => parseAppRouteContract(app.replace(
      'routeElement(<ParentHome />, PARENT_HOME_NAMESPACES)',
      "routeElement()",
    )),
    /routeElement.*인자/,
  );
  assert.throws(
    () => parseAppRouteContract(app.replace(
      'routeElement(<ParentHome />, PARENT_HOME_NAMESPACES)',
      "routeElement(<ParentHome />, PARENT_HOME_NAMESPACES, SHARED_NAMESPACES)",
    )),
    /routeElement.*인자/,
  );

  const wrongNamespace = app.replace(
    'routeElement(<ParentHome />, PARENT_HOME_NAMESPACES)',
    "routeElement(<ParentHome />, NOT_A_NAMESPACE)",
  );
  assert.notEqual(wrongNamespace, app, "잘못된 namespace fixture가 원본을 바꿔야 합니다.");
  assert.throws(
    () => parseAppRouteContract(wrongNamespace),
    /routeElement.*namespace.*인자/,
  );

  const inlineNamespace = app.replace(
    'routeElement(<ParentHome />, PARENT_HOME_NAMESPACES)',
    'routeElement(<ParentHome />, ["core", "parent"])',
  );
  assert.notEqual(inlineNamespace, app, "직접 배열 namespace fixture가 원본을 바꿔야 합니다.");
  assert.throws(
    () => parseAppRouteContract(inlineNamespace),
    /routeElement.*namespace.*인자/,
  );
});

test("지연 화면 선언 삭제를 검출한다", () => {
  assertMutationRejected(
    (source) => source.replace(
      'const ParentHome = lazyScreen(() => import("@/screens/parent/ParentHome"), "ParentHome");',
      "",
    ),
    "지연 화면 삭제를 허용하면 안 됩니다.",
  );
});

test("지연 화면의 module 및 named export 오배선을 각각 검출한다", () => {
  assertMutationRejected(
    (source) => source.replace('import("@/screens/parent/ParentHome")', 'import("@/screens/child/ChildHome")'),
    "잘못된 화면 모듈을 허용하면 안 됩니다.",
  );
  assertMutationRejected(
    (source) => source.replace('"ParentHome");', '"ChildHome");'),
    "잘못된 named export를 허용하면 안 됩니다.",
  );
});

test("라우트 삭제를 검출한다", () => {
  assertMutationRejected(
    (source) => source.replace(
      '{ path: "parent/home", element: routeElement(<ParentHome />, PARENT_HOME_NAMESPACES) },',
      "",
    ),
    "라우트 삭제를 허용하면 안 됩니다.",
  );
});

test("라우트 path 오배선을 검출한다", () => {
  assertMutationRejected(
    (source) => source.replace('path: "parent/home"', 'path: "parent/start"'),
    "잘못된 route path를 허용하면 안 됩니다.",
  );
});

test("중복 path를 검출한다", () => {
  assertMutationRejected(
    (source) => source.replace('path: "child/memo"', 'path: "child/home"'),
    "중복 path를 허용하면 안 됩니다.",
  );
});

test("named export 화면 로더는 React.lazy의 default 모듈 계약으로 변환한다", () => {
  const helper = read("src/app/lazyScreen.tsx");
  assert.match(helper, /export function lazyScreen/);
  assert.match(helper, /lazy\(async \(\) =>/);
  assert.match(helper, /default:\s*loaded\[exportName\]/);
});

test("공통 Suspense 전환 상태와 안정된 로더 접근성을 유지한다", () => {
  const helper = read("src/app/App.tsx");
  const component = read("src/components/ui/RouteLoading.tsx");
  const css = read("src/components/ui/RouteLoading.css");

  assert.match(helper, /<Suspense fallback=\{<RouteLoading \/>\}>/);
  assert.match(component, /role="status"/);
  assert.match(component, /aria-live="polite"/);
  assert.equal(
    component.match(/intl\.formatMessage\(\{ id: "core\.state\.loadingScreen" \}\)/g)?.length,
    2,
    "상태 label과 화면 표시 문구가 같은 locale catalog ID를 사용해야 합니다",
  );
  const koCore = JSON.parse(read("locales/ko/core.json"));
  assert.match(koCore["core.state.loadingScreen"], /화면을 불러오는 중/);
  assert.match(css, /\.route-loading\s*\{[^}]*min-height:\s*(?:var\([^;]+\)|\d+px)/s);
  // 로더 그림은 공용 로딩 마크가 맡고, 움직임 줄이기도 그 컴포넌트가 정지 프레임으로 처리한다
  // (가드=tests/progressIndicatorContract.test.mjs).
  assert.match(component, /<LoaderMark \/>/);
  assert.match(read("src/components/ui/LoaderMark.tsx"), /media="\(prefers-reduced-motion: reduce\)"/);
});

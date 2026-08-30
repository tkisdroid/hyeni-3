import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tsModule from "typescript";

const ts = tsModule.default ?? tsModule;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(rootDir, path), "utf8");

const queryStates = (loading, error, empty, success, retry) => ({
  loading,
  error,
  empty,
  success,
  retry,
});

const queryStatesAt = (source, loading, error, empty, success, retry) => ({
  source,
  states: queryStates(loading, error, empty, success, retry),
});

const route = (
  path,
  screen,
  source,
  guard,
  availability,
  kind,
  states,
  back,
  tone,
  dialog = "none",
) => ({ path, screen, source, guard, availability, kind, states, back, tone, dialog });

// App.tsx에서 실제 렌더되는 63개 사용자 화면의 출시 품질 계약이다.
// 같은 MemoChat 소스를 쓰더라도 부모/아이 라우트는 guard·말투 계약이 달라 별도 행으로 둔다.
const routeQualityMatrix = [
  route("parent/home", "ParentHome", "src/screens/parent/ParentHome.tsx", "parent", "all", "query", [
    queryStatesAt("src/screens/parent/ParentHome.tsx", /eventsQuery\.isLoading/, /eventsQuery\.isError/, /todayEvents\.length === 0/, /todayEvents\.map/, /void handleRefresh\(\)/),
    // 홈의 친구 초대 카드가 여는 패널도 같은 화면의 read query다(2026-08-17).
    queryStatesAt("src/components/ReferralRewardPanel.tsx", /statusQuery\.isLoading/, /statusQuery\.isError/, /eligibleChildren\.length === 0/, /status \? \(/, /void statusQuery\.refetch\(\)/),
  ], "shell", "parent-formal"),
  route("parent/calendar", "ParentCalendar", "src/screens/parent/ParentCalendar.tsx", "parent", "all", "query", queryStates(/isLoading \? \(/, /isError \? \(/, /selEvents\.length > 0/, /selEvents\.map/, /void refetchEvents\(\)/), "shell", "parent-formal"),
  route("parent/location", "ParentLocation", "src/screens/parent/ParentLocation.tsx", "parent", "all", "query", [
    queryStatesAt("src/screens/parent/ParentLocation.tsx", /isFetching: historyFetching/, /isError: historyError/, /pointCount: timedHistoryPoints\.length/, /<LocationJourneyPanel/, /onRetry=\{\(\) => void refetchHistory\(\)\}/),
    queryStatesAt("src/screens/parent/LocationJourneyPanel.tsx", /loading: "parent\.location\.history\.loadingShort"/, /error: "parent\.parentLocation\.copy016"/, /empty: "parent.location.history.emptyDay"/, /state === "ready"/, /onClick=\{onRetry\}/),
  ], "shell", "parent-formal"),
  route("parent/memo", "MemoChat", "src/screens/shared/MemoChat.tsx", "parent", "all", "query", queryStates(/thread\.isLoading/, /thread\.isError/, /showEmpty/, /messages\.map/, /void thread\.refetch\(\)/), "safe", "role-aware"),
  route("parent/settings", "ParentSettings", "src/screens/parent/ParentSettings.tsx", "parent", "all", "hybrid", [
    queryStatesAt("src/screens/parent/ParentSettings.tsx", /settingsQueryState === "loading"/, /settingsQueryState === "error"/, /settingsDataEmpty/, /settingsRows\.map/, /void retryParentSettings\(\)/),
    queryStatesAt("src/components/ReferralRewardPanel.tsx", /statusQuery\.isLoading/, /statusQuery\.isError/, /eligibleChildren\.length === 0/, /status \? \(/, /void statusQuery\.refetch\(\)/),
  ], "shell", "parent-formal"),
  route("study", "ParentStudy", "src/screens/study/ParentStudy.tsx", "parent", "all", "hybrid", [
    queryStatesAt("src/screens/study/ParentStudy.tsx", /parentStudyQueryState === "loading"/, /parentStudyQueryState === "error"/, /target\.kind === "select"/, /<ParentStudySummary/, /void retryParentStudy\(\)/),
    queryStatesAt("src/features/study/StudyAccessGate.tsx", /status\.isPending \|\| view\.kind === "loading"/, /className="study-access-status" role="alert"/, /view\.kind === "hidden"/, /view\.kind === "enabled"/, /void status\.refetch\(\)/),
  ], "screen", "parent-formal"),

  route("child/home", "ChildHome", "src/screens/child/ChildHome.tsx", "child", "all", "query", [
    queryStatesAt("src/screens/child/ChildHome.tsx", /homeLoading/, /homeError/, /adventure\.nodes\.length === 0/, /adventure\.nodes\.map/, /void retryHomeData\(\)/),
    queryStatesAt("src/screens/child/overlays/PlaydateSheet.tsx", /candidatesQuery\.isLoading/, /candidatesQuery\.isError/, /candidates\.length === 0/, /candidates\.map/, /void candidatesQuery\.refetch\(\)/),
  ], "shell", "child-informal"),
  route("child/sticker", "StickerBook", "src/screens/child/StickerBook.tsx", "child", "all", "query", queryStates(/received\.isLoading/, /received\.isError/, /book\.gotCount === 0/, /book\.slots\.map/, /void received\.refetch\(\)/), "shell", "child-informal"),
  route("child/memo", "MemoChat", "src/screens/shared/MemoChat.tsx", "child", "all", "query", queryStates(/thread\.isLoading/, /thread\.isError/, /showEmpty/, /messages\.map/, /void thread\.refetch\(\)/), "safe", "role-aware"),
  route("study/learn", "ChildStudy", "src/screens/study/ChildStudy.tsx", "child", "all", "hybrid", [
    queryStatesAt("src/screens/study/ChildStudy.tsx", /childStudyQueryState === "loading"/, /childStudyQueryState === "error"/, /entry\.kind === "unavailable"/, /<StudyMissionPlayer/, /void retryChildStudy\(\)/),
    queryStatesAt("src/features/study/StudyAccessGate.tsx", /status\.isPending \|\| view\.kind === "loading"/, /className="study-access-status" role="alert"/, /view\.kind === "hidden"/, /view\.kind === "enabled"/, /void status\.refetch\(\)/),
  ], "screen", "child-informal"),

  route("teacher/home", "TeacherHome", "src/screens/teacher/TeacherHome.tsx", "teacher", "dev", "query", queryStates(/loading/, /genuineError/, /preview\.length === 0/, /preview\.map/, /void retryTeacherHome\(\)/), "shell", "teacher-dev"),
  route("teacher/students", "TeacherStudents", "src/screens/teacher/TeacherStudents.tsx", "teacher", "dev", "query", queryStates(/studentsLoading/, /studentsError/, /visibleStudents\.length === 0/, /visibleStudents\.map/, /void retryTeacherStudents\(\)/), "shell", "teacher-dev"),
  route("teacher/timetable", "TeacherTimetable", "src/screens/teacher/TeacherTimetable.tsx", "teacher", "dev", "query", queryStates(/scheduleQ\.isLoading/, /scheduleQ\.isError/, /rows\.length === 0/, /rows\.map/, /scheduleQ\.refetch\(\)/), "shell", "teacher-dev"),
  route("teacher/settings", "TeacherSettings", "src/screens/teacher/TeacherSettings.tsx", "teacher", "dev", "hybrid", queryStates(/teacherSettingsQueryState === "loading"/, /teacherSettingsQueryState === "error"/, /classesQ\.data\?\.length === 0/, /CLASS_ROWS\.map/, /void retryTeacherSettings\(\)/), "shell", "teacher-dev"),
  route("teacher/*", "TeacherReleaseGate", "src/screens/teacher/TeacherReleaseGate.tsx", "teacher", "production", "mutation", null, "none", "teacher-release"),

  route("onboarding", "Onboarding", "src/screens/onboarding/Onboarding.tsx", "guest", "all", "mutation", null, "none", "role-aware"),
  route("parent/family", "ParentFamily", "src/screens/parent/ParentFamily.tsx", "parent", "all", "query", queryStates(/isLoading/, /isError/, /view\.children\.length === 0/, /view\.children\.map/, /void refetchFamily\(\)/), "safe", "parent-formal"),
  route("subscription", "Subscription", "src/screens/feature/Subscription.tsx", "parent", "all", "hybrid", queryStates(/subscriptionQueryState === "loading"/, /subscriptionQueryState === "error"/, /subscriptionDataEmpty/, /BENEFITS\.map/, /void retrySubscription\(\)/), "screen", "parent-formal"),
  route("trial-lock", "TrialLock", "src/screens/feature/TrialLock.tsx", "parent", "all", "static", null, "screen", "parent-formal"),
  route("notifications", "Notifications", "src/screens/feature/Notifications.tsx", "parent", "all", "query", queryStates(/isLoading/, /isError/, /groups\.length === 0/, /groups\.map/, /refetch\(\)/), "safe", "parent-formal"),
  route("remote-audio", "RemoteAudio", "src/screens/feature/RemoteAudio.tsx", "parent", "all", "hybrid", queryStates(/remoteAudioQueryState === "loading"/, /remoteAudioQueryState === "error"/, /childMembers\.length === 0/, /className="ra-start hy-press"/, /void retryRemoteAudio\(\)/), "screen", "parent-formal"),
  route("place-manager", "PlaceManager", "src/screens/feature/PlaceManager.tsx", "parent", "all", "query", queryStates(/placesLoading/, /placesError/, /places\.length === 0/, /places\.map/, /void retryPlaces\(\)/), "screen", "parent-formal"),
  route("friend-play", "FriendPlay", "src/screens/feature/FriendPlay.tsx", "parent", "all", "query", queryStates(/parentPlaydateLoading/, /parentPlaydateError/, /shared\.friendPlay\.parent\.empty/, /active \? \(/, /void retryParentPlaydate\(\)/), "safe", "parent-formal"),
  route("ai-schedule", "AiSchedule", "src/screens/feature/AiSchedule.tsx", "parent", "all", "hybrid", queryStates(/aiScheduleQueryState === "loading"/, /aiScheduleQueryState === "error"/, /existingEvents\.data\?\.length === 0/, /className="ais-confirm hy-press"/, /void retryAiSchedule\(\)/), "screen", "parent-formal"),
  route("ai-credit", "AiCredit", "src/screens/feature/AiCredit.tsx", "parent", "all", "hybrid", queryStates(/aiCreditQueryState === "loading"/, /aiCreditQueryState === "error"/, /!childUserId|aiCreditDataEmpty/, /availablePacks\.map/, /void retryAiCredit\(\)/), "screen", "parent-formal"),
  route("phone-setup", "PhoneSetup", "src/screens/feature/PhoneSetup.tsx", "parent", "all", "hybrid", queryStates(/phoneQueryState === "loading"/, /phoneQueryState === "error"/, /family && parents\.length === 0/, /parents\.map/, /void retryPhoneSetup\(\)/), "screen", "parent-formal"),
  route("sticker-send", "StickerSend", "src/screens/feature/StickerSend.tsx", "parent", "all", "hybrid", queryStates(/stickerQueryState === "loading"/, /stickerQueryState === "error"/, /children\.length === 0/, /STICKERS\.map/, /void retryStickerSend\(\)/), "screen", "parent-formal"),
  route("profile-edit", "ProfileEdit", "src/screens/feature/ProfileEdit.tsx", "parent", "all", "hybrid", queryStates(/profileQueryState === "loading"/, /profileQueryState === "error"/, /!member/, /member &&/, /void retryProfileEdit\(\)/), "screen", "parent-formal"),
  route("place-form", "PlaceForm", "src/screens/feature/PlaceForm.tsx", "parent", "all", "hybrid", queryStates(/placeFormQueryState === "loading"/, /placeFormQueryState === "error"/, /places\.length === 0/, /PLACE_TYPES\.map/, /void retryPlaceForm\(\)/), "screen", "parent-formal"),
  route("child-invite", "ChildInvite", "src/screens/feature/ChildInvite.tsx", "parent", "all", "query", queryStates(/isLoading/, /isError/, /!pairCode/, /pairLink/, /void refetchFamily\(\)/), "screen", "parent-formal"),
  route("event-form", "EventForm", "src/screens/parent/EventForm.tsx", "parent", "all", "hybrid", queryStates(/eventFormQueryState === "loading"/, /eventFormQueryState === "error"/, /children\.length === 0/, /CATEGORIES\.map/, /void retryEventForm\(\)/), "screen", "parent-formal"),
  route("danger-zone-form", "DangerZoneForm", "src/screens/feature/DangerZoneForm.tsx", "parent", "all", "hybrid", queryStates(/dangerZoneQueryState === "loading"/, /dangerZoneQueryState === "error"/, /zones\.length === 0/, /<KakaoMap/, /void retryDangerZoneForm\(\)/), "screen", "parent-formal"),
  route("location-status", "LocationStatus", "src/screens/feature/LocationStatus.tsx", "parent", "all", "query", queryStates(/\? "loading"/, /\? "error"/, /!loc/, /loc && fresh/, /void retry\(\)/), "screen", "parent-formal"),
  route("child-detail", "ChildDetail", "src/screens/parent/ChildDetail.tsx", "parent", "all", "query", queryStates(/detailLoading/, /detailError/, /!rawChild/, /title=\{name\}/, /void retryChildDetail\(\)/), "screen", "parent-formal"),
  route("pairing-wizard", "PairingWizard", "src/screens/feature/PairingWizard.tsx", "parent", "all", "hybrid", queryStates(/pairingQueryState === "loading"/, /pairingQueryState === "error"/, /existingChildCount === 0/, /COUNTS\.map/, /void retryPairingWizard\(\)/), "screen", "parent-formal"),
  route("family-connection", "FamilyConnection", "src/screens/feature/FamilyConnection.tsx", "parent", "all", "query", queryStates(/connectionLoading/, /connectionError/, /connected\.length === 0/, /connected\.map/, /void retryFamilyConnection\(\)/), "screen", "parent-formal"),
  route("location-settings", "LocationSettings", "src/screens/feature/LocationSettings.tsx", "parent", "all", "hybrid", queryStates(/locationSettingsQueryState === "loading"/, /locationSettingsQueryState === "error"/, /locationSettingsEmpty/, /INTERVALS\.map/, /void retryLocationSettings\(\)/), "screen", "parent-formal"),
  route("account", "ParentAccount", "src/screens/parent/ParentAccount.tsx", "parent", "all", "query", [
    queryStatesAt("src/screens/parent/ParentAccount.tsx", /isLoading \|\| accountLoadError/, /accountIsError/, /account === null/, /const isPrimary = account\.isPrimaryParent/, /void refetchAccount\(\)/),
    queryStatesAt("src/screens/parent/SocialLinks.tsx", /native && isLoading/, /native && isError/, /links\.length === 0/, /links\.map/, /void refetch\(\)/),
  ], "screen", "parent-formal", "focus-trapped"),
  route("data-sync", "DataSync", "src/screens/feature/DataSync.tsx", "parent", "all", "hybrid", queryStates(/dataSyncQueryState === "loading"/, /dataSyncQueryState === "error"/, /dataSyncEmpty/, /members\.filter/, /void retryDataSync\(\)/), "screen", "parent-formal"),
  route("notification-settings", "NotificationSettings", "src/screens/feature/NotificationSettings.tsx", "parent", "all", "hybrid", queryStates(/notificationQueryState === "loading"/, /notificationQueryState === "error"/, /notificationDataEmpty/, /SAFETY_TOGGLES\.map/, /void retryNotificationSettings\(\)/), "screen", "parent-formal"),
  route("arrival-alerts", "ArrivalAlerts", "src/screens/feature/ArrivalAlerts.tsx", "parent", "all", "query", queryStates(/isLoading/, /isError/, /list\.length === 0/, /list\.map/, /refetch\(\)/), "safe", "parent-formal"),
  route("danger-alert", "DangerAlert", "src/screens/feature/DangerAlert.tsx", "parent", "all", "query", queryStates(/isLoading/, /isError/, /!latest/, /latest &&/, /refetch\(\)/), "safe", "parent-formal"),
  route("day-summary", "DaySummary", "src/screens/feature/DaySummary.tsx", "parent", "all", "query", queryStates(/isLoading/, /isError/, /isEmpty/, /rows\.map/, /void refetchSummary\(\)/), "screen", "parent-formal"),
  route("daily-report", "DailySafetyReport", "src/screens/feature/DailySafetyReport.tsx", "parent", "all", "query", queryStates(/safetySourceIsLoading/, /safetySourceHasError/, /todayEvents\.length === 0/, /overviewCards\.map/, /source\.refetch\(\)/), "screen", "parent-formal"),
  route("weekly-report", "WeeklyFamilyReport", "src/screens/feature/WeeklyFamilyReport.tsx", "parent", "all", "query", queryStates(/queryState === "loading"/, /queryState === "error"/, /summary\.busiestDay \?/, /summary \? \(/, /void Promise\.all/), "screen", "parent-formal"),
  route("child-digest", "ChildDailyDigest", "src/screens/feature/ChildDailyDigest.tsx", "parent", "all", "query", queryStates(/query\.isLoading/, /query\.isError/, /!digest \? \(/, /digest\.chat\.topics\.map/, /void query\.refetch\(\)/), "screen", "parent-formal"),
  route("remote-audio-audit", "RemoteAudioAudit", "src/screens/feature/RemoteAudioAudit.tsx", "parent", "all", "query", queryStates(/audit\.isLoading/, /audit\.isError/, /items\.length === 0/, /items\.map/, /audit\.refetch\(\)/), "screen", "parent-formal"),
  route("remote-ring", "RemoteRing", "src/screens/feature/RemoteRing.tsx", "parent", "all", "hybrid", queryStates(/ringQueryState === "loading"/, /ringQueryState === "error"/, /children\.length === 0/, /ringDataReady && ringing/, /void retryRemoteRing\(\)/), "screen", "parent-formal", "focus-trapped"),
  route("sos-receive", "SosReceive", "src/screens/feature/SosReceive.tsx", "parent", "all", "query", queryStates(/sosLoading/, /sosLoadError/, /!latest && !sosLoading && !sosLoadError/, /\{latest && \(/, /void refetchSos\(\)/), "safe", "parent-formal"),

  route("child/sos", "ChildSos", "src/screens/child/ChildSos.tsx", "child", "all", "hybrid", queryStates(/sosFamilyQueryState === "loading"/, /sosFamilyQueryState === "error"/, /parents\.length === 0/, /className="cs-hold hy-press"/, /void retrySosFamily\(\)/), "safe", "child-informal"),
  route("child/ai-friend", "AiFriendChat", "src/screens/child/AiFriendChat.tsx", "child", "all", "query", queryStates(/chatLoading/, /chatError/, /messagesData\.length === 0/, /shown\.map/, /void retryChat\(\)/), "safe", "child-informal"),
  route("child/location-status", "ChildLocationStatus", "src/screens/child/ChildLocationStatus.tsx", "child", "all", "query", queryStates(/isLoading/, /isError/, /!location/, /location &&/, /void refetchLocation\(\)/), "screen", "child-informal"),
  route("child/settings", "ChildSettings", "src/screens/child/ChildSettings.tsx", "child", "all", "hybrid", queryStates(/childSettingsQueryState === "loading"/, /childSettingsQueryState === "error"/, /childSettingsDataEmpty|!me/, /REQUEST_ITEMS\.map/, /void retryChildSettings\(\)/), "screen", "child-informal"),
  route("child/ai-friend-setup", "AiFriendSetup", "src/screens/child/AiFriendSetup.tsx", "child", "all", "hybrid", queryStates(/aiFriendSetupQueryState === "loading"/, /aiFriendSetupQueryState === "error"/, /aiFriendSetupDataEmpty|!childMember/, /afs-name-field/, /void retryAiFriendSetup\(\)/), "screen", "child-informal"),
  route("playdate-accept", "PlaydateAccept", "src/screens/feature/PlaydateAccept.tsx", "child", "all", "query", queryStates(/playdateLoading/, /playdateError/, /incoming\.length === 0/, /incoming\.map/, /void retryPlaydates\(\)/), "safe", "child-informal"),

  route("teacher/notice", "TeacherNotice", "src/screens/teacher/TeacherNotice.tsx", "teacher", "dev", "hybrid", queryStates(/teacherNoticeQueryState === "loading"/, /teacherNoticeQueryState === "error"/, /teacherNoticeDataEmpty/, /attachments\.map/, /void retryTeacherNotice\(\)/), "screen", "teacher-dev"),
  route("feedback", "Feedback", "src/screens/feature/Feedback.tsx", "authenticated", "all", "mutation", null, "screen", "role-aware"),
  // 운영자 전용 숨은 라우트 — 메뉴 미노출, 서버도 화이트리스트 밖 계정에 404.
  route("admin/ai-prompt", "AdminAiPrompt", "src/screens/admin/AdminAiPrompt.tsx", "authenticated", "all", "hybrid", null, "screen", "parent-formal"),
  route("miniapps", "MiniApps", "src/screens/miniapps/MiniApps.tsx", "parent-child", "all", "static", null, "screen", "role-aware"),
  route("supplies", "Supplies", "src/screens/feature/Supplies.tsx", "parent-child", "all", "query", queryStates(/isLoading/, /isError/, /sec\.list\.length === 0/, /sec\.list\.map/, /void Promise\.all/), "screen", "role-aware"),
  route("route", "RouteView", "src/screens/feature/RouteView.tsx", "parent-child", "all", "query", queryStates(/sourceQueriesLoading/, /sourceQueriesError/, /routeState === "no-child" \|\| routeState === "no-dest"/, /steps\.map/, /retrySourceQueries\(\)/), "screen", "role-aware"),
  route("app-update", "AppUpdate", "src/screens/feature/AppUpdate.tsx", "public", "all", "mutation", null, "none", "system"),
  route("perm-denied", "PermDenied", "src/screens/feature/PermDenied.tsx", "public", "all", "mutation", null, "none", "system"),
];

function property(object, name) {
  return object.properties.find(
    (item) => ts.isPropertyAssignment(item)
      && ((ts.isIdentifier(item.name) && item.name.text === name)
        || (ts.isStringLiteral(item.name) && item.name.text === name)),
  );
}

function stringValue(node) {
  return ts.isStringLiteralLike(node) ? node.text : null;
}

function guardFromElement(node, sourceFile) {
  if (!node) return null;
  const text = node.getText(sourceFile);
  const roleMatch = text.match(/<RequireRole\s+role="(parent|child|teacher)"/);
  if (roleMatch) return roleMatch[1];
  if (/<RequireAnyRole\s+roles=\{\["parent",\s*"child"\]\}/.test(text)) return "parent-child";
  if (/<RequireAuthenticated\b/.test(text)) return "authenticated";
  if (/<RequireGuest\b/.test(text)) return "guest";
  return null;
}

function screenFromElement(node, sourceFile, lazyScreens) {
  let found = null;
  const visit = (child) => {
    if (found) return;
    if (ts.isJsxSelfClosingElement(child) && ts.isIdentifier(child.tagName)) {
      const name = child.tagName.text;
      if (lazyScreens.has(name)) found = name;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function extractLazyScreens(sourceFile) {
  const lazyScreens = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === "lazyScreen") {
      const importCall = node.initializer.arguments[0];
      let importPath = null;
      const findImport = (child) => {
        if (ts.isCallExpression(child)
          && child.expression.kind === ts.SyntaxKind.ImportKeyword
          && child.arguments[0]
          && ts.isStringLiteral(child.arguments[0])) {
          importPath = child.arguments[0].text;
        }
        ts.forEachChild(child, findImport);
      };
      findImport(importCall);
      if (importPath?.startsWith("@/")) {
        lazyScreens.set(node.name.text, `src/${importPath.slice(2)}.tsx`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return lazyScreens;
}

const queryModuleCache = new Map();

function localSourcePathForImport(fromSource, moduleName) {
  let base;
  if (moduleName.startsWith("@/")) {
    base = resolve(rootDir, "src", moduleName.slice(2));
  } else if (moduleName.startsWith(".")) {
    base = resolve(rootDir, dirname(fromSource), moduleName);
  } else {
    return null;
  }
  const candidates = /\.[cm]?[jt]sx?$/.test(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")];
  const absolute = candidates.find((candidate) => existsSync(candidate));
  if (!absolute) return null;
  const sourcePath = relative(rootDir, absolute).replaceAll("\\", "/");
  return sourcePath.startsWith("src/") ? sourcePath : null;
}

function sourcePathForImport(fromSource, moduleName) {
  const sourcePath = localSourcePathForImport(fromSource, moduleName);
  return sourcePath?.startsWith("src/queries/") ? sourcePath : null;
}

function queryModuleInfo(sourcePath) {
  const cached = queryModuleCache.get(sourcePath);
  if (cached) return cached;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    read(sourcePath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const functions = new Map();
  const imports = new Map();
  sourceFile.statements.forEach((statement) => {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      statement.declarationList.declarations.forEach((declaration) => {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          functions.set(declaration.name.text, declaration.initializer);
        }
      });
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return;
    const importedSource = sourcePathForImport(sourcePath, statement.moduleSpecifier.text);
    if (!importedSource) return;
    statement.importClause?.namedBindings?.elements?.forEach((element) => {
      imports.set(element.name.text, {
        source: importedSource,
        name: element.propertyName?.text ?? element.name.text,
      });
    });
  });
  const info = { sourceFile, functions, imports };
  queryModuleCache.set(sourcePath, info);
  return info;
}

function isReadQueryHook(sourcePath, hookName, seen = new Set()) {
  const key = `${sourcePath}#${hookName}`;
  if (seen.has(key)) return false;
  seen.add(key);
  const info = queryModuleInfo(sourcePath);
  const hook = info.functions.get(hookName);
  if (!hook) return false;
  let readQuery = false;
  const visit = (node) => {
    if (readQuery) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const called = node.expression.text;
      if (called === "useQuery" || called === "useQueries") {
        readQuery = true;
        return;
      }
      if (info.functions.has(called) && isReadQueryHook(sourcePath, called, new Set(seen))) {
        readQuery = true;
        return;
      }
      const imported = info.imports.get(called);
      if (imported && isReadQueryHook(imported.source, imported.name, new Set(seen))) {
        readQuery = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(hook);
  return readQuery;
}

function readQueryHooksForScreen(sourcePath) {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    read(sourcePath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const hooks = [];
  sourceFile.statements.forEach((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return;
    const importedSource = sourcePathForImport(sourcePath, statement.moduleSpecifier.text);
    if (!importedSource) return;
    statement.importClause?.namedBindings?.elements?.forEach((element) => {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (isReadQueryHook(importedSource, importedName)) hooks.push(element.name.text);
    });
  });
  return hooks.sort();
}

/** 화면이 실제 JSX로 렌더하는 지역 컴포넌트까지 따라가 read query가 있는 파일을 찾는다. */
function readQuerySourcesForScreen(sourcePath, seen = new Set()) {
  if (seen.has(sourcePath)) return [];
  seen.add(sourcePath);
  const sourceFile = ts.createSourceFile(
    sourcePath,
    read(sourcePath),
    ts.ScriptTarget.Latest,
    true,
    sourcePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sources = new Set();
  const jsxNames = new Set();
  let directReadQuery = false;

  const visit = (node) => {
    if (ts.isJsxOpeningLikeElement(node) && ts.isIdentifier(node.tagName)) {
      jsxNames.add(node.tagName.text);
    }
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === "useQuery" || node.expression.text === "useQueries")) {
      directReadQuery = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (directReadQuery) sources.add(sourcePath);

  sourceFile.statements.forEach((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return;
    const moduleName = statement.moduleSpecifier.text;
    const importedSource = localSourcePathForImport(sourcePath, moduleName);
    if (!importedSource) return;

    if (importedSource.startsWith("src/queries/")) {
      statement.importClause?.namedBindings?.elements?.forEach((element) => {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (isReadQueryHook(importedSource, importedName)) sources.add(sourcePath);
      });
      return;
    }

    if (!importedSource.endsWith(".tsx")) return;
    const importedLocals = [];
    if (statement.importClause?.name) importedLocals.push(statement.importClause.name.text);
    statement.importClause?.namedBindings?.elements?.forEach((element) => {
      importedLocals.push(element.name.text);
    });
    if (!importedLocals.some((name) => jsxNames.has(name))) return;
    readQuerySourcesForScreen(importedSource, new Set(seen)).forEach((item) => sources.add(item));
  });

  return [...sources].sort();
}

function assertReadQueryClassification(row) {
  const hooks = readQueryHooksForScreen(row.source);
  const sources = readQuerySourcesForScreen(row.source);
  if (row.kind === "mutation") {
    assert.deepEqual(
      sources,
      [],
      `${row.path}는 read query ${[...hooks, ...sources].join(", ")}를 mutation-only로 숨겼습니다`,
    );
  }
  if (row.kind === "hybrid") {
    assert.ok(sources.length > 0, `${row.path} hybrid 분류에 실제 read query가 없습니다`);
  }
}

function stateContracts(row) {
  if (!row.states) return [];
  if (Array.isArray(row.states)) return row.states;
  return [{ source: row.source, states: row.states }];
}

function assertStateContracts(row) {
  const contracts = stateContracts(row);
  assert.ok(contracts.length > 0, `${row.path} read query 상태 계약이 없습니다`);
  for (const contract of contracts) {
    assert.deepEqual(Object.keys(contract.states).sort(), ["empty", "error", "loading", "retry", "success"]);
    const source = read(contract.source);
    for (const [state, pattern] of Object.entries(contract.states)) {
      assert.match(source, pattern, `${row.path} (${contract.source})의 ${state} 계약이 없습니다`);
    }
  }
  const coveredSources = new Set(contracts.map((contract) => contract.source));
  for (const querySource of readQuerySourcesForScreen(row.source)) {
    assert.ok(coveredSources.has(querySource), `${row.path}의 중첩 read query ${querySource} 상태 계약이 없습니다`);
  }
}

function localFunctionMap(sourceFile) {
  const functions = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      functions.set(node.name.text, node);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        functions.set(node.name.text, node.initializer);
      } else if (ts.isCallExpression(node.initializer)
        && ts.isIdentifier(node.initializer.expression)
        && node.initializer.expression.text === "useCallback"
        && node.initializer.arguments[0]
        && (ts.isArrowFunction(node.initializer.arguments[0]) || ts.isFunctionExpression(node.initializer.arguments[0]))) {
        functions.set(node.name.text, node.initializer.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return functions;
}

function stateReceiverNames(node, propertyName) {
  const names = new Set();
  const visit = (child) => {
    if (ts.isPropertyAccessExpression(child)
      && child.name.text === propertyName
      && ts.isIdentifier(child.expression)) {
      names.add(child.expression.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

function compositeReadQueryNames(sourceFile, row) {
  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "resolveQueryTruthState") {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.equal(calls.length, 1, `${row.path}는 resolveQueryTruthState를 정확히 한 번 사용해야 합니다`);

  const stateList = calls[0].arguments[0];
  assert.ok(ts.isArrayLiteralExpression(stateList), `${row.path} query state 입력은 정적 배열이어야 합니다`);
  const queryNames = [];
  for (const item of stateList.elements) {
    assert.ok(ts.isObjectLiteralExpression(item), `${row.path} query state 항목은 객체여야 합니다`);
    const loadingProperty = property(item, "isLoading");
    const errorProperty = property(item, "isError");
    assert.ok(loadingProperty && errorProperty, `${row.path} query state 항목에 loading/error가 모두 필요합니다`);
    const loadingNames = stateReceiverNames(loadingProperty.initializer, "isLoading");
    const errorNames = stateReceiverNames(errorProperty.initializer, "isError");
    const sharedNames = [...loadingNames].filter((name) => errorNames.has(name));
    assert.equal(sharedNames.length, 1, `${row.path} query state 항목은 같은 query의 loading/error를 사용해야 합니다`);
    queryNames.push(sharedNames[0]);
  }
  assert.ok(queryNames.length > 0, `${row.path} query state에 read query가 없습니다`);
  assert.equal(new Set(queryNames).size, queryNames.length, `${row.path} query state에 같은 query가 중복됐습니다`);
  return queryNames;
}

function readQueryBindings(sourceFile, sourcePath) {
  const readHooks = new Set(readQueryHooksForScreen(sourcePath));
  const bindings = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression)
      && readHooks.has(node.initializer.expression.text)) {
      bindings.set(node.name.text, node.initializer.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

function directReceiverName(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isAsExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : null;
}

function refetchesReachedFromHandler(node, functions, seen = new Set()) {
  const refetches = new Set();
  const expandFunction = (name) => {
    if (seen.has(name)) return;
    const fn = functions.get(name);
    if (!fn) return;
    seen.add(name);
    visit(fn.body ?? fn);
  };
  const visit = (child) => {
    if (ts.isCallExpression(child)) {
      if (ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === "refetch") {
        const receiver = directReceiverName(child.expression.expression);
        if (receiver) refetches.add(receiver);
      } else if (ts.isIdentifier(child.expression) && functions.has(child.expression.text)) {
        expandFunction(child.expression.text);
      }
    }
    ts.forEachChild(child, visit);
  };
  if (ts.isIdentifier(node) && functions.has(node.text)) {
    expandFunction(node.text);
  } else {
    visit(node);
  }
  return refetches;
}

function jsxHandlerRefetchSets(sourceFile, functions) {
  const handlerSets = [];
  const visit = (node) => {
    if (ts.isJsxAttribute(node)
      && ts.isIdentifier(node.name)
      && /^on[A-Z]/.test(node.name.text)
      && node.initializer
      && ts.isJsxExpression(node.initializer)
      && node.initializer.expression) {
      handlerSets.push(refetchesReachedFromHandler(node.initializer.expression, functions));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return handlerSets;
}

function assertCompositeRetryWiring(row, source = read(row.source)) {
  const sourceFile = ts.createSourceFile(
    row.source,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const queryNames = compositeReadQueryNames(sourceFile, row);
  const bindings = readQueryBindings(sourceFile, row.source);
  for (const queryName of queryNames) {
    assert.ok(
      bindings.has(queryName),
      `${row.path}의 ${queryName}는 src/queries의 실제 read query hook 결과여야 합니다`,
    );
  }

  const handlerSets = jsxHandlerRefetchSets(sourceFile, localFunctionMap(sourceFile));
  const completeHandler = handlerSets.find((set) => queryNames.every((queryName) => set.has(queryName)));
  if (!completeHandler) {
    const reached = new Set(handlerSets.flatMap((set) => [...set]));
    const missing = queryNames.filter((queryName) => !reached.has(queryName));
    const names = missing.length > 0 ? missing : queryNames;
    assert.fail(`${row.path}의 ${names.join(", ")} read query가 하나의 실제 retry handler에서 모두 refetch되지 않습니다`);
  }
}

function extractAppRoutes() {
  const source = read("src/app/App.tsx");
  const sourceFile = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lazyScreens = extractLazyScreens(sourceFile);
  const routes = [];
  let routerArray = null;

  const findRouter = (node) => {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "createHashRouter"
      && ts.isArrayLiteralExpression(node.arguments[0])) {
      routerArray = node.arguments[0];
      return;
    }
    ts.forEachChild(node, findRouter);
  };
  findRouter(sourceFile);
  assert.ok(routerArray, "App.tsx의 createHashRouter 배열을 찾지 못했습니다");

  const walk = (node, context = { guard: "public", availability: "all" }) => {
    if (ts.isParenthesizedExpression(node)) {
      walk(node.expression, context);
      return;
    }
    if (ts.isSpreadElement(node)) {
      walk(node.expression, context);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      const condition = node.condition.getText(sourceFile);
      const usesTeacherFlag = condition.includes("TEACHER_MODE_ENABLED");
      walk(node.whenTrue, { ...context, availability: usesTeacherFlag ? "dev" : context.availability });
      walk(node.whenFalse, { ...context, availability: usesTeacherFlag ? "production" : context.availability });
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((item) => walk(item, context));
      return;
    }
    if (!ts.isObjectLiteralExpression(node)) return;

    const elementProperty = property(node, "element");
    const pathProperty = property(node, "path");
    const localGuard = guardFromElement(elementProperty?.initializer, sourceFile) ?? context.guard;
    const localContext = { ...context, guard: localGuard };

    if (pathProperty) {
      const path = stringValue(pathProperty.initializer);
      const screen = elementProperty
        ? screenFromElement(elementProperty.initializer, sourceFile, lazyScreens)
        : null;
      if (path && screen) {
        routes.push({
          path,
          screen,
          source: lazyScreens.get(screen),
          guard: localGuard,
          availability: context.availability,
        });
      }
    }

    const childrenProperty = property(node, "children");
    if (childrenProperty) walk(childrenProperty.initializer, localContext);
  };

  walk(routerArray);
  return routes;
}

test("라우트 품질 매트릭스는 App.tsx의 63개 실제 화면·가드·출시 범위를 정확히 대조한다", () => {
  assert.equal(routeQualityMatrix.length, 63);
  assert.equal(new Set(routeQualityMatrix.map((item) => item.path)).size, 63, "매트릭스 path 중복");
  assert.equal(new Set(routeQualityMatrix.map((item) => item.source)).size, 62, "MemoChat 외 화면 소스 중복 또는 누락");
  assert.equal(routeQualityMatrix.filter((item) => item.kind === "query").length, 32);
  assert.equal(routeQualityMatrix.filter((item) => item.kind === "hybrid").length, 24);
  assert.equal(routeQualityMatrix.filter((item) => item.kind === "mutation").length, 5);
  assert.equal(routeQualityMatrix.filter((item) => item.kind === "static").length, 2);
  for (const item of routeQualityMatrix.filter((row) => row.kind === "mutation" || row.kind === "static")) {
    assert.equal(item.states, null, `${item.path}는 query 상태 계약 대상이 아닙니다`);
  }

  const actual = extractAppRoutes();
  assert.equal(actual.length, 63, "App.tsx 사용자 화면 수가 바뀌면 매트릭스도 함께 갱신해야 합니다");

  const signature = (item) => [item.path, item.screen, item.source, item.guard, item.availability].join("|");
  const expectedSignatures = routeQualityMatrix.map(signature).sort();
  const actualSignatures = actual.map(signature).sort();
  assert.deepEqual(actualSignatures, expectedSignatures);
});

test("mutation-only 분류는 실제 read query를 숨길 수 없고 hybrid는 조회 사용을 명시한다", () => {
  routeQualityMatrix.forEach(assertReadQueryClassification);
  const parentSettings = routeQualityMatrix.find((row) => row.path === "parent/settings");
  assert.ok(parentSettings);
  assert.throws(
    () => assertReadQueryClassification({ ...parentSettings, kind: "mutation" }),
    /mutation-only로 숨겼습니다/,
  );
});

test("중첩 렌더 컴포넌트의 read query도 화면 상태 계약에서 빠질 수 없다", () => {
  const account = routeQualityMatrix.find((row) => row.path === "account");
  assert.ok(account);
  assert.deepEqual(readQuerySourcesForScreen(account.source), [
    "src/screens/parent/ParentAccount.tsx",
    "src/screens/parent/SocialLinks.tsx",
  ]);
  assertStateContracts(account);

  assert.throws(
    () => assertStateContracts({ ...account, states: account.states.slice(0, 1) }),
    /SocialLinks\.tsx 상태 계약이 없습니다/,
  );
});

test("query 화면은 loading/error/empty/success와 실제 retry UI 계약을 모두 가진다", () => {
  const queryRows = routeQualityMatrix.filter((item) => item.kind === "query");
  assert.equal(queryRows.length, 32);
  assert.equal(new Set(queryRows.map((item) => item.source)).size, 31, "MemoChat만 부모·아이 라우트에서 공유됩니다");

  const failures = [];
  for (const item of queryRows) {
    try {
      assertStateContracts(item);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  assert.deepEqual(failures, []);
});

test("감사 완료된 hybrid 화면은 read query의 다섯 상태와 실제 재시도를 계약한다", () => {
  const auditedHybridRows = routeQualityMatrix.filter((item) => item.kind === "hybrid" && item.states);
  assert.deepEqual(auditedHybridRows.map((item) => item.path), [
    "parent/settings",
    "study",
    "study/learn",
    "teacher/settings",
    "subscription",
    "remote-audio",
    "ai-schedule",
    "ai-credit",
    "phone-setup",
    "sticker-send",
    "profile-edit",
    "place-form",
    "event-form",
    "danger-zone-form",
    "pairing-wizard",
    "location-settings",
    "data-sync",
    "notification-settings",
    "remote-ring",
    "child/sos",
    "child/settings",
    "child/ai-friend-setup",
    "teacher/notice",
  ]);
  auditedHybridRows.forEach(assertStateContracts);
});

test("hybrid 화면의 retry handler는 상태를 만든 동일 read query를 모두 다시 조회한다", () => {
  const auditedHybridRows = routeQualityMatrix.filter((item) => item.kind === "hybrid" && item.states);
  auditedHybridRows.forEach((row) => assertCompositeRetryWiring(row));

  const locationSettings = routeQualityMatrix.find((row) => row.path === "location-settings");
  assert.ok(locationSettings);
  const source = read(locationSettings.source);
  const brokenSource = source.replace("preferencesQuery.refetch()", "Promise.resolve()");
  assert.notEqual(brokenSource, source, "회귀 fixture가 실제 preferencesQuery retry를 제거해야 합니다");
  assert.throws(
    () => assertCompositeRetryWiring(locationSettings, brokenSource),
    /preferencesQuery.*retry handler/,
  );
});

test("모든 화면은 뒤로가기와 역할별 말투 정책을 분류하고 DEV 선생님 경계를 보존한다", () => {
  const validBack = new Set(["shell", "safe", "screen", "none"]);
  const validTone = new Set([
    "parent-formal",
    "child-informal",
    "teacher-dev",
    "teacher-release",
    "role-aware",
    "system",
  ]);
  for (const item of routeQualityMatrix) {
    assert.ok(validBack.has(item.back), `${item.path} 뒤로가기 분류 누락`);
    assert.ok(validTone.has(item.tone), `${item.path} 말투 분류 누락`);
    if (item.guard === "parent") assert.notEqual(item.tone, "child-informal", item.path);
    if (item.guard === "child") assert.notEqual(item.tone, "parent-formal", item.path);
    if (item.guard === "teacher" && item.screen !== "TeacherReleaseGate") {
      assert.equal(item.availability, "dev", `${item.path}는 DEV에서만 열려야 합니다`);
      assert.equal(item.tone, "teacher-dev", item.path);
    }
    if (item.back === "safe") {
      const source = read(item.source);
      assert.match(source, /useSafeBack/, `${item.path} safe back hook 누락`);
      assert.match(source, /onClick=\{goBack\}/, `${item.path} safe back 버튼 누락`);
    }
  }

  const appShell = read("src/app/AppShell.tsx");
  assert.match(appShell, /to:\s*"\/teacher\/settings"/);
  assert.match(read("src/config/releaseFeatures.ts"), /TEACHER_MODE_ENABLED\s*=\s*import\.meta\.env\.DEV/);
});

test("계정·지도 선택·원격 울림 dialog는 공통 focus lifecycle을 실제로 연결한다", () => {
  const hook = read("src/components/useDialogFocusLifecycle.ts");
  assert.match(hook, /previousFocus/);
  assert.match(hook, /requestAnimationFrame/);
  assert.match(hook, /handleTopmostDialogKey\(\{/);
  assert.match(hook, /key: event\.key/);
  assert.match(hook, /shiftKey: event\.shiftKey/);
  assert.match(hook, /previousFocus\?\.isConnected/);
  assert.match(hook, /restoreFallback:/);
  assert.match(hook, /restoreDialogFocus\(closeResult\)/);

  const account = read("src/screens/parent/ParentAccount.tsx");
  assert.equal((account.match(/useDialogFocusLifecycle(?:<[^>]+>)?\(/g) ?? []).length, 2, "계정 dialog 2개 모두 focus lifecycle 필요");
  assert.match(account, /ref=\{deleteDialogRef\}/);
  assert.match(account, /ref=\{passwordDialogRef\}/);
  assert.match(account, /aria-labelledby=\{deleteTitleId\}/);
  assert.match(account, /aria-labelledby=\{passwordTitleId\}/);

  const picker = read("src/components/MapPickerSheet.tsx");
  assert.match(picker, /useDialogFocusLifecycle/);
  assert.match(picker, /ref=\{dialogRef\}/);
  assert.match(picker, /aria-labelledby=\{titleId\}/);

  const ring = read("src/screens/feature/RemoteRing.tsx");
  assert.match(ring, /useDialogFocusLifecycle/);
  assert.match(ring, /ref=\{confirmDialogRef\}/);
  assert.match(ring, /role="dialog"/);
  assert.match(ring, /aria-modal="true"/);
  assert.match(ring, /aria-labelledby=\{confirmTitleId\}/);
});

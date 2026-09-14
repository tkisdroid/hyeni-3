import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("부모 위치 화면은 엔타이틀먼트 미확정·오류에서 캐시 좌표와 경로를 숨긴다", () => {
  const source = read("src/screens/parent/ParentLocation.tsx");
  const koParent = JSON.parse(read("locales/ko/parent.json"));

  assert.match(source, /const entitlement = useEntitlement\(\)/);
  assert.match(source, /const locationScopePending = entitlement\.isError \|\| !tierKnown/);
  assert.match(source, /const canShowLocation = !locationScopePending && mode !== "locked"/);
  assert.match(source, /const canShowHistory = canShowLocation/);
  assert.match(source, /const premiumOpen = !locationScopePending && mode === "realtime"/);
  assert.match(source, /const loc = canShowLocation \? cachedLoc : null/);
  assert.match(source, /isLocked \|\| locationScopePending \? "live" : view/);
  assert.match(koParent["parent.location.scopeLoadingForChild"], /조회 범위 확인 중/);
  assert.match(source, /parent\.location\.scopeLoadingForChild/);
  assert.doesNotMatch(source, /const premiumOpen = !tierKnown \|\| mode === "realtime"/);
});

test("안심 리포트는 위치 조회 범위 확인 중에 캐시 장소·신선도를 노출하지 않는다", () => {
  const source = read("src/screens/feature/DailySafetyReport.tsx");
  const koReports = JSON.parse(read("locales/ko/reports.json"));

  assert.match(source, /const locationScopePending = entitlement\.isError \|\| entitlement\.tier === TIERS\.UNKNOWN/);
  assert.match(source, /const canShowLocation = !locationScopePending && isLocationVisible\(entitlement\.tier\)/);
  assert.match(source, /const childLocation = canShowLocation \? cachedChildLocation : null/);
  assert.match(source, /reports\.daily\.scopeLoading/);
  assert.match(source, /reports\.daily\.scopePendingDescription/);
  assert.match(source, /reports\.daily\.subscriptionChecking/);
  assert.equal(koReports["reports.daily.scopeLoading"], "위치 조회 범위 확인 중");
  assert.equal(
    koReports["reports.daily.scopePendingDescription"],
    "위치 조회 범위 확인 중 · 구독 상태를 확인하고 있어요.",
  );
  assert.equal(koReports["reports.daily.subscriptionChecking"], "구독 상태를 확인하고 있어요");
  assert.doesNotMatch(source, /const locationLocked = entitlement\.ready &&/);
});

test("위치 상태 화면은 허용 티어가 확정되기 전 좌표·주소·갱신 버튼을 닫는다", () => {
  const source = read("src/screens/feature/LocationStatus.tsx");

  assert.match(source, /const entitlement = useEntitlement\(\)/);
  assert.match(source, /const locationScopePending = entitlement\.isError \|\| entitlement\.tier === TIERS\.UNKNOWN/);
  assert.match(source, /const canShowLocation = !locationScopePending && mode !== "locked"/);
  assert.match(source, /const loc = canShowLocation \? cachedLoc : null/);
  assert.match(source, /title: "위치 조회 범위 확인 중"/);
  assert.match(source, /\{canShowLocation && \(/);
});

test("부모 홈은 엔타이틀먼트 오류에서 캐시 위치와 현재 위치 문구를 닫는다", () => {
  const source = read("src/screens/parent/ParentHome.tsx");

  assert.match(source, /const entitlement = useEntitlement\(\)/);
  assert.match(source, /const locationScopeLoading = !entitlement\.isError && entitlement\.tier === TIERS\.UNKNOWN/);
  assert.match(source, /const locationScopeUnavailable = locationScopeError \|\| locationScopeLoading/);
  assert.match(source, /const locationsForDisplay = !locationScopeUnavailable && locationMode !== "locked"/);
  assert.match(source, /modeKnown: !locationScopeUnavailable/);
  assert.match(source, /loadState: locationScopeError\s*\? "error"\s*:\s*locationScopeLoading\s*\? "loading"/s);
  assert.doesNotMatch(source, /const locationModeKnown = tier !== TIERS\.UNKNOWN/);
});

test("위치 조회 범위가 닫히면 캐시된 경로로 일정 방문 여부를 확정하지 않는다", () => {
  const hook = read("src/queries/useVisitVerify.ts");
  const home = read("src/screens/parent/ParentHome.tsx");
  const koParent = JSON.parse(read("locales/ko/parent.json"));
  const calendar = read("src/screens/parent/ParentCalendar.tsx");

  assert.match(hook, /locationHistoryAllowed: boolean/);
  assert.match(hook, /locationHistoryAllowed && !!range && hasTarget && dayStarted/);
  assert.match(hook, /locationHistoryAllowed \? history \?\? \[\] : \[\]/);
  assert.match(home, /const canVerifyVisits = !locationScopeUnavailable && locationMode === "realtime"/);
  assert.match(home, /useVisitVerify\(\s*todayKey,\s*familyTimeZone,\s*events,\s*activeChild\?\.user_id \?\? null,\s*canVerifyVisits/s);
  assert.match(calendar, /const entitlement = useEntitlement\(\)/);
  assert.match(calendar, /const canVerifyVisits = !entitlement\.isError && locationModeFor\(entitlement\.tier\) === "realtime"/);
  assert.match(calendar, /useVisitVerify\(\s*selectedKey,\s*familyTimeZone,\s*events,\s*childUserByMemberId,\s*canVerifyVisits/s);
});

test("엔타이틀먼트 503은 영구 확인 중이 아니라 실패와 다시 시도로 일관되게 안내한다", () => {
  const hook = read("src/queries/useEntitlement.ts");
  const location = read("src/screens/parent/ParentLocation.tsx");
  const status = read("src/screens/feature/LocationStatus.tsx");
  const report = read("src/screens/feature/DailySafetyReport.tsx");
  const home = read("src/screens/parent/ParentHome.tsx");
  const koParent = JSON.parse(read("locales/ko/parent.json"));
  const koReports = JSON.parse(read("locales/ko/reports.json"));

  assert.match(hook, /isFetching: boolean/);
  assert.match(hook, /refetch: \(\) => Promise<void>/);
  assert.match(hook, /isFetching: query\.isFetching/);
  assert.match(location, /const locationScopeError = entitlement\.isError/);
  assert.match(koParent["parent.location.scopeFailedForChild"], /위치 조회 범위 확인 실패/);
  assert.equal(koParent["parent.parentLocation.copy018"], "구독 상태를 확인하지 못했어요.");
  assert.match(location, /parent\.location\.scopeFailedForChild/);
  assert.match(location, /parent\.parentLocation\.copy018/);
  assert.match(location, /entitlement\.refetch/);
  assert.match(status, /scope_error/);
  assert.match(status, /위치 조회 범위를 확인하지 못했어요/);
  assert.match(status, /entitlement\.refetch/);
  assert.match(report, /const locationScopeError = entitlement\.isError/);
  assert.match(report, /reports\.daily\.scopeFailed/);
  assert.equal(koReports["reports.daily.scopeFailed"], "위치 조회 범위 확인 실패");
  assert.match(report, /entitlement\.refetch/);
  assert.match(home, /const locationScopeError = entitlement\.isError/);
  assert.match(home, /parent\.parentHome\.copy014/);
  assert.equal(koParent["parent.parentHome.copy014"], "위치 조회 범위 확인 실패");
  assert.match(home, /entitlement\.refetch/);
});

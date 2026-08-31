import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("길찾기는 부모 전용이 아니라 부모·아이 공용 역할 가드 아래에 있다", () => {
  const app = readSource("src/app/App.tsx");
  const parentStart = app.indexOf("// 부모 전용 푸시/상세");
  const childStart = app.indexOf("// 아이 전용 푸시/상세");
  const sharedStart = app.indexOf("// 부모·아이 공용 상세");
  const skeletonStart = app.indexOf("// 앱레벨 골격 화면");

  assert.ok(parentStart >= 0 && childStart > parentStart);
  assert.doesNotMatch(app.slice(parentStart, childStart), /path: "route"/);
  assert.ok(sharedStart >= 0 && skeletonStart > sharedStart);
  const sharedRoutes = app.slice(sharedStart, skeletonStart);
  assert.match(sharedRoutes, /<RequireAnyRole roles=\{\["parent", "child"\]\}\s*\/>/);
  assert.match(sharedRoutes, /path: "route"/);
  assert.match(sharedRoutes, /path: "supplies"/);
});

test("길찾기는 역할에 따라 아이 선택·홈 경로·존댓말과 반말을 분리한다", () => {
  const source = readSource("src/screens/feature/RouteView.tsx");

  assert.match(source, /const \{ role, userId, familyId \} = useAuth\(\)/);
  assert.match(source, /const isChild = role === "child"/);
  assert.match(source, /const homePath = isChild \? "\/child\/home" : "\/parent\/home"/);
  assert.match(source, /const childMember = isChild \? ownChild : activeChildMember/);
  assert.match(source, /안내할 곳이 없어/);
  assert.match(source, /안내할 곳이 없어요/);
  assert.match(source, /길을 못 찾았어 · 다시 시도/);
  assert.match(source, /길을 찾지 못했어요 · 다시 시도/);
  assert.match(source, /navigate\(homePath\)/);
});

test("아이 길찾기는 기기 GPS를 서버 위치보다 먼저 쓰고 부모 기기 위치는 요청하지 않는다", () => {
  const source = readSource("src/screens/feature/RouteView.tsx");

  assert.match(source, /const \[deviceOrigin, setDeviceOrigin\] = useState<RoutePoint \| null>\(null\)/);
  assert.match(source, /if \(!isChild\) return/);
  assert.match(source, /typeof navigator === "undefined" \|\| !navigator\.geolocation/);
  assert.match(source, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(source, /\[deviceOriginRetryNonce, isChild\]/);
  assert.match(
    source,
    /const origin = isChild[\s\S]{0,160}deviceOriginStatus === "ready"[\s\S]{0,80}deviceOrigin[\s\S]{0,100}deviceOriginStatus === "error"[\s\S]{0,80}serverOrigin[\s\S]{0,80}: serverOrigin/,
  );
  assert.doesNotMatch(source, /deviceOrigin \?\? serverOrigin/);
});

test("공용 길찾기는 URL에 명시된 일정을 현재 아이 범위에서 정확히 선택한다", () => {
  const source = readSource("src/screens/feature/RouteView.tsx");

  assert.match(source, /useSearchParams/);
  assert.match(source, /searchParams\.get\("event"\)/);
  assert.match(source, /pickRouteEvent\(childEvents, requestedEventId/);
});

test("아이 GPS 실패는 영구 로딩 대신 재시도하고 실제 GPS 출발지는 오래된 서버 장소명으로 부르지 않는다", () => {
  const source = readSource("src/screens/feature/RouteView.tsx");

  assert.match(source, /deviceOriginStatus/);
  assert.match(source, /setDeviceOriginRetryNonce/);
  assert.match(source, /originUnavailable/);
  assert.match(source, /deviceOrigin\s*\?\s*intl\.formatMessage\(\{ id: "shared\.routeView\.currentLocationFallback" \}\)/);
});

test("유효한 아이 member가 없으면 위치·일정 query 결과를 화면 계산에 사용하지 않는다", () => {
  const source = readSource("src/screens/feature/RouteView.tsx");

  assert.match(
    source,
    /const loc = childMember\s*\? locations\?\.find\(\(l\) => l\.user_id === childMember\.user_id\) \?\? null\s*: null/s,
  );
  assert.match(
    source,
    /childMember \? filterEventsForChild\(events \?\? \[\], childMember\.id\) : \[\]/,
  );
  assert.match(source, /type RouteState = "no-child"/);
  // 아이 member 가 없으면 절대 ready 로 가지 않는다.
  // 가족 조회가 아직 진행 중일 때는 "아이 없음"을 단정하지 않고 loading 으로 남긴다
  // (진행 표시자를 띄우기 위한 구분 — 어느 쪽이든 query 결과는 쓰지 않는다).
  assert.match(source, /!childMember\s*(\/\/[^\n]*\n\s*)*\?\s*\(familyLoading \? "loading" : "no-child"\)/);
  assert.match(source, /routeState === "no-child"/);
});

test("길찾기 목적지는 현재 child owner가 일치하는 값만 경로·지도·제목에 전달한다", () => {
  const source = readSource("src/screens/feature/RouteView.tsx");

  assert.match(source, /beginRouteDestinationScope/);
  assert.match(source, /resolveRouteDestination/);
  assert.match(source, /selectRouteDestinationForChild/);
  assert.match(
    source,
    /const destination = selectRouteDestinationForChild\(destinationState, childMember\?\.id \?\? null\)/,
  );
  assert.match(source, /useWalkingRoute\(\s*origin,\s*destination\?\.point \?\? null,/s);
  assert.match(
    source,
    /resolveRouteDestination\(current, ownerChildMemberId, value\)/,
  );
  assert.doesNotMatch(source, /useState<DestPick \| null \| undefined>/);
});

test("길찾기 필수 조회 실패는 빈 상태나 영구 로딩으로 숨기지 않고 같은 쿼리를 모두 재시도한다", () => {
  const source = readSource("src/screens/feature/RouteView.tsx");

  for (const queryName of ["familyQuery", "locationsQuery", "placesQuery", "eventsQuery"]) {
    assert.match(source, new RegExp(`const ${queryName} = use`));
    assert.match(source, new RegExp(`${queryName}\\.isError`));
    assert.match(source, new RegExp(`${queryName}\\.refetch\\(\\)`));
  }
  assert.match(source, /sourceQueriesLoading/);
  assert.match(source, /sourceQueriesError/);
  assert.match(source, /retrySourceQueries/);
});

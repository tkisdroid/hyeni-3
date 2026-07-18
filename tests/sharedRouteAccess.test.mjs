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

  assert.match(source, /const \{ role, userId \} = useAuth\(\)/);
  assert.match(source, /const isChild = role === "child"/);
  assert.match(source, /const homePath = isChild \? "\/child\/home" : "\/parent\/home"/);
  assert.match(source, /const childMember = isChild \? ownChild : activeChildMember/);
  assert.match(source, /안내할 곳이 없어/);
  assert.match(source, /안내할 곳이 없어요/);
  assert.match(source, /길을 못 찾았어 · 다시 시도/);
  assert.match(source, /길을 찾지 못했어요 · 다시 시도/);
  assert.match(source, /navigate\(homePath\)/);
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
  assert.match(source, /!childMember\s*\? "no-child"/);
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
  assert.match(source, /useWalkingRoute\(origin, destination\?\.point \?\? null\)/);
  assert.match(
    source,
    /resolveRouteDestination\(current, ownerChildMemberId, value\)/,
  );
  assert.doesNotMatch(source, /useState<DestPick \| null \| undefined>/);
});

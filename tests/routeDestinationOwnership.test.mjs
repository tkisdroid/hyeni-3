import assert from "node:assert/strict";
import test from "node:test";
import {
  beginRouteDestinationScope,
  resolveRouteDestination,
  selectRouteDestinationForChild,
} from "../src/transform/routeDestinationScope.ts";

const destinationA = {
  name: "A 일정",
  point: { lat: 37.1, lng: 127.1 },
};
const destinationB = {
  name: "B 일정",
  point: { lat: 37.2, lng: 127.2 },
};

test("A 목적지가 준비된 상태에서 현재 아이가 B로 바뀌면 즉시 목적지와 경로 인자를 숨긴다", () => {
  const loadingA = beginRouteDestinationScope("child-a");
  const readyA = resolveRouteDestination(loadingA, "child-a", destinationA);
  assert.deepEqual(selectRouteDestinationForChild(readyA, "child-a"), destinationA);

  const visibleAfterSwitch = selectRouteDestinationForChild(readyA, "child-b");
  assert.equal(visibleAfterSwitch, undefined);
  assert.equal(visibleAfterSwitch?.point ?? null, null, "B 경로 query 목적지는 비활성이어야 함");
});

test("B scope가 시작된 뒤 늦게 끝난 A 검색 결과는 B 상태를 덮지 않는다", async () => {
  let state = beginRouteDestinationScope("child-a");
  let finishA;
  const lateA = new Promise((resolve) => {
    finishA = resolve;
  }).then((value) => {
    state = resolveRouteDestination(state, "child-a", value);
  });

  state = beginRouteDestinationScope("child-b");
  finishA(destinationA);
  await lateA;

  assert.equal(selectRouteDestinationForChild(state, "child-b"), undefined);
  assert.equal(selectRouteDestinationForChild(state, "child-a"), undefined);

  state = resolveRouteDestination(state, "child-b", destinationB);
  assert.deepEqual(selectRouteDestinationForChild(state, "child-b"), destinationB);
});

test("owner가 같은 null만 해당 아이의 목적지 없음으로 확정하고 owner 부재는 로딩으로 닫는다", () => {
  const loading = beginRouteDestinationScope("child-b");
  assert.equal(selectRouteDestinationForChild(loading, "child-b"), undefined);

  const noDestination = resolveRouteDestination(loading, "child-b", null);
  assert.equal(selectRouteDestinationForChild(noDestination, "child-b"), null);
  assert.equal(selectRouteDestinationForChild(noDestination, null), undefined);
  assert.equal(selectRouteDestinationForChild(noDestination, "child-a"), undefined);
});

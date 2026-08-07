import test from "node:test";
import assert from "node:assert/strict";
import { resolveChildAddGate } from "../src/transform/secondChildGate.ts";
import { TIERS } from "../src/transform/tierPolicy.ts";

test("무료·기존 혜택은 활성 아이 1명까지 허용하고 둘째 추가는 프리미엄 안내로 보낸다", () => {
  assert.equal(resolveChildAddGate({
    ready: true,
    isError: false,
    tier: TIERS.FREE,
    activeChildCount: 0,
    requestedChildCount: 1,
  }).status, "allowed");

  for (const tier of [TIERS.FREE, TIERS.REVIEWED]) {
    const decision = resolveChildAddGate({
      ready: true,
      isError: false,
      tier,
      activeChildCount: 1,
      requestedChildCount: 1,
    });
    assert.equal(decision.status, "premium_required");
    assert.equal(decision.maxChildren, 1);
    assert.equal(decision.remainingSlots, 0);
  }

  assert.equal(resolveChildAddGate({
    ready: true,
    isError: false,
    tier: TIERS.FREE,
    activeChildCount: 0,
    requestedChildCount: 2,
  }).status, "premium_required");
});

test("프리미엄은 활성 아이 2명까지 허용하고 셋째 추가는 서버 호출 전에 막는다", () => {
  assert.equal(resolveChildAddGate({
    ready: true,
    isError: false,
    tier: TIERS.PREMIUM,
    activeChildCount: 0,
    requestedChildCount: 2,
  }).status, "allowed");
  assert.equal(resolveChildAddGate({
    ready: true,
    isError: false,
    tier: TIERS.PREMIUM,
    activeChildCount: 1,
    requestedChildCount: 1,
  }).status, "allowed");
  assert.equal(resolveChildAddGate({
    ready: true,
    isError: false,
    tier: TIERS.PREMIUM,
    activeChildCount: 2,
    requestedChildCount: 1,
  }).status, "limit_reached");

  // 프리미엄으로도 2명 상한을 넘는 요청은 업셀로 오인하지 않는다.
  assert.equal(resolveChildAddGate({
    ready: true,
    isError: false,
    tier: TIERS.FREE,
    activeChildCount: 1,
    requestedChildCount: 2,
  }).status, "limit_reached");
});

test("엔타이틀먼트 미확정·오류와 잘못된 수 입력은 모두 fail-closed 한다", () => {
  const unavailableInputs = [
    { ready: false, isError: false, tier: TIERS.UNKNOWN, activeChildCount: 0, requestedChildCount: 1 },
    { ready: true, isError: false, tier: TIERS.UNKNOWN, activeChildCount: 0, requestedChildCount: 1 },
    { ready: true, isError: true, tier: TIERS.PREMIUM, activeChildCount: 0, requestedChildCount: 1 },
    { ready: true, isError: false, tier: TIERS.FREE, activeChildCount: -1, requestedChildCount: 1 },
    { ready: true, isError: false, tier: TIERS.FREE, activeChildCount: 0, requestedChildCount: 0 },
  ] as const;

  for (const input of unavailableInputs) {
    const decision = resolveChildAddGate(input);
    assert.equal(decision.status, "unavailable");
    assert.equal(decision.remainingSlots, 0);
  }
});

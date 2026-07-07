import test from "node:test";
import assert from "node:assert/strict";

import { resolveDailySupplyChildMemberId } from "../src/transform/dailySupplyScope.ts";
import type { FamilyMember } from "../src/lib/api/endpoints/family.ts";

const members: FamilyMember[] = [
  {
    id: "child-member-1",
    role: "child",
    name: "첫째",
    user_id: "child-user-1",
    emoji: null,
    phone: null,
    gender: null,
    birthdate: null,
    photo_url: null,
    device_label: null,
    device_health: null,
    child_order: 0,
  },
  {
    id: "child-member-2",
    role: "child",
    name: "둘째",
    user_id: "child-user-2",
    emoji: null,
    phone: null,
    gender: null,
    birthdate: null,
    photo_url: null,
    device_label: null,
    device_health: null,
    child_order: 1,
  },
];

test("준비물 저장 대상은 member id 힌트를 우선한다", () => {
  assert.equal(
    resolveDailySupplyChildMemberId(members, "parent", "parent-user", "child-member-2"),
    "child-member-2",
  );
});

test("준비물 저장 대상은 user id 힌트를 member id로 변환한다", () => {
  assert.equal(
    resolveDailySupplyChildMemberId(members, "parent", "parent-user", "child-user-2"),
    "child-member-2",
  );
});

test("아이 세션은 본인 member id로만 저장 대상을 해석한다", () => {
  assert.equal(
    resolveDailySupplyChildMemberId(members, "child", "child-user-1", null),
    "child-member-1",
  );
});

test("부모 세션에 명시 대상이 없으면 첫 아이로 폴백하지 않는다", () => {
  assert.equal(
    resolveDailySupplyChildMemberId(members, "parent", "parent-user", null),
    null,
  );
});

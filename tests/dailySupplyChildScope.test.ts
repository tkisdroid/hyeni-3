import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

test("부모 세션의 잘못된 대상 힌트는 다른 아이로 폴백하지 않는다", () => {
  assert.equal(
    resolveDailySupplyChildMemberId(members, "parent", "parent-user", "unknown-child"),
    null,
  );
});

test("아이 세션은 다른 아이 힌트가 있어도 본인 member id만 사용한다", () => {
  assert.equal(
    resolveDailySupplyChildMemberId(members, "child", "child-user-1", "child-member-2"),
    "child-member-1",
  );
});

test("가족에 본인 member가 없는 아이 세션은 힌트가 있어도 대상을 만들지 않는다", () => {
  assert.equal(
    resolveDailySupplyChildMemberId(members, "child", "unknown-user", "child-member-2"),
    null,
  );
});

test("준비물 화면은 공용 resolver만 사용하고 대상 미확정 시 전체 데이터를 숨긴다", () => {
  const source = readFileSync(
    new URL("../src/screens/feature/Supplies.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /resolveDailySupplyChildMemberId/);
  assert.match(
    source,
    /resolveDailySupplyChildMemberId\(family\?\.members \?\? \[\], role, userId, targetHint\)/,
  );
  assert.doesNotMatch(source, /childMembers\.find\(\(m\) => m\.user_id === userId\)/);
  assert.match(
    source,
    /return targetChildId \? all\.filter\(\(s\) => s\.child_user_id === targetChildId\) : \[\];/,
  );
});

test("준비물 화면은 로딩·조회 실패·대상 없음 상태를 분리하고 대상 없이는 입력을 렌더하지 않는다", () => {
  const source = readFileSync(
    new URL("../src/screens/feature/Supplies.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const isLoading = familyQuery\.isLoading \|\| suppliesQuery\.isLoading/);
  assert.match(source, /const isError = familyQuery\.isError \|\| suppliesQuery\.isError/);
  assert.match(source, /className="sup-status sup-status--loading"/);
  assert.match(source, /className="sup-status sup-status--error"/);
  assert.match(source, /className="sup-status sup-status--no-target"/);

  const noTargetBranch = source.slice(
    source.indexOf('className="sup-status sup-status--no-target"'),
    source.indexOf("sections.map"),
  );
  assert.ok(noTargetBranch.length > 0, "대상 없음 상태가 섹션보다 먼저 렌더되어야 함");
});

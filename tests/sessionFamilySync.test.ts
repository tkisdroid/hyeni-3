import test from "node:test";
import assert from "node:assert/strict";

import { reconcileApiUserWithFamilyMine } from "../src/transform/sessionFamilySync.ts";
import type { ApiUser } from "../src/lib/api/session.ts";

test("가족 조회 응답이 저장 user의 오래된 family id와 role을 서버 정본으로 보정한다", () => {
  const staleUser: ApiUser = {
    id: "parent-user",
    role: "parent",
    family_id: "old-family",
    app_metadata: {
      provider: "password",
      family_id: "old-family",
      role: "parent",
    },
    user_metadata: {
      family_id: "old-family",
      role: "parent",
      name: "아빠용",
    },
  };

  const result = reconcileApiUserWithFamilyMine(staleUser, {
    familyId: "server-family",
    myRole: "parent",
  });

  assert.deepEqual(result, {
    id: "parent-user",
    role: "parent",
    family_id: "server-family",
    app_metadata: {
      provider: "password",
      family_id: "server-family",
      role: "parent",
    },
    user_metadata: {
      family_id: "server-family",
      role: "parent",
      name: "아빠용",
    },
  });
  assert.notEqual(result, staleUser);
});

test("서버 가족 정보가 없거나 이미 같은 값이면 기존 user 참조를 유지한다", () => {
  const user: ApiUser = {
    id: "child-user",
    role: "child",
    family_id: "family-1",
    app_metadata: {
      family_id: "family-1",
      role: "child",
    },
    user_metadata: {
      family_id: "family-1",
      role: "child",
    },
  };

  assert.equal(
    reconcileApiUserWithFamilyMine(user, { familyId: "family-1", myRole: "child" }),
    user,
  );
  assert.equal(
    reconcileApiUserWithFamilyMine(user, { familyId: "", myRole: "child" }),
    user,
  );
  assert.equal(
    reconcileApiUserWithFamilyMine(null, { familyId: "family-1", myRole: "child" }),
    null,
  );
});

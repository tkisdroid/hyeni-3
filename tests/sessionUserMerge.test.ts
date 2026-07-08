import test from "node:test";
import assert from "node:assert/strict";

import { mergeApiUserWithTokenUser } from "../src/transform/sessionUserMerge.ts";
import type { ApiUser } from "../src/lib/api/session.ts";

test("저장된 user 스냅샷에 role/family가 없으면 access token claim으로 보강한다", () => {
  const storedUser: ApiUser = {
    id: "child-user",
    app_metadata: {
      provider: "anonymous",
    },
    user_metadata: {},
  };
  const tokenUser: ApiUser = {
    id: "child-user",
    app_metadata: {
      family_id: "family-1",
      role: "child",
    },
    user_metadata: {
      family_id: "family-1",
      role: "child",
    },
  };

  assert.deepEqual(mergeApiUserWithTokenUser(storedUser, tokenUser), {
    id: "child-user",
    family_id: "family-1",
    role: "child",
    app_metadata: {
      provider: "anonymous",
      family_id: "family-1",
      role: "child",
    },
    user_metadata: {
      family_id: "family-1",
      role: "child",
    },
  });
});

test("저장된 user에 이미 role/family가 있으면 token claim으로 임의 변경하지 않는다", () => {
  const storedUser: ApiUser = {
    id: "child-user",
    family_id: "server-family",
    role: "child",
    app_metadata: {
      family_id: "server-family",
      role: "child",
    },
    user_metadata: {
      family_id: "server-family",
      role: "child",
    },
  };
  const tokenUser: ApiUser = {
    id: "child-user",
    app_metadata: {
      family_id: "old-token-family",
      role: "parent",
    },
  };

  assert.equal(mergeApiUserWithTokenUser(storedUser, tokenUser), storedUser);
});

test("token user가 없거나 다른 사용자면 저장 user를 유지한다", () => {
  const storedUser: ApiUser = { id: "child-user" };

  assert.equal(mergeApiUserWithTokenUser(storedUser, null), storedUser);
  assert.equal(mergeApiUserWithTokenUser(storedUser, { id: "other-user", role: "child" }), storedUser);
  assert.deepEqual(mergeApiUserWithTokenUser(null, { id: "child-user", role: "child" }), {
    id: "child-user",
    role: "child",
  });
});


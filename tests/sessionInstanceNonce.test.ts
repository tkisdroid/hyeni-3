import test from "node:test";
import assert from "node:assert/strict";

import { resolveSessionInstanceId } from "../src/transform/sessionInstance.ts";

function jwt(
  sub: string,
  iat: number,
  options: { role?: string; familyId?: string | null; anonymous?: boolean } = {},
): string {
  const payload = Buffer.from(JSON.stringify({
    sub,
    iat,
    role: options.role ?? "child",
    family_id: options.familyId === undefined ? "family-1" : options.familyId,
    is_anonymous: options.anonymous ?? false,
  })).toString(
    "base64url",
  );
  return `header.${payload}.sig`;
}

test("같은 로그인 안의 토큰 회전은 session nonce를 유지한다", () => {
  const first = resolveSessionInstanceId({
    currentAccessToken: null,
    nextAccessToken: jwt("child-1", 100),
    currentInstanceId: null,
    createInstanceId: () => "nonce-1",
  });
  const rotated = resolveSessionInstanceId({
    currentAccessToken: jwt("child-1", 100),
    nextAccessToken: jwt("child-1", 200),
    currentInstanceId: first,
    createInstanceId: () => "nonce-2",
  });
  assert.equal(first, "nonce-1");
  assert.equal(rotated, first);
});

test("같은 사용자라도 페어링으로 역할·가족·익명 상태가 바뀌면 새 session nonce를 만든다", () => {
  const anonymous = jwt("child-1", 100, { role: "anonymous", familyId: null, anonymous: true });
  const paired = jwt("child-1", 200, { role: "child", familyId: "family-1", anonymous: false });
  const switchedFamily = jwt("child-1", 300, { role: "child", familyId: "family-2", anonymous: false });

  assert.equal(resolveSessionInstanceId({
    currentAccessToken: anonymous,
    nextAccessToken: paired,
    currentInstanceId: "nonce-old",
    createInstanceId: () => "nonce-paired",
  }), "nonce-paired");
  assert.equal(resolveSessionInstanceId({
    currentAccessToken: paired,
    nextAccessToken: switchedFamily,
    currentInstanceId: "nonce-paired",
    createInstanceId: () => "nonce-family-2",
  }), "nonce-family-2");
});

test("로그아웃 뒤 새 로그인과 사용자 전환은 새 session nonce를 만든다", () => {
  const cleared = resolveSessionInstanceId({
    currentAccessToken: jwt("child-1", 100),
    nextAccessToken: null,
    currentInstanceId: "nonce-1",
    createInstanceId: () => "unused",
  });
  const second = resolveSessionInstanceId({
    currentAccessToken: null,
    nextAccessToken: jwt("child-1", 200),
    currentInstanceId: cleared,
    createInstanceId: () => "nonce-2",
  });
  const switched = resolveSessionInstanceId({
    currentAccessToken: jwt("child-1", 200),
    nextAccessToken: jwt("child-2", 300),
    currentInstanceId: second,
    createInstanceId: () => "nonce-3",
  });
  assert.equal(cleared, null);
  assert.equal(second, "nonce-2");
  assert.equal(switched, "nonce-3");
});

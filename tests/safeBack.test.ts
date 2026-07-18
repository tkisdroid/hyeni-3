import test from "node:test";
import assert from "node:assert/strict";

import { resolveSafeBackTarget } from "../src/app/safeBack.ts";

test("앱 내부 history index가 1 이상이면 이전 history로 돌아간다", () => {
  assert.deepEqual(
    resolveSafeBackTarget({ historyIndex: 1, role: "parent" }),
    { kind: "history" },
  );
  assert.deepEqual(
    resolveSafeBackTarget({ historyIndex: 3, explicitFallback: "/notifications", role: "parent" }),
    { kind: "history" },
  );
});

test("콜드 스타트에서는 역할별 홈으로 이동한다", () => {
  assert.deepEqual(
    resolveSafeBackTarget({ historyIndex: 0, role: "parent" }),
    { kind: "route", to: "/parent/home" },
  );
  assert.deepEqual(
    resolveSafeBackTarget({ historyIndex: undefined, role: "child" }),
    { kind: "route", to: "/child/home" },
  );
});

test("콜드 스타트의 화면 명시 fallback은 같은 역할 route만 허용한다", () => {
  assert.deepEqual(
    resolveSafeBackTarget({
      historyIndex: 0,
      explicitFallback: "/notifications",
      role: "parent",
    }),
    { kind: "route", to: "/notifications" },
  );
  assert.deepEqual(
    resolveSafeBackTarget({
      historyIndex: 0,
      explicitFallback: "/child/home",
      role: "child",
    }),
    { kind: "route", to: "/child/home" },
  );
});

test("외부 URL·로그인·다른 역할 fallback은 현재 역할 홈으로 닫는다", () => {
  for (const explicitFallback of [
    "https://evil.example",
    "//evil.example",
    "/onboarding",
    "/child/home",
  ]) {
    assert.deepEqual(
      resolveSafeBackTarget({ historyIndex: 0, explicitFallback, role: "parent" }),
      { kind: "route", to: "/parent/home" },
    );
  }

  assert.deepEqual(
    resolveSafeBackTarget({
      historyIndex: 0,
      explicitFallback: "/notifications",
      role: "child",
    }),
    { kind: "route", to: "/child/home" },
  );
});

import "./helpers/appModuleResolve.mjs";

import assert from "node:assert/strict";
import test from "node:test";
const { qk } = await import("../src/queries/keys.ts");
const {
  createStudyAttachChallenge,
  getStudyReport,
} = await import("../src/lib/api/endpoints/study.ts");
const { createStudyMutationRequest } = await import("../src/lib/api/studyMutationRequest.ts");
const { clearApiSession, setApiTokens } = await import("../src/lib/api/session.ts");

test("Study query key는 가족과 명시적 member를 분리한다", () => {
  assert.deepEqual(qk.studyReport("family-a", "child-a", "7d"), [
    "study", "family-a", "child-a", "report", "7d",
  ]);
  assert.notDeepEqual(
    qk.studyReport("family-a", "child-a", "7d"),
    qk.studyReport("family-a", "child-b", "7d"),
  );
  assert.deepEqual(qk.studyDevices("family-a", "child-a"), [
    "study", "family-a", "child-a", "devices",
  ]);
});

test("Study endpoint는 first-child fallback 없이 요청한 member 경로만 사용한다", async () => {
  assert.throws(() => getStudyReport("", "7d"), /study_member_required/);
  const source = await import("node:fs").then(({ readFileSync }) => readFileSync(
    new URL("../src/lib/api/endpoints/study.ts", import.meta.url),
    "utf8",
  ));
  assert.match(source, /children\/\$\{encodeURIComponent\(memberId\)\}\/report/);
  assert.doesNotMatch(source, /children\/first|activeChild\?\?|children\[0\]/);
});

test("내장 access refresh 재시도에서도 mutation Idempotency-Key는 하나다", async () => {
  const originalFetch = globalThis.fetch;
  const observedStudyHeaders: Headers[] = [];
  let studyCalls = 0;
  setApiTokens({ access: "old-access", refresh: "refresh-token" });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/refresh")) {
      return Response.json({
        session: {
          access_token: "new-access",
          refresh_token: "new-refresh",
          user: { id: "parent-a", role: "parent" },
        },
      });
    }
    if (url.includes("/api/study/children/child%2Fa/attach-challenges")) {
      observedStudyHeaders.push(new Headers(init?.headers));
      studyCalls += 1;
      if (studyCalls === 1) return Response.json({ error: "expired" }, { status: 401 });
      return Response.json({
        challenge: {
          apiVersion: "2026-08-24",
          purpose: "attach_child_device",
          qrUrl: "https://study.example/attach/token",
          expiresAt: "2026-08-27T01:00:00.000Z",
        },
        permissions: { canManageLinks: true },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    const request = createStudyMutationRequest("child/a");
    await request.run(({ memberId, requestId }) =>
      createStudyAttachChallenge(memberId, requestId));
    assert.equal(observedStudyHeaders.length, 2);
    assert.deepEqual(
      observedStudyHeaders.map((headers) => headers.get("Idempotency-Key")),
      [request.requestId, request.requestId],
    );
  } finally {
    globalThis.fetch = originalFetch;
    clearApiSession();
  }
});

import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { fetchAccessCountry } = await import("../src/lib/api/endpoints/accessRegion.ts");

test("접속 국가 공개 조회는 인증 정보 없이 no-store로 요청하고 국가만 정규화한다", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify({ country: "jp" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  assert.equal(await fetchAccessCountry({ fetchImpl, timeoutMs: 1_000 }), "JP");
  assert.equal(calls.length, 1);
  assert.equal(String(calls[0]?.input), "https://hyeni-calendar-api.tkisdroid.workers.dev/api/access-region");
  assert.equal(calls[0]?.init?.credentials, "omit");
  assert.equal(calls[0]?.init?.cache, "no-store");
  assert.equal(new Headers(calls[0]?.init?.headers).has("Authorization"), false);
});

test("접속 국가 조회 실패나 잘못된 응답은 로그인 화면을 막지 않고 null로 강등한다", async () => {
  const invalidFetch: typeof fetch = async () => new Response(
    JSON.stringify({ country: "T1" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
  const failedFetch: typeof fetch = async () => new Response(null, { status: 503 });

  assert.equal(await fetchAccessCountry({ fetchImpl: invalidFetch, timeoutMs: 1_000 }), null);
  assert.equal(await fetchAccessCountry({ fetchImpl: failedFetch, timeoutMs: 1_000 }), null);
});

import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const workerEntry = (await import("../index.ts")).default;

function countryRequest(country) {
  const request = new Request("https://worker.test/api/access-region", {
    headers: { Origin: "https://hyenicalendar.com" },
  });
  Object.defineProperty(request, "cf", {
    configurable: true,
    value: country === undefined ? undefined : { country },
  });
  return request;
}

test("공개 접속 국가 API는 Cloudflare 국가 코드만 no-store로 반환한다", async () => {
  const response = await workerEntry.fetch(countryRequest("jp"), {
    CF_VERSION_METADATA: { id: "test" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://hyenicalendar.com");
  assert.deepEqual(await response.json(), { country: "JP" });
});

test("Cloudflare 국가가 없거나 특수 코드이면 개인 정보를 추측하지 않고 ZZ로 닫는다", async () => {
  for (const country of [undefined, "XX", "T1", "not-a-country"]) {
    const response = await workerEntry.fetch(countryRequest(country), {
      CF_VERSION_METADATA: { id: "test" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { country: "ZZ" });
  }
});

import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const appPolicy = await import("../../shared/mapPolicy.ts");
const { normalizeServiceCountry } = await import("../lib/studyMarket.ts");

test("Worker도 앱과 같은 지도 공급자 정책 모듈을 사용한다", () => {
  const enabled = new Set(["JP"]);

  assert.deepEqual(appPolicy.resolveMapPolicy("KR", enabled), {
    provider: "kakao",
    countryCode: "KR",
  });
  assert.deepEqual(appPolicy.resolveMapPolicy("JP", enabled), {
    provider: "google",
    countryCode: "JP",
  });
  assert.deepEqual(appPolicy.resolveMapPolicy("CN", enabled), {
    provider: "unsupported",
    reason: "china_unsupported",
  });
});

test("Google 운영 국가는 저장 가능한 ISO 국가에서 한국만 제외한 집합이다", () => {
  const serviceCountries = [];
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const countryCode = String.fromCharCode(first, second);
      if (normalizeServiceCountry(countryCode)) serviceCountries.push(countryCode);
    }
  }
  assert.equal(serviceCountries.length, 249);
  assert.deepEqual(
    [...appPolicy.GOOGLE_MAP_RELEASE_COUNTRIES].sort(),
    serviceCountries.filter((countryCode) => countryCode !== "KR"),
  );
});

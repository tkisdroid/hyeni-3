import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  GOOGLE_MAP_RELEASE_COUNTRIES,
  resolveMapPolicy,
} from "../shared/mapPolicy.ts";

test("한국·미확정 국가는 allowlist보다 우선해 공급자를 결정한다", () => {
  const enabled = new Set(["KR", "ZZ", "JP"]);

  assert.deepEqual(resolveMapPolicy("KR", enabled), { provider: "kakao", countryCode: "KR" });
  assert.deepEqual(resolveMapPolicy("ZZ", enabled), {
    provider: "unsupported",
    reason: "country_unresolved",
  });
});

test("명시적으로 활성화한 비한국 국가만 Google 지도를 사용한다", () => {
  const enabled = new Set(["JP"]);

  assert.deepEqual(resolveMapPolicy(" jp ", enabled), { provider: "google", countryCode: "JP" });
  assert.deepEqual(resolveMapPolicy("US", enabled), {
    provider: "unsupported",
    reason: "country_not_enabled",
  });
});

test("누락되거나 형식이 잘못된 국가는 외부 지도 호출을 열지 않는다", () => {
  const enabled = new Set(["JP"]);

  for (const value of [undefined, null, "", "J", "JPN", "J1", 82]) {
    assert.deepEqual(resolveMapPolicy(value, enabled), {
      provider: "unsupported",
      reason: "country_unresolved",
    });
  }
});

test("운영 allowlist는 Google이 지원하는 ISO 국가 중 한국을 제외한 248개국을 연다", () => {
  assert.equal(GOOGLE_MAP_RELEASE_COUNTRIES.length, 248);
  assert.equal(new Set(GOOGLE_MAP_RELEASE_COUNTRIES).size, 248);

  for (const countryCode of ["JP", "US", "CN", "MO", "DE", "BR", "ZA"]) {
    assert.ok(GOOGLE_MAP_RELEASE_COUNTRIES.includes(countryCode), countryCode);
    assert.deepEqual(resolveMapPolicy(countryCode), {
      provider: "google",
      countryCode,
    });
  }

  assert.equal(GOOGLE_MAP_RELEASE_COUNTRIES.includes("KR"), false);
  assert.equal(GOOGLE_MAP_RELEASE_COUNTRIES.includes("ZZ"), false);
  assert.equal(GOOGLE_MAP_RELEASE_COUNTRIES.includes("AC"), false);
  assert.deepEqual(resolveMapPolicy("AC"), {
    provider: "unsupported",
    reason: "country_not_enabled",
  });
});

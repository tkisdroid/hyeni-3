import test from "node:test";
import assert from "node:assert/strict";
import { resolveMapPolicy } from "../shared/mapPolicy.ts";

test("한국·중국·미확정 국가는 allowlist보다 우선해 공급자를 결정한다", () => {
  const enabled = new Set(["KR", "CN", "ZZ", "JP"]);

  assert.deepEqual(resolveMapPolicy("KR", enabled), { provider: "kakao", countryCode: "KR" });
  assert.deepEqual(resolveMapPolicy("CN", enabled), {
    provider: "unsupported",
    reason: "china_unsupported",
  });
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

test("운영 allowlist 기본값은 자격이 준비될 때까지 비한국 국가를 닫는다", () => {
  assert.deepEqual(resolveMapPolicy("JP"), {
    provider: "unsupported",
    reason: "country_not_enabled",
  });
});

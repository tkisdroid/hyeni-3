import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { googleJsRegion, googleServiceRegion, googleRoutesRegion } = await import("../shared/googleRegion.ts");

test("Google 제품별 region 형식을 분리한다", () => {
  for (const country of ["KR", "JP", "US"] as const) {
    assert.equal(googleJsRegion(country), country);
    assert.equal(googleServiceRegion(country), country.toLowerCase());
    assert.equal(googleRoutesRegion(country), country.toLowerCase());
  }
  assert.equal(googleJsRegion("GB"), "GB");
  assert.equal(googleServiceRegion("GB"), "gb");
  assert.equal(googleRoutesRegion("GB"), "uk");
});


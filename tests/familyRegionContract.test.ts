import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { buildSetupFamilyPayload, mapFamilyMineResponse } = await import(
  "../src/lib/api/endpoints/family.ts"
);

test("새 가족 payload는 사용자가 확인한 국가를 정규화해 보낸다", () => {
  const payload = buildSetupFamilyPayload({ parentName: "보호자", countryCode: " jp " });
  assert.equal(payload.countryCode, "JP");
});

test("가족 응답은 countryCode와 Worker mapPolicy를 손실 없이 유지한다", () => {
  const family = mapFamilyMineResponse({
    familyId: "family-a",
    countryCode: "JP",
    mapPolicy: { provider: "unsupported", reason: "country_not_enabled" },
  });

  assert.equal(family.countryCode, "JP");
  assert.deepEqual(family.mapPolicy, { provider: "unsupported", reason: "country_not_enabled" });
});

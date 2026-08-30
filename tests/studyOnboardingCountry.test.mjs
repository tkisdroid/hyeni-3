import "./helpers/appModuleResolve.mjs";

import assert from "node:assert/strict";
import test from "node:test";

const { buildSetupFamilyPayload } = await import("../src/lib/api/endpoints/family.ts");

test("새 가족 생성은 확인 국가와 확인 출처를 함께 보낸다", () => {
  const confirmed = buildSetupFamilyPayload({
    parentName: "보호자",
    studyCountry: { serviceCountry: "KR", serviceCountrySource: "guardian_confirmed" },
  });
  assert.equal(confirmed.serviceCountry, "KR");
  assert.equal(confirmed.serviceCountryMatchedEdge, true);

  const changed = buildSetupFamilyPayload({
    parentName: "보호자",
    studyCountry: { serviceCountry: "JP", serviceCountrySource: "guardian_changed" },
  });
  assert.equal(changed.serviceCountry, "JP");
  assert.equal(changed.serviceCountryMatchedEdge, false);
});

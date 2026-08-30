import "./helpers/appModuleResolve.mjs";

import assert from "node:assert/strict";
import test from "node:test";

const { resolveStudyAccessView } = await import("../src/features/study/studyAccessModel.ts");

test("JP 가족과 비대표 보호자에게 Study 진입 제어를 만들지 않는다", () => {
  assert.deepEqual(resolveStudyAccessView({ state: "outside_market" }), { kind: "hidden" });
  assert.deepEqual(
    resolveStudyAccessView({ state: "not_confirmed", inferredCountry: "KR", canConfirm: false }),
    { kind: "hidden" },
  );
});

test("대표 보호자에게만 추정 이용 국가 확인 상태를 표시한다", () => {
  assert.deepEqual(
    resolveStudyAccessView({ state: "not_confirmed", inferredCountry: "KR", canConfirm: true }),
    { kind: "confirm", inferredCountry: "KR" },
  );
});

test("서버 장애와 역할별 활성 상태를 구분한다", () => {
  assert.deepEqual(resolveStudyAccessView({ state: "unavailable" }), { kind: "unavailable" });
  assert.deepEqual(resolveStudyAccessView({
    state: "enabled",
    market: "KR",
    role: "child",
    managementEnabled: true,
    learnerEnabled: true,
  }), { kind: "enabled", role: "child" });
});

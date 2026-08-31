import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const appPolicy = await import("../../shared/mapPolicy.ts");

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

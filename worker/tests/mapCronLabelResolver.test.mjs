import "./helpers/tsModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { resolveFamilyMapLabel } = await import("../lib/maps/labelResolver.ts");

function envWithCountry(country_code) {
  return {
    DB: {
      prepare(sql) {
        assert.match(sql, /SELECT country_code FROM families/);
        return {
          bind() {
            return { first: async () => ({ country_code }) };
          },
        };
      },
    },
  };
}

test("미지원 가족 국가는 백그라운드 안전 전이를 막지 않고 label null로 강등한다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("upstream 호출 금지"); };
  try {
    assert.equal(await resolveFamilyMapLabel({
      env: envWithCountry("US"),
      familyId: "family-1",
      point: { lat: 40.7128, lng: -74.006 },
      locale: "en",
    }), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("도착 감지와 미등록 체류 cron은 가족 정책 label resolver만 사용한다", () => {
  for (const path of ["../lib/arrivalDetect.ts", "../cron/unregistered-stay-check.ts"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /resolveFamilyMapLabel/);
    assert.doesNotMatch(source, /kakaoReverseGeocode|\/v2\/local\/geo\/coord2address/);
  }
});

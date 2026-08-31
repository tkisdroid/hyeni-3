import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("지도 상태 문구는 10개 locale에 모두 있고 Google 상표는 번역하지 않는다", () => {
  const ids = ["shared.map.countryUnsupported", "shared.map.countryUnresolved", "shared.map.providerUnavailable", "shared.map.googlePlayServicesUnavailable", "shared.map.retry"];
  for (const locale of ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"]) {
    const catalog = JSON.parse(read(`locales/${locale}/shared.json`));
    for (const id of ids) assert.equal(typeof catalog[id], "string", `${locale}:${id}`);
  }
  assert.match(read("src/maps/MapAttribution.tsx"), />Google Maps</);
});

test("공개 약관은 Google Maps 처리와 정본 정책 링크를 표시한다", () => {
  const legal = read("worker/routes/legal.ts");
  assert.match(legal, /Google Maps Platform/);
  assert.match(legal, /policies\.google\.com\/privacy/);
  assert.match(legal, /cloud\.google\.com\/maps-platform\/terms/);
  assert.match(legal, /Google 원문 응답·검색어·좌표·Place ID를 D1이나 로그에 보존하지 않고/);
});

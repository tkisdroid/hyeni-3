import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("클라이언트 저장은 공급자 후보가 아니라 사용자가 지도에서 확정한 핀만 받는다", () => {
  const api = read("src/lib/api/endpoints/maps.ts");
  const persistence = read("src/maps/persistence.ts");
  assert.match(api, /declare const ephemeralProviderContent: unique symbol/);
  assert.match(api, /declare const userConfirmedPin: unique symbol/);
  assert.match(api, /confirmPinFromMapGesture/);
  assert.match(persistence, /pin: UserConfirmedPin/);
  assert.doesNotMatch(persistence, /providerPlaceId/);
});

test("공통 지도 API는 가족 정본과 object reference만 서버로 보낸다", () => {
  const client = read("src/lib/api/endpoints/maps.ts");
  const worker = read("worker/routes/maps.ts");
  for (const route of ["/api/maps/search", "/api/maps/reverse", "/api/maps/directions"]) {
    assert.match(client, new RegExp(route));
  }
  assert.match(worker, /loadFamilyMapContext/);
  assert.doesNotMatch(worker, /body\s*\.\s*(?:countryCode|country_code)/);
  assert.doesNotMatch(client, /\/api\/kakao\//);
});

test("외부 지도 링크는 공급자 정책을 따르고 미지원 국가는 열지 않는다", () => {
  const source = read("src/transform/externalMapUrl.ts");
  assert.match(source, /provider === "unsupported"/);
  assert.match(source, /map\.kakao\.com/);
  assert.match(source, /www\.google\.com\/maps/);
});

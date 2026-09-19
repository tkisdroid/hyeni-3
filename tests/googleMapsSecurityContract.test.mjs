import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Google 웹 로더는 key·locale·region 튜플 충돌과 실패 재시도를 통제한다", () => {
  const source = read("src/lib/googleMaps.ts");
  assert.match(source, /activeTuple && activeTuple !== tuple/);
  assert.match(source, /map_loader_context_changed/);
  assert.match(source, /if \(failed && !input\.retry\)/);
  assert.match(source, /loadPromise = null/);
});

test("Android Google Maps 키는 한 개 manifest placeholder와 release fail-closed로만 주입된다", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const gradle = read("android/app/build.gradle");
  assert.equal((manifest.match(/com\.google\.android\.geo\.API_KEY/gu) ?? []).length, 1);
  assert.match(manifest, /android:value="\$\{MAPS_API_KEY\}"/);
  assert.match(gradle, /providers\.gradleProperty\("MAPS_API_KEY"\)/);
  assert.match(gradle, /if \(!hyeniMapsApiKey\)/);
  assert.doesNotMatch(manifest, /AIza[0-9A-Za-z_-]+/);
});

test("Google CSP는 필요한 지도 호스트만 기존 정책에 추가한다", () => {
  const headers = read("public/_headers");
  assert.match(headers, /script-src[^\n]+https:\/\/maps\.googleapis\.com[^\n]+https:\/\/maps\.gstatic\.com/);
  assert.match(headers, /connect-src[^\n]+https:\/\/maps\.googleapis\.com[^\n]+https:\/\/maps\.gstatic\.com/);
  assert.match(headers, /style-src[^;]+https:\/\/fonts\.googleapis\.com/);
  assert.match(headers, /font-src[^\n]+https:\/\/fonts\.gstatic\.com/);
  assert.doesNotMatch(headers, /\*\.googleapis\.com/);
});

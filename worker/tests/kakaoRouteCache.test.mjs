import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../routes/kakao.ts", import.meta.url), "utf8");

/** 주석에 적힌 "쓰지 않기로 한 것"이 금지 검사에 걸리지 않게 코드만 남긴다. */
const code = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ 	]*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");

test("도보 경로는 카카오와 OSRM 을 동시에 부른다(순차 대기 금지)", () => {
  // 카카오 도보는 제휴 전용이라 매번 403 인데, 그 왕복을 다 기다린 뒤 OSRM 을 시작해 2.2초가 걸렸다.
  assert.match(src, /await Promise\.all\(\[\s*fetchKakaoWalkingRoute\([\s\S]{0,120}fetchOsrmFootRoute\(/);
  // 제휴가 살아나면 카카오가 이긴다.
  assert.match(src, /const payload = kakaoRoute \?\? osrmRoute/);
});

const cacheSrc = readFileSync(new URL("../lib/edgeCache.ts", import.meta.url), "utf8");

test("도보 경로·역지오코딩은 캐시를 쓴다", () => {
  assert.match(src, /const WALK_CACHE_TTL_SEC = 60 \* 60 \* 24 \* 7/);
  assert.match(src, /const GEOCODE_CACHE_TTL_SEC = 60 \* 60 \* 24 \* 30/);
  assert.match(src, /const cacheKey = `walk\/\$\{coordKey\(origin\)\}\/\$\{coordKey\(destination\)\}`/);
  assert.match(src, /const geoKey = `geo\/\$\{coordKey\(point\)\}`/);
});

test("Cache API 는 workers.dev 에서 no-op 이라 쓰지 않는다(D1 + 메모리 2단)", () => {
  assert.ok(!/caches\.default/.test(code(src)), "라우트 코드에서 Cache API 사용 금지");
  assert.match(cacheSrc, /workers\.dev.*no-op|no-op.*workers\.dev/s);
  assert.match(cacheSrc, /SELECT payload, expires_at FROM edge_cache WHERE key = \?/);
  assert.match(cacheSrc, /INSERT OR REPLACE INTO edge_cache/);
  assert.match(cacheSrc, /const memo = new Map<string, MemoEntry>\(\)/);
});

test("캐시 키는 좌표를 5자리로 반올림한다(GPS 흔들림마다 갈라지지 않게)", () => {
  assert.match(cacheSrc, /export function coordKey[\s\S]{0,160}toFixed\(5\)/);
});

test("캐시 키는 사용자와 무관하다(경로·주소는 공개 지리정보)", () => {
  const keyFn = cacheSrc.slice(cacheSrc.indexOf("export function coordKey"), cacheSrc.indexOf("export async function cacheGet"));
  assert.ok(!/family|user|token|auth/i.test(keyFn));
});

test("캐시 쓰기는 응답을 막지 않고, 메모리 캐시는 무한정 커지지 않는다", () => {
  assert.match(cacheSrc, /ctx\.waitUntil\(write\)/);
  assert.match(cacheSrc, /const MEMO_LIMIT = 200/);
  assert.match(src, /cachePut\(c\.executionCtx, c\.env\.DB, cacheKey, payload, WALK_CACHE_TTL_SEC\)/);
});

test("상류가 매달리면 끊는다(사용자 화면이 멈추지 않게)", () => {
  assert.match(src, /const KAKAO_TIMEOUT_MS = 2500/);
  assert.match(src, /const OSRM_TIMEOUT_MS = 4000/);
  assert.match(src, /signal: AbortSignal\.timeout\(KAKAO_TIMEOUT_MS\)/);
  assert.match(src, /signal: AbortSignal\.timeout\(OSRM_TIMEOUT_MS\)/);
});

test("만료 캐시는 크론이 정리한다", () => {
  const index = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  assert.match(index, /edge-cache-sweep/);
  assert.match(cacheSrc, /export async function cacheSweep/);
});

test("둘 다 실패하면 정직하게 502 로 알린다(가짜 직선 경로 금지)", () => {
  assert.match(src, /return c\.json\(\{ ok: false, error: "upstream_unreachable" \}, 502\)/);
  assert.ok(!/straightLine|직선 폴백/.test(src));
});

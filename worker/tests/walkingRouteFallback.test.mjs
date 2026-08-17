// 도보 경로 폴백 회귀(2026-08-17 실사고).
//
// 증상: 아이 길찾기가 항상 "길을 못 찾았어"였다.
// 원인: 카카오는 제휴 미승인 403(정상)인데 폴백인 FOSSGIS 공개 OSRM 이
//       **Cloudflare Workers 대역을 403 으로 차단**해 두 경로가 동시에 죽었다.
//       같은 URL·헤더가 로컬에서는 200 이라 IP 차단이 확실했고, 실패 사유를 통째로
//       삼키고 있어서(catch { return null }) 배포 전까지 원인을 알 수 없었다.
import "./helpers/tsModuleResolve.mjs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(workerDir, "routes/kakao.ts"), "utf8");

test("상류 실패 사유를 삼키지 않고 남긴다(원인 추적 불가 재발 방지)", () => {
  // 중앙 운영 logger 만 쓴다(정적 이벤트명 + status/provider 필드 — 원문 유출 방지 계약).
  for (const event of [
    "walking_route_kakao_failed", "walking_route_kakao_network_failed",
    "walking_route_osrm_failed", "walking_route_osrm_no_route", "walking_route_osrm_network_failed",
    "walking_route_ors_failed", "walking_route_ors_network_failed",
  ]) {
    assert.ok(source.includes(event), `${event} 로그가 없다`);
  }
  // 자유 문자열 console 은 운영 로그 계약(safeOperationalLog)이 금지한다.
  assert.doesNotMatch(source, /console\.(error|log|warn)\(/);
  // 사유를 통째로 삼키는 빈 catch 가 남아 있으면 안 된다.
  assert.doesNotMatch(source, /\}\s*catch\s*\{\s*return null;\s*\}/);
});

test("좌표·응답 본문은 로그에 남기지 않는다(아이 위치 유출 금지)", () => {
  const logs = [...source.matchAll(/writeOperationalLog\(([^;]*?)\);/g)].map((m) => m[1]);
  assert.ok(logs.length >= 7, "운영 로그 호출이 없다");
  for (const log of logs) {
    assert.doesNotMatch(log, /origin|destination|\blat\b|\blng\b|res\.text|JSON\.stringify/);
  }
});

test("폴백은 카카오 → ORS → OSRM 순서이며 병렬로 부른다", () => {
  assert.match(source, /const \[kakaoRoute, orsRoute, osrmRoute\] = await Promise\.all\(\[/);
  assert.match(source, /const payload = kakaoRoute \?\? orsRoute \?\? osrmRoute;/);
});

test("ORS 키가 없으면 호출 자체를 건너뛴다(설정 누락이 오류가 되지 않게)", () => {
  const start = source.indexOf("async function fetchOrsFootRoute");
  assert.ok(start >= 0, "fetchOrsFootRoute 가 없다");
  const block = source.slice(start, start + 400);
  assert.match(block, /if \(!apiKey\) return null;/);
});

test("모든 상류가 실패하면 경로를 지어내지 않고 502 로 닫는다", () => {
  assert.match(source, /error: "upstream_unreachable"/);
  // 직선 좌표로 가짜 경로를 합성하지 않는다(아이가 건물로 걸어가면 안 된다).
  assert.doesNotMatch(source, /straight_line|synthesizeStraightRoute/);
});

test("ORS 안내문은 이름 없는 길의 '-' 를 그대로 읽지 않는다", async () => {
  // "-에서 왼쪽으로 꺾어"처럼 들리면 아이가 이해할 수 없다.
  assert.match(source, /rawName === "-" \? "" : rawName/);
});

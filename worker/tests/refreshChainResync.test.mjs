// refresh 체인 재동기화 계약 — node --test worker/tests/refreshChainResync.test.mjs
//
// 배경(2026-07-10 실사고): 같은 기기 안에서 WebView 와 네이티브 위치 서비스가 각자
// refresh 를 회전하다 체인이 갈라졌고(0.7초 간격 2회전), 낙오한 네이티브가 폐기 토큰으로
// 401 을 맞아 위치 서비스를 정지 → 혜니 위치 89분 중단.
//
// 기기 바인딩(device_id)이 이미 검증된 뒤이므로, 같은 기기의 폐기 토큰은 도난이 아니라
// "뒤처진 홀더"로 보고 체인을 따라가 살아 있는 토큰으로 재동기화한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/refresh.ts", import.meta.url), "utf8");

test("기기 바인딩 게이트가 체인 추적보다 먼저 실행된다(탈취 차단이 우선)", () => {
  const deviceGate = src.indexOf("if (row.device_id && row.device_id !== presentedDeviceId) return null;");
  const revokedBlock = src.indexOf("if (row.revoked) {");
  assert.ok(deviceGate > -1 && revokedBlock > -1);
  assert.ok(deviceGate < revokedBlock, "기기 게이트가 폐기 토큰 처리보다 뒤에 있다");
});

test("제시한 refresh 자체가 만료됐으면 폐기 체인도 되살리지 않는다", () => {
  const deviceGate = src.indexOf("if (row.device_id && row.device_id !== presentedDeviceId) return null;");
  const expiryGate = src.indexOf("if (new Date(row.expires_at).getTime() <= Date.now()) return null;");
  const revokedBlock = src.indexOf("if (row.revoked)");
  assert.ok(expiryGate > deviceGate, "기기 바인딩 검증 전 만료 분기를 두면 계약 순서가 바뀝니다");
  assert.ok(expiryGate < revokedBlock, "만료된 폐기 토큰이 장기 체인으로 복귀할 수 있습니다");
});

test("기기 바인딩 체인은 30일 수명 동안의 장기 회전을 한 번의 재귀 쿼리로 추적한다", () => {
  assert.match(src, /const deviceBound = !!row\.device_id;/);
  assert.match(src, /if \(!deviceBound && !withinGrace\) return null;/);
  assert.match(src, /const MAX_CHAIN_HOPS = 2048;/);
  assert.match(src, /WITH RECURSIVE token_chain/);
  assert.match(src, /JOIN refresh_tokens next ON next\.token=token_chain\.rotated_to/);
  assert.match(src, /token_chain\.depth \+ 1 < \?/);
  assert.match(src, /findLiveTokenInChain\(db, row\.rotated_to, deviceBound \? MAX_CHAIN_HOPS : 1\)/);
});

test("레거시(device_id NULL) 체인은 60초 유예 + 1단계만 허용(기존 정책 보존)", () => {
  assert.match(src, /const ROTATE_REUSE_GRACE_MS = 60 \* 1000;/);
  // 레거시는 hops=1 로 넘어간다(위 테스트의 삼항 확인) + 유예 밖이면 즉시 거부.
  assert.match(src, /withinGrace =\s*\n?\s*!!row\.rotated_at && Date\.now\(\) - new Date\(row\.rotated_at\)\.getTime\(\) < ROTATE_REUSE_GRACE_MS/);
});

test("재귀 체인 추적은 명시적 depth 상한으로 순환·무한루프를 방어한다", () => {
  assert.match(src, /token_chain\.depth \+ 1 < \?/);
});

test("체인 추적은 살아 있고 만료되지 않은 토큰만 반환한다", () => {
  const fn = src.slice(src.indexOf("async function findLiveTokenInChain"));
  assert.match(fn, /WHERE revoked=0 AND expires_at>\?/);
});

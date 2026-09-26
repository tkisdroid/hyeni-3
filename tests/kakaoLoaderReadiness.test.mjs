import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const loader = readFileSync(new URL("../src/maps/providers/kakao/loadKakaoMaps.ts", import.meta.url), "utf8");

// 2026-09-26 에뮬레이터 실측: autoload=false SDK 의 껍데기 kakao.maps(load 만 있음)를 완성본으로
// 돌려줘 본체 도착 전에 다시 돈 지도 효과가 `new maps.LatLng` TypeError 로 실패했다.
test("Kakao 로더는 본체가 올 때까지 껍데기 kakao.maps 를 완성본으로 돌려주지 않는다", () => {
  const once = loader.slice(loader.indexOf("function loadKakaoMapsOnce()"));
  assert.match(loader, /typeof window\.kakao\?\.maps\?\.LatLng === "function"/);
  assert.doesNotMatch(once, /if \(window\.kakao\?\.maps\) return/);
  const readyAt = once.indexOf("if (isKakaoMapsReady()) return Promise.resolve(window.kakao.maps);");
  const pendingAt = once.indexOf("if (loadPromise) return loadPromise;");
  assert.ok(readyAt >= 0 && pendingAt > readyAt, "완성본 확인 → 진행 중 Promise 재사용 순서여야 한다");
  // 스크립트가 이미 실행된 상태면 새 스크립트를 넣지 않고 load 완료를 기다린다.
  assert.match(once, /typeof window\.kakao\?\.maps\?\.load === "function"[\s\S]*?window\.kakao\.maps\.load\(\(\) => resolve\(window\.kakao\.maps\)\)/);
});

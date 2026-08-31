import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("FamilyMap은 공급자 공통 장면 계약과 지연 로드 경계를 가진다", () => {
  const contract = read("src/maps/contracts.ts");
  const familyMap = read("src/maps/FamilyMap.tsx");
  for (const field of ["child", "zones", "places", "route", "stays", "destination", "picked", "onPick"]) {
    assert.match(contract, new RegExp(`\\b${field}\\??:`), `${field} 계약 누락`);
  }
  assert.match(familyMap, /useActiveChild\(\)/);
  assert.match(familyMap, /mapPolicy: policy/);
  assert.match(familyMap, /policy\.provider === "unsupported"/);
  assert.match(familyMap, /lazy\(\(\) => import\("\.\/providers\/kakao/);
  assert.match(familyMap, /lazy\(\(\) => import\("\.\/providers\/google/);
});

test("지도는 시각 캔버스와 독립된 키보드·보조기술 좌표 목록을 제공한다", () => {
  const familyMap = read("src/maps/FamilyMap.tsx");
  assert.match(familyMap, /className="fm-accessible"/);
  assert.match(familyMap, /<ul>/);
  assert.match(familyMap, /<button type="button" onClick=/);
  assert.match(familyMap, /<output>/);
});

import test from "node:test";
import assert from "node:assert/strict";

import { resolvePlaceVisual } from "../src/transform/placeVisual.ts";

test("장소명에 맞는 카테고리 이미지를 고른다", () => {
  assert.equal(resolvePlaceVisual({ name: "한빛태권도" }).assetPath, "cat/taekwondo.webp");
  assert.equal(resolvePlaceVisual({ name: "예음피아노 학원" }).assetPath, "cat/piano.webp");
  assert.equal(resolvePlaceVisual({ name: "블루수영장" }).assetPath, "cat/swim.webp");
});

test("집과 일반 장소는 안전한 기본 이미지로 낮춘다", () => {
  assert.equal(resolvePlaceVisual({ name: "우리집", is_home: true }).assetPath, "ui/place-home.webp");
  // 편의점은 2026-07-10 신규 mart 에셋으로 승격 — 진짜 일반명만 frequent 폴백.
  assert.equal(resolvePlaceVisual({ name: "동네 골목길" }).assetPath, "ui/place-frequent.webp");
});

test("생활 장소는 신규 클레이 에셋으로 매핑된다(2026-07-10)", () => {
  assert.equal(resolvePlaceVisual({ name: "성당" }).assetPath, "place/church.webp");
  assert.equal(resolvePlaceVisual({ name: "무지개 아파트" }).assetPath, "place/apartment.webp");
  assert.equal(resolvePlaceVisual({ name: "중앙공원" }).assetPath, "place/park.webp");
  assert.equal(resolvePlaceVisual({ name: "이마트" }).assetPath, "place/mart.webp");
  assert.equal(resolvePlaceVisual({ name: "동네 편의점" }).assetPath, "place/mart.webp");
  assert.equal(resolvePlaceVisual({ name: "튼튼 소아과" }).assetPath, "place/hospital.webp");
  assert.equal(resolvePlaceVisual({ name: "어린이 도서관" }).assetPath, "place/library.webp");
});

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
  assert.equal(resolvePlaceVisual({ name: "동네 편의점" }).assetPath, "ui/place-frequent.webp");
});

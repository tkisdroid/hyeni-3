import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMapViewportPadding } from "../src/transform/mapViewportPadding.ts";

test("지도 padding은 음수·NaN을 0으로 낮추고 정수로 반올림한다", () => {
  assert.deepEqual(
    normalizeMapViewportPadding({ top: 120.4, right: -2, bottom: Number.NaN, left: 24.8 }),
    { top: 120, right: 0, bottom: 0, left: 25 },
  );
  assert.deepEqual(normalizeMapViewportPadding(undefined), { top: 0, right: 0, bottom: 0, left: 0 });
});

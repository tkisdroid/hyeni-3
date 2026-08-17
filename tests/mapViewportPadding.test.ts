import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveHistoryMapViewportPadding,
  getMapFocusPanOffset,
  normalizeMapViewportPadding,
} from "../src/transform/mapViewportPadding.ts";

test("지도 padding은 음수·NaN을 0으로 낮추고 정수로 반올림한다", () => {
  assert.deepEqual(
    normalizeMapViewportPadding({ top: 120.4, right: -2, bottom: Number.NaN, left: 24.8 }),
    { top: 120, right: 0, bottom: 0, left: 25 },
  );
  assert.deepEqual(normalizeMapViewportPadding(undefined), { top: 0, right: 0, bottom: 0, left: 0 });
});

test("A17 세로 화면의 도구막대와 패널 사이를 지도 가시 영역으로 남긴다", () => {
  assert.deepEqual(
    deriveHistoryMapViewportPadding({
      viewportWidth: 384,
      viewportHeight: 832,
      toolbarRect: { top: 64, right: 368, bottom: 156, left: 16 },
      panelRect: { top: 313, right: 368, bottom: 696, left: 16 },
      wideLayout: false,
    }),
    { top: 172, right: 24, bottom: 535, left: 24 },
  );
});

test("가로 화면은 왼쪽 패널만 피하고 center 이동량을 padding 차이로 계산한다", () => {
  const padding = deriveHistoryMapViewportPadding({
    viewportWidth: 844,
    viewportHeight: 390,
    toolbarRect: { top: 64, right: 408, bottom: 120, left: 16 },
    panelRect: { top: 96, right: 408, bottom: 374, left: 16 },
    wideLayout: true,
  });

  assert.deepEqual(padding, { top: 24, right: 24, bottom: 24, left: 424 });
  assert.deepEqual(getMapFocusPanOffset(padding), { x: -200, y: 0 });
});

test("지나치게 큰 overlay 여백은 최소 96px 지도 영역을 남기도록 제한한다", () => {
  assert.deepEqual(
    deriveHistoryMapViewportPadding({
      viewportWidth: 320,
      viewportHeight: 400,
      toolbarRect: { top: 0, right: 320, bottom: 280, left: 0 },
      panelRect: { top: 290, right: 320, bottom: 400, left: 0 },
      wideLayout: false,
    }),
    { top: 280, right: 24, bottom: 24, left: 24 },
  );
});

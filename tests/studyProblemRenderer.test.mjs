import "./helpers/appModuleResolve.mjs";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { ACTIVE_STUDY_VISUAL_KINDS, supportsStudyVisual } = await import(
  "../src/features/study/player/visuals/visualRegistry.ts"
);

test("활성 문제 릴리스의 모든 시각화 kind를 복구 가능한 렌더러가 받는다", () => {
  const expected = [
    "angle", "chart", "circle", "coordinate_plane", "fraction_bar", "line_diagram", "net",
    "number_line", "orthographic_views", "partial_grid", "picture_graph", "polygon", "protractor",
    "solid", "table", "tiling",
  ];
  assert.deepEqual([...ACTIVE_STUDY_VISUAL_KINDS].sort(), expected);
  for (const kind of expected) assert.equal(supportsStudyVisual({ kind }), true);
  assert.equal(supportsStudyVisual({ kind: "future_visual" }), false);
});

test("캘린더 소유 문제 렌더러는 네트워크·iframe·외부 앱 경계를 포함하지 않는다", async () => {
  const source = await readFile(new URL("../src/features/study/player/StudyProblemRenderer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|<iframe|window\.open|Browser\.open|serviceWorker/);
  assert.match(source, /aria-live/);
  assert.match(source, /focus\(\)/);
});

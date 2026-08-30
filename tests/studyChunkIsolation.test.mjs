import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("초기 App·홈 파일은 문제 플레이어를 정적 import하지 않는다", async () => {
  for (const path of [
    "../src/app/App.tsx",
    "../src/screens/parent/ParentHome.tsx",
    "../src/screens/child/ChildHome.tsx",
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /StudyProblemRenderer|StudyMissionPlayer|player\/visuals/);
  }
});

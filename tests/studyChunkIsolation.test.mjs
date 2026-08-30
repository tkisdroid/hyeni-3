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

test("홈은 전체 Study query 묶음 대신 작은 status query만 불러온다", async () => {
  for (const path of [
    "../src/screens/parent/ParentHome.tsx",
    "../src/screens/child/ChildHome.tsx",
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /@\/queries\/useStudyStatus/);
    assert.doesNotMatch(source, /@\/queries\/useStudy"/);
  }
  const statusQuery = await readFile(new URL("../src/queries/useStudyStatus.ts", import.meta.url), "utf8");
  assert.match(statusQuery, /@\/lib\/api\/endpoints\/studyStatus/);
  assert.doesNotMatch(statusQuery, /@\/lib\/api\/endpoints\/study"/);
});

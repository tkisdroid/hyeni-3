import "./helpers/appModuleResolve.mjs";

import assert from "node:assert/strict";
import test from "node:test";

test("답안 피드백은 후속 캐시 재조회 완료를 기다리지 않는다", async () => {
  const studyQueries = await import("../src/queries/studyQueryRefresh.ts");
  const pending = new Promise<never>(() => undefined);
  const invalidations: unknown[] = [];
  const client = {
    invalidateQueries(options: unknown) {
      invalidations.push(options);
      return pending;
    },
  };

  const returned = studyQueries.refreshStudyAfterAnswer(client, {
    familyId: "family-1",
    learnerMemberId: "child-1",
    missionId: "mission-1",
  });

  assert.equal(returned, undefined);
  assert.equal(invalidations.length, 4);
});

test("학습 mutation은 화면 안내만 사용하고 전역 저장 실패 토스트를 띄우지 않는다", async () => {
  const source = await import("node:fs/promises")
    .then(({ readFile }) => readFile(new URL("../src/queries/useStudy.ts", import.meta.url), "utf8"));
  for (const functionName of ["useStartStudyMission", "useSubmitStudyAnswer"]) {
    const start = source.indexOf(`export function ${functionName}()`);
    assert.ok(start >= 0, `${functionName} 이 없다`);
    const end = source.indexOf("export function", start + 20);
    const block = source.slice(start, end > start ? end : undefined);
    assert.match(block, /meta: \{ silentError: true \}/);
  }
});

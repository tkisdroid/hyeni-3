import test from "node:test";
import assert from "node:assert/strict";

import { resolveQueryTruthState } from "../src/transform/queryTruthState.ts";

test("오류를 로딩과 빈 성공보다 우선한다", () => {
  assert.equal(
    resolveQueryTruthState([
      { isLoading: true, isError: false },
      { isLoading: false, isError: true },
    ]),
    "error",
  );
});

test("오류 없이 하나라도 로딩 중이면 loading을 반환한다", () => {
  assert.equal(
    resolveQueryTruthState([
      { isLoading: false, isError: false },
      { isLoading: true, isError: false },
    ]),
    "loading",
  );
});

test("모든 조회가 오류와 로딩 없이 끝나야 ready를 반환한다", () => {
  assert.equal(
    resolveQueryTruthState([
      { isLoading: false, isError: false },
      { isLoading: false, isError: false },
    ]),
    "ready",
  );
});

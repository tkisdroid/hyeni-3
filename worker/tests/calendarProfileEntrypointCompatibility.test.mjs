import "./helpers/tsModuleResolve.mjs";
import assert from "node:assert/strict";
import test from "node:test";

test("기본 Worker 테스트 resolver도 CalendarProfileService entrypoint를 불러온다", async () => {
  const worker = await import("../index.ts");

  assert.equal(typeof worker.CalendarProfileService, "function");
});

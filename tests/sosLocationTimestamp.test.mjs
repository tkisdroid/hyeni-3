import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const endpoint = readFileSync(
  new URL("../src/lib/api/endpoints/sos.ts", import.meta.url),
  "utf8",
);
const screen = readFileSync(
  new URL("../src/screens/child/ChildSos.tsx", import.meta.url),
  "utf8",
);
const query = readFileSync(
  new URL("../src/queries/useSos.ts", import.meta.url),
  "utf8",
);

test("SOS 현재 위치와 이력은 GeolocationPosition의 동일한 fix 시각을 전달한다", () => {
  assert.match(screen, /capturedAtMs:\s*p\.timestamp/);
  assert.match(screen, /capturedAtMs:\s*posRef\.current\?\.capturedAtMs\s*\?\?\s*null/);
  assert.match(query, /capturedAtMs:\s*pos\.capturedAtMs\s*\?\?\s*null/);
  assert.match(endpoint, /const recordedAt = new Date\([\s\S]+\)\.toISOString\(\)/);
  assert.match(endpoint, /p_recorded_at:\s*recordedAt/);
  assert.match(endpoint, /recorded_at:\s*recordedAt/);
  assert.equal((endpoint.match(/const recordedAt =/g) ?? []).length, 1);
});

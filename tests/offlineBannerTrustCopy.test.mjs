import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/ui/OfflineBanner.tsx", import.meta.url),
  "utf8",
);

test("오프라인 배너는 미구현 자동 동기화를 약속하지 않고 연결 후 재시도를 안내한다", () => {
  assert.match(source, /오프라인 상태야 · 연결 후 다시 시도해 줘/);
  assert.match(source, /오프라인 상태예요 · 연결 후 다시 시도해 주세요/);
  assert.doesNotMatch(source, /연결되면 동기화/);
});

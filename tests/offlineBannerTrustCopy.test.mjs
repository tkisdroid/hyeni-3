import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/ui/OfflineBanner.tsx", import.meta.url),
  "utf8",
);
const koreanCore = JSON.parse(readFileSync(
  new URL("../locales/ko/core.json", import.meta.url),
  "utf8",
));

test("오프라인 배너는 미구현 자동 동기화를 약속하지 않고 연결 후 재시도를 안내한다", () => {
  assert.match(source, /core\.offline\.child/);
  assert.match(source, /core\.offline\.formal/);
  assert.equal(koreanCore["core.offline.child"], "오프라인 상태야 · 연결 후 다시 시도해 줘");
  assert.equal(koreanCore["core.offline.formal"], "오프라인 상태예요 · 연결 후 다시 시도해 주세요");
  assert.doesNotMatch(Object.values(koreanCore).join("\n"), /연결되면 동기화/);
});

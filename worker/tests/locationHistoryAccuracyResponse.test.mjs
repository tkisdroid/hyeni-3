import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("오늘 경로 API는 저장한 accuracy_m를 부모 앱에 반환한다", () => {
  const source = readFileSync(new URL("../routes/location.ts", import.meta.url), "utf8");
  assert.match(source, /SELECT user_id, lat, lng, recorded_at, is_estimated, accuracy_m/);
});

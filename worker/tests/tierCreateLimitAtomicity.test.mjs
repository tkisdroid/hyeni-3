import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("저장 장소 Free 한도는 count-then-insert가 아닌 단일 조건부 INSERT로 확정한다", () => {
  const source = readFileSync(resolve(workerDir, "routes/saved-places.ts"), "utf8");
  assert.match(source, /INSERT INTO saved_places[\s\S]+SELECT \?,\?,\?,\?,\?,\?,\?,\?,\?[\s\S]+WHERE \(SELECT COUNT\(\*\) FROM saved_places WHERE family_id = \?\) < \?/);
  assert.match(source, /inserted\.meta\.changes/);
  assert.doesNotMatch(source, /assertSavedPlaceCreateLimit/);
});

test("위험구역 Free 한도는 count-then-insert가 아닌 단일 조건부 INSERT로 확정한다", () => {
  const source = readFileSync(resolve(workerDir, "routes/danger-zones.ts"), "utf8");
  assert.match(source, /INSERT INTO danger_zones[\s\S]+SELECT \?,\?,\?,\?,\?,\?,\?,\?,\?,\?[\s\S]+WHERE \(SELECT COUNT\(\*\) FROM danger_zones WHERE family_id = \?\) < \?/);
  assert.match(source, /inserted\.meta\.changes/);
  assert.doesNotMatch(source, /assertDangerZoneCreateLimit/);
});

test("위험구역 수정은 다른 가족 id를 조회·반환하거나 realtime으로 흘리지 않는다", () => {
  const source = readFileSync(resolve(workerDir, "routes/danger-zones.ts"), "utf8");
  const updateStart = source.indexOf("if (zone.id)");
  const insertStart = source.indexOf("const limit = await serviceLimitForFamily", updateStart);
  const updateBranch = source.slice(updateStart, insertStart);

  assert.match(updateBranch, /const updated = await/);
  assert.match(updateBranch, /if \(!updated\.meta\.changes\).*not_found/s);
  assert.match(updateBranch, /SELECT \* FROM danger_zones WHERE id = \? AND family_id = \?/);
  assert.doesNotMatch(updateBranch, /SELECT \* FROM danger_zones WHERE id = \?`/);
});

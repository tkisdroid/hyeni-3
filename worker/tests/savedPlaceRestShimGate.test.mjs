import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tableSource = readFileSync(new URL("../routes/rest-shim-table.ts", import.meta.url), "utf8");

function savedPlacePostGateIndex() {
  return tableSource.indexOf('if (table === "saved_places" && !caller.serviceRole)');
}

test("일반 클라이언트의 saved_places POST는 body와 upsert 처리 전에 정식 API로 강제된다", () => {
  const handlerStart = tableSource.indexOf("export async function handleTablePost");
  const handlerEnd = tableSource.indexOf("export async function handleTablePatch", handlerStart);
  const handler = tableSource.slice(handlerStart, handlerEnd);
  const gateIndex = handler.indexOf('if (table === "saved_places" && !caller.serviceRole)');

  assert.ok(gateIndex >= 0, "saved_places 비-service POST 차단 게이트가 필요하다");
  assert.ok(gateIndex < handler.indexOf("await c.req.json()"), "요청 본문 처리 전에 거부해야 한다");
  assert.ok(gateIndex < handler.indexOf("const onConflict"), "on_conflict upsert 해석 전에 거부해야 한다");
  assert.ok(gateIndex < handler.indexOf("await upsertRow"), "generic upsert에 도달하면 안 된다");
  assert.match(handler, /saved_place_write_requires_canonical_api/);
  assert.match(handler, /canonical_path:\s*"\/api\/saved-places"/);
});

test("Free 3번째 생성·비주보호자 생성·클라이언트 id upsert는 모두 shim에서 우회할 수 없다", () => {
  const gateIndex = savedPlacePostGateIndex();
  assert.ok(gateIndex >= 0);
  assert.match(
    tableSource.slice(gateIndex, gateIndex + 260),
    /return c\.json\([\s\S]*saved_place_write_requires_canonical_api[\s\S]*403/,
  );
});

test("service-role saved_places POST는 기존 운영 쓰기 경로를 유지한다", () => {
  assert.match(tableSource, /if \(table === "saved_places" && !caller\.serviceRole\)/);
  assert.match(tableSource, /const written = await upsertRow\(c\.env\.DB, table, r, conflictCols\)/);
});

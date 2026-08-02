import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseShutdownLocationPayload } from "../shared/shutdownLocation.js";

const NOW_MS = Date.parse("2026-08-01T06:00:00.000Z");

test("종료 직전 위치 payload는 네이티브 숫자 좌표와 실제 fix 시각만 허용한다", () => {
  assert.deepEqual(parseShutdownLocationPayload({
    user_id: " child-1 ",
    latitude: 37.2,
    longitude: 127.1,
    accuracy_m: 8.5,
    captured_at: "2026-08-01T05:59:58.000Z",
  }, NOW_MS), {
    userId: "child-1",
    lat: 37.2,
    lng: 127.1,
    accuracyM: 8.5,
    fixTime: {
      atMs: Date.parse("2026-08-01T05:59:58.000Z"),
      timestamp: "2026-08-01 05:59:58.000+00",
      explicit: true,
    },
  });

  for (const payload of [
    null,
    [],
    { user_id: "", latitude: 37.2, longitude: 127.1, captured_at: "2026-08-01T05:59:58.000Z" },
    { user_id: "child-1", latitude: "37.2", longitude: 127.1, captured_at: "2026-08-01T05:59:58.000Z" },
    { user_id: "child-1", latitude: 91, longitude: 127.1, captured_at: "2026-08-01T05:59:58.000Z" },
    { user_id: "child-1", latitude: 37.2, longitude: -181, captured_at: "2026-08-01T05:59:58.000Z" },
    { user_id: "child-1", latitude: 37.2, longitude: 127.1, accuracy: -1, captured_at: "2026-08-01T05:59:58.000Z" },
    { user_id: "child-1", latitude: 37.2, longitude: 127.1, captured_at: "invalid" },
  ]) {
    assert.equal(parseShutdownLocationPayload(payload, NOW_MS), null);
  }
});

test("locations shim은 잘못된 입력과 다른 사용자 요청을 성공으로 위장하지 않는다", () => {
  const source = readFileSync(new URL("../routes/rest-shim-table.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function handleLocationsPost");
  const handler = source.slice(start);

  assert.match(handler, /invalid_location_payload[\s\S]*400/);
  assert.match(handler, /location_user_mismatch[\s\S]*403/);
  assert.doesNotMatch(handler, /Number\(body\.(?:latitude|longitude)\)/);
});

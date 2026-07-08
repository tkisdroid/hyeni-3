import test from "node:test";
import assert from "node:assert/strict";

import { hasNewerLocationUpdate } from "../src/transform/locationView.ts";

test("위치 새로고침은 서버 updated_at이 실제로 증가할 때만 성공으로 본다", () => {
  const before = { updated_at: "2026-07-08 11:24:04.956+00" };

  assert.equal(
    hasNewerLocationUpdate(before, { updated_at: "2026-07-08 11:24:04.956+00" }),
    false,
  );
  assert.equal(
    hasNewerLocationUpdate(before, { updated_at: "2026-07-08 11:25:04.956+00" }),
    true,
  );
});

test("기존 위치가 없던 아이는 새 위치가 도착했을 때 성공으로 본다", () => {
  assert.equal(
    hasNewerLocationUpdate(null, { updated_at: "2026-07-08 11:25:04.956+00" }),
    true,
  );
  assert.equal(hasNewerLocationUpdate(null, null), false);
});

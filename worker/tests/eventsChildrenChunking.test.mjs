import test from "node:test";
import assert from "node:assert/strict";

import { chunkSqlVariables } from "../lib/sqlChunk.ts";

test("events_children 조회 id는 D1 변수 제한을 넘지 않도록 청크로 나뉜다", () => {
  const ids = Array.from({ length: 1200 }, (_, i) => `event-${i}`);
  const chunks = chunkSqlVariables(ids, 90);

  assert.equal(chunks.flat().length, ids.length);
  assert.equal(new Set(chunks.flat()).size, ids.length);
  assert.deepEqual(chunks.flat(), ids);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 90));
});

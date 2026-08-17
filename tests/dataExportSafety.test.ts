import assert from "node:assert/strict";
import test from "node:test";

import {
  serializePublicDataExport,
} from "../src/transform/dataExport.ts";
import * as dataExportModule from "../src/transform/dataExport.ts";

test("실제 export 수집기는 네 section rejection을 공개 unavailable 상태로만 기록한다", async () => {
  const collect = (dataExportModule as Record<string, unknown>).collectDataExportSections;
  assert.equal(typeof collect, "function");
  const rejected = () => Promise.reject(Object.assign(new Error("Bearer raw-message"), {
    code: "account_deletion_guard_unavailable",
  }));
  const collected = await (collect as (loaders: Record<string, () => Promise<never>>) => Promise<unknown>)({
    events: rejected,
    savedPlaces: rejected,
    dangerZones: rejected,
    academies: rejected,
  });
  assert.deepEqual(collected, {
    values: { events: [], savedPlaces: [], dangerZones: [], academies: [] },
    errors: [
      { section: "events", unavailable: true },
      { section: "savedPlaces", unavailable: true },
      { section: "dangerZones", unavailable: true },
      { section: "academies", unavailable: true },
    ],
  });
  const downloaded = serializePublicDataExport(collected);
  assert.doesNotMatch(downloaded, /message|code|account_deletion_guard_unavailable|export_section_failed/);
});

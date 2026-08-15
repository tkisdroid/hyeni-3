import assert from "node:assert/strict";
import test from "node:test";

import {
  dataExportSectionUnavailable,
  serializePublicDataExport,
} from "../src/transform/dataExport.ts";

test("다운로드용 부분 실패 스키마는 내부 code·message 없이 공개 상태만 저장한다", () => {
  const fixture = {
    meta: {
      schemaVersion: 1,
      errors: [dataExportSectionUnavailable("events")],
    },
  };
  assert.deepEqual(fixture.meta.errors, [{ section: "events", unavailable: true }]);
  const downloaded = serializePublicDataExport(fixture);
  assert.doesNotMatch(downloaded, /message|code|account_deletion_guard_unavailable|export_section_failed/);
});

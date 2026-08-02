import test from "node:test";
import assert from "node:assert/strict";

import { isParentAlertRecipientEnabled } from "../lib/parentAlertRecipients.ts";

test("미등록 장소 출발은 등록 장소가 아니라 일반 위치 알림 설정을 따른다", () => {
  assert.equal(isParentAlertRecipientEnabled("unregistered_stay_left", {
    registered_place_enabled: 1,
    location_enabled: 0,
  }), false);
  assert.equal(isParentAlertRecipientEnabled("unregistered_stay_left", {
    registered_place_enabled: 0,
    location_enabled: 1,
  }), true);
});

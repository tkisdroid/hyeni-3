import assert from "node:assert/strict";

import {
  buildEventLocation,
  buildOccurrenceDateKeys,
  type WeekdayIndex,
} from "../src/transform/eventRecurrence";

const weekdayRepeat: WeekdayIndex[] = [1, 3, 5];
const keys = buildOccurrenceDateKeys("2026-6-6", "요일", weekdayRepeat);

assert.equal(keys.length, 24);
assert.deepEqual(keys.slice(0, 6), [
  "2026-6-6",
  "2026-6-8",
  "2026-6-10",
  "2026-6-13",
  "2026-6-15",
  "2026-6-17",
]);
assert.equal(keys.at(-1), "2026-7-28");

assert.deepEqual(buildEventLocation("", { lat: 37.123456, lng: 127.987654 }), {
  address: "지도에서 선택한 위치",
  lat: 37.123456,
  lng: 127.987654,
});
assert.equal(buildEventLocation("   ", null), null);

console.log("eventRecurrence contract ok");

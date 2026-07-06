import assert from "node:assert/strict";

import { findFutureSeriesEvents, resolveSeriesEditTargets } from "../src/transform/eventSeries";

const seed = {
  id: "wed-1",
  family_id: "family",
  date_key: "2026-6-8",
  title: "피아노 학원",
  time: "15:00",
  end_time: null,
  category: "hobby",
  emoji: "🎨",
  memo: "악보",
  location: { address: "수지구 대지로 49", lat: 37.331, lng: 127.111 },
  notif_override: { minutesBefore: [10] },
  is_family_event: false,
  events_children: [{ child_id: "hyeni" }],
} as const;

const rows = [
  { ...seed, id: "mon-prev", date_key: "2026-6-6" },
  seed,
  { ...seed, id: "fri-next", date_key: "2026-6-10" },
  { ...seed, id: "next-week", date_key: "2026-6-15" },
  { ...seed, id: "other-place", date_key: "2026-6-17", location: { address: "다른 곳", lat: 37.4, lng: 127.4 } },
  { ...seed, id: "other-child", date_key: "2026-6-19", events_children: [{ child_id: "testi" }] },
];

assert.deepEqual(findFutureSeriesEvents(rows, seed).map((event) => event.id), [
  "wed-1",
  "fri-next",
  "next-week",
]);

assert.deepEqual(resolveSeriesEditTargets(rows, seed, "single").map((event) => event.id), ["wed-1"]);
assert.deepEqual(resolveSeriesEditTargets(rows, seed, "future").map((event) => event.id), [
  "wed-1",
  "fri-next",
  "next-week",
]);

console.log("eventSeries contract ok");

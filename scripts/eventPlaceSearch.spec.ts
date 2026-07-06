import assert from "node:assert/strict";

import { searchSavedPlacesForSchedule } from "../src/transform/eventPlaceSearch";

const savedPlaces = [
  {
    id: "piano",
    family_id: "family",
    name: "피아노 학원",
    location: { lat: 37.331, lng: 127.111, address: "경기도 용인시 수지구 대지로 49" },
  },
  {
    id: "home",
    family_id: "family",
    name: "집",
    location: { lat: 37.2, lng: 127.2, address: "경기도 용인시 수지구 현암로 1" },
    is_home: true,
  },
  {
    id: "broken",
    family_id: "family",
    name: "좌표 없는 장소",
    location: { lat: Number.NaN, lng: Number.NaN, address: "수지구 대지로 49" },
  },
] as const;

assert.deepEqual(
  searchSavedPlacesForSchedule(savedPlaces, "피").map((p) => p.id),
  ["piano"],
);

assert.deepEqual(
  searchSavedPlacesForSchedule(savedPlaces, "수지구대지로49").map((p) => p.id),
  ["piano"],
);

assert.deepEqual(searchSavedPlacesForSchedule(savedPlaces, "   "), []);

assert.deepEqual(
  searchSavedPlacesForSchedule(savedPlaces, "수지구").map((p) => p.id),
  ["piano", "home"],
);

console.log("eventPlaceSearch contract ok");

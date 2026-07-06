import assert from "node:assert/strict";

import { resolveEventPlaceLabel } from "../src/transform/eventPlaceLabel";

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
    location: { lat: 37.2, lng: 127.2, address: "용인시 수지구 집주소" },
    is_home: true,
  },
] as const;

assert.equal(
  resolveEventPlaceLabel(
    { address: "수지구 대지로 49", lat: 37.33105, lng: 127.11102 },
    savedPlaces,
  ),
  "피아노 학원",
);

assert.equal(
  resolveEventPlaceLabel({ address: "수지구 대지로 49" }, savedPlaces),
  "피아노 학원",
);

assert.equal(
  resolveEventPlaceLabel({ address: "처음 가는 곳", lat: 37.9, lng: 127.9 }, savedPlaces),
  "처음 가는 곳",
);

assert.equal(resolveEventPlaceLabel(null, savedPlaces), "");

console.log("eventPlaceLabel contract ok");

import test from "node:test";
import assert from "node:assert/strict";

import { exactSavedPlaceLabel, hasNewerLocationUpdate } from "../src/transform/locationView.ts";
import type { ChildLocation, SavedPlace } from "../src/lib/api/endpoints/location.ts";

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

test("저장장소 라벨은 가까운 장소만 확정 표시한다", () => {
  const loc: ChildLocation = {
    user_id: "child-1",
    lat: 37.5,
    lng: 127,
    updated_at: "2026-07-09 06:12:00.000+00",
  };
  const nearPlace: SavedPlace = {
    id: "place-near",
    family_id: "family-1",
    name: "학교",
    location: { lat: 37.50045, lng: 127, address: "학교 주소" },
  };
  const farPlace: SavedPlace = {
    id: "place-far",
    family_id: "family-1",
    name: "피아노 학원",
    location: { lat: 37.50135, lng: 127, address: "학원 주소" },
  };

  assert.equal(exactSavedPlaceLabel(loc, [nearPlace]), "학교");
  assert.equal(exactSavedPlaceLabel(loc, [farPlace]), null);
});

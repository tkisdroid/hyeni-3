import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const form = readFileSync("src/screens/parent/EventForm.tsx", "utf8");
const css = readFileSync("src/screens/parent/EventForm.css", "utf8");

assert.match(form, /searchSavedPlacesForSchedule/);
assert.match(form, /ef-place-suggestions/);
assert.match(form, /role="listbox"/);
assert.match(form, /aria-label="저장된 장소 검색 결과"/);
assert.match(form, /setPlace\(p\.name\)/);
assert.match(form, /Number\.isFinite\(p\.location\?\.lat\)/);
assert.match(form, /setPlaceCoord\(coord\)/);

assert.match(css, /\.ef-place-field/);
assert.match(css, /\.ef-place-suggestions/);
assert.match(css, /\.ef-place-option/);

console.log("eventPlaceAutocompleteUi contract ok");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tsx = readFileSync("src/screens/parent/ParentHome.tsx", "utf8");
const css = readFileSync("src/screens/parent/ParentHome.css", "utf8");

assert.match(tsx, /최근 실행/);
assert.match(tsx, /가장 많이 사용/);
assert.match(tsx, /deviceStatus\.mostUsedApp/);
assert.match(tsx, /deviceStatus\.topApps/);

assert.match(css, /\.ph-app-summary/);
assert.match(css, /\.ph-app-summary__item/);
assert.match(css, /\.ph-app-summary__time/);

console.log("parentHomeAppUsageUi contract ok");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_DAILY_SUPPLY_ITEMS_PER_KIND,
  exceedsDailySupplyItemLimit,
} from "../lib/dailySupplyChecklist.ts";

test("daily-supplies는 준비물·숙제 compact 배열을 각각 8개로 제한하고 레거시 평문은 보존한다", () => {
  const compact = (count) => JSON.stringify(Array.from({ length: count }, (_, index) => ({
    i: `id${index}`,
    t: `항목${index}`,
    d: 0,
  })));

  assert.equal(MAX_DAILY_SUPPLY_ITEMS_PER_KIND, 8);
  assert.equal(exceedsDailySupplyItemLimit(compact(8)), false);
  assert.equal(exceedsDailySupplyItemLimit(compact(9)), true);
  assert.equal(exceedsDailySupplyItemLimit("실내화, 물통"), false);
  assert.equal(exceedsDailySupplyItemLimit(""), false);

  const route = readFileSync(new URL("../routes/daily-supplies.ts", import.meta.url), "utf8");
  assert.match(route, /exceedsDailySupplyItemLimit\(body\.supplies\)/);
  assert.match(route, /exceedsDailySupplyItemLimit\(body\.homework\)/);
  assert.match(route, /daily_supply_limit_exceeded/);
});

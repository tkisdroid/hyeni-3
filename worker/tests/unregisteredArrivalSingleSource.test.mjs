import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("미등록 장소 도착 알림은 upload 후 arrivalDetect만 발송하고 cron은 departure 상태만 연다", () => {
  const rpc = readFileSync(new URL("../routes/rest-shim-rpc.ts", import.meta.url), "utf8");
  const cron = readFileSync(new URL("../cron/unregistered-stay-check.ts", import.meta.url), "utf8");
  const arrivalStart = cron.indexOf("// ── 1단계: 진입(도착)");
  const departureStart = cron.indexOf("// ── 2단계", arrivalStart);
  const arrivalSection = cron.slice(arrivalStart, departureStart);

  assert.match(rpc, /detectArbitraryArrival/);
  assert.match(arrivalSection, /persistArrival/);
  assert.doesNotMatch(arrivalSection, /buildUnregisteredStayAlert/);
  assert.doesNotMatch(arrivalSection, /deliverParentAlert/);
});

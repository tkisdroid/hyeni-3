import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const java = readFileSync("android/app/src/main/java/com/hyeni/calendar/DeviceStatusReporter.java", "utf8");
const sortStart = java.indexOf("Collections.sort(rows");
const sortEnd = java.indexOf("int limit = Math.min", sortStart);
assert.notEqual(sortStart, -1, "appUsage 정렬 블록이 있어야 해요");
assert.notEqual(sortEnd, -1, "appUsage 정렬 직후 limit 계산이 있어야 해요");
const sortBlock = java.slice(sortStart, sortEnd);

const usageIndex = sortBlock.indexOf("Long.compare(right.usageMs, left.usageMs)");
const recentIndex = sortBlock.indexOf("Long.compare(right.lastTimeUsed, left.lastTimeUsed)");
assert.ok(usageIndex >= 0, "오늘 사용시간 내림차순 정렬이 먼저 있어야 해요");
assert.ok(recentIndex >= 0, "동률이면 최근 사용 시각으로 정렬해야 해요");
assert.ok(usageIndex < recentIndex, "가장 많이 사용한 앱이 빠지지 않도록 usageMs 정렬이 우선이어야 해요");
assert.match(java, /\.put\("usageMs", row\.usageMs\)/);
assert.match(java, /\.put\("lastTimeUsed", row\.lastTimeUsed\)/);

console.log("deviceStatusReporterUsageSort contract ok");

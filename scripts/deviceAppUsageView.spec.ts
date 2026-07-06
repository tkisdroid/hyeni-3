import assert from "node:assert/strict";

import { buildDeviceAppUsageView } from "../src/transform/deviceAppUsageView";

const health = {
  batteryLevel: 72,
  isCharging: false,
  networkConnected: true,
  networkType: "wifi",
  recentApp: "카카오톡",
  usagePermission: "granted",
  deviceScreenOnMs: 92 * 60 * 1000,
  appUsage: [
    { name: "카카오톡", packageName: "com.kakao.talk", usageMs: 18 * 60 * 1000, percent: 25 },
    { name: "유튜브 키즈", packageName: "com.google.android.apps.youtube.kids", usageMs: 42 * 60 * 1000, percent: 58 },
    { name: "웹툰", packageName: "com.webtoon", usageMs: 12 * 60 * 1000, percent: 17 },
  ],
};

const view = buildDeviceAppUsageView(health);

assert.equal(view.recentAppLabel, "카카오톡");
assert.equal(view.mostUsedApp?.name, "유튜브 키즈");
assert.equal(view.mostUsedApp?.timeLabel, "42분");
assert.deepEqual(
  view.topApps.map((app) => app.name),
  ["유튜브 키즈", "카카오톡", "웹툰"],
);
assert.equal(view.topApps[1]?.isLatest, true);

console.log("deviceAppUsageView contract ok");

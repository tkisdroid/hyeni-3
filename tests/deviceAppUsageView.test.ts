import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildDeviceAppUsageView } from "../src/transform/deviceAppUsageView.ts";

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("오늘 많이 쓴 앱에서 혜니캘린더 자신은 제외한다 (패키지명·표시명 모두)", () => {
  const view = buildDeviceAppUsageView({
    recentApp: "혜니캘린더",
    appUsage: [
      { name: "혜니캘린더", packageName: "com.hyeni.calendar", usageMs: 142 * 60000 },
      { name: "카카오톡", packageName: "com.kakao.talk", usageMs: 31 * 60000 },
      // 패키지명이 없어도 표시명으로 거른다(구버전 리포트 호환).
      { name: "혜니캘린더", packageName: null, usageMs: 90 * 60000 },
      { name: "유튜브", packageName: "com.google.android.youtube", usageMs: 12 * 60000 },
    ],
  });

  assert.deepEqual(view.topApps.map((a) => a.name), ["카카오톡", "유튜브"]);
  assert.equal(view.mostUsedApp?.name, "카카오톡");
  // 최근 실행 라벨은 표시 유지(요청 범위는 "많이 쓴 앱" 목록).
  assert.equal(view.recentAppLabel, "혜니캘린더");
});

test("혜니캘린더만 쓴 날은 목록이 빈다", () => {
  const view = buildDeviceAppUsageView({
    recentApp: null,
    appUsage: [{ name: "혜니캘린더", packageName: "com.hyeni.calendar", usageMs: 60 * 60000 }],
  });
  assert.deepEqual(view.topApps, []);
  assert.equal(view.mostUsedApp, null);
});

test("빈 목록 문구는 Usage Access 허용 여부로 '권한 필요'와 '쓴 앱 없음'을 구분한다", () => {
  const familyView = readSource("src/transform/familyView.ts");
  assert.match(familyView, /appUsagePermissionGranted: health\.usagePermission === "granted"/);

  const home = readSource("src/screens/parent/ParentHome.tsx");
  assert.match(home, /appUsagePermissionGranted\s*\?\s*"혜니캘린더 외에 오늘 쓴 앱이 없어요"/);
  assert.match(home, /아이 기기 설정 > 사용정보 접근 허용을 켜면 표시돼요/);

  const report = readSource("src/screens/feature/DailySafetyReport.tsx");
  assert.match(report, /appUsagePermissionGranted\s*\?\s*"혜니캘린더 외에 오늘 쓴 앱이 없어요\."/);
  assert.match(report, /사용정보 접근 권한을 켜면 많이 쓴 앱이 표시돼요\./);
});

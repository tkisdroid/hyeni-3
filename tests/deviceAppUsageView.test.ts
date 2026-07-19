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

test("시스템 자녀 보호 기능은 공백 변형과 영문 표시명 모두 최근 앱에서 제외한다", () => {
  const koreanView = buildDeviceAppUsageView({
    recentApp: "  시스템   자녀 보호기능  ",
    appUsage: [],
  });
  const englishView = buildDeviceAppUsageView({
    recentApp: " System   Parental Controls ",
    appUsage: [],
  });

  assert.equal(koreanView.recentAppLabel, null);
  assert.equal(englishView.recentAppLabel, null);
});

test("명시된 시스템 표면은 오늘 많이 쓴 앱과 최다 사용 앱에서 모두 제외한다", () => {
  const view = buildDeviceAppUsageView({
    recentApp: "com.android.systemui",
    appUsage: [
      { name: "설정", packageName: "com.android.settings", usageMs: 180 * 60000 },
      { name: "시스템 UI", packageName: "com.android.systemui", usageMs: 170 * 60000 },
      { name: "권한 관리자", packageName: "com.google.android.permissioncontroller", usageMs: 160 * 60000 },
      { name: "패키지 설치 프로그램", packageName: "com.google.android.packageinstaller", usageMs: 150 * 60000 },
      { name: "One UI 홈", packageName: "com.sec.android.app.launcher", usageMs: 140 * 60000 },
      { name: "시스템 자녀 보호 기능", packageName: null, usageMs: 130 * 60000 },
      { name: "System parental controls", packageName: null, usageMs: 120 * 60000 },
      { name: "유튜브", packageName: "com.google.android.youtube", usageMs: 30 * 60000 },
    ],
  });

  assert.equal(view.recentAppLabel, null);
  assert.deepEqual(view.topApps.map((app) => app.name), ["유튜브"]);
  assert.equal(view.mostUsedApp?.name, "유튜브");
});

test("Launcher Pro처럼 시스템 키워드가 포함된 정상 표시명은 최근·상위·최다 사용에 유지한다", () => {
  const view = buildDeviceAppUsageView({
    recentApp: "Launcher Pro",
    appUsage: [
      { name: "Launcher Pro", packageName: "com.example.tools", usageMs: 45 * 60000, percent: 75 },
      { name: "유튜브", packageName: "com.google.android.youtube", usageMs: 15 * 60000, percent: 25 },
    ],
  });

  assert.equal(view.recentAppLabel, "Launcher Pro");
  assert.deepEqual(view.topApps.map((app) => app.name), ["Launcher Pro", "유튜브"]);
  assert.equal(view.mostUsedApp?.name, "Launcher Pro");
});

test("시스템 또는 자체 행을 제거하면 남은 앱의 과거 분모 비율을 표시하지 않는다", () => {
  const systemFiltered = buildDeviceAppUsageView({
    recentApp: "유튜브",
    appUsage: [
      { name: "설정", packageName: "com.android.settings", usageMs: 90 * 60000, percent: 90 },
      { name: "유튜브", packageName: "com.google.android.youtube", usageMs: 10 * 60000, percent: 10 },
    ],
  });
  const ownAppFiltered = buildDeviceAppUsageView({
    recentApp: "카카오톡",
    appUsage: [
      { name: "혜니캘린더", packageName: "com.hyeni.calendar", usageMs: 90 * 60000, percent: 90 },
      { name: "카카오톡", packageName: "com.kakao.talk", usageMs: 10 * 60000, percent: 10 },
    ],
  });

  assert.equal(systemFiltered.mostUsedApp?.name, "유튜브");
  assert.equal(systemFiltered.mostUsedApp?.percent, null);
  assert.equal(ownAppFiltered.mostUsedApp?.name, "카카오톡");
  assert.equal(ownAppFiltered.mostUsedApp?.percent, null);
});

test("필터가 없는 정상 payload는 기존 비율 정규화를 유지한다", () => {
  const view = buildDeviceAppUsageView({
    recentApp: "유튜브",
    appUsage: [
      { name: "유튜브", packageName: "com.google.android.youtube", usageMs: 20 * 60000, percent: 66.6 },
    ],
  });

  assert.equal(view.mostUsedApp?.percent, 67);
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

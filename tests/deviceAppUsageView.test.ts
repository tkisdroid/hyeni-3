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

test("여러 제조사의 시스템 표면은 오늘 많이 쓴 앱과 최다 사용 앱에서 모두 제외한다", () => {
  const view = buildDeviceAppUsageView({
    recentApp: "com.android.systemui",
    appUsage: [
      { name: "설정", packageName: "com.android.settings", usageMs: 180 * 60000 },
      { name: "시스템 UI", packageName: "com.android.systemui", usageMs: 170 * 60000 },
      { name: "권한 관리자", packageName: "com.google.android.permissioncontroller", usageMs: 160 * 60000 },
      { name: "패키지 설치 프로그램", packageName: "com.google.android.packageinstaller", usageMs: 150 * 60000 },
      { name: "One UI 홈", packageName: "com.sec.android.app.launcher", usageMs: 140 * 60000 },
      { name: "Pixel Launcher", packageName: "com.google.android.apps.nexuslauncher", usageMs: 139 * 60000 },
      { name: "MIUI Home", packageName: "com.miui.home", usageMs: 138 * 60000 },
      { name: "Huawei Home", packageName: "com.huawei.android.launcher", usageMs: 137 * 60000 },
      { name: "vivo Launcher", packageName: "com.bbk.launcher2", usageMs: 136 * 60000 },
      { name: "ColorOS System UI", packageName: "com.oplus.systemui", usageMs: 135 * 60000 },
      { name: "Samsung AOD", packageName: "com.samsung.android.app.aodservice", usageMs: 134 * 60000 },
      { name: "Gboard", packageName: "com.google.android.inputmethod.latin", usageMs: 133 * 60000 },
      { name: "MIUI 설치 관리자", packageName: "com.miui.packageinstaller", usageMs: 132 * 60000 },
      { name: "Android 설정 도우미", packageName: "com.google.android.setupwizard", usageMs: 131 * 60000 },
      { name: "시스템 자녀 보호 기능", packageName: null, usageMs: 130 * 60000 },
      { name: "System parental controls", packageName: null, usageMs: 120 * 60000 },
      { name: "유튜브", packageName: "com.google.android.youtube", usageMs: 30 * 60000 },
    ],
  });

  assert.equal(view.recentAppLabel, null);
  assert.deepEqual(view.topApps.map((app) => app.name), ["유튜브"]);
  assert.equal(view.mostUsedApp?.name, "유튜브");
});

test("정상 앱과 실행 가능한 기본 앱은 시스템 필터 오탐으로 숨기지 않는다", () => {
  const view = buildDeviceAppUsageView({
    recentApp: "Home School",
    appUsage: [
      { name: "Launcher Pro", packageName: "com.example.launcherpro", usageMs: 80 * 60000 },
      { name: "Home School", packageName: "com.example.homeschool", usageMs: 70 * 60000 },
      { name: "Keyboard Trainer", packageName: "com.example.keyboardtrainer", usageMs: 60 * 60000 },
      { name: "Settings Guide", packageName: "com.example.settingsguide", usageMs: 50 * 60000 },
      { name: "카메라", packageName: "com.sec.android.app.camera", usageMs: 40 * 60000 },
      { name: "삼성 인터넷", packageName: "com.sec.android.app.sbrowser", usageMs: 30 * 60000 },
      { name: "메시지", packageName: "com.samsung.android.messaging", usageMs: 20 * 60000 },
      { name: "에이닷 전화", packageName: "com.skt.prod.dialer", usageMs: 10 * 60000 },
    ],
  }, 8);

  assert.deepEqual(view.topApps.map((app) => app.name), [
    "Launcher Pro",
    "Home School",
    "Keyboard Trainer",
    "Settings Guide",
    "카메라",
    "삼성 인터넷",
    "메시지",
    "에이닷 전화",
  ]);
  assert.equal(view.recentAppLabel, "Home School");
});

test("앱 이름을 확인하지 못한 원시 패키지 문자열은 사용자 앱으로 표시하지 않는다", () => {
  const view = buildDeviceAppUsageView({
    recentApp: "com.vendor.edgepanel.overlay",
    appUsage: [
      {
        name: "com.vendor.edgepanel.overlay",
        packageName: "com.vendor.edgepanel.overlay",
        usageMs: 90 * 60000,
      },
      { name: "에이닷 전화", packageName: "com.skt.prod.dialer", usageMs: 10 * 60000 },
    ],
  });

  assert.equal(view.recentAppLabel, null);
  assert.deepEqual(view.topApps.map((app) => app.name), ["에이닷 전화"]);
  assert.equal(view.mostUsedApp?.timeLabel, "10분");
});

test("razr 실측 payload는 보조 화면 런처를 숨기고 실제 앱명과 사용량을 유지한다", () => {
  const view = buildDeviceAppUsageView({
    recentApp: "최근 사용한 앱 없음",
    appUsage: [
      { name: "혜니캘린더", packageName: "com.hyeni.calendar", usageMs: 808_975, percent: 49 },
      { name: "혜니캘린더", packageName: "com.hyeni.calendar", usageMs: 712_586, percent: 43 },
      { name: "에이닷 전화", packageName: "com.skt.prod.dialer", usageMs: 140_495, percent: 8 },
      {
        name: "com.motorola.launcher.secondarydisplay",
        packageName: "com.motorola.launcher.secondarydisplay",
        usageMs: 1_132,
        percent: 0,
      },
    ],
  });

  assert.deepEqual(view.topApps.map((app) => ({
    name: app.name,
    timeLabel: app.timeLabel,
  })), [
    { name: "에이닷 전화", timeLabel: "2분" },
  ]);
  assert.equal(view.mostUsedApp?.name, "에이닷 전화");
  assert.equal(view.mostUsedApp?.timeLabel, "2분");
});

test("Launcher Pro처럼 시스템 키워드가 포함된 정상 표시명은 최근·상위·최다 사용에 유지한다", () => {
  const view = buildDeviceAppUsageView({
    recentApp: "Launcher Pro",
    appUsage: [
      { name: "Launcher Pro", packageName: "com.example.launcherpro", usageMs: 45 * 60000, percent: 75 },
      { name: "유튜브", packageName: "com.google.android.youtube", usageMs: 15 * 60000, percent: 25 },
    ],
  });

  assert.equal(view.recentAppLabel, "Launcher Pro");
  assert.deepEqual(view.topApps.map((app) => app.name), ["Launcher Pro", "유튜브"]);
  assert.equal(view.mostUsedApp?.name, "Launcher Pro");
});

test("구버전 name-only 시스템 패키지는 표시명으로 노출하지 않는다", () => {
  const view = buildDeviceAppUsageView({
    recentApp: "유튜브",
    appUsage: [
      { name: "com.android.systemui", packageName: null, usageMs: 90 * 60000 },
      { name: "유튜브", packageName: "com.google.android.youtube", usageMs: 10 * 60000 },
    ],
  });

  assert.deepEqual(view.topApps.map((app) => app.name), ["유튜브"]);
  assert.equal(view.mostUsedApp?.name, "유튜브");
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
  const koParent = JSON.parse(readSource("locales/ko/parent.json"));
  assert.match(home, /appUsagePermissionGranted[\s\S]{0,180}parent\.parentHome\.copy046/);
  assert.match(home, /parent\.parentHome\.copy047/);
  assert.equal(koParent["parent.parentHome.copy046"], "혜니캘린더 외에 오늘 쓴 앱이 없어요");
  assert.equal(koParent["parent.parentHome.copy047"], "아이 기기에서 사용 정보 접근을 켜면 보여요");

  const report = readSource("src/screens/feature/DailySafetyReport.tsx");
  const koReports = JSON.parse(readSource("locales/ko/reports.json"));
  assert.match(report, /appUsagePermissionGranted[\s\S]{0,180}reports\.daily\.noOtherApps/);
  assert.match(report, /reports\.daily\.appPermission/);
  assert.equal(koReports["reports.daily.noOtherApps"], "혜니캘린더 외에 오늘 쓴 앱이 없어요.");
  assert.equal(koReports["reports.daily.appPermission"], "아이 기기에서 사용 정보 접근을 켜면 보여요.");
});

test("Android 패키지 가시성은 일반 앱·기본 홈·보조 화면 홈을 모두 조회한다", () => {
  const manifest = readSource("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android\.intent\.category\.LAUNCHER/);
  assert.match(manifest, /android\.intent\.category\.HOME/);
  assert.match(manifest, /android\.intent\.category\.SECONDARY_HOME/);
  assert.doesNotMatch(
    manifest,
    /<uses-permission[^>]+android\.permission\.QUERY_ALL_PACKAGES/,
  );
});

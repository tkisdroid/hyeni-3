import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  deviceLocationHealthView,
  deviceNotificationHealthView,
  deviceOverallSafetyLabel,
} from "../src/transform/deviceNotificationHealth.ts";

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = new Date("2026-07-14T06:00:00.000Z");
const RECENT_REPORT = "2026-07-14T05:55:00.000Z";
const STALE_REPORT = "2026-07-14T05:30:00.000Z";

test("최근 기기 보고와 아이 일정 알림 설정이 모두 켜져야 표시 설정 정상으로 안내한다", () => {
  const view = deviceNotificationHealthView({
    updatedAt: RECENT_REPORT,
    postPermissionGranted: true,
    notificationsEnabled: true,
    requiredChannelsEnabled: true,
    fullScreenIntentAllowed: true,
    remoteListenChannelEnabled: true,
    postNotif: true,
  }, { now: NOW, childScheduleEnabled: true });

  assert.equal(view.state, "ready");
  assert.equal(view.label, "알림 표시 설정 정상");
  assert.equal(view.shortLabel, "알림 정상");
  assert.match(view.detail, /최근 보고 기준/);
  assert.match(view.detail, /일정 알림 설정/);
  assert.doesNotMatch(view.label, /수신 정상/);
});

test("전체 화면 특별 접근이 꺼지면 일반 알림이 켜져 있어도 화면 상단 팝업 강등을 주의로 표시한다", () => {
  const view = deviceNotificationHealthView({
    updatedAt: RECENT_REPORT,
    postPermissionGranted: true,
    notificationsEnabled: true,
    requiredChannelsEnabled: true,
    fullScreenIntentAllowed: false,
    remoteListenChannelEnabled: true,
    postNotif: false,
  }, { now: NOW, childScheduleEnabled: true });

  assert.equal(view.state, "attention");
  assert.equal(view.label, "긴급 알림 전체 화면 확인 필요");
  assert.match(view.detail, /화면 상단 팝업/);
});

test("주변 소리 요청 채널이 꺼지면 부모 건강상태에서 별도 주의로 표시한다", () => {
  const view = deviceNotificationHealthView({
    updatedAt: RECENT_REPORT,
    postPermissionGranted: true,
    notificationsEnabled: true,
    requiredChannelsEnabled: true,
    fullScreenIntentAllowed: true,
    remoteListenChannelEnabled: false,
    postNotif: false,
  }, { now: NOW, childScheduleEnabled: true });

  assert.equal(view.state, "attention");
  assert.equal(view.label, "주변 소리 요청 알림 확인 필요");
  assert.match(view.detail, /요청 알림 채널/);
});

test("필수 채널이 하나라도 꺼진 마지막 보고를 주의 상태로 표시한다", () => {
  const view = deviceNotificationHealthView({
    updatedAt: RECENT_REPORT,
    postPermissionGranted: true,
    notificationsEnabled: true,
    requiredChannelsEnabled: false,
    postNotif: false,
  }, { now: NOW, childScheduleEnabled: true });

  assert.equal(view.state, "attention");
  assert.equal(view.label, "알림 확인 필요");
  assert.match(view.detail, /마지막 보고/);
  assert.match(view.detail, /필수 알림 채널/);
});

test("알림 권한과 앱 전체 알림 차단 원인을 각각 구분한다", () => {
  assert.match(deviceNotificationHealthView({
    postPermissionGranted: false,
    notificationsEnabled: true,
    requiredChannelsEnabled: true,
  }, { now: NOW, childScheduleEnabled: true }).detail, /알림 권한이 꺼져/);

  assert.match(deviceNotificationHealthView({
    postPermissionGranted: true,
    notificationsEnabled: false,
    requiredChannelsEnabled: true,
  }, { now: NOW, childScheduleEnabled: true }).detail, /앱 알림이 꺼져/);
});

test("아이 앱의 일정 알림 설정이 꺼져 있으면 OS 상태와 무관하게 주의로 표시한다", () => {
  const view = deviceNotificationHealthView({
    updatedAt: RECENT_REPORT,
    postPermissionGranted: true,
    notificationsEnabled: true,
    requiredChannelsEnabled: true,
  }, { now: NOW, childScheduleEnabled: false });

  assert.equal(view.state, "attention");
  assert.match(view.detail, /아이 앱의 일정 알림 설정이 꺼져/);
});

test("오래된 보고와 아이 설정 조회 대기는 정상으로 추정하지 않는다", () => {
  const stale = deviceNotificationHealthView({
    updatedAt: STALE_REPORT,
    postPermissionGranted: true,
    notificationsEnabled: true,
    requiredChannelsEnabled: true,
  }, { now: NOW, childScheduleEnabled: true });
  const settingsUnknown = deviceNotificationHealthView({
    updatedAt: RECENT_REPORT,
    postPermissionGranted: true,
    notificationsEnabled: true,
    requiredChannelsEnabled: true,
    fullScreenIntentAllowed: true,
    remoteListenChannelEnabled: true,
  }, { now: NOW, childScheduleEnabled: null });

  assert.equal(stale.state, "unknown");
  assert.equal(stale.shortLabel, "알림 확인 중");
  assert.match(stale.detail, /상태가 오래돼/);
  assert.equal(settingsUnknown.state, "unknown");
  assert.equal(settingsUnknown.shortLabel, "알림 확인 중");
  assert.match(settingsUnknown.detail, /일정 알림 설정을 확인 중/);
});

test("구버전 보고처럼 필수 채널 값이 없으면 정상으로 추정하지 않는다", () => {
  const partial = deviceNotificationHealthView({
    updatedAt: RECENT_REPORT,
    postPermissionGranted: true,
    notificationsEnabled: true,
    postNotif: true,
  }, { now: NOW, childScheduleEnabled: true });
  const absent = deviceNotificationHealthView(null, { now: NOW, childScheduleEnabled: true });

  assert.equal(partial.state, "unknown");
  assert.equal(partial.label, "알림 상태 확인 대기");
  assert.equal(absent.state, "unknown");
});

test("구버전 종합값이 false면 원인은 몰라도 주의 상태를 유지한다", () => {
  const view = deviceNotificationHealthView({ postNotif: false }, {
    now: NOW,
    childScheduleEnabled: true,
  });

  assert.equal(view.state, "attention");
  assert.match(view.detail, /권한 또는 필수 채널/);
});

test("위치 권한·백그라운드 제한·서비스 중단·오프라인을 각각 주의로 표시한다", () => {
  assert.match(deviceLocationHealthView({
    updatedAt: RECENT_REPORT,
    backgroundLocationGranted: false,
    locationServiceRunning: true,
    backgroundRestricted: false,
    networkConnected: true,
  }, NOW).detail, /항상 허용 위치 권한/);

  assert.match(deviceLocationHealthView({
    updatedAt: RECENT_REPORT,
    backgroundLocationGranted: true,
    locationServiceRunning: true,
    backgroundRestricted: true,
    networkConnected: true,
  }, NOW).detail, /백그라운드 사용이 제한/);

  assert.match(deviceLocationHealthView({
    updatedAt: RECENT_REPORT,
    backgroundLocationGranted: true,
    locationServiceRunning: false,
    backgroundRestricted: false,
    networkConnected: true,
  }, NOW).detail, /위치 서비스가 멈춰/);

  assert.match(deviceLocationHealthView({
    updatedAt: RECENT_REPORT,
    backgroundLocationGranted: true,
    locationServiceRunning: true,
    backgroundRestricted: false,
    networkConnected: false,
  }, NOW).detail, /오프라인/);
});

test("위치 전송도 최근 보고의 필수 조건이 모두 true일 때만 정상이다", () => {
  const ready = deviceLocationHealthView({
    updatedAt: RECENT_REPORT,
    backgroundLocationGranted: true,
    locationServiceRunning: true,
    backgroundRestricted: false,
    networkConnected: true,
  }, NOW);
  const stale = deviceLocationHealthView({
    updatedAt: STALE_REPORT,
    backgroundLocationGranted: true,
    locationServiceRunning: true,
    backgroundRestricted: false,
    networkConnected: true,
  }, NOW);

  assert.equal(ready.state, "ready");
  assert.equal(ready.label, "위치 전송 설정 정상");
  assert.equal(ready.shortLabel, "위치 정상");
  assert.equal(stale.state, "unknown");
  assert.equal(stale.shortLabel, "위치 확인 중");
});

test("전체 안전 라벨은 알림·위치·네트워크 중 하나라도 막히면 주의, 미확인이면 확인 중이다", () => {
  assert.equal(deviceOverallSafetyLabel(false, "attention", "ready", true), "주의 필요");
  assert.equal(deviceOverallSafetyLabel(false, "ready", "attention", true), "주의 필요");
  assert.equal(deviceOverallSafetyLabel(false, "ready", "ready", false), "주의 필요");
  assert.equal(deviceOverallSafetyLabel(true, "ready", "ready", true), "주의 필요");
  assert.equal(deviceOverallSafetyLabel(false, "unknown", "ready", true), "확인 중");
  assert.equal(deviceOverallSafetyLabel(false, "ready", "unknown", true), "확인 중");
  assert.equal(deviceOverallSafetyLabel(false, "ready", "ready", true), "양호");
});

test("아이 일정 알림 상태 endpoint와 네이티브 위치 상태 필드를 타입·쿼리에 연결한다", () => {
  const familyApi = readSource("src/lib/api/endpoints/family.ts");
  const notificationsApi = readSource("src/lib/api/endpoints/notifications.ts");
  const notificationsQuery = readSource("src/queries/useNotifications.ts");
  const familyView = readSource("src/transform/familyView.ts");

  for (const field of [
    "updatedAt",
    "postNotif",
    "postPermissionGranted",
    "notificationsEnabled",
    "requiredChannelsEnabled",
    "fullScreenIntentAllowed",
    "remoteListenChannelEnabled",
    "backgroundLocationGranted",
    "locationServiceRunning",
    "backgroundRestricted",
    "locationOk",
  ]) {
    assert.match(familyApi, new RegExp(`${field}\\?`), `${field} 타입 누락`);
  }
  assert.match(notificationsApi, /\/api\/notif-settings\/child-status\?/);
  assert.match(notificationsApi, /child_enabled/);
  assert.match(notificationsQuery, /useChildNotifSettingsStatus/);
  assert.match(notificationsQuery, /qk\.childNotifSettings/);
  assert.match(familyView, /deviceNotificationHealthView\(health,/);
  assert.match(familyView, /deviceLocationHealthView\(health, now\)/);
  assert.match(familyView, /deviceOverallSafetyLabel\(/);
});

test("부모 홈과 안심 리포트가 아이 알림 설정·기기 알림·위치 전송 원인을 직접 표시한다", () => {
  const home = readSource("src/screens/parent/ParentHome.tsx");
  const report = readSource("src/screens/feature/DailySafetyReport.tsx");

  for (const source of [home, report]) {
    assert.match(source, /useChildNotifSettingsStatus/);
  }
  assert.match(home, /deviceStatus\.notification\.label/);
  assert.match(home, /deviceStatus\.notification\.detail/);
  assert.match(home, /deviceStatus\.location\.label/);
  assert.match(home, /deviceStatus\.location\.detail/);
  assert.match(report, /device\.notification\.label/);
  assert.match(report, /device\.notification\.detail/);
  assert.match(report, /device\.location\.label/);
  assert.match(report, /device\.location\.detail/);
});

test("부모 홈 안전 지표는 정상/확인 중을 컴팩트 칩으로, 상세 안내는 조치 필요일 때만 보여준다", () => {
  const home = readSource("src/screens/parent/ParentHome.tsx");
  const homeCss = readSource("src/screens/parent/ParentHome.css");

  assert.match(home, /ph-safety__signals/);
  assert.match(home, /deviceStatus\.notification\.shortLabel/);
  assert.match(home, /deviceStatus\.location\.shortLabel/);
  assert.match(home, /deviceStatus\.notification\.state === "attention" && \(/);
  assert.match(home, /deviceStatus\.location\.state === "attention" && \(/);
  assert.match(homeCss, /\.ph-safety__signal\b/);
  // 정상/확인 중 상태에서 긴 detail 문장이 항상 노출되던 회귀 방지:
  // detail 박스는 attention 조건부 렌더 안에만 존재해야 한다.
  const unconditionalDetailBox = /<div\s+className="ph-safety__notification"\s+data-state=\{deviceStatus/.test(home);
  assert.equal(unconditionalDetailBox, false, "detail 박스가 상태 무관하게 항상 렌더되면 안 됨");
});

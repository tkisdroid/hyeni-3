import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  alertCategory,
  alertRoute,
  arrivalAlertTone,
  isArrivalAlertType,
  isDangerAlert,
  isDangerAlertType,
  mapAlertsToGroups,
} from "../src/transform/notificationsView.ts";
import type { ParentAlert } from "../src/lib/api/endpoints/notifications.ts";
import { webPushDeliveryView } from "../src/transform/notificationDeliveryView.ts";

const readSource = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function alert(alertType: string, severity = "info"): ParentAlert {
  return {
    id: `alert-${alertType}`,
    alert_type: alertType,
    title: alertType,
    message: alertType,
    severity,
    event_id: null,
    child_user_id: "child-1",
    read: false,
    created_at: "2026-07-14T03:00:00.000Z",
  };
}

test("서버 canonical 알림 유형을 한 분류표로 해석한다", () => {
  assert.equal(alertCategory("low_battery"), "safety");
  assert.equal(alertCategory("emergency"), "safety");
  assert.equal(alertCategory("late_arrived"), "location");
  assert.equal(alertCategory("missed_arrival"), "location");

  assert.equal(isArrivalAlertType("late_arrived"), true);
  assert.equal(isArrivalAlertType("missed_arrival"), true);
  assert.equal(arrivalAlertTone("late_arrived"), "pending");
  assert.equal(arrivalAlertTone("missed_arrival"), "pending");

  assert.equal(isDangerAlertType("danger_enter"), true);
  assert.equal(isDangerAlertType("danger_entry"), true);
  assert.equal(isDangerAlertType("emergency"), true);
  assert.equal(isDangerAlertType("sos_followup"), true);
  assert.equal(isDangerAlertType("danger_exit"), false);
  assert.equal(isDangerAlert(alert("not_arrived", "emergency")), false);
  assert.equal(isDangerAlert(alert("missed_arrival", "emergency")), false);
  assert.equal(isDangerAlert(alert("low_battery", "emergency")), false);
});

test("알림 유형별 상세 경로가 도착·위험·일정을 정확히 구분한다", () => {
  assert.equal(alertRoute("late_arrived"), "/arrival-alerts");
  assert.equal(alertRoute("missed_arrival"), "/arrival-alerts");
  assert.equal(alertRoute("danger_enter"), "/danger-alert");
  assert.equal(alertRoute("danger_entry"), "/danger-alert");
  assert.equal(alertRoute("emergency"), "/danger-alert");
  assert.equal(alertRoute("sos_followup"), "/danger-alert");
  assert.equal(alertRoute("danger_exit"), "/parent/location");
  assert.equal(alertRoute("low_battery"), "/parent/location");
});

test("위험구역 이탈은 과거 severity가 emergency여도 긴급으로 다시 표시하지 않는다", () => {
  const [group] = mapAlertsToGroups(
    [alert("danger_exit", "emergency")],
    new Date("2026-07-14T03:01:00.000Z"),
  );
  assert.equal(group?.items[0]?.soft, "var(--mint-soft)");
});

test("PushShell 상세 라우트는 부모·아이·공용 역할 가드 안에 있다", () => {
  const app = readSource("src/app/App.tsx");
  const parentStart = app.indexOf("// 부모 전용 푸시/상세");
  const childStart = app.indexOf("// 아이 전용 푸시/상세");
  const commonStart = app.indexOf("// 인증 역할 공용 푸시/상세");
  const familyStart = app.indexOf("// 부모·아이 공용 상세");
  const skeletonStart = app.indexOf("// 앱레벨 골격 화면");
  assert.ok(parentStart >= 0 && childStart > parentStart && commonStart > childStart);
  assert.ok(familyStart > commonStart && skeletonStart > familyStart);

  const parentBlock = app.slice(parentStart, childStart);
  const childBlock = app.slice(childStart, commonStart);
  assert.match(parentBlock, /element: <RequireRole role="parent" \/>/);
  for (const path of [
    "notifications",
    "notification-settings",
    "arrival-alerts",
    "danger-alert",
    "sos-receive",
    "remote-audio",
    "remote-ring",
    "location-status",
  ]) {
    assert.ok(parentBlock.includes(`path: "${path}"`), `${path} 부모 가드 누락`);
  }

  assert.match(childBlock, /element: <RequireRole role="child" \/>/);
  for (const path of [
    "child/sos",
    "child/ai-friend",
    "child/ai-friend-setup",
    "child/location-status",
    "child/settings",
    "playdate-accept",
  ]) {
    assert.ok(childBlock.includes(`path: "${path}"`), `${path} 아이 가드 누락`);
  }

  const familyBlock = app.slice(familyStart, skeletonStart);
  assert.match(familyBlock, /<RequireAnyRole roles=\{\["parent", "child"\]\}\s*\/>/);
  assert.ok(familyBlock.includes('path: "route"'), "route 부모·아이 공용 가드 누락");
});

test("선생님 탭과 알림장 상세는 teacher 역할 가드를 우회하지 않는다", () => {
  const app = readSource("src/app/App.tsx");
  const teacherTabsStart = app.indexOf("// 선생님 탭 (인증 + role=teacher 가드)");
  const pushStart = app.indexOf("// 푸시/상세(탭바 없음)");
  assert.ok(teacherTabsStart >= 0 && pushStart > teacherTabsStart);

  const teacherTabsBlock = app.slice(teacherTabsStart, pushStart);
  assert.match(teacherTabsBlock, /element: <RequireRole role="teacher" \/>/);
  for (const path of [
    "teacher/home",
    "teacher/students",
    "teacher/timetable",
    "teacher/settings",
  ]) {
    assert.ok(teacherTabsBlock.includes(`path: "${path}"`), `${path} 선생님 가드 누락`);
  }

  const teacherDetailStart = app.indexOf("// 선생님 전용 푸시/상세");
  const commonStart = app.indexOf("// 인증 역할 공용 푸시/상세");
  assert.ok(teacherDetailStart >= 0 && commonStart > teacherDetailStart);

  const teacherDetailBlock = app.slice(teacherDetailStart, commonStart);
  assert.match(teacherDetailBlock, /element: <RequireRole role="teacher" \/>/);
  assert.ok(teacherDetailBlock.includes('path: "teacher/notice"'));
});

test("알림 설정과 권한 화면은 가짜 로컬 방해금지 대신 실제 권한 상태를 사용한다", () => {
  const settings = readSource("src/screens/feature/NotificationSettings.tsx");
  const permDenied = readSource("src/screens/feature/PermDenied.tsx");
  assert.doesNotMatch(settings, /hyeni-dnd-v1|localStorage\.setItem\(DND/);
  assert.match(settings, /소리·진동은 휴대폰이나 브라우저에서 바꿔 주세요\./);
  assert.doesNotMatch(settings, /방해금지/);
  assert.match(settings, /readNotificationDeliveryState\(\)/);
  assert.match(settings, /requestOrOpenPermission\("noti"\)/);
  assert.match(settings, /위험·SOS·미도착은 항상 알려/);
  assert.match(permDenied, /readPermissionState\(kind\)/);
  assert.match(permDenied, /requestOrOpenPermission\(kind\)/);
  assert.match(permDenied, /if \(result\.granted\) navigate\(-1\)/);
  assert.doesNotMatch(permDenied, /visibilityState === "visible"\) navigate\(-1\)/);
});

test("웹 알림은 권한만 허용되고 구독이 없으면 수신 가능으로 표시하지 않는다", () => {
  const unsubscribed = webPushDeliveryView({
    supported: true,
    configured: true,
    configCheckFailed: false,
    permission: "granted",
    subscribed: false,
    accountRegistered: false,
    contextSynchronized: true,
  });
  assert.equal(unsubscribed.ready, false);
  assert.equal(unsubscribed.canSubscribe, true);
  assert.equal(unsubscribed.canUnsubscribe, false);

  const ready = webPushDeliveryView({
    supported: true,
    configured: true,
    configCheckFailed: false,
    permission: "granted",
    subscribed: true,
    accountRegistered: true,
    contextSynchronized: true,
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.canSubscribe, false);
  assert.equal(ready.canRegisterAccount, true);
  assert.equal(ready.canUnsubscribe, true);
});

test("웹 푸시 미지원·VAPID 미설정·권한 차단을 각각 정직하게 구분한다", () => {
  const unsupported = webPushDeliveryView({
    supported: false,
    configured: false,
    configCheckFailed: false,
    permission: "unsupported",
    subscribed: false,
    accountRegistered: null,
    contextSynchronized: null,
  });
  assert.equal(unsupported.reason, "unsupported");
  assert.equal(unsupported.configuredLabel, "확인 안 함");
  assert.equal(webPushDeliveryView({
    supported: true,
    configured: false,
    configCheckFailed: false,
    permission: "default",
    subscribed: false,
    accountRegistered: false,
    contextSynchronized: true,
  }).reason, "not_configured");
  assert.equal(webPushDeliveryView({
    supported: true,
    configured: true,
    configCheckFailed: false,
    permission: "denied",
    subscribed: false,
    accountRegistered: false,
    contextSynchronized: true,
  }).reason, "permission_denied");
});

test("iPhone 일반 Safari 탭의 웹 푸시 미지원은 홈 화면 설치 방법으로 안내한다", () => {
  const view = webPushDeliveryView({
    supported: false,
    configured: false,
    configCheckFailed: false,
    permission: "unsupported",
    subscribed: false,
    accountRegistered: null,
    contextSynchronized: null,
  }, { iosHomeScreenInstallRequired: true });

  assert.equal(view.reason, "unsupported");
  assert.match(view.title, /iPhone 홈 화면 앱/);
  assert.match(view.detail, /Safari 공유 버튼/);
  assert.match(view.detail, /홈 화면에 추가/);
});

test("iPhone 일반 Safari 탭은 기능 감지가 지원으로 보여도 홈 화면 설치를 먼저 안내한다", () => {
  const view = webPushDeliveryView({
    supported: true,
    configured: true,
    configCheckFailed: false,
    permission: "default",
    subscribed: false,
    accountRegistered: false,
    contextSynchronized: true,
  }, { iosHomeScreenInstallRequired: true });

  assert.equal(view.reason, "unsupported");
  assert.equal(view.ready, false);
  assert.equal(view.canSubscribe, false);
  assert.equal(view.canRegisterAccount, false);
  assert.match(view.title, /iPhone 홈 화면 앱/);
  assert.match(view.detail, /홈 화면에 추가/);
});

test("로컬 웹 구독이 있어도 현재 계정 서버 등록이 아니면 수신 가능으로 표시하지 않는다", () => {
  const wrongAccount = webPushDeliveryView({
    supported: true,
    configured: true,
    configCheckFailed: false,
    permission: "granted",
    subscribed: true,
    accountRegistered: false,
    contextSynchronized: true,
  });
  assert.equal(wrongAccount.ready, false);
  assert.equal(wrongAccount.reason, "account_not_registered");
  assert.equal(wrongAccount.canRegisterAccount, true);
  assert.equal(wrongAccount.canUnsubscribe, true);
  assert.match(wrongAccount.detail, /이 계정에는 연결되지 않았어요/);
});

test("VAPID 상태 조회가 실패해도 남은 로컬 웹 구독은 해제할 수 있다", () => {
  const failed = webPushDeliveryView({
    supported: true,
    configured: false,
    configCheckFailed: true,
    permission: "granted",
    subscribed: true,
    accountRegistered: null,
    contextSynchronized: false,
  });
  assert.equal(failed.ready, false);
  assert.equal(failed.reason, "check_failed");
  assert.equal(failed.canUnsubscribe, true);
  assert.match(failed.title, /확인하지 못했어요/);
});

test("웹 푸시 구독과 해제는 자동 effect가 아니라 사용자 버튼에서만 호출한다", () => {
  const settings = readSource("src/screens/feature/NotificationSettings.tsx");
  assert.match(settings, /ensureWebPushSubscription/);
  assert.match(settings, /unsubscribeWebPush/);
  assert.match(settings, /const changeWebPushSubscription = async/);
  assert.doesNotMatch(settings, /useEffect\([\s\S]{0,500}ensureWebPushSubscription/);
});

test("아이 설정의 위치 상태는 네이티브 서비스 실값을 읽는다", () => {
  const childSettings = readSource("src/screens/child/ChildSettings.tsx");
  assert.match(childSettings, /readLocationTrackingStatus/);
  assert.match(childSettings, /위치 보내기가 꺼져 있어/);
  assert.match(childSettings, /위치 상태를 확인하지 못했어/);
  assert.match(childSettings, /위치 상태를 확인하고 있어/);
  assert.doesNotMatch(childSettings, /항상 켜져 있어 \(부모님이 정했어\)/);
});

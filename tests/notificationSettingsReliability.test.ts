import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";

import {
  alertCategory,
  alertRoute,
  arrivalAlertTone,
  isArrivalAlertType,
} from "../src/transform/notificationsView.ts";

const readSource = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("알림 설정 전체 객체 저장은 사용자별 mutation scope로 직렬 실행한다", () => {
  const hook = readSource("src/queries/useNotifications.ts");

  assert.match(
    hook,
    /scope:\s*\{\s*id:\s*`notif-settings:\$\{userId \?\? "anonymous"\}`\s*\}/,
  );
});

test("같은 사용자 scope의 과거 설정 요청이 끝나기 전에는 최신 초안을 전송하지 않는다", async () => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const started: string[] = [];
  const completed: string[] = [];
  let releaseFirst = () => undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const mutationFn = async (value: string) => {
    started.push(value);
    if (value === "과거 초안") await firstGate;
    completed.push(value);
  };
  const build = (value: string) => client.getMutationCache().build<void, Error, string, unknown>(
    client,
    {
      scope: { id: "notif-settings:user-1" },
      mutationFn,
    },
  ).execute(value);

  const first = build("과거 초안");
  const latest = build("최신 초안");
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(started, ["과거 초안"]);
  releaseFirst();
  await Promise.all([first, latest]);
  assert.deepEqual(completed, ["과거 초안", "최신 초안"]);
  client.clear();
});

test("서버가 지원하는 60분 알림을 1시간 전으로 표시한다", () => {
  const endpoint = readSource("src/lib/api/endpoints/notifications.ts");
  const screen = readSource("src/screens/feature/NotificationSettings.tsx");

  assert.match(
    endpoint,
    /NOTIF_MINUTE_OPTIONS:\s*readonly number\[\]\s*=\s*\[60, 30, 15, 10, 5\]/,
  );
  assert.match(screen, /m === 60 \? "1시간 전" : `\$\{m\}분 전`/);
});

test("미등록 장소 출발은 일반 위치의 도착·출발 알림으로 상세 화면에 연결한다", () => {
  assert.equal(alertCategory("unregistered_stay_left"), "location");
  assert.equal(isArrivalAlertType("unregistered_stay_left"), true);
  assert.equal(arrivalAlertTone("unregistered_stay_left"), "pending");
  assert.equal(alertRoute("unregistered_stay_left"), "/arrival-alerts");
});

test("알림 설정 저장은 호출 계정과 세션 nonce를 캡처하고 서버에도 expected_user_id를 보낸다", () => {
  const endpoint = readSource("src/lib/api/endpoints/notifications.ts");
  const hook = readSource("src/queries/useNotifications.ts");

  assert.match(endpoint, /expectedUserId:\s*string/);
  assert.match(endpoint, /expected_user_id:\s*expectedUserId/);
  assert.match(hook, /getApiSessionInstanceId/);
  assert.match(hook, /getApiUser/);
  assert.match(hook, /const expectedUserId = userId/);
  assert.match(hook, /const expectedSessionInstanceId = getApiSessionInstanceId\(\)/);
  assert.match(hook, /getApiUser\(\)\?\.id !== expectedUserId/);
  assert.match(hook, /getApiSessionInstanceId\(\) !== expectedSessionInstanceId/);
  assert.match(hook, /saveNotifSettings\(familyId \?\? null, expectedUserId, settings\)/);
});

test("알림 설정 화면은 사용자 전환 때 이전 초안을 버리고 새 사용자 데이터로 hydrate한다", () => {
  const screen = readSource("src/screens/feature/NotificationSettings.tsx");
  assert.match(screen, /hydratedUserId/);
  assert.match(screen, /setDraft\(DEFAULT_NOTIF_SETTINGS\)/);
  assert.match(screen, /setHydratedUserId\(null\)/);
  assert.match(screen, /\[userId\]/);
  assert.match(screen, /hydratedUserId === userId/);
  assert.doesNotMatch(screen, /const \[hydrated, setHydrated\]/);
});

test("notification_settings realtime은 변경 사용자에 맞는 설정 query만 갱신한다", () => {
  const keys = readSource("src/queries/keys.ts");
  const realtime = readSource("src/queries/useFamilyRealtime.ts");

  assert.match(keys, /notifSettings:\s*\(userId:\s*string\)/);
  assert.match(keys, /childNotifSettings:\s*\(familyId:\s*string,\s*childUserId:\s*string\)/);
  assert.match(realtime, /case "notification_settings"/);
  assert.match(realtime, /rowUserId/);
  assert.match(realtime, /rowUserId === userId/);
  assert.match(realtime, /qk\.notifSettings\(userId\)/);
  assert.match(realtime, /qk\.childNotifSettings\(familyId, rowUserId\)/);
});

test("Android 전체화면 특별 접근은 일반 알림 권한과 분리해 설명 후 사용자 버튼으로만 연다", () => {
  const permissions = readSource("src/lib/native/permissions.ts");
  const screen = readSource("src/screens/feature/NotificationSettings.tsx");

  assert.match(permissions, /export async function openFullScreenIntentSettings/);
  assert.match(permissions, /plugin\.openFullScreenIntentSettings\?\.\(\)/);
  assert.match(screen, /전체 화면이 꺼져 있어 긴급 알림은 heads-up 팝업으로만 표시돼요/);
  assert.match(screen, /잠금화면 전체 표시 설정/);
  assert.match(screen, /onClick=\{openFullScreenSettings\}/);
  assert.doesNotMatch(screen, /useEffect\([\s\S]{0,400}openFullScreenIntentSettings/);
});

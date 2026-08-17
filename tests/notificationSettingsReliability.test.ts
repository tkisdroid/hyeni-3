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
import { qk } from "../src/queries/keys.ts";
import {
  commitNotificationQuietHoursIfSessionCurrent,
  executeNotificationQuietHoursScopedMutation,
  mergeNotifSettingsPreservingQuietHours,
  runNotificationQuietHoursSessionBound,
  type NotificationQuietHoursSessionSnapshot,
  type NotificationQuietHoursSessionState,
} from "../src/queries/notificationQuietHoursRuntime.ts";

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

test("family quiet 상세 query key는 같은 가족의 공동부모와 session별로 캐시를 분리한다", () => {
  const client = new QueryClient();
  const firstParentSession = qk.familyNotificationQuietHours(
    "family-1",
    "parent-1",
    "session-1",
  );
  const secondParentSession = qk.familyNotificationQuietHours(
    "family-1",
    "parent-2",
    "session-2",
  );
  const renewedSession = qk.familyNotificationQuietHours(
    "family-1",
    "parent-1",
    "session-3",
  );

  assert.deepEqual(firstParentSession, [
    "notif-settings",
    "family-quiet-hours",
    "family-1",
    "parent-1",
    "session-1",
  ]);
  assert.notDeepEqual(firstParentSession, secondParentSession);
  assert.notDeepEqual(firstParentSession, renewedSession);
  client.setQueryData(firstParentSession, { marker: "첫 부모" });
  client.setQueryData(secondParentSession, { marker: "공동부모" });
  client.setQueryData(renewedSession, { marker: "새 session" });
  assert.deepEqual(client.getQueryData(firstParentSession), { marker: "첫 부모" });
  assert.deepEqual(client.getQueryData(secondParentSession), { marker: "공동부모" });
  assert.deepEqual(client.getQueryData(renewedSession), { marker: "새 session" });
  client.clear();
});

test("family quiet realtime prefix는 같은 가족의 모든 부모·session cache만 무효화한다", async () => {
  const client = new QueryClient();
  const firstFamilyParent = qk.familyNotificationQuietHours(
    "family-1",
    "parent-1",
    "session-1",
  );
  const firstFamilyCoParent = qk.familyNotificationQuietHours(
    "family-1",
    "parent-2",
    "session-2",
  );
  const otherFamilyParent = qk.familyNotificationQuietHours(
    "family-2",
    "parent-3",
    "session-3",
  );
  client.setQueryData(firstFamilyParent, { marker: "first-parent" });
  client.setQueryData(firstFamilyCoParent, { marker: "co-parent" });
  client.setQueryData(otherFamilyParent, { marker: "other-family" });

  await client.invalidateQueries({
    queryKey: qk.familyNotificationQuietHoursPrefix("family-1"),
  });

  assert.equal(client.getQueryState(firstFamilyParent)?.isInvalidated, true);
  assert.equal(client.getQueryState(firstFamilyCoParent)?.isInvalidated, true);
  assert.equal(client.getQueryState(otherFamilyParent)?.isInvalidated, false);
  client.clear();
});

test("family quiet 응답 대기 중 session이 바뀌면 결과와 cache 반영을 모두 거부한다", async () => {
  const client = new QueryClient();
  const snapshot: NotificationQuietHoursSessionSnapshot = {
    parentUserId: "parent-1",
    familyId: "family-1",
    sessionInstanceId: "session-1",
  };
  let current: NotificationQuietHoursSessionState = {
    status: "authenticated",
    userId: "parent-1",
    familyId: "family-1",
    role: "parent",
    sessionInstanceId: "session-1",
  };
  let releaseResponse = () => undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const staleKey = qk.familyNotificationQuietHours(
    snapshot.familyId,
    snapshot.parentUserId,
    snapshot.sessionInstanceId,
  );
  client.setQueryData(staleKey, { marker: "기존 캐시" });

  const request = client.fetchQuery({
    queryKey: staleKey,
    staleTime: 0,
    queryFn: () => runNotificationQuietHoursSessionBound(
      snapshot,
      () => current,
      async () => {
        await responseGate;
        return { marker: "늦은 응답" };
      },
    ),
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  current = { ...current, sessionInstanceId: "session-2" };
  releaseResponse();

  await assert.rejects(request, /계정 또는 가족이 변경되어/);
  const committed = commitNotificationQuietHoursIfSessionCurrent(
    snapshot,
    () => current,
    () => {
      client.setQueryData(staleKey, { marker: "늦은 응답" });
      client.setQueryData(qk.notifSettings(snapshot.parentUserId), { marker: "새 캐시" });
    },
  );
  assert.equal(committed, false);
  assert.deepEqual(client.getQueryData(staleKey), { marker: "기존 캐시" });
  assert.equal(client.getQueryData(qk.notifSettings(snapshot.parentUserId)), undefined);
  client.clear();
});

test("quiet MutationCache는 같은 target만 직렬화하고 다른 target은 병렬 실행한다", async () => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const started: string[] = [];
  const completed: string[] = [];
  let releaseFirst = () => undefined;
  let releaseOther = () => undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const otherGate = new Promise<void>((resolve) => {
    releaseOther = resolve;
  });
  interface Variables {
    targetUserId: string;
    marker: string;
  }
  const mutationFn = async (variables: Variables) => {
    started.push(variables.marker);
    if (variables.marker === "같은 대상 첫 요청") await firstGate;
    if (variables.marker === "다른 대상 요청") await otherGate;
    completed.push(variables.marker);
    return variables.marker;
  };
  const execute = (variables: Variables) => executeNotificationQuietHoursScopedMutation(
    client,
    "family-1",
    variables,
    mutationFn,
  );

  const first = execute({ targetUserId: "child-1", marker: "같은 대상 첫 요청" });
  const latest = execute({ targetUserId: "child-1", marker: "같은 대상 최신 요청" });
  const other = execute({ targetUserId: "child-2", marker: "다른 대상 요청" });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(started, ["같은 대상 첫 요청", "다른 대상 요청"]);
  releaseOther();
  await other;
  assert.deepEqual(started, ["같은 대상 첫 요청", "다른 대상 요청"]);
  releaseFirst();
  await Promise.all([first, latest]);
  assert.deepEqual(completed, [
    "다른 대상 요청",
    "같은 대상 첫 요청",
    "같은 대상 최신 요청",
  ]);
  client.clear();
});

test("일반 설정과 self quiet 저장 완료 순서가 바뀌어도 최신 quiet cache를 보존한다", () => {
  const client = new QueryClient();
  const key = qk.notifSettings("parent-1");
  const oldQuiet = {
    enabled: false,
    startMinute: 1320,
    endMinute: 420,
    updatedAt: null,
    configured: false,
  };
  const latestQuiet = {
    enabled: true,
    startMinute: 1380,
    endMinute: 360,
    updatedAt: "2026-07-19T18:00:00.000Z",
    configured: true,
  };
  const initial = {
    childEnabled: true,
    parentEnabled: true,
    locationEnabled: true,
    registeredPlaceEnabled: true,
    playdateEnabled: true,
    minutesBefore: [15, 5],
    quietHours: oldQuiet,
  };
  const submittedGeneral = { ...initial, parentEnabled: false };

  client.setQueryData(key, initial);
  client.setQueryData(key, { ...initial, quietHours: latestQuiet });
  client.setQueryData(key, (current) => mergeNotifSettingsPreservingQuietHours(
    current,
    submittedGeneral,
  ));
  assert.deepEqual(client.getQueryData(key), {
    ...submittedGeneral,
    quietHours: latestQuiet,
  });

  client.setQueryData(key, initial);
  client.setQueryData(key, (current) => mergeNotifSettingsPreservingQuietHours(
    current,
    submittedGeneral,
  ));
  client.setQueryData(key, (current: typeof initial | undefined) => (
    current ? { ...current, quietHours: latestQuiet } : current
  ));
  assert.deepEqual(client.getQueryData(key), {
    ...submittedGeneral,
    quietHours: latestQuiet,
  });
  client.clear();
});

test("서버가 지원하는 60분 알림을 한 줄 칩의 짧은 기간으로 표시한다", () => {
  const endpoint = readSource("src/lib/api/endpoints/notifications.ts");
  const screen = readSource("src/screens/feature/NotificationSettings.tsx");
  const css = readSource("src/screens/feature/NotificationSettings.css");

  assert.match(
    endpoint,
    /NOTIF_MINUTE_OPTIONS:\s*readonly number\[\]\s*=\s*\[60, 30, 15, 10, 5\]/,
  );
  assert.match(screen, /notifAdvanceChipLabel/);
  assert.match(screen, /minutes % 60 === 0 \? `\$\{minutes \/ 60\}시간` : `\$\{minutes\}분`/);
  assert.match(screen, /aria-label=\{`\$\{duration\} 전`\}/);
  assert.doesNotMatch(screen, /1시간 전|\$\{m\}분 전/);
  assert.match(css, /\.nst-minutes__row\s*\{[^}]*flex-wrap:\s*nowrap/s);
  assert.match(css, /\.nst-minutes__row \.nst-minute\s*\{[^}]*white-space:\s*nowrap/s);
});

test("미등록 장소 출발은 일반 위치의 도착·출발 알림으로 상세 화면에 연결한다", () => {
  assert.equal(alertCategory("unregistered_stay_left"), "location");
  assert.equal(isArrivalAlertType("unregistered_stay_left"), true);
  // 출발은 정상 이동 소식이라 경고(확인 필요)가 아니라 중립 톤이다(2026-07-30).
  assert.equal(arrivalAlertTone("unregistered_stay_left"), "left");
  assert.equal(arrivalAlertTone("place_left"), "left");
  assert.equal(arrivalAlertTone("not_arrived"), "pending");
  assert.equal(arrivalAlertTone("place_arrived"), "arrived");
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

test("quiet endpoint는 Worker snake_case를 엄격한 camelCase 계약으로 변환한다", () => {
  const endpoint = readSource("src/lib/api/endpoints/notifications.ts");

  assert.match(endpoint, /quietHours:\s*NotificationQuietHours/);
  assert.match(endpoint, /export interface FamilyNotificationQuietHoursRecipient/);
  assert.match(endpoint, /targetUserId:\s*string/);
  assert.match(endpoint, /role:\s*"parent"\s*\|\s*"child"/);
  assert.match(endpoint, /export interface FamilyNotificationQuietHours/);
  assert.match(endpoint, /familyId:\s*string/);
  assert.match(endpoint, /fetchFamilyNotificationQuietHours/);
  assert.match(endpoint, /family_id/);
  assert.match(endpoint, /target_user_id/);
  assert.match(endpoint, /start_minute/);
  assert.match(endpoint, /end_minute/);
  assert.match(endpoint, /updated_at/);
  assert.match(endpoint, /configured/);
  assert.match(endpoint, /typeof[\s\S]{0,120}family_id[\s\S]{0,120}string/);
  assert.match(endpoint, /typeof[\s\S]{0,120}target_user_id[\s\S]{0,120}string/);
  assert.match(endpoint, /typeof[\s\S]{0,120}enabled[\s\S]{0,120}boolean/);
  assert.match(endpoint, /Number\.isInteger\([\s\S]{0,120}start_minute/);
  assert.match(endpoint, /Number\.isInteger\([\s\S]{0,120}end_minute/);
  assert.match(endpoint, /알림 조용한 시간 응답이 올바르지 않아요/);
});

test("quiet PUT은 부모·가족·대상 소유권 필드만 snake_case로 보낸다", () => {
  const endpoint = readSource("src/lib/api/endpoints/notifications.ts");

  assert.match(endpoint, /apiPut/);
  assert.match(endpoint, /"\/api\/notif-settings\/quiet-hours"/);
  assert.match(endpoint, /expected_parent_user_id:\s*expectedParentUserId/);
  assert.match(endpoint, /family_id:\s*familyId/);
  assert.match(endpoint, /target_user_id:\s*targetUserId/);
  assert.match(endpoint, /enabled:\s*quietHours\.enabled/);
  assert.match(endpoint, /start_minute:\s*quietHours\.startMinute/);
  assert.match(endpoint, /end_minute:\s*quietHours\.endMinute/);
});

test("기존 self 알림 설정 POST는 quiet 필드를 절대 포함하지 않는다", () => {
  const endpoint = readSource("src/lib/api/endpoints/notifications.ts");
  const selfSave = endpoint.slice(
    endpoint.indexOf("export async function saveNotifSettings"),
    endpoint.indexOf("export async function saveNotificationQuietHours"),
  );

  assert.ok(selfSave.length > 0);
  assert.doesNotMatch(selfSave, /quiet_hours_(enabled|start_minute|end_minute)/);
});

test("family quiet query는 상세 key를 쓰고 응답 전후 부모 세션을 재검증한다", () => {
  const hook = readSource("src/queries/useNotifications.ts");
  const runtime = readSource("src/queries/notificationQuietHoursRuntime.ts");

  assert.match(hook, /export function useFamilyNotificationQuietHours/);
  assert.match(hook, /role === "parent"/);
  assert.match(hook, /const expectedParentUserId = userId/);
  assert.match(hook, /const expectedFamilyId = familyId/);
  assert.match(hook, /const expectedSessionInstanceId = getApiSessionInstanceId\(\)/);
  assert.match(hook, /deriveAuthState\(\)/);
  assert.match(runtime, /current\.userId === snapshot\.parentUserId/);
  assert.match(runtime, /current\.familyId === snapshot\.familyId/);
  assert.match(runtime, /current\.role === "parent"/);
  assert.match(runtime, /current\.sessionInstanceId === snapshot\.sessionInstanceId/);
  assert.match(
    hook,
    /qk\.familyNotificationQuietHours\(\s*expectedFamilyId \?\? "",\s*expectedParentUserId \?\? "",\s*expectedSessionInstanceId \?\? "",\s*\)/,
  );
  assert.match(
    hook,
    /runNotificationQuietHoursSessionBound\([\s\S]{0,500}fetchFamilyNotificationQuietHours/,
  );
});

test("quiet 저장은 실제 target scope helper와 save 응답 후 세션 재검증을 사용한다", () => {
  const hook = readSource("src/queries/useNotifications.ts");
  const runtime = readSource("src/queries/notificationQuietHoursRuntime.ts");

  assert.match(hook, /export function useSaveNotificationQuietHours/);
  assert.match(runtime, /notif-quiet-hours:\$\{familyId\}:\$\{variables\.targetUserId\}/);
  assert.match(runtime, /scope:\s*\{\s*id:/);
  assert.match(hook, /executeNotificationQuietHoursScopedMutation\(/);
  assert.match(hook, /runNotificationQuietHoursSessionBound\(/);
  assert.match(hook, /expectedParentUserId/);
  assert.match(hook, /expectedFamilyId/);
  assert.match(hook, /expectedSessionInstanceId/);
  assert.match(hook, /saveNotificationQuietHours\(/);
  assert.match(hook, /data\.targetUserId !== scopedVariables\.targetUserId/);
  assert.match(hook, /저장 대상이 달라져/);
});

test("quiet 저장 성공은 정확한 target family cache와 self cache만 불변 갱신한다", () => {
  const hook = readSource("src/queries/useNotifications.ts");

  assert.match(hook, /commitNotificationQuietHoursIfSessionCurrent\(/);
  assert.match(
    hook,
    /qk\.familyNotificationQuietHours\(\s*sessionSnapshot\.familyId,\s*sessionSnapshot\.parentUserId,\s*sessionSnapshot\.sessionInstanceId,\s*\)/,
  );
  assert.match(hook, /recipient\.targetUserId === data\.targetUserId/);
  assert.match(hook, /\{\s*\.\.\.recipient,\s*quietHours:\s*data\.quietHours\s*\}/);
  assert.match(hook, /data\.targetUserId !== sessionSnapshot\.parentUserId/);
  assert.match(hook, /qk\.notifSettings\(sessionSnapshot\.parentUserId\)/);
  assert.match(hook, /\{\s*\.\.\.current,\s*quietHours:\s*data\.quietHours\s*\}/);
  assert.doesNotMatch(hook, /children\[0\]/);
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
  assert.match(keys, /familyNotificationQuietHoursPrefix:\s*\(familyId:\s*string\)/);
  assert.match(realtime, /qk\.familyNotificationQuietHoursPrefix\(familyId\)/);
});

test("Android 전체화면 특별 접근은 일반 알림 권한과 분리해 설명 후 사용자 버튼으로만 연다", () => {
  const permissions = readSource("src/lib/native/permissions.ts");
  const screen = readSource("src/screens/feature/NotificationSettings.tsx");

  assert.match(permissions, /export async function openFullScreenIntentSettings/);
  assert.match(permissions, /plugin\.openFullScreenIntentSettings\?\.\(\)/);
  assert.match(screen, /꺼져 있어 긴급 알림은 위쪽 팝업만 보여요/);
  assert.match(screen, /잠금 화면 설정 열기/);
  assert.match(screen, /onClick=\{openFullScreenSettings\}/);
  assert.doesNotMatch(screen, /useEffect\([\s\S]{0,400}openFullScreenIntentSettings/);
});

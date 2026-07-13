import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bridgePath = resolve(rootDir, "src/lib/native/parentPendingNotifications.ts");

async function loadBridge() {
  assert.equal(
    existsSync(bridgePath),
    true,
    "부모 pending 알림용 native bridge가 아직 없습니다",
  );
  return import(pathToFileURL(bridgePath).href);
}

test("실제 표시되거나 FCM ACK가 확인된 pending 행만 서버 delivered 처리한다", async () => {
  const { pollParentPendingNotifications } = await loadBridge();
  const shown: Array<Record<string, unknown>> = [];
  const delivered: string[][] = [];

  const result = await pollParentPendingNotifications({
    familyId: "family-1",
    userId: "parent-1",
    signal: new AbortController().signal,
    fetchPending: async () => [
      { id: "row-fcm", title: "FCM 완료", body: "이미 표시", data: { pushId: "push-fcm", type: "15min" } },
      { id: "row-show", title: "직접 표시", body: "fallback", data: { pushId: "push-show", type: "parent_alert", urgent: false, severity: "warning" } },
      { id: "row-fail", title: "표시 실패", body: "권한 없음", data: { pushId: "push-fail", type: "15min" } },
    ],
    showPending: async (input: Record<string, unknown>) => {
      shown.push(input);
      if (input.stableId === "push-fcm") return { acknowledged: true, displayed: false };
      if (input.stableId === "push-show") return { acknowledged: true, displayed: true };
      return { acknowledged: false, displayed: false };
    },
    markDelivered: async (ids: string[]) => {
      delivered.push(ids);
    },
  });

  assert.deepEqual(shown.map((row) => row.stableId), ["push-fcm", "push-show", "push-fail"]);
  assert.equal(shown[1]?.urgent, false);
  assert.deepEqual(delivered, [["row-fcm", "row-show"]]);
  assert.deepEqual(result, { fetched: 3, acknowledged: 2 });
});

test("네이티브 전용 명령은 웹·foreground 표시 함수로 보내거나 delivered ACK하지 않는다", async () => {
  const { pollParentPendingNotifications } = await loadBridge();
  const shown: string[] = [];
  const delivered: string[][] = [];

  const result = await pollParentPendingNotifications({
    familyId: "family-1",
    userId: "child-1",
    signal: new AbortController().signal,
    fetchPending: async () => [
      { id: "location", title: "새 알림", body: "", data: { pushId: "request-location", type: "request_location" } },
      { id: "status", title: "새 알림", body: "", data: { pushId: "request-status", type: "request_device_status" } },
      { id: "listen", title: "새 알림", body: "", data: { pushId: "remote-listen", type: "remote_listen" } },
      { id: "listen-stop", title: "새 알림", body: "", data: { pushId: "remote-listen-stop", type: "remote_listen_stop" } },
      { id: "memo", title: "엄마님의 메시지", body: "집에 와", data: { pushId: "memo-1", type: "new_memo" } },
    ],
    showPending: async (input: Record<string, unknown>) => {
      shown.push(String(input.type));
      return { acknowledged: true, displayed: true };
    },
    markDelivered: async (ids: string[]) => { delivered.push(ids); },
  });

  assert.deepEqual(shown, ["new_memo"]);
  assert.deepEqual(delivered, [["memo"]]);
  assert.deepEqual(result, { fetched: 5, acknowledged: 1 });
});

test("role 변경이나 background 전환으로 abort되면 늦은 조회 결과를 표시하지 않는다", async () => {
  const { pollParentPendingNotifications } = await loadBridge();
  const controller = new AbortController();
  let resolveFetch: ((rows: unknown[]) => void) | null = null;
  const shown: unknown[] = [];
  const delivered: string[][] = [];

  const pending = pollParentPendingNotifications({
    familyId: "family-1",
    userId: "parent-1",
    signal: controller.signal,
    fetchPending: () => new Promise((resolveRows) => { resolveFetch = resolveRows; }),
    showPending: async (input: unknown) => {
      shown.push(input);
      return { acknowledged: true, displayed: true };
    },
    markDelivered: async (ids: string[]) => { delivered.push(ids); },
  });

  controller.abort();
  assert.ok(resolveFetch);
  resolveFetch?.([{ id: "late", title: "늦은 알림", body: "표시 금지", data: { pushId: "late-push" } }]);
  await pending;

  assert.deepEqual(shown, []);
  assert.deepEqual(delivered, []);
});

test("foreground에서만 즉시·주기 폴링하고 background와 cleanup에서 timer와 진행 요청을 정리한다", async () => {
  const { startParentPendingForegroundPolling } = await loadBridge();
  let foreground = true;
  let visibilityListener: (() => void) | null = null;
  const intervalCallbacks = new Map<number, () => void>();
  const cleared: number[] = [];
  const signals: AbortSignal[] = [];
  let nextTimerId = 1;

  const cleanup = startParentPendingForegroundPolling(
    async (signal: AbortSignal) => { signals.push(signal); },
    {
      isForeground: () => foreground,
      addVisibilityListener: (listener: () => void) => { visibilityListener = listener; },
      removeVisibilityListener: (listener: () => void) => {
        if (visibilityListener === listener) visibilityListener = null;
      },
      setInterval: (callback: () => void) => {
        const id = nextTimerId++;
        intervalCallbacks.set(id, callback);
        return id;
      },
      clearInterval: (id: number) => {
        cleared.push(id);
        intervalCallbacks.delete(id);
      },
    },
    30_000,
  );

  await Promise.resolve();
  assert.equal(signals.length, 1, "부모 foreground 진입 즉시 1회 조회해야 합니다");
  assert.equal(intervalCallbacks.size, 1);

  foreground = false;
  visibilityListener?.();
  assert.equal(intervalCallbacks.size, 0);
  assert.equal(signals[0]?.aborted, true);

  foreground = true;
  visibilityListener?.();
  await Promise.resolve();
  assert.equal(signals.length, 2, "다시 foreground가 되면 즉시 재조회해야 합니다");
  assert.equal(intervalCallbacks.size, 1);

  cleanup();
  assert.equal(visibilityListener, null);
  assert.equal(intervalCallbacks.size, 0);
  assert.equal(signals[1]?.aborted, true);
  assert.ok(cleared.length >= 2);
});

test("NativeBootstrap과 Android plugin이 부모·아이 foreground 표시형 pending ACK 계약을 실제 연결한다", async () => {
  await loadBridge();
  const bootstrap = readFileSync(resolve(rootDir, "src/app/NativeBootstrap.tsx"), "utf8");
  const plugin = readFileSync(
    resolve(rootDir, "android/app/src/main/java/com/hyeni/calendar/NotificationPlugin.java"),
    "utf8",
  );

  assert.match(bootstrap, /role !== "parent" && role !== "child"/);
  assert.match(bootstrap, /startParentPendingForegroundPolling/);
  assert.match(bootstrap, /pollParentPendingNotifications/);
  assert.match(plugin, /public void showPending\(PluginCall call\)/);
  assert.match(plugin, /PolledNotificationStore\.isAcked\(.*stableId\)/s);
  assert.match(plugin, /PolledNotificationStore\.markAck\(.*stableId\)/s);
  assert.match(plugin, /"acknowledged"/);
  assert.match(plugin, /"displayed"/);
});

test("웹·PWA는 부모와 아이 pending을 foreground 토스트로 회수한 뒤에만 ACK한다", async () => {
  const { presentWebPendingNotification } = await loadBridge();
  const shown: Array<{ text: string; emoji?: string }> = [];
  const result = presentWebPendingNotification(
    {
      stableId: "web-schedule",
      title: "일정 알림",
      body: "태권도 15분 전입니다.",
      type: "15min",
      urgent: false,
      severity: "",
      alertType: "",
    },
    (text: string, emoji?: string) => {
      shown.push({ text, emoji });
      return true;
    },
  );
  assert.deepEqual(result, { displayed: true, acknowledged: true });
  assert.deepEqual(shown, [{ text: "일정 알림 — 태권도 15분 전입니다.", emoji: "🔔" }]);

  const bootstrap = readFileSync(resolve(rootDir, "src/app/NativeBootstrap.tsx"), "utf8");
  assert.match(bootstrap, /fetchDevicePendingNotifications/);
  assert.match(bootstrap, /presentWebPendingNotification/);
  assert.match(bootstrap, /role !== "parent" && role !== "child"/);
});

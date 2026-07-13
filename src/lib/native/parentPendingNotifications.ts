import type { PendingDeviceNotification } from "../api/endpoints/notifications";

export const PARENT_PENDING_POLL_INTERVAL_MS = 30_000;

export interface ParentPendingPresentation {
  stableId: string;
  title: string;
  body: string;
  type: string;
  urgent: boolean;
  severity: string;
  alertType: string;
  route: string;
  [key: string]: unknown;
}

export interface ParentPendingDisplayResult {
  acknowledged?: boolean;
  displayed?: boolean;
}

export type PendingToastAnnouncer = (text: string, emoji?: string) => boolean;

/** 웹·PWA foreground에서 시스템 푸시 실패 pending을 실제 인앱 토스트로 보여준다. */
export function presentWebPendingNotification(
  input: ParentPendingPresentation,
  announce: PendingToastAnnouncer,
): ParentPendingDisplayResult {
  const text = input.body ? `${input.title} — ${input.body}` : input.title;
  const displayed = announce(text, input.urgent ? "🚨" : "🔔");
  return { displayed, acknowledged: displayed };
}

export interface ParentPendingPollArgs {
  familyId: string;
  userId: string;
  signal: AbortSignal;
  fetchPending: (familyId: string, userId: string) => Promise<PendingDeviceNotification[]>;
  showPending: (input: ParentPendingPresentation) => Promise<ParentPendingDisplayResult>;
  markDelivered: (ids: string[]) => Promise<unknown>;
}

function dataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function trueFlag(value: unknown): boolean {
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

const NATIVE_COMMAND_PENDING_TYPES = new Set([
  "request_location",
  "request_device_status",
  "remote_listen",
  "remote_listen_stop",
]);

export function isDisplayPendingType(type: string): boolean {
  return !NATIVE_COMMAND_PENDING_TYPES.has(type.trim().toLowerCase());
}

export function pendingPresentation(notification: PendingDeviceNotification): ParentPendingPresentation {
  const data = dataRecord(notification.data);
  return {
    stableId: firstText(
      data.pushId,
      data.idempotencyKey,
      data.idempotency_key,
      data.requestId,
      notification.id,
    ),
    title: notification.title || "혜니캘린더",
    body: notification.body || "",
    type: firstText(data.type, data.action) || "schedule",
    urgent: trueFlag(data.urgent),
    severity: firstText(data.severity),
    alertType: firstText(data.alertType, data.alert_type),
    route: firstText(data.route),
  };
}

/**
 * 한 번의 부모 pending 조회·표시·ACK 처리. abort 이후 도착한 네트워크 결과는
 * role 변경이나 background 전환 뒤 알림을 띄우지 않는다.
 */
export async function pollParentPendingNotifications({
  familyId,
  userId,
  signal,
  fetchPending,
  showPending,
  markDelivered,
}: ParentPendingPollArgs): Promise<{ fetched: number; acknowledged: number }> {
  if (signal.aborted) return { fetched: 0, acknowledged: 0 };
  const notifications = await fetchPending(familyId, userId);
  if (signal.aborted) return { fetched: notifications.length, acknowledged: 0 };

  const deliveredIds = new Set<string>();
  for (const notification of notifications) {
    if (signal.aborted) break;
    try {
      const presentation = pendingPresentation(notification);
      if (!isDisplayPendingType(presentation.type)) continue;
      const result = await showPending(presentation);
      if (signal.aborted) break;
      if (result.displayed === true || result.acknowledged === true) {
        deliveredIds.add(notification.id);
      }
    } catch (error) {
      console.error("부모 pending 알림 표시 실패:", error);
    }
  }

  const ids = [...deliveredIds];
  if (!signal.aborted && ids.length > 0) {
    await markDelivered(ids);
  }
  return { fetched: notifications.length, acknowledged: signal.aborted ? 0 : ids.length };
}

export interface ParentPendingPollingEnvironment {
  isForeground: () => boolean;
  addVisibilityListener: (listener: () => void) => void;
  removeVisibilityListener: (listener: () => void) => void;
  setInterval: (callback: () => void, intervalMs: number) => unknown;
  clearInterval: (timer: unknown) => void;
}

function browserPollingEnvironment(): ParentPendingPollingEnvironment {
  return {
    isForeground: () => document.visibilityState === "visible",
    addVisibilityListener: (listener) => document.addEventListener("visibilitychange", listener),
    removeVisibilityListener: (listener) => document.removeEventListener("visibilitychange", listener),
    setInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
    clearInterval: (timer) => window.clearInterval(timer as number),
  };
}

/** foreground에서만 즉시 1회 + 저빈도 주기 폴링하고 cleanup 시 진행 요청도 폐기한다. */
export function startParentPendingForegroundPolling(
  poll: (signal: AbortSignal) => Promise<void>,
  environment: ParentPendingPollingEnvironment = browserPollingEnvironment(),
  intervalMs = PARENT_PENDING_POLL_INTERVAL_MS,
): () => void {
  let stopped = false;
  let timer: unknown = null;
  let activeController: AbortController | null = null;
  let activeRunId = 0;

  const stopTimer = () => {
    if (timer == null) return;
    environment.clearInterval(timer);
    timer = null;
  };

  const abortActive = () => {
    activeRunId += 1;
    activeController?.abort();
    activeController = null;
  };

  const run = () => {
    if (stopped || !environment.isForeground() || activeController) return;
    const controller = new AbortController();
    const runId = activeRunId + 1;
    activeRunId = runId;
    activeController = controller;
    void poll(controller.signal)
      .catch((error) => console.error("부모 pending 알림 조회 실패:", error))
      .finally(() => {
        if (activeRunId === runId) activeController = null;
      });
  };

  const syncForeground = () => {
    stopTimer();
    if (stopped || !environment.isForeground()) {
      abortActive();
      return;
    }
    run();
    timer = environment.setInterval(run, intervalMs);
  };

  environment.addVisibilityListener(syncForeground);
  syncForeground();

  return () => {
    if (stopped) return;
    stopped = true;
    stopTimer();
    abortActive();
    environment.removeVisibilityListener(syncForeground);
  };
}

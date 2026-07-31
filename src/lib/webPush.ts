import { apiRequest } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import { getApiSessionInstanceId } from "@/lib/api/session";
import { isNativePlatform } from "@/lib/native/plugins";
import { acquirePushRegistrationPermit } from "@/lib/pushSessionBarrier";
import { shownPushLedgerKey } from "@/transform/webPushShownLedger";

export interface WebPushSessionContext {
  userId: string;
  familyId: string;
  role: "parent" | "child";
}

export interface WebPushState {
  supported: boolean;
  configured: boolean;
  configCheckFailed: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  accountRegistered: boolean | null;
  contextSynchronized: boolean | null;
}

export type WebPushSubscriptionResult =
  | { ok: true; state: WebPushState }
  | {
      ok: false;
      reason:
        | "unsupported"
        | "not_configured"
        | "permission_denied"
        | "registration_unavailable"
        | "context_sync_failed"
        | "status_unavailable"
        | "endpoint_conflict"
        | "unsubscribe_failed";
    };

interface VapidConfig {
  configured: boolean;
  publicKey: string | null;
}

let lastContext: WebPushSessionContext | null = null;
let controllerListenerAttached = false;
let contextSyncGeneration = 0;

const PUSH_CONTEXT_DB = "hyeni-push-context-v1";
const PUSH_CONTEXT_STORE = "session";
const SHOWN_PUSH_IDS_KEY = "shown-push-ids";

function isSupported(): boolean {
  return !isNativePlatform()
    && typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

/**
 * iPhone/iPad의 일반 Safari 탭은 웹 푸시 수신 앱으로 등록할 수 없으므로
 * 홈 화면 웹앱 설치 안내가 필요한지 판정한다. 이미 standalone이면 false다.
 */
export function isIosHomeScreenInstallRequired(): boolean {
  if (
    isNativePlatform()
    || typeof window === "undefined"
    || typeof navigator === "undefined"
  ) {
    return false;
  }
  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  const isIos = /\b(iPhone|iPad|iPod)\b/i.test(iosNavigator.userAgent)
    || (iosNavigator.platform === "MacIntel" && iosNavigator.maxTouchPoints > 1);
  if (!isIos) return false;
  const standalone = iosNavigator.standalone === true
    || window.matchMedia?.("(display-mode: standalone)").matches === true;
  return !standalone;
}

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  const bytes = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  for (let index = 0; index < bytes.length; index += 1) {
    out[index] = bytes.charCodeAt(index);
  }
  return out.buffer;
}

function openPushContextDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PUSH_CONTEXT_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PUSH_CONTEXT_STORE)) {
        request.result.createObjectStore(PUSH_CONTEXT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("push context DB open failed"));
  });
}

export async function wasWebPushDisplayed(
  pushId: string,
  context: Pick<WebPushSessionContext, "familyId" | "userId">,
): Promise<boolean> {
  const ledgerKey = shownPushLedgerKey(context.familyId, context.userId, pushId);
  if (!ledgerKey || typeof indexedDB === "undefined") return false;

  let db: IDBDatabase | null = null;
  try {
    db = await openPushContextDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db?.transaction(PUSH_CONTEXT_STORE, "readonly");
      if (!tx) {
        reject(new Error("push context DB is unavailable"));
        return;
      }
      const request = tx.objectStore(PUSH_CONTEXT_STORE).get(SHOWN_PUSH_IDS_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("shown push ID read failed"));
    });
    return Array.isArray(value)
      && value.some((entry) => typeof entry === "string" && entry.trim() === ledgerKey);
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

async function getRegistration(waitForReady: boolean): Promise<ServiceWorkerRegistration | null> {
  if (!isSupported()) return null;
  const current = await navigator.serviceWorker.getRegistration();
  if (!waitForReady) return current ?? null;
  if (current?.active) return current;
  const ready = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 15_000)),
  ]);
  return ready?.active ? ready : null;
}

function postContext(
  registration: ServiceWorkerRegistration,
  context: WebPushSessionContext | null,
): Promise<boolean> {
  const worker = navigator.serviceWorker.controller
    ?? registration.active
    ?? registration.waiting
    ?? registration.installing;
  if (!worker) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      channel.port1.close();
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), 3_000);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const ack = event.data as { type?: unknown; ok?: unknown } | null;
      finish(ack?.type === "HYENI_PUSH_CONTEXT_ACK" && ack.ok === true);
    };
    channel.port1.start();
    try {
      worker.postMessage({ type: "HYENI_PUSH_CONTEXT", context }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}

function attachControllerListener(): void {
  if (controllerListenerAttached || !isSupported()) return;
  controllerListenerAttached = true;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    void getRegistration(false).then((registration) => {
      if (registration) void postContext(registration, lastContext);
    });
  });
}

export async function syncWebPushSessionContext(
  context: WebPushSessionContext | null,
): Promise<boolean> {
  const generation = ++contextSyncGeneration;
  lastContext = context;
  if (!isSupported()) return false;
  attachControllerListener();
  const registration = await getRegistration(true);
  if (generation !== contextSyncGeneration) return false;
  if (!registration) return false;
  const stored = await postContext(registration, context);
  return generation === contextSyncGeneration && stored;
}

async function loadVapidConfig(signal?: AbortSignal): Promise<VapidConfig> {
  return apiRequest<VapidConfig>("/api/push-subscriptions/vapid-public-key", { signal });
}

async function loadAccountRegistration(
  endpoint: string,
  registrationInstanceId: string,
  signal?: AbortSignal,
): Promise<boolean | null> {
  return apiRequest<{ registered: boolean }>(
    `/api/push-subscriptions/status?endpoint=${encodeURIComponent(endpoint)}`
      + `&registration_instance_id=${encodeURIComponent(registrationInstanceId)}`,
    { signal },
  ).then((result) => result.registered === true, () => null);
}

async function registerWebPushSubscription(
  context: WebPushSessionContext,
  subscription: PushSubscription,
  registrationInstanceId: string,
  signal: AbortSignal,
): Promise<"registered" | "conflict"> {
  try {
    await apiRequest("/api/push-subscriptions", {
      method: "POST",
      body: JSON.stringify({
        family_id: context.familyId,
        endpoint: subscription.endpoint,
        subscription: subscription.toJSON(),
        registration_instance_id: registrationInstanceId,
      }),
      signal,
    });
    return "registered";
  } catch (error) {
    if (isApiError(error) && error.status === 409) return "conflict";
    throw error;
  }
}

export async function getWebPushState(
  context?: WebPushSessionContext | null,
): Promise<WebPushState> {
  if (!isSupported()) {
    return {
      supported: false,
      configured: false,
      configCheckFailed: false,
      permission: "unsupported",
      subscribed: false,
      accountRegistered: null,
      contextSynchronized: null,
    };
  }
  const [registration, configResult] = await Promise.all([
    getRegistration(false),
    loadVapidConfig().then(
      (config) => ({ config, failed: false }),
      () => ({ config: { configured: false, publicKey: null }, failed: true }),
    ),
  ]);
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  const registrationInstanceId = getApiSessionInstanceId()?.trim() ?? "";
  let accountRegistered: boolean | null = subscription ? null : false;
  if (subscription && context && registrationInstanceId) {
    accountRegistered = await loadAccountRegistration(subscription.endpoint, registrationInstanceId);
  } else if (subscription && context) {
    accountRegistered = false;
  }
  const contextSynchronized = context
    ? await syncWebPushSessionContext(context)
    : null;
  return {
    supported: true,
    configured: configResult.config.configured,
    configCheckFailed: configResult.failed,
    permission: Notification.permission,
    subscribed: subscription !== null,
    accountRegistered,
    contextSynchronized,
  };
}

export async function ensureWebPushSubscription(
  context: WebPushSessionContext,
): Promise<WebPushSubscriptionResult> {
  if (!isSupported()) return { ok: false, reason: "unsupported" };

  // iPhone 홈 화면 PWA는 사용자 탭에 직접 이어진 호출에서만 알림 권한을 요청할 수 있다.
  // 네트워크·세션 장벽 await보다 먼저 requestPermission()을 호출해 transient activation을 보존한다.
  const permissionRequest = Notification.permission === "default"
    ? Notification.requestPermission()
    : Promise.resolve(Notification.permission);
  const permission = await permissionRequest;
  if (permission !== "granted") return { ok: false, reason: "permission_denied" };

  const permit = await acquirePushRegistrationPermit();
  let createdSubscription: PushSubscription | null = null;
  try {
    const registrationInstanceId = getApiSessionInstanceId()?.trim() ?? "";
    if (!registrationInstanceId) return { ok: false, reason: "context_sync_failed" };
    const config = await loadVapidConfig(permit.signal)
      .catch(() => ({ configured: false, publicKey: null }));
    if (permit.signal.aborted) return { ok: false, reason: "context_sync_failed" };
    if (!config.configured || !config.publicKey) return { ok: false, reason: "not_configured" };

    const registration = await getRegistration(true);
    if (permit.signal.aborted) return { ok: false, reason: "context_sync_failed" };
    if (!registration) return { ok: false, reason: "registration_unavailable" };
    let subscription = await registration.pushManager.getSubscription();
    if (permit.signal.aborted) return { ok: false, reason: "context_sync_failed" };
    if (subscription) {
      const existingRegistered = await loadAccountRegistration(
        subscription.endpoint,
        registrationInstanceId,
        permit.signal,
      );
      if (permit.signal.aborted) return { ok: false, reason: "context_sync_failed" };
      if (existingRegistered === null) return { ok: false, reason: "status_unavailable" };
      if (existingRegistered === false) {
        const unsubscribed = await subscription.unsubscribe();
        if (!unsubscribed) return { ok: false, reason: "unsubscribe_failed" };
        subscription = null;
      }
    }
    if (permit.signal.aborted) return { ok: false, reason: "context_sync_failed" };
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64Url(config.publicKey),
      });
      createdSubscription = subscription;
    }
    if (permit.signal.aborted) {
      await createdSubscription?.unsubscribe().catch(() => false);
      return { ok: false, reason: "context_sync_failed" };
    }

    let registrationResult = await registerWebPushSubscription(
      context,
      subscription,
      registrationInstanceId,
      permit.signal,
    );
    if (registrationResult === "conflict") {
      // 다른 계정의 과거 endpoint가 남았을 수 있다. 로컬 구독을 정확히 한 번
      // 폐기·재생성한 뒤 다시 등록하고, 두 번째 409는 반복하지 않는다.
      const unsubscribed = await subscription.unsubscribe();
      if (!unsubscribed) return { ok: false, reason: "unsubscribe_failed" };
      if (permit.signal.aborted) return { ok: false, reason: "context_sync_failed" };
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64Url(config.publicKey),
      });
      createdSubscription = subscription;
      registrationResult = await registerWebPushSubscription(
        context,
        subscription,
        registrationInstanceId,
        permit.signal,
      );
      if (registrationResult === "conflict") {
        const cleaned = await subscription.unsubscribe().catch(() => false);
        if (!cleaned) return { ok: false, reason: "unsubscribe_failed" };
        return { ok: false, reason: "endpoint_conflict" };
      }
    }
    if (permit.signal.aborted) return { ok: false, reason: "context_sync_failed" };
    const contextSynchronized = await syncWebPushSessionContext(context);
    if (!contextSynchronized || permit.signal.aborted) {
      return { ok: false, reason: "context_sync_failed" };
    }
    const state = await getWebPushState(context);
    if (permit.signal.aborted) return { ok: false, reason: "context_sync_failed" };
    if (state.accountRegistered !== true) return { ok: false, reason: "status_unavailable" };
    return { ok: true, state };
  } finally {
    permit.release();
  }
}

export async function unsubscribeWebPush(
  options: { signal?: AbortSignal; registrationInstanceId?: string } = {},
): Promise<boolean> {
  if (!isSupported()) return false;
  const registrationInstanceId = options.registrationInstanceId !== undefined
    ? options.registrationInstanceId.trim()
    : (getApiSessionInstanceId()?.trim() ?? "");
  if (!registrationInstanceId) return false;
  const registration = await getRegistration(false);
  if (options.signal?.aborted) return false;
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (options.signal?.aborted) return false;
  if (!subscription) return true;
  try {
    await apiRequest(
      `/api/push-subscriptions?endpoint=${encodeURIComponent(subscription.endpoint)}`
        + `&registration_instance_id=${encodeURIComponent(registrationInstanceId)}`,
      { method: "DELETE", signal: options.signal },
      false,
    );
  } catch {
    return false;
  }
  if (options.signal?.aborted) return false;
  const unsubscribed = await subscription.unsubscribe();
  return unsubscribed === true;
}

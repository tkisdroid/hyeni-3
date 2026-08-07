/// <reference lib="webworker" />

import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { API_BASE } from "./config/env";
import {
  authorizeMemoDisplay,
  isNewMemoPush,
} from "./transform/memoDisplayAuthorization";
import { sanitizeNotificationRoute } from "./transform/notificationRoute";
import { mergeShownPushIds, shownPushLedgerKey } from "./transform/webPushShownLedger";
import { isPushExpired } from "./transform/pushExpiry";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string | null }>;
};

interface PushContext {
  userId: string;
  familyId: string;
  role: "parent" | "child";
}

interface PushPayload {
  title?: unknown;
  body?: unknown;
  icon?: unknown;
  badge?: unknown;
  data?: Record<string, unknown>;
}

const CONTEXT_DB = "hyeni-push-context-v1";
const CONTEXT_STORE = "session";
const CONTEXT_KEY = "current";
const SHOWN_PUSH_IDS_KEY = "shown-push-ids";

const ALLOWED_ROUTES = {
  parent: new Set([
    "/parent/home",
    "/parent/calendar",
    "/parent/location",
    "/parent/memo",
    "/notifications",
    "/arrival-alerts",
    "/danger-alert",
    "/sos-receive",
  ]),
  child: new Set([
    "/child/home",
    "/child/memo",
    "/child/sos",
    "/child/sticker",
    "/child/ai-friend",
  ]),
} as const;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function openContextDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONTEXT_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CONTEXT_STORE)) {
        request.result.createObjectStore(CONTEXT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("push context DB open failed"));
  });
}

async function writePushContext(context: PushContext | null): Promise<void> {
  const db = await openContextDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CONTEXT_STORE, "readwrite");
    const store = tx.objectStore(CONTEXT_STORE);
    if (context) store.put(context, CONTEXT_KEY);
    else store.delete(CONTEXT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("push context write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("push context write aborted"));
  });
  db.close();
}

async function readPushContext(): Promise<PushContext | null> {
  const db = await openContextDb();
  const value = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(CONTEXT_STORE, "readonly");
    const request = tx.objectStore(CONTEXT_STORE).get(CONTEXT_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("push context read failed"));
  });
  db.close();
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PushContext>;
  if (!candidate.userId || !candidate.familyId) return null;
  if (candidate.role !== "parent" && candidate.role !== "child") return null;
  return candidate as PushContext;
}

async function recordShownPushId(pushId: string, context: PushContext): Promise<void> {
  const ledgerKey = shownPushLedgerKey(context.familyId, context.userId, pushId);
  if (!ledgerKey) return;
  const db = await openContextDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CONTEXT_STORE, "readwrite");
      const store = tx.objectStore(CONTEXT_STORE);
      const request = store.get(SHOWN_PUSH_IDS_KEY);
      request.onsuccess = () => {
        store.put(mergeShownPushIds(request.result, ledgerKey), SHOWN_PUSH_IDS_KEY);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("shown push ID write failed"));
      tx.onabort = () => reject(tx.error ?? new Error("shown push ID write aborted"));
    });
  } finally {
    db.close();
  }
}

function messageContext(data: unknown): PushContext | null | undefined {
  if (!data || typeof data !== "object") return undefined;
  const message = data as { type?: unknown; context?: unknown };
  if (message.type !== "HYENI_PUSH_CONTEXT") return undefined;
  if (message.context == null) return null;
  if (typeof message.context !== "object") return undefined;
  const context = message.context as Partial<PushContext>;
  if (!context.userId || !context.familyId) return undefined;
  if (context.role !== "parent" && context.role !== "child") return undefined;
  return context as PushContext;
}

self.addEventListener("message", (event) => {
  if (
    event.data
    && typeof event.data === "object"
    && (event.data as { type?: unknown }).type === "SKIP_WAITING"
  ) {
    event.waitUntil(self.skipWaiting());
    return;
  }
  const context = messageContext(event.data);
  if (context === undefined) return;
  const replyPort = event.ports[0];
  const write = writePushContext(context).then(
    () => replyPort?.postMessage({ type: "HYENI_PUSH_CONTEXT_ACK", ok: true }),
    () => replyPort?.postMessage({ type: "HYENI_PUSH_CONTEXT_ACK", ok: false }),
  );
  event.waitUntil(write);
});

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function routeForRole(rawRoute: unknown, role: PushContext["role"]): string {
  const route = stringValue(rawRoute).replace(/^#/, "");
  if (ALLOWED_ROUTES[role].has(route)) return route;
  return sanitizeNotificationRoute(route, role);
}

function targetMatches(data: Record<string, unknown>, context: PushContext): boolean {
  const familyId = stringValue(data.familyId ?? data.family_id);
  const targetUserId = stringValue(data.targetUserId ?? data.target_user_id);
  const targetRole = stringValue(data.targetRole ?? data.target_role).toLowerCase();
  if (!familyId || familyId !== context.familyId) return false;
  if (!targetUserId || targetUserId !== context.userId) return false;
  if (targetRole && targetRole !== context.role) return false;
  return true;
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload: PushPayload;
    try {
      payload = event.data?.json() as PushPayload;
    } catch {
      return;
    }
    const context = await readPushContext().catch(() => null);
    const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
    if (!context || !targetMatches(data, context)) return;
    if (isPushExpired(data.expiresAt, Date.now())) return;
    if (isNewMemoPush(data)) {
      const displayAllowed = await authorizeMemoDisplay(data.memoDisplayPermit, {
        apiBase: API_BASE,
      });
      if (!displayAllowed) return;
    }

    const route = routeForRole(data.route, context.role);
    const pushId = stringValue(data.pushId) || crypto.randomUUID();
    const title = stringValue(payload.title) || "혜니캘린더";
    const body = stringValue(payload.body);
    const familyId = context.familyId;
    const targetUserId = context.userId;
    const targetRole = context.role;
    await self.registration.showNotification(title, {
      body,
      icon: stringValue(payload.icon) || "./pwa-192x192.png",
      badge: stringValue(payload.badge) || "./pwa-192x192.png",
      tag: pushId,
      data: { pushId, route, familyId, targetUserId, targetRole },
    });
    await recordShownPushId(pushId, context);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const context = await readPushContext().catch(() => null);
    if (!context) return;
    const notificationData = event.notification.data as Record<string, unknown> | undefined;
    // 공유 브라우저에서 로그아웃·다른 계정 로그인 뒤 예전 알림을 눌러도
    // 새 계정 화면을 열지 않는다.
    if (!targetMatches(notificationData ?? {}, context)) return;
    const pushId = stringValue(notificationData?.pushId);
    if (pushId) await recordShownPushId(pushId, context).catch(() => undefined);
    const route = routeForRole(notificationData?.route, context.role);
    const target = new URL("./", self.registration.scope);
    target.hash = `#${route}`;

    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      const windowClient = client as WindowClient;
      if (new URL(windowClient.url).origin !== target.origin) continue;
      await windowClient.navigate(target.href);
      await windowClient.focus();
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});

export {};

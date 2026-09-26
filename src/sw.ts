/// <reference lib="webworker" />
import { formatNotificationCopy } from "../shared/notificationCopy.ts";

import { addPlugins, cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import type { WorkboxPlugin } from "workbox-core/types";
import { API_BASE } from "./config/env";
import { resolvePwaNavigationResponse } from "./transform/pwaNavigationFreshness";
import { isUsableAssetResponse } from "./transform/pwaAssetResponse";
import {
  authorizeMemoDisplay,
  isNewMemoPush,
} from "./transform/memoDisplayAuthorization";
import { sanitizeNotificationRoute } from "./transform/notificationRoute";
import { mergeShownPushIds, shownPushLedgerKey } from "./transform/webPushShownLedger";
import { isPushExpired } from "./transform/pushExpiry";
import { isSupportedLocale, localizedBrandName, type SupportedLocale } from "./i18n/locale";

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
/**
 * 기기 언어. **계정·세션 정보를 담지 않는다** — 지원 locale 코드 문자열 하나뿐이다.
 * 서버가 title 을 보내지 않은 web push 의 브랜드 폴백을 사용자 언어로 표시하기 위해 둔다.
 */
const LOCALE_KEY = "locale";

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

// 앱 문서는 온라인일 때 현재 배포를 먼저 확인한다. 브랜드 도메인이 구형 호스팅에서
// 넘어온 브라우저가 설치 당시 index.html만 계속 받으면 로그인 직후 새 문서가 부팅되지
// 않을 수 있다. 자산 precache보다 먼저 등록해야 탐색 요청을 이 정책이 선점한다.
registerRoute(
  ({ request }) => request.mode === "navigate",
  ({ request }) => resolvePwaNavigationResponse({
    request,
    fetchNetwork: (navigationRequest) => fetch(navigationRequest, { cache: "no-store" }),
    matchOfflineShell: () => matchPrecache("index.html"),
  }),
);

// JS·CSS 이름으로 HTML(Pages SPA 폴백)이 저장·응답되지 않게 한다. 이미 잘못 저장된 항목은
// 없는 것으로 보고 다시 받는다 — precache는 같은 이름을 재설치 때 다시 받지 않기 때문이다.
function usableAsset(request: Request, response: Response): boolean {
  return isUsableAssetResponse(new URL(request.url).pathname, response.status, response.headers.get("content-type"));
}
const assetResponseGuard: WorkboxPlugin = {
  cacheWillUpdate: async ({ request, response }) => (usableAsset(request, response) ? response : null),
  cachedResponseWillBeUsed: async ({ request, cachedResponse }) => (
    cachedResponse && usableAsset(request, cachedResponse) ? cachedResponse : null
  ),
};
addPlugins([assetResponseGuard]);
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// 해시가 붙은 같은 출처 정적 JS만 저장한다. 추가 언어 화면도 한 번 방문한 뒤에는
// 오프라인 재진입할 수 있고, API 응답·계정 데이터는 이 캐시에 들어가지 않는다.
const localeChunkCache = new CacheFirst({
    cacheName: "hyeni-locale-chunks-v1",
    plugins: [assetResponseGuard, new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true })],
});
registerRoute(
  ({ url, request }) => url.origin === self.location.origin
    && request.destination === "script"
    && /^\/assets\/[^/]+-[\w-]+\.js$/.test(url.pathname),
  localeChunkCache,
);

/** 첫 제어권 이전에 로드한 문구도 현재 언어에 한해 오프라인용으로 준비한다. */
const localeWarmups = new Map<SupportedLocale, Promise<void>>();
function warmLocaleCatalogs(locale: SupportedLocale, event: ExtendableEvent): Promise<void> {
  const pending = localeWarmups.get(locale);
  if (pending) return pending;
  const work = (async () => {
    const manifest = await matchPrecache("deferred-locale-chunks.json");
    if (!manifest) return;
    const byLocale = await manifest.json() as Record<string, unknown>;
    const urls = byLocale[locale];
    if (!Array.isArray(urls) || urls.length > 16) return;
    await Promise.allSettled(urls.filter((url): url is string => typeof url === "string"
      && /^assets\/[^/]+-[\w-]+\.js$/.test(url)).map((url) => localeChunkCache.handle({
        event,
        request: new Request(new URL(url, self.location.origin), { credentials: "omit" }),
      })));
  })().catch(() => undefined).finally(() => localeWarmups.delete(locale));
  localeWarmups.set(locale, work);
  return work;
}

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
  event.waitUntil(readServiceWorkerLocale().then((locale) => locale ? warmLocaleCatalogs(locale, event) : undefined).catch(() => undefined));
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

/** 지원 locale 코드만 저장한다. 그 밖의 값은 무시해 저장소를 임의 문자열 통로로 쓰지 못하게 한다. */
async function writeServiceWorkerLocale(locale: SupportedLocale): Promise<void> {
  const db = await openContextDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CONTEXT_STORE, "readwrite");
    tx.objectStore(CONTEXT_STORE).put(locale, LOCALE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("locale write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("locale write aborted"));
  });
  db.close();
}

async function readServiceWorkerLocale(): Promise<SupportedLocale | null> {
  const db = await openContextDb();
  const value = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(CONTEXT_STORE, "readonly");
    const request = tx.objectStore(CONTEXT_STORE).get(LOCALE_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("locale read failed"));
  });
  db.close();
  return typeof value === "string" && isSupportedLocale(value) ? value : null;
}

async function recordShownPushId(pushId: string, context: PushContext): Promise<void> {  const ledgerKey = shownPushLedgerKey(context.familyId, context.userId, pushId);
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
  // 언어 전환 알림. locale 코드 하나만 받고 ack 도 locale 전용으로 되돌린다.
  if (
    event.data
    && typeof event.data === "object"
    && (event.data as { type?: unknown }).type === "HYENI_LOCALE"
  ) {
    const raw = (event.data as { locale?: unknown }).locale;
    if (typeof raw !== "string" || !isSupportedLocale(raw)) return;
    const replyPort = event.ports[0];
      event.waitUntil(writeServiceWorkerLocale(raw).then(
      () => replyPort?.postMessage({ type: "HYENI_LOCALE_ACK", ok: true }),
      () => replyPort?.postMessage({ type: "HYENI_LOCALE_ACK", ok: false }),
      ));
      event.waitUntil(warmLocaleCatalogs(raw, event));
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
    const locale = await readServiceWorkerLocale().catch(() => null) ?? "ko";
    const translated = formatNotificationCopy(data.notificationCopy, locale);
    const title = translated?.title ?? (stringValue(payload.title) || localizedBrandName(locale));
    const body = translated?.body ?? stringValue(payload.body);
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

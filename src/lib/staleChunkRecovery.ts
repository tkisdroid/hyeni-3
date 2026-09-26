/**
 * 배포 뒤 옛 화면 청크 복구(2026-09-26 TK 제보: Safari에서 수학·영단어를 누르면 크래시 화면).
 *
 * 배포하면 청크 파일 이름(해시)이 바뀐다. 이미 열려 있던 문서는 아직 받지 않은 화면을
 * 옛 이름으로 요청하고, Pages는 없는 경로에 index.html(200, text/html)을 돌려주므로
 * 동적 import가 MIME 오류로 실패한다. 이 경우는 새 index.html을 받도록 한 번만 새로고침한다.
 * 짧은 시간 안에 다시 실패하면(오프라인·실제 결함) 반복하지 않고 기존 오류 화면에 맡긴다.
 *
 * 홈 화면 앱은 Service Worker 캐시에 그 HTML이 JS 이름으로 남아 새로고침해도 같은 응답을 받을 수 있다.
 * 새로고침 전에 JS·CSS 이름의 잘못된 캐시 항목만 지워 네트워크에서 다시 받게 한다(오프라인 셸은 유지).
 */
import { isUsableAssetResponse } from "@/transform/pwaAssetResponse";

const RELOAD_AT_KEY = "hy-stale-chunk-reload-at";
export const STALE_CHUNK_RELOAD_COOLDOWN_MS = 60_000;
const CACHE_PURGE_TIMEOUT_MS = 3_000;

const STALE_CHUNK_PATTERNS: readonly RegExp[] = [
  /Failed to fetch dynamically imported module/iu, // Chromium
  /Importing a module script failed/iu, // Safari
  /error loading dynamically imported module/iu, // Firefox
  /is not a valid JavaScript MIME type/iu, // Safari: 없는 청크에 HTML 응답
  /Expected a JavaScript(?:-or-Wasm)? module script/iu, // Chromium: 없는 청크에 HTML 응답
  /Unable to preload CSS/iu, // Vite preload helper
];

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  return message !== "" && STALE_CHUNK_PATTERNS.some((pattern) => pattern.test(message));
}

export interface StaleChunkReloadContext {
  error: unknown;
  online: boolean;
  /** 직전 복구 새로고침 시각. 저장소를 읽지 못하면 undefined — 반복을 막을 수 없으니 하지 않는다. */
  lastReloadAt: number | null | undefined;
  now: number;
}

export function shouldReloadForStaleChunk(context: StaleChunkReloadContext): boolean {
  if (!context.online || context.lastReloadAt === undefined) return false;
  if (!isStaleChunkError(context.error)) return false;
  return context.lastReloadAt === null || context.now - context.lastReloadAt >= STALE_CHUNK_RELOAD_COOLDOWN_MS;
}

function readLastReloadAt(): number | null | undefined {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_AT_KEY);
    const value = raw === null ? null : Number(raw);
    return value === null || Number.isFinite(value) ? value : null;
  } catch {
    return undefined;
  }
}

/** Cache Storage에서 JS·CSS 이름으로 저장된 HTML 등 형식이 맞지 않는 응답만 지운다. */
export async function purgeMismatchedAssetCacheEntries(storage: CacheStorage): Promise<number> {
  let purged = 0;
  for (const name of await storage.keys()) {
    const cache = await storage.open(name);
    for (const request of await cache.keys()) {
      const pathname = new URL(request.url).pathname;
      if (!/\.(?:m?js|css)$/u.test(pathname)) continue;
      const response = await cache.match(request);
      if (response && !isUsableAssetResponse(pathname, response.status, response.headers.get("content-type"))) {
        if (await cache.delete(request)) purged += 1;
      }
    }
  }
  return purged;
}

/** 옛 청크 실패면 새로고침을 시작하고 true. 그 밖에는 아무것도 하지 않고 false. */
export function reloadForStaleChunk(error: unknown): boolean {
  if (typeof window === "undefined") return false;
  const now = Date.now();
  if (!shouldReloadForStaleChunk({ error, online: navigator.onLine !== false, lastReloadAt: readLastReloadAt(), now })) {
    return false;
  }
  try {
    window.sessionStorage.setItem(RELOAD_AT_KEY, String(now));
  } catch {
    return false;
  }
  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  // 캐시 정리가 멈춰도 새로고침은 반드시 한다.
  window.setTimeout(reload, CACHE_PURGE_TIMEOUT_MS);
  const storage = "caches" in window ? window.caches : null;
  void (storage ? purgeMismatchedAssetCacheEntries(storage) : Promise.resolve(0))
    .catch(() => 0)
    .finally(reload);
  return true;
}

/**
 * 상류 API 응답 캐시(도보 경로 · 역지오코딩).
 *
 * 왜 Cache API 를 안 쓰나: Cloudflare 의 `caches.default` 는 **`*.workers.dev` 배포에서 no-op** 이다
 * (put 이 조용히 버려진다). 실제로 넣어 보고 적중률 0 을 확인했다. 커스텀 도메인을 붙이기 전까지는
 * 이미 있는 D1 을 캐시 저장소로 쓴다.
 *
 * 2단 구조:
 *   ① 아이솔레이트 메모리 — 같은 워커 인스턴스가 살아 있는 동안은 0ms
 *   ② D1 테이블 `edge_cache` — 콜드 아이솔레이트/다른 콜로에서도 상류 왕복을 건너뛴다
 *
 * 캐시 대상은 사용자와 무관한 공개 지리정보(좌표→경로/주소)뿐이다. 키에 가족·토큰을 넣지 않는다.
 */

interface MemoEntry {
  payload: unknown;
  expiresAtMs: number;
}

const MEMO_LIMIT = 200;
const memo = new Map<string, MemoEntry>();

function memoSet(key: string, payload: unknown, expiresAtMs: number): void {
  if (memo.size >= MEMO_LIMIT) {
    const oldest = memo.keys().next().value;
    if (oldest) memo.delete(oldest);
  }
  memo.set(key, { payload, expiresAtMs });
}

/** 좌표 → 캐시 키 조각. 5자리(≈1m)로 반올림해 GPS 흔들림마다 키가 갈라지지 않게 한다. */
export function coordKey(point: { lat: number; lng: number }): string {
  return `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
}

export async function cacheGet<T>(db: D1Database, key: string): Promise<T | null> {
  const hit = memo.get(key);
  if (hit) {
    if (hit.expiresAtMs > Date.now()) return hit.payload as T;
    memo.delete(key);
  }
  try {
    const row = await db
      .prepare("SELECT payload, expires_at FROM edge_cache WHERE key = ? LIMIT 1")
      .bind(key)
      .first<{ payload: string; expires_at: string }>();
    if (!row) return null;
    const expiresAtMs = Date.parse(row.expires_at);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null;
    const payload = JSON.parse(row.payload) as T;
    memoSet(key, payload, expiresAtMs);
    return payload;
  } catch {
    return null; // 캐시는 있으면 좋은 것 — 실패해도 상류로 그냥 간다
  }
}

export function cachePut(
  ctx: { waitUntil(promise: Promise<unknown>): void } | undefined,
  db: D1Database,
  key: string,
  payload: unknown,
  ttlSec: number,
): void {
  const expiresAtMs = Date.now() + ttlSec * 1000;
  memoSet(key, payload, expiresAtMs);
  // 응답을 막지 않는다 — 쓰기는 백그라운드로.
  const write = db
    .prepare("INSERT OR REPLACE INTO edge_cache (key, payload, expires_at) VALUES (?, ?, ?)")
    .bind(key, JSON.stringify(payload), new Date(expiresAtMs).toISOString())
    .run()
    .then(() => undefined)
    .catch(() => undefined);
  if (ctx) ctx.waitUntil(write);
  else void write;
}

/** 만료 행 정리(크론에서 호출). 테이블이 무한정 커지지 않게 한다. */
export async function cacheSweep(db: D1Database): Promise<number> {
  try {
    const res = await db
      .prepare("DELETE FROM edge_cache WHERE expires_at <= ?")
      .bind(new Date().toISOString())
      .run();
    return res.meta?.changes ?? 0;
  } catch {
    return 0;
  }
}

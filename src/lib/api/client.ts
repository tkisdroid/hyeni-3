/**
 * Cloudflare Worker API 클라이언트(fetch 래퍼).
 * 모든 백엔드 호출은 Worker 를 경유한다. 세션/토큰 상태는 session.ts 가 관리하고,
 * 여기서는 요청 조립·401 토큰 회전·에러 표면화만 담당한다.
 *
 * 원칙: 컴포넌트는 이 모듈을 직접 쓰지 않는다. lib/api/endpoints/* 가 감싸고,
 *       그 위를 queries/* (TanStack Query) 훅이 감싼다.
 */
import { API_BASE } from "@/config/env";
import { adoptNativeLocationSessionTokens, syncNativeLocationToken } from "@/lib/native/location";
import { ApiError } from "./errors";
import {
  getApiAccessToken,
  getApiRefreshToken,
  setApiTokens,
  setApiUser,
  userFromAccessToken,
  notifyTokens,
  clearApiSession,
  type ApiUser,
} from "./session";

type FetchOptions = RequestInit;

async function doFetch(path: string, opts: FetchOptions = {}): Promise<Response> {
  const accessToken = getApiAccessToken();
  return fetch(API_BASE + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(opts.headers || {}),
    },
  });
}

interface RefreshResponse {
  session?: { access_token?: string; refresh_token?: string; user?: ApiUser };
  user?: ApiUser;
}

// refresh 결과 3-way: ok(회전 성공) / rejected(refresh 토큰 자체가 무효 → 세션 clear) /
// error(5xx·네트워크 등 일시 오류 → 세션 유지, 다음에 재시도). 일시 오류로 로그아웃되지 않게 구분.
type RefreshResult = "ok" | "rejected" | "error";

// refresh 회전 single-flight — 동시 401 다발 시 회전이 병행 실행되면 두 번째가
// 이미 폐기된 old 토큰으로 시도해 rejected → 세션이 지워진다(아이 기기 풀림 사고의 주범).
// 진행 중 Promise 를 공유해 회전은 언제나 1회만 실행되게 한다.
let refreshInFlight: Promise<RefreshResult> | null = null;
function refreshAccess(): Promise<RefreshResult> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefreshAccess().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

// refresh token 으로 access 회전. 성공 시 새 토큰/사용자 적용 후 영속화.
async function doRefreshAccess(): Promise<RefreshResult> {
  await adoptNativeLocationSessionTokens();
  const refreshToken = getApiRefreshToken();
  if (!refreshToken) return "rejected"; // 회전 불가 → 세션 무효
  try {
    const res = await doFetch("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (res.status === 401 || res.status === 403) return "rejected"; // refresh 토큰 만료/철회
    if (!res.ok) return "error"; // 5xx 등 일시 오류 — 세션 유지
    const data = (await res.json()) as RefreshResponse;
    const nextAccess = data.session?.access_token ?? getApiAccessToken();
    const nextRefresh = data.session?.refresh_token ?? refreshToken;
    setApiTokens({ access: nextAccess, refresh: nextRefresh });
    const nextUser = data.session?.user ?? data.user ?? userFromAccessToken(nextAccess);
    setApiUser(nextUser);
    notifyTokens();
    void syncNativeLocationToken();
    return "ok";
  } catch {
    return "error"; // 네트워크 오류 — 일시적, 세션 유지
  }
}

/**
 * 저수준 요청. 401 이면 1회 토큰 회전 후 재시도.
 * @param allowRetry OAuth code 교환·login-password·anonymous 등 단회용 요청은 false.
 */
export async function apiRequest<T = unknown>(
  path: string,
  opts: FetchOptions = {},
  allowRetry = true,
): Promise<T> {
  let res = await doFetch(path, opts);
  if (res.status === 401 && allowRetry) {
    const result = await refreshAccess();
    if (result === "ok") {
      res = await doFetch(path, opts);
      // 회전 후에도 401 → 세션이 무효(철회 등). clear 로 재인증 유도.
      if (res.status === 401) clearApiSession();
    } else if (result === "rejected") {
      // refresh 토큰 자체가 만료/철회/부재 → 세션 clear(notifyTokens 로 AuthProvider 재동기화).
      // 만료 사용자가 authenticated 로 남아 401 도배 홈에 갇히는 것 방지. 가드가 /onboarding 으로.
      clearApiSession();
    }
    // result === "error"(5xx·네트워크 일시 오류) → 세션 유지(로그아웃 안 함). 아래에서 ApiError 표면화 → 재시도 여지.
  }
  if (!res.ok) {
    // Worker 가 보낸 한글 에러 메시지(본문 error/message)를 우선 표면화.
    let detail: string | null = null;
    try {
      const body = (await res.clone().json()) as { error?: string; message?: string };
      detail = body?.error || body?.message || null;
    } catch {
      /* non-json body */
    }
    throw new ApiError(detail || `API ${res.status}`, res.status);
  }
  // 204 No Content(void RPC) — 빈 본문 파싱 없이 null 단락.
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export function apiGet<T = unknown>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
}

export function apiPut<T = unknown>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) });
}

export function apiPatch<T = unknown>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });
}

export function apiDelete<T = unknown>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "DELETE" });
}

// ── child-photos 스토리지(Worker/R2 proxy) ──
// path 세그먼트별 encodeURIComponent(슬래시는 키 구조라 보존).
function encodeChildPhotoKey(path: string): string {
  return String(path || "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

function encodeStorageKey(path: string): string {
  return String(path || "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

/**
 * 자녀 사진 업로드 — 바이너리 본문 + Bearer. apiRequest 는 JSON 전용이라 별도 fetch.
 * 성공 시 서버가 { path } 반환(R2 동일 키 put = upsert).
 */
export async function apiUploadChildPhoto(
  path: string,
  fileOrBlob: Blob,
  contentType?: string,
): Promise<{ path: string }> {
  const accessToken = getApiAccessToken();
  const url = API_BASE + "/api/storage/child-photos/" + encodeChildPhotoKey(path);
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      ...(contentType ? { "Content-Type": contentType } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: fileOrBlob,
  });
  if (!res.ok) {
    let detail: string | null = null;
    try {
      const body = (await res.clone().json()) as { error?: string; message?: string };
      detail = body?.error || body?.message || null;
    } catch {
      /* non-json body */
    }
    throw new ApiError(detail || `Upload ${res.status}`, res.status);
  }
  return (await res.json()) as { path: string };
}

/**
 * 자녀 사진 조회용 proxy URL 합성(서버 왕복 없음).
 * <img src> 는 Authorization 헤더를 못 실으므로 단기 access token 을 쿼리로 싣는다.
 */
export function childPhotoProxyUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const accessToken = getApiAccessToken();
  const q = accessToken ? `?token=${encodeURIComponent(accessToken)}` : "";
  return API_BASE + "/api/storage/child-photos/" + encodeChildPhotoKey(path) + q;
}

function teacherNoticeRelativeKey(path: string): string {
  return String(path || "").replace(/^teacher-notices\//, "");
}

/** 선생님 알림장 파일 업로드 — teacher-notices/{userId}/... R2 키로 저장. */
export async function apiUploadTeacherNoticeFile(
  relativePath: string,
  fileOrBlob: Blob,
  contentType?: string,
): Promise<{ path: string }> {
  const accessToken = getApiAccessToken();
  const url = API_BASE + "/api/storage/teacher-notices/" + encodeStorageKey(teacherNoticeRelativeKey(relativePath));
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      ...(contentType ? { "Content-Type": contentType } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: fileOrBlob,
  });
  if (!res.ok) {
    let detail: string | null = null;
    try {
      const body = (await res.clone().json()) as { error?: string; message?: string };
      detail = body?.error || body?.message || null;
    } catch {
      /* non-json body */
    }
    throw new ApiError(detail || `Upload ${res.status}`, res.status);
  }
  return (await res.json()) as { path: string };
}

/** 선생님 알림장 첨부 조회용 proxy URL. */
export function teacherNoticeFileProxyUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const accessToken = getApiAccessToken();
  const q = accessToken ? `?token=${encodeURIComponent(accessToken)}` : "";
  return API_BASE + "/api/storage/teacher-notices/" + encodeStorageKey(teacherNoticeRelativeKey(path)) + q;
}

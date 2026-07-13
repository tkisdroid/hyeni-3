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
import { getAuthDeviceInstallId } from "@/lib/native/deviceIdentity";
import { isNativePlatform } from "@/lib/native/plugins";
import { ApiError } from "./errors";
import {
  acquirePendingChildPhotoUploadRequest,
  clearPendingChildPhotoUploadRequest,
} from "./storageUploadIdempotency";
import {
  getApiAccessToken,
  getApiRefreshToken,
  getApiSessionInstanceId,
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
  const refreshSessionNonce = getApiSessionInstanceId();
  if (!refreshToken) return "rejected"; // 회전 불가 → 세션 무효
  try {
    // 기기 바인딩 회전 — 스탬핑된 체인은 같은 deviceInstallId 를 제시해야 회전된다.
    const deviceInstallId = await getAuthDeviceInstallId().catch(() => null);
    // 네이티브 bridge가 아직 준비되지 않은 순간 ID 없이 요청하면 device-bound 체인이 401을
    // 반환한다. 이를 세션 철회로 오판해 로그아웃하지 말고 다음 요청에서 다시 시도한다.
    if (isNativePlatform() && !deviceInstallId) return "error";
    const res = await doFetch("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({
        refresh_token: refreshToken,
        ...(deviceInstallId ? { device_install_id: deviceInstallId } : {}),
      }),
    });
    // 요청 중 명시적 로그아웃 또는 다른 계정 로그인이 일어나면, 늦은 응답으로
    // WebView·native 세션을 되살리거나 새 사용자를 덮지 않는다.
    if (getApiSessionInstanceId() !== refreshSessionNonce) return "error";
    if (res.status === 401 || res.status === 403) return "rejected"; // refresh 토큰 만료/철회
    if (!res.ok) return "error"; // 5xx 등 일시 오류 — 세션 유지
    const data = (await res.json()) as RefreshResponse;
    const nextAccess = data.session?.access_token ?? getApiAccessToken();
    const nextRefresh = data.session?.refresh_token ?? refreshToken;
    setApiTokens({ access: nextAccess, refresh: nextRefresh });
    const nextUser = data.session?.user ?? data.user ?? userFromAccessToken(nextAccess);
    setApiUser(nextUser);
    // 이 응답이 서버에서 방금 검증·발급된 정본이다. 먼저 네이티브에 확정해야
    // 동기 구독자가 이전 네이티브 holder를 다시 채택하는 경합이 생기지 않는다.
    await syncNativeLocationToken({ nativeFirst: false, authoritativeServerRefresh: true });
    notifyTokens();
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
      // refresh 자체가 성공했다면 세션은 유효하다. 개별 endpoint의 후속 401까지 전역
      // 로그아웃으로 확대하지 않고 ApiError로 표면화해 해당 요청만 실패시킨다.
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

export type ChildPhotoUploadPurpose = "memo" | "profile" | "placeholder";

export interface ChildPhotoUploadInput {
  familyId: string;
  purpose: ChildPhotoUploadPurpose;
  targetMemberId?: string;
  fileOrBlob: Blob;
  contentType?: string;
}

function validateChildPhotoUploadResponse(
  value: { path?: unknown },
  familyId: string,
): { path: string } {
  const path = typeof value?.path === "string" ? value.path.trim() : "";
  const segments = path.split("/");
  const validFileName = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;
  if (
    segments.length !== 4
    || segments[0] !== familyId
    || segments[1] !== "uploads"
    || !/^[A-Za-z0-9_-]{1,128}$/.test(segments[2] ?? "")
    || !validFileName.test(segments[3] ?? "")
  ) {
    throw new ApiError("invalid_upload_response", 502);
  }
  return { path };
}

/** 자녀 사진 신규 업로드 — 객체 키는 Worker가 만들며 클라이언트는 덮어쓸 키를 지정하지 않는다. */
export async function apiUploadChildPhoto(input: ChildPhotoUploadInput): Promise<{ path: string }> {
  const pending = await acquirePendingChildPhotoUploadRequest(input);
  const upload = async (requestId: string) => apiRequest<{ path: string }>(
    "/api/storage/child-photo-uploads/" + encodeURIComponent(input.familyId),
    {
      method: "POST",
      headers: {
        "Content-Type": input.contentType || input.fileOrBlob.type || "application/octet-stream",
        "X-Hyeni-Upload-Purpose": input.purpose,
        "X-Hyeni-Upload-Request-Id": requestId,
        ...(input.targetMemberId
          ? { "X-Hyeni-Target-Member-Id": input.targetMemberId }
          : {}),
      },
      body: input.fileOrBlob,
    },
  );
  try {
    const response = await upload(pending.requestId);
    const validated = validateChildPhotoUploadResponse(response, input.familyId);
    clearPendingChildPhotoUploadRequest(pending);
    return validated;
  } catch (error) {
    if (error instanceof ApiError && error.message === "storage_upload_request_retired") {
      clearPendingChildPhotoUploadRequest(pending);
    }
    throw error;
  }
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
  return apiRequest<{ path: string }>(
    "/api/storage/teacher-notices/" + encodeStorageKey(teacherNoticeRelativeKey(relativePath)),
    {
    method: "PUT",
    headers: {
      "Content-Type": contentType || fileOrBlob.type || "application/octet-stream",
    },
    body: fileOrBlob,
    },
  );
}

/** 선생님 알림장 첨부 조회용 proxy URL. */
export function teacherNoticeFileProxyUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const accessToken = getApiAccessToken();
  const q = accessToken ? `?token=${encodeURIComponent(accessToken)}` : "";
  return API_BASE + "/api/storage/teacher-notices/" + encodeStorageKey(teacherNoticeRelativeKey(path)) + q;
}

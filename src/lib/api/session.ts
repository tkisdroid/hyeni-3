/**
 * Worker 세션 상태 저장소(메모리 + localStorage 영속화).
 * hyeni-1 client.js 의 세션 관리부를 TS 로 이관.
 *
 * - Supabase 완전 제거 → Worker 가 유일 백엔드. 세션은 여기서만 관리.
 * - access/refresh/user 를 localStorage 'hyeni-api-session-v1' 에 직접 영속화하고
 *   모듈 로드 시 자동 복원한다(reload/앱 재시작에도 로그인 유지).
 * - family_id·role·is_anonymous 는 access token JWT claim 에서 클라가 직접 디코드한다.
 */
import { API_BASE } from "@/config/env";
import { resolveSessionInstanceId } from "@/transform/sessionInstance";
import { mergeApiUserWithTokenUser } from "@/transform/sessionUserMerge";
import { clearPrivateObjectUrlCache } from "./privateObjectUrlCache";

export interface ApiUser {
  id: string;
  is_anonymous?: boolean;
  // 서버 응답(login-password/anonymous/join)은 role·family_id 를 최상위에 둔다.
  role?: string;
  family_id?: string | null;
  // JWT 디코드 경로(userFromAccessToken)는 app_metadata 에 채운다.
  app_metadata?: {
    provider?: string;
    family_id?: string;
    role?: string;
  };
  user_metadata?: {
    role?: string;
    family_id?: string;
    [key: string]: unknown;
  };
}

export interface ApiSession {
  access_token: string;
  refresh_token: string | null;
  token_type: "bearer";
  user: ApiUser | null;
}

export interface TokenPair {
  access?: string | null;
  refresh?: string | null;
}

type PersistedSession = {
  access: string | null;
  refresh: string | null;
  user: ApiUser | null;
  session_instance_id?: string | null;
  login_generation_id?: string | null;
};

export interface ApiSessionApplyOptions {
  /** 비밀번호·회원가입·OAuth처럼 사용자가 다시 인증한 새 로그인/요청 소유권 세대에만 사용한다. */
  renewLoginGeneration?: boolean;
  /** OAuth completion을 세션 적용 전에 stage할 때 미리 만든 세대를 정확히 채택한다. */
  loginGenerationId?: string;
}

type TokensChangedListener = (tokens: { access: string | null; refresh: string | null }) => void;

const SESSION_KEY = "hyeni-api-session-v1";

let accessToken: string | null = null;
let refreshToken: string | null = null;
let currentUser: ApiUser | null = null;
let sessionInstanceId: string | null = null;
let loginGenerationId: string | null = null;
let onTokensChanged: TokensChangedListener | null = null;

function createSessionInstanceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readJsonStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string | null): Record<string, unknown> | null {
  if (!token || typeof token !== "string") return null;
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function tokenSubject(token: string | null | undefined): string | null {
  const sub = decodeJwtPayload(token ?? null)?.sub;
  return typeof sub === "string" && sub.trim() ? sub.trim() : null;
}

/** access token JWT claim → ApiUser. sub 없으면 null(비유효 토큰). */
export function userFromAccessToken(token: string | null): ApiUser | null {
  const payload = decodeJwtPayload(token);
  const sub = payload?.sub;
  if (typeof sub !== "string") return null;
  const provider = typeof payload?.provider === "string" ? payload.provider : undefined;
  const familyId = typeof payload?.family_id === "string" ? payload.family_id : undefined;
  const role = typeof payload?.role === "string" ? payload.role : undefined;
  const isAnonymous = payload?.is_anonymous === true;
  return {
    id: sub,
    is_anonymous: isAnonymous,
    app_metadata: {
      provider: provider ?? (isAnonymous ? "anonymous" : undefined),
      family_id: familyId,
      role,
    },
    user_metadata: {
      role,
      family_id: familyId,
    },
  };
}

export function mergeApiUserWithAccessToken(user: ApiUser | null, token: string | null): ApiUser | null {
  return mergeApiUserWithTokenUser(user, userFromAccessToken(token));
}

function applyPersistedSession(session: PersistedSession | null): void {
  accessToken = session?.access ?? null;
  refreshToken = session?.refresh ?? null;
  currentUser = mergeApiUserWithAccessToken(session?.user ?? null, accessToken);
  sessionInstanceId = resolveSessionInstanceId({
    currentAccessToken: accessToken,
    nextAccessToken: accessToken,
    currentInstanceId: session?.session_instance_id ?? null,
    createInstanceId: createSessionInstanceId,
  });
  loginGenerationId = accessToken
    ? normalizeLoginGenerationId(session?.login_generation_id) ?? createApiLoginGenerationId()
    : null;
}

// access 가 있으면 {access,refresh,user} 저장, 없으면(로그아웃) 키 제거.
export function persistSession(): void {
  try {
    if (accessToken) {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          access: accessToken,
          refresh: refreshToken,
          user: currentUser,
          session_instance_id: sessionInstanceId,
          login_generation_id: loginGenerationId,
        }),
      );
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* localStorage 접근 불가 시 무시 */
  }
}

/**
 * 모듈 로드 시 1회 세션 복원: 저장된 access/refresh/user 를 메모리로 되살린다.
 * (만료된 access 는 첫 요청 401 → client 의 refreshAccess 로 회전한다.)
 */
function restoreSessionFromStorage(): void {
  const persisted = readJsonStorage<PersistedSession>(SESSION_KEY);
  if (persisted?.access) {
    applyPersistedSession(persisted);
    if (
      (!persisted.user && currentUser)
      || !persisted.session_instance_id
      || !persisted.login_generation_id
    ) persistSession();
  }
}

restoreSessionFromStorage();

export function setApiTokens(
  { access, refresh }: TokenPair = {},
  options: ApiSessionApplyOptions = {},
): void {
  const previousSessionInstanceId = sessionInstanceId;
  if (access !== undefined) {
    const currentSubject = tokenSubject(accessToken);
    const nextSubject = tokenSubject(access);
    const requestedGeneration = normalizeLoginGenerationId(options.loginGenerationId);
    if (!access) {
      loginGenerationId = null;
    } else if (requestedGeneration) {
      loginGenerationId = requestedGeneration;
    } else if (
      options.renewLoginGeneration
      || !loginGenerationId
      || !currentSubject
      || currentSubject !== nextSubject
    ) {
      loginGenerationId = createApiLoginGenerationId();
    }
    sessionInstanceId = resolveSessionInstanceId({
      currentAccessToken: accessToken,
      nextAccessToken: access,
      currentInstanceId: options.renewLoginGeneration ? null : sessionInstanceId,
      createInstanceId: createSessionInstanceId,
    });
    accessToken = access;
  }
  if (
    previousSessionInstanceId
    && sessionInstanceId
    && previousSessionInstanceId !== sessionInstanceId
  ) {
    clearPrivateObjectUrlCache();
  }
  if (refresh !== undefined) refreshToken = refresh;
  currentUser = mergeApiUserWithAccessToken(currentUser, accessToken);
  // 회전 직후 프로세스가 죽어도 새 refresh 가 살아남게 즉시 영속화
  // (persist 지연 중 킬 → 옛 refresh 만 남음 → 이미 폐기된 토큰 → 세션 풀림 방지).
  persistSession();
}

export function getApiAccessToken(): string | null {
  return accessToken;
}

/** 로그인 세대는 bearer가 아니지만 collision 없는 process-persistent 식별자여야 한다. */
export function createApiLoginGenerationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return createSessionInstanceId();
}

function normalizeLoginGenerationId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized && normalized.length <= 200 ? normalized : null;
}

/** access JWT의 비밀이 아닌 고유 발급 식별자. OAuth continuation 세션 채택 확인에만 쓴다. */
export function accessTokenJti(token: string | null | undefined): string | null {
  const jti = decodeJwtPayload(token ?? null)?.jti;
  return typeof jti === "string" && jti.trim() ? jti.trim() : null;
}

export function getApiAccessTokenJti(): string | null {
  return accessTokenJti(accessToken);
}

export function getApiRefreshToken(): string | null {
  return refreshToken;
}

export function getApiSessionInstanceId(): string | null {
  return sessionInstanceId;
}

export function getApiLoginGenerationId(): string | null {
  return loginGenerationId;
}

/** 현재 로그인 사용자(서버가 발급한 user 객체). */
export function getApiUser(): ApiUser | null {
  return currentUser;
}

export function setApiUser(user: ApiUser | null): void {
  currentUser = mergeApiUserWithAccessToken(user ?? null, accessToken);
  persistSession();
}

/**
 * 메모리 보관 중인 Worker 세션을 반환(없으면 null).
 * access_token 이 없으면 비로그인.
 */
export function getApiSession(): ApiSession | null {
  if (!currentUser && accessToken) {
    currentUser = mergeApiUserWithAccessToken(currentUser, accessToken);
    if (currentUser) persistSession();
  }
  if (!accessToken) return null;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    user: currentUser,
  };
}

/** 로그아웃 — 메모리 세션/사용자 제거 후 영속화 콜백 알림. */
export function clearApiSession(): void {
  clearPrivateObjectUrlCache();
  accessToken = null;
  refreshToken = null;
  currentUser = null;
  sessionInstanceId = null;
  loginGenerationId = null;
  notifyTokens();
}

/** 토큰 변경 시 호출(앱이 상태 반영/추가 영속화할 수 있게). */
export function setOnApiTokensChanged(fn: TokensChangedListener | null): void {
  onTokensChanged = fn;
}

export function notifyTokens(): void {
  persistSession();
  if (onTokensChanged) onTokensChanged({ access: accessToken, refresh: refreshToken });
}

/**
 * Worker 세션({access_token, refresh_token})을 적용하고 영속화 콜백을 알린다.
 * OAuth(naver 등) 콜백처럼 login-password 를 거치지 않는 로그인 경로용.
 */
export function applyApiSession(
  session: Partial<ApiSession> = {},
  options: ApiSessionApplyOptions = {},
): void {
  setApiTokens({
    access: session.access_token,
    refresh: session.refresh_token,
  }, options);
  notifyTokens();
}

/** 네이티브 플러그인에 넘길 백엔드 base URL = Worker. */
export function getNativeBackendUrl(): string {
  return API_BASE;
}

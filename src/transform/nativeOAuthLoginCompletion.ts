import { isOAuthProvider, type OAuthProvider } from "./oauthProvider";
import type { PendingPairInvite } from "./onboardingDraft";

const STORAGE_KEY = "hyeni-native-oauth-login-completion-v1";
const PENDING_EXCHANGE_STORAGE_KEY = "hyeni-native-oauth-pending-exchange-v1";
const COMPLETION_TTL_MS = 10 * 60 * 1000;
const PENDING_EXCHANGE_TTL_MS = 5 * 60 * 1000;

export const NATIVE_OAUTH_LOGIN_COMPLETED_EVENT = "hyeni:native-oauth-login-completed";

export type OAuthAccountStatus = "created" | "existing" | "linked";

export interface NativeOAuthLoginCompletion {
  version: 1;
  id: string;
  phase: "staged" | "session-bound";
  provider: OAuthProvider;
  accountStatus: OAuthAccountStatus | null;
  expectedUserId: string;
  expectedAccessTokenJti: string;
  /** 신규 클라이언트의 stable 로그인 세대. null은 배포 전 저장값 호환용이다. */
  expectedLoginGenerationId: string | null;
  sessionInstanceId: string | null;
  pairInvite: PendingPairInvite | null;
  completedAtMs: number;
  expiresAtMs: number;
}

export interface NativeOAuthPendingExchange {
  version: 1;
  id: string;
  provider: OAuthProvider;
  createdAtMs: number;
  expiresAtMs: number;
}

let memoryCompletion: NativeOAuthLoginCompletion | null = null;
let memoryPendingExchange: NativeOAuthPendingExchange | null = null;

function browserStores(): Storage[] {
  if (typeof window === "undefined") return [];
  const stores: Storage[] = [];
  for (const name of ["sessionStorage", "localStorage"] as const) {
    try {
      stores.push(window[name]);
    } catch {
      // 저장소 하나가 막혀도 메모리와 다른 저장소로 후속 온보딩을 이어간다.
    }
  }
  return stores;
}

function parsePairInvite(value: unknown): PendingPairInvite | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const invite = value as Partial<PendingPairInvite>;
  const code = typeof invite.code === "string" ? invite.code.trim().toUpperCase() : "";
  if (!/^KID-[A-Z0-9-]{4,96}$/.test(code)) return undefined;
  if (invite.role !== "child" && invite.role !== "parent") return undefined;
  if (typeof invite.roleExplicit !== "boolean") return undefined;
  return { code, role: invite.role, roleExplicit: invite.roleExplicit };
}

function parseCompletion(raw: string | null, nowMs: number): NativeOAuthLoginCompletion | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<NativeOAuthLoginCompletion>;
    if (value.version !== 1) return null;
    if (typeof value.id !== "string" || value.id.length < 8 || value.id.length > 200) return null;
    if (value.phase !== "staged" && value.phase !== "session-bound") return null;
    if (!isOAuthProvider(value.provider)) return null;
    if (
      value.accountStatus !== null
      && value.accountStatus !== "created"
      && value.accountStatus !== "existing"
      && value.accountStatus !== "linked"
    ) return null;
    const expectedUserId = typeof value.expectedUserId === "string" ? value.expectedUserId.trim() : "";
    if (!expectedUserId || expectedUserId.length > 200) return null;
    const expectedAccessTokenJti = typeof value.expectedAccessTokenJti === "string"
      ? value.expectedAccessTokenJti.trim()
      : "";
    if (!expectedAccessTokenJti || expectedAccessTokenJti.length > 200) return null;
    if (
      value.expectedLoginGenerationId !== undefined
      && value.expectedLoginGenerationId !== null
      && typeof value.expectedLoginGenerationId !== "string"
    ) return null;
    const expectedLoginGenerationId = typeof value.expectedLoginGenerationId === "string"
      ? value.expectedLoginGenerationId.trim()
      : null;
    if (
      value.expectedLoginGenerationId !== undefined
      && value.expectedLoginGenerationId !== null
      && !expectedLoginGenerationId
    ) return null;
    if ((expectedLoginGenerationId?.length ?? 0) > 200) return null;
    const sessionInstanceId = typeof value.sessionInstanceId === "string"
      ? value.sessionInstanceId.trim()
      : null;
    if (value.phase === "session-bound" && !sessionInstanceId) return null;
    if (value.phase === "staged" && sessionInstanceId) return null;
    const pairInvite = parsePairInvite(value.pairInvite ?? null);
    if (pairInvite === undefined) return null;
    if (!Number.isFinite(value.completedAtMs) || !Number.isFinite(value.expiresAtMs)) return null;
    // staged는 아직 새 세션 채택이 확인되지 않은 짧은 교환 경계라 만료시킨다.
    // session-bound는 정확한 user+로그인 세대에 이미 묶였으므로, 오프라인이 길어져도
    // 가족 생성·초대 후속 처리가 성공하거나 사용자가 명시적으로 포기할 때까지 보존한다.
    if (value.phase === "staged" && (value.expiresAtMs ?? 0) <= nowMs) return null;
    if ((value.completedAtMs ?? 0) > nowMs + 60_000) return null;
    return {
      version: 1,
      id: value.id,
      phase: value.phase,
      provider: value.provider,
      accountStatus: value.accountStatus,
      expectedUserId,
      expectedAccessTokenJti,
      expectedLoginGenerationId,
      sessionInstanceId,
      pairInvite,
      completedAtMs: Number(value.completedAtMs),
      expiresAtMs: Number(value.expiresAtMs),
    };
  } catch {
    return null;
  }
}

function removeCompletionEverywhere(): void {
  memoryCompletion = null;
  for (const store of browserStores()) {
    try {
      store.removeItem(STORAGE_KEY);
    } catch {
      // 접근 불가 저장소는 무시한다.
    }
  }
}

function writeCompletion(completion: NativeOAuthLoginCompletion): NativeOAuthLoginCompletion {
  const serialized = JSON.stringify(completion);
  memoryCompletion = completion;
  for (const store of browserStores()) {
    try {
      store.setItem(STORAGE_KEY, serialized);
    } catch {
      // 메모리 또는 다른 저장소가 성공하면 현재 실행에서는 계속 처리할 수 있다.
    }
  }
  return completion;
}

function createCompletionId(nowMs: number): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `oauth-${nowMs}-${Math.random().toString(36).slice(2)}`;
  }
}

function parsePendingExchange(raw: string | null, nowMs: number): NativeOAuthPendingExchange | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<NativeOAuthPendingExchange>;
    if (value.version !== 1 || !isOAuthProvider(value.provider)) return null;
    if (
      typeof value.id !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(value.id)
    ) return null;
    if (!Number.isFinite(value.createdAtMs) || !Number.isFinite(value.expiresAtMs)) return null;
    const lifetimeMs = Number(value.expiresAtMs) - Number(value.createdAtMs);
    if (
      (value.createdAtMs ?? 0) > nowMs + 60_000
      || (value.expiresAtMs ?? 0) <= nowMs
      || lifetimeMs <= 0
      || lifetimeMs > PENDING_EXCHANGE_TTL_MS
    ) return null;
    return {
      version: 1,
      id: value.id,
      provider: value.provider,
      createdAtMs: Number(value.createdAtMs),
      expiresAtMs: Number(value.expiresAtMs),
    };
  } catch {
    return null;
  }
}

function removePendingExchange(): void {
  memoryPendingExchange = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PENDING_EXCHANGE_STORAGE_KEY);
  } catch {
    // 메모리 표식은 이미 정리했다.
  }
}

/** callback 처리 직전 복구용 ID만 localStorage에 남긴다. code/state/secret/token은 포함하지 않는다. */
export function stageNativeOAuthPendingExchange(
  provider: OAuthProvider,
  nowMs = Date.now(),
): NativeOAuthPendingExchange {
  const random = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of random) binary += String.fromCharCode(byte);
  const pending: NativeOAuthPendingExchange = {
    version: 1,
    id: btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""),
    provider,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + PENDING_EXCHANGE_TTL_MS,
  };
  if (typeof window === "undefined") throw new Error("oauth_recovery_storage_unavailable");
  const serialized = JSON.stringify(pending);
  try {
    window.localStorage.setItem(PENDING_EXCHANGE_STORAGE_KEY, serialized);
    if (window.localStorage.getItem(PENDING_EXCHANGE_STORAGE_KEY) !== serialized) {
      throw new Error("oauth_recovery_storage_unavailable");
    }
  } catch {
    memoryPendingExchange = null;
    try { window.localStorage.removeItem(PENDING_EXCHANGE_STORAGE_KEY); } catch { /* 접근 불가 */ }
    throw new Error("oauth_recovery_storage_unavailable");
  }
  memoryPendingExchange = pending;
  return pending;
}

export function readNativeOAuthPendingExchange(nowMs = Date.now()): NativeOAuthPendingExchange | null {
  if (memoryPendingExchange) {
    if (memoryPendingExchange.expiresAtMs > nowMs) return memoryPendingExchange;
    removePendingExchange();
    return null;
  }
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PENDING_EXCHANGE_STORAGE_KEY);
  } catch {
    return null;
  }
  const pending = parsePendingExchange(raw, nowMs);
  if (!pending) {
    if (raw) removePendingExchange();
    return null;
  }
  memoryPendingExchange = pending;
  return pending;
}

export function clearNativeOAuthPendingExchange(expectedId?: string): void {
  const current = readNativeOAuthPendingExchange();
  if (expectedId && current?.id !== expectedId) return;
  removePendingExchange();
}

/**
 * code 교환 성공 직후, 새 세션을 적용하기 전에 비민감 continuation을 먼저 남긴다.
 * 토큰·provider code·state는 저장하지 않는다. 세션 적용 뒤 별도 bind해야 소비할 수 있다.
 */
export function stageNativeOAuthLoginCompletion(
  input: {
    provider: OAuthProvider;
    accountStatus?: OAuthAccountStatus | null;
    expectedUserId: string;
    expectedAccessTokenJti: string;
    expectedLoginGenerationId: string;
    pairInvite: PendingPairInvite | null;
  },
  nowMs = Date.now(),
): NativeOAuthLoginCompletion {
  const expectedUserId = input.expectedUserId.trim();
  const expectedAccessTokenJti = input.expectedAccessTokenJti.trim();
  const expectedLoginGenerationId = input.expectedLoginGenerationId.trim();
  if (!expectedUserId) throw new Error("native_oauth_completion_user_missing");
  if (!expectedAccessTokenJti) throw new Error("native_oauth_completion_jti_missing");
  if (!expectedLoginGenerationId) throw new Error("native_oauth_completion_login_generation_missing");
  return writeCompletion({
    version: 1,
    id: createCompletionId(nowMs),
    phase: "staged",
    provider: input.provider,
    accountStatus: input.accountStatus ?? null,
    expectedUserId,
    expectedAccessTokenJti,
    expectedLoginGenerationId,
    sessionInstanceId: null,
    pairInvite: input.pairInvite,
    completedAtMs: nowMs,
    expiresAtMs: nowMs + COMPLETION_TTL_MS,
  });
}

export function readNativeOAuthLoginCompletion(nowMs = Date.now()): NativeOAuthLoginCompletion | null {
  if (memoryCompletion) {
    if (memoryCompletion.phase === "session-bound" || memoryCompletion.expiresAtMs > nowMs) {
      return memoryCompletion;
    }
    removeCompletionEverywhere();
    return null;
  }

  for (const store of browserStores()) {
    let raw: string | null = null;
    try {
      raw = store.getItem(STORAGE_KEY);
    } catch {
      continue;
    }
    if (!raw) continue;
    const parsed = parseCompletion(raw, nowMs);
    if (!parsed) {
      removeCompletionEverywhere();
      return null;
    }
    memoryCompletion = parsed;
    return parsed;
  }
  return null;
}

/** stage한 결과를 실제로 채택된 로그인 세대에 묶는다. 다른 handler의 최신 건은 건드리지 않는다. */
export function bindNativeOAuthLoginCompletion(
  expectedId: string,
  sessionInstanceId: string,
  nowMs = Date.now(),
): NativeOAuthLoginCompletion | null {
  const current = readNativeOAuthLoginCompletion(nowMs);
  const normalizedSessionId = sessionInstanceId.trim();
  if (!current || current.id !== expectedId || !normalizedSessionId) return null;
  return writeCompletion({
    ...current,
    phase: "session-bound",
    sessionInstanceId: normalizedSessionId,
  });
}

/** 현재 user와 로그인 세대가 모두 같은 완료 건만 후속 온보딩에서 소비한다. */
export function readNativeOAuthLoginCompletionForSession(
  userId: string | null | undefined,
  sessionInstanceId: string | null | undefined,
  accessTokenJti: string | null | undefined,
  loginGenerationId: string | null | undefined,
  nowMs = Date.now(),
): NativeOAuthLoginCompletion | null {
  let current = readNativeOAuthLoginCompletion(nowMs);
  const normalizedUserId = userId?.trim() ?? "";
  const normalizedSessionId = sessionInstanceId?.trim() ?? "";
  const normalizedJti = accessTokenJti?.trim() ?? "";
  const normalizedLoginGenerationId = loginGenerationId?.trim() ?? "";
  if (!current || !normalizedUserId) return null;
  if (current.expectedUserId !== normalizedUserId) return null;
  if (current.expectedLoginGenerationId) {
    if (current.expectedLoginGenerationId !== normalizedLoginGenerationId) return null;
  } else {
    // 배포 전 persisted completion은 안정 세대가 없으므로 기존 exact JTI/session 경계를 유지한다.
    if (!normalizedSessionId || !normalizedJti || current.expectedAccessTokenJti !== normalizedJti) return null;
    if (current.phase === "session-bound" && current.sessionInstanceId !== normalizedSessionId) return null;
    if (normalizedLoginGenerationId) {
      // exact legacy 세션을 한 번 확인한 뒤 승격하면 다음 access refresh부터 JTI에 묶이지 않는다.
      current = writeCompletion({
        ...current,
        expectedLoginGenerationId: normalizedLoginGenerationId,
      });
    }
  }
  return current;
}

/** 같은 완료 건을 처리한 handler만 표식을 지운다. 늦은 handler가 새 완료를 지우지 못한다. */
export function clearNativeOAuthLoginCompletion(expectedId?: string): void {
  const current = readNativeOAuthLoginCompletion();
  if (expectedId && current?.id !== expectedId) return;
  removeCompletionEverywhere();
}

/** stage·adopt·bind가 모두 끝난 완료 건만 구독자에게 알린다. */
export function publishNativeOAuthLoginCompletion(expectedId: string): NativeOAuthLoginCompletion | null {
  const completion = readNativeOAuthLoginCompletion();
  if (!completion || completion.id !== expectedId || completion.phase !== "session-bound") return null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(NATIVE_OAUTH_LOGIN_COMPLETED_EVENT, { detail: completion }));
  }
  return completion;
}

export function subscribeNativeOAuthLoginCompletion(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onCompleted = () => listener();
  window.addEventListener(NATIVE_OAUTH_LOGIN_COMPLETED_EVENT, onCompleted);
  return () => window.removeEventListener(NATIVE_OAUTH_LOGIN_COMPLETED_EVENT, onCompleted);
}

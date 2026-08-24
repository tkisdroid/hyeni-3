/**
 * 인증 엔드포인트(순수 API 호출 + 세션 상태 반영).
 * 캐시 무효화(queryClient.clear)·React 상태 반영은 상위(AuthProvider/온보딩)가 담당한다.
 * OAuth(카카오/구글/네이버)·브리지는 Slice 2(온보딩)에서 추가한다.
 */
import {
  isOAuthProvider,
  oauthExchangePath,
  type OAuthProvider,
} from "@/transform/oauthProvider";
import { apiRequest, apiPost } from "../client";
import { ApiError, isApiError, normalizeApiErrorCode } from "../errors";
import { applyApiSession, setApiUser, clearApiSession, notifyTokens, type ApiUser } from "../session";
import { getPlatform, isNativePlatform } from "@/lib/native/plugins";
import { openExternal } from "@/lib/native/browser";
import {
  getAuthDeviceDescriptor,
} from "@/lib/native/deviceIdentity";
import {
  createIdempotentAuthResultAdopter,
  returnAuthResultWithAdoption,
  type AuthResultAdoptionOptions,
} from "@/auth/authResultAdoption";
import {
  normalizeLoginId,
  isValidLoginId,
  normalizePhoneForAuth,
  normalizePhoneForStorage,
  validateParentSignupForm,
  type ParentSignupInput,
} from "@/transform/phone";
import type { OnboardingInterest } from "@/transform/onboardingPreferences";

export interface AuthSession {
  access_token: string;
  refresh_token?: string | null;
  user?: ApiUser;
}

export interface AuthResult {
  user: ApiUser | null;
  session: AuthSession;
  account_status?: "created" | "existing" | "linked";
}

const adoptAuthResultOnce = createIdempotentAuthResultAdopter<AuthResult>({
  applySession: (data) => {
    applyApiSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token ?? null,
    });
  },
  applyUser: (data) => {
    setApiUser(data.user ?? data.session.user ?? null);
  },
  notify: notifyTokens,
});

/** 로그인 응답을 토큰→사용자 순서로 한 번만 채택하고 기존 토큰 구독자에게 알린다. */
export function adoptAuthResult(data: AuthResult): boolean {
  return adoptAuthResultOnce(data);
}

/** 부모 ID+비밀번호 로그인. 단회용이라 allowRetry=false. */
export async function signInWithLoginId(
  input: { loginId: string; password: string },
  options?: AuthResultAdoptionOptions,
): Promise<AuthResult> {
  const loginId = normalizeLoginId(input.loginId);
  if (!isValidLoginId(loginId) || !input.password) {
    throw new ApiError("invalid_credentials", 400);
  }
  // 기기 바인딩 — 이 기기에서 발급된 refresh 체인은 이 기기만 회전할 수 있게 스탬핑한다.
  const device = await getAuthDeviceDescriptor().catch(() => null);
  const data = await apiRequest<AuthResult>(
    "/auth/login-password",
    {
      method: "POST",
      body: JSON.stringify({
        loginId,
        password: input.password,
        ...(device ?? {}),
      }),
    },
    false,
  );
  if (!data?.user || !data?.session?.access_token) {
    throw new ApiError("login_response_invalid", 502);
  }
  return returnAuthResultWithAdoption(data, options, adoptAuthResult);
}

/** 아이(child) 익명 로그인. 매 호출 새 익명 세션. allowRetry=false. */
export async function anonymousLogin(): Promise<AuthResult> {
  const device = await getAuthDeviceDescriptor().catch(() => null);
  const data = await apiRequest<AuthResult>(
    "/auth/anonymous",
    {
      method: "POST",
      body: JSON.stringify(device ?? {}),
    },
    false,
  );
  if (!data?.user) {
    throw new Error("아이 모드 준비에 실패했어. 잠시 후 다시 시도해 줘!");
  }
  adoptAuthResult(data);
  return data;
}

/** 회원가입 ID 중복확인. 사용 가능하면 true. */
export async function checkLoginIdAvailability(loginId: string): Promise<boolean> {
  const normalized = normalizeLoginId(loginId);
  if (!isValidLoginId(normalized)) {
    throw new ApiError("invalid_login_id", 400);
  }
  const data = await apiPost<{ available?: boolean }>("/auth/check-login-id", { loginId: normalized });
  if (typeof data?.available !== "boolean") {
    throw new ApiError("login_id_check_invalid", 502);
  }
  return data.available;
}

export interface PendingSignup {
  phone: string;
  phoneStorage: string;
  password: string;
  profile: {
    user_id: null;
    login_id: string;
    display_name: string;
    phone: string;
    provider: "phone";
    gender: string;
    birthdate: string;
  };
}

/** 전화 가입 OTP 발송. user 생성/해시는 verify 단계에서. password 는 verify 왕복용으로만 반환(메모리). */
export async function requestPhoneSignupCode(input: ParentSignupInput): Promise<PendingSignup> {
  const validation = validateParentSignupForm(input);
  if (!validation.ok || !validation.values) {
    const code = validation.errors.loginId
      ? "invalid_login_id"
      : validation.errors.phone
        ? "invalid_phone"
        : validation.errors.password
          ? "weak_password"
          : "bad_request";
    throw new ApiError(code, 400);
  }
  const { name, loginId, password, gender, birthdate, phoneAuth, phoneStorage } = validation.values;
  const available = await checkLoginIdAvailability(loginId);
  if (!available) throw new ApiError("login_id_taken", 409);

  const sent = await apiPost<{ ok?: boolean }>("/auth/signup/request-otp", { phone: phoneAuth, password, loginId });
  if (sent?.ok !== true) {
    throw new ApiError("signup_response_invalid", 502);
  }
  return {
    phone: phoneAuth,
    phoneStorage,
    password,
    profile: {
      user_id: null,
      login_id: loginId,
      display_name: name,
      phone: phoneAuth,
      provider: "phone",
      gender,
      birthdate,
    },
  };
}

/** 전화 가입 OTP 검증 + user 생성 + 세션 발급을 한 번에. 성공 시 전화 user 세션 전환. */
export async function verifyPhoneSignupCode(input: {
  phone: string;
  token: string;
  profile: PendingSignup["profile"];
  password: string;
  onboardingInterests?: OnboardingInterest[];
}, options?: AuthResultAdoptionOptions): Promise<AuthResult> {
  const phoneAuth = normalizePhoneForAuth(input.phone);
  const token = String(input.token || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(token)) {
    throw new ApiError("invalid_token_format", 400);
  }
  const device = await getAuthDeviceDescriptor().catch(() => null);
  let data: AuthResult;
  try {
    data = await apiPost<AuthResult>("/auth/signup/verify", {
      phone: phoneAuth,
      token,
      password: input.password ?? "",
      loginId: input.profile?.login_id,
      name: input.profile?.display_name,
      gender: input.profile?.gender,
      birthdate: input.profile?.birthdate,
      onboardingInterests: input.onboardingInterests,
      ...(device ?? {}),
    });
  } catch (error) {
    if (!isApiError(error) || error.code !== "signup_created_login_required") throw error;
    // user 생성은 끝났지만 가입 응답용 세션만 실패한 경계다. 같은 메모리의 ID/PW로
    // 새 로그인 세션을 즉시 발급해 사용자를 phone_exists 막다른 길로 보내지 않는다.
    return signInWithLoginId(
      { loginId: input.profile?.login_id ?? "", password: input.password ?? "" },
      options,
    );
  }
  if (!data?.user || !data?.session?.access_token) {
    throw new ApiError("signup_response_invalid", 502);
  }
  return returnAuthResultWithAdoption(data, options, adoptAuthResult);
}

/** 로그아웃 — 서버 활성 설치 잠금 해제 성공 뒤 메모리 세션을 제거한다. */
export async function logout(): Promise<void> {
  const device = await getAuthDeviceDescriptor().catch(() => null);
  await apiPost("/auth/logout", device ?? {});
  clearApiSession();
}

/** 가족/계정 영구 삭제. 성공 시 세션 제거. */
export async function deleteAccount(): Promise<{ ok?: boolean; error?: string }> {
  const data = await apiPost<{ ok?: boolean; error?: string }>("/api/account/delete", {});
  if (data && data.ok === false) {
    throw new ApiError(normalizeApiErrorCode(data.error), 400);
  }
  clearApiSession();
  return data;
}

// ── OAuth(카카오/구글/네이버) — 웹 리다이렉트 + 네이티브 딥링크 복귀 ──────────────
// 웹: 현재 창을 인가 URL 로 이동(origin 복귀). 네이티브(Capacitor): 시스템 브라우저로 열고,
// 복귀는 검증된 HTTPS App Link를 initOAuthDeepLink가 처리한다.
// provider 별 계약 차이는 transform/oauthProvider 주석 참조.
export type { OAuthProvider };

const OAUTH_CONTEXT_KEY = "hyeni-oauth-context-v2";
const LEGACY_OAUTH_KEYS = ["hyeni-oauth-state", "hyeni-oauth-provider", "hyeni-oauth-mode"] as const;

/** 로그인(login) 인지, 이미 로그인한 계정에 소셜을 붙이는 연결(link) 인지. */
export type OAuthFlowMode = "login" | "link";

export interface OAuthStartOptions {
  /** 검증된 인가 URL을 외부 브라우저에 넘기기 직전에 호출한다. */
  onExternalOpen?: () => void;
}

interface OAuthFlowContext {
  provider: OAuthProvider;
  mode: OAuthFlowMode;
  state: string;
  transactionSecret: string;
  expiresAt: string;
}

interface OAuthStartResponse {
  authorizationUrl: unknown;
  state: unknown;
  transactionSecret: unknown;
  expiresAt: unknown;
}

function parseOAuthContext(raw: string | null): OAuthFlowContext | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OAuthFlowContext>;
    if (!isOAuthProvider(value.provider)) return null;
    if (value.mode !== "login" && value.mode !== "link") return null;
    if (typeof value.state !== "string" || value.state.length < 40 || value.state.length > 256) return null;
    if (
      typeof value.transactionSecret !== "string"
      || value.transactionSecret.length < 40
      || value.transactionSecret.length > 256
    ) return null;
    if (typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt))) return null;
    if (Date.parse(value.expiresAt) <= Date.now()) return null;
    return value as OAuthFlowContext;
  } catch {
    return null;
  }
}

function clearOAuthContext(): void {
  for (const store of [window.sessionStorage, window.localStorage]) {
    try {
      store.removeItem(OAUTH_CONTEXT_KEY);
      for (const key of LEGACY_OAUTH_KEYS) store.removeItem(key);
    } catch {
      /* 저장소 접근 불가 */
    }
  }
}

function readOAuthContext(): OAuthFlowContext | null {
  const contexts: OAuthFlowContext[] = [];
  for (const store of [window.sessionStorage, window.localStorage]) {
    try {
      const parsed = parseOAuthContext(store.getItem(OAUTH_CONTEXT_KEY));
      if (parsed) contexts.push(parsed);
    } catch {
      /* 저장소 접근 불가 */
    }
  }
  if (contexts.length === 0) return null;
  const canonical = JSON.stringify(contexts[0]);
  return contexts.every((context) => JSON.stringify(context) === canonical) ? contexts[0] : null;
}

function writeOAuthContext(context: OAuthFlowContext): void {
  const serialized = JSON.stringify(context);
  clearOAuthContext();
  let written = 0;
  for (const store of [window.sessionStorage, window.localStorage]) {
    try {
      store.setItem(OAUTH_CONTEXT_KEY, serialized);
      if (store.getItem(OAUTH_CONTEXT_KEY) !== serialized) throw new Error("oauth_context_write_failed");
      written += 1;
    } catch {
      // Safari 개인정보 보호 설정 등으로 한 저장소만 막혀도 다른 저장소로 안전하게 계속한다.
    }
  }
  if (written === 0) {
    clearOAuthContext();
    throw new Error("oauth_context_write_failed");
  }
}

function takeOAuthContext(): OAuthFlowContext | null {
  const context = readOAuthContext();
  clearOAuthContext();
  return context;
}

/** 복귀한 콜백이 로그인인지 계정 연결인지 — 폐기하지 않고 들여다본다. */
export function peekOAuthFlowMode(): OAuthFlowMode {
  return readOAuthContext()?.mode ?? "login";
}

/**
 * 이 브라우저/앱 저장소에 아직 소비하지 않은 OAuth transaction이 있는지(읽기 전용).
 * 네이티브에서 시작한 transaction의 콜백이 App Link 검증 실패로 브라우저에 떨어진 경우를
 * 판별하는 데 쓴다 — 이때는 로컬 context가 없어 교환이 불가능하므로 네트워크 대신
 * "앱에서 다시 시도" 안내로 끝내야 한다.
 */
export function hasLocalOAuthContext(): boolean {
  return readOAuthContext() !== null;
}

function readOAuthProviderHint(): string | null {
  return readOAuthContext()?.provider ?? null;
}

const AUTHORIZE_ORIGIN: Record<OAuthProvider, string> = {
  kakao: "https://kauth.kakao.com",
  google: "https://accounts.google.com",
  naver: "https://nid.naver.com",
};

function validateAuthorizationUrl(provider: OAuthProvider, value: unknown): string {
  if (typeof value !== "string") throw new ApiError("oauth_start_invalid", 502);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError("oauth_start_invalid", 502);
  }
  if (url.protocol !== "https:" || url.origin !== AUTHORIZE_ORIGIN[provider]) {
    throw new ApiError("oauth_start_invalid", 502);
  }
  return url.toString();
}

function validateOAuthStartResponse(
  response: OAuthStartResponse,
): Pick<OAuthFlowContext, "state" | "transactionSecret" | "expiresAt"> {
  if (
    typeof response.state !== "string"
    || response.state.length < 40
    || response.state.length > 256
    || typeof response.transactionSecret !== "string"
    || response.transactionSecret.length < 40
    || response.transactionSecret.length > 256
    || typeof response.expiresAt !== "string"
  ) {
    throw new ApiError("oauth_start_invalid", 502);
  }
  const expiresAt = Date.parse(response.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new ApiError("invalid_oauth_transaction", 400);
  }
  return {
    state: response.state,
    transactionSecret: response.transactionSecret,
    expiresAt: response.expiresAt,
  };
}

/**
 * OAuth 시작 — Worker /start 를 연다.
 * - 웹: 현재 창을 이동(location.href). 복귀 target = window.location.origin.
 * - 네이티브: 시스템 브라우저로 열고(openExternal), Android는 검증된 HTTPS App Link,
 *   iOS는 transaction secret으로 보호된 전용 URL scheme으로 복귀한다.
 *   복귀는 initOAuthDeepLink 의 appUrlOpen 리스너가 받아 finishOAuthLogin 을 호출한다.
 *
 * 서버가 발급한 state·별도 transaction secret·provider·mode를 두 저장소에 동일하게 기록하고
 * 복귀 시 모두 대조한다. 두 저장소가 어긋나거나 만료되면 교환 전에 거부한다.
 */
export async function startWorkerOAuth(
  provider: OAuthProvider,
  mode: OAuthFlowMode = "login",
  options?: OAuthStartOptions,
): Promise<void> {
  const native = isNativePlatform();
  const oauthClient = native && getPlatform() === "ios" ? "ios" : native ? "native" : "web";
  const startPath = mode === "link"
    ? `/api/auth/oauth/${provider}/link/start`
    : `/api/auth/oauth/${provider}/start`;
  const response = await apiRequest<OAuthStartResponse>(startPath, {
    method: "POST",
    body: JSON.stringify({
      client: oauthClient,
      webOrigin: native ? undefined : window.location.origin,
    }),
  }, false);
  const validated = validateOAuthStartResponse(response);
  const startUrl = validateAuthorizationUrl(provider, response.authorizationUrl);
  try {
    writeOAuthContext({
      provider,
      mode,
      state: validated.state,
      transactionSecret: validated.transactionSecret,
      expiresAt: validated.expiresAt,
    });
  } catch {
    throw new ApiError("oauth_storage_unavailable", 400);
  }

  options?.onExternalOpen?.();
  if (native) {
    try {
      await openExternal(startUrl);
    } catch (error) {
      clearOAuthContext();
      throw error;
    }
  } else {
    window.location.assign(startUrl);
  }
}

/** OAuth 콜백에서 code+state 로 세션 교환. code 는 단회용이라 allowRetry=false. */
export async function finishOAuthLogin(input: {
  provider: OAuthProvider;
  code: string;
  state?: string;
}, options?: AuthResultAdoptionOptions & {
  onboardingInterests?: OnboardingInterest[];
}): Promise<AuthResult> {
  if (!isOAuthProvider(input.provider)) {
    throw new ApiError("unsupported_provider", 400);
  }
  if (!input.code) throw new ApiError("invalid_oauth_transaction", 400);

  const context = takeOAuthContext();
  if (!context
    || context.mode !== "login"
    || context.provider !== input.provider
    || !input.state
    || context.state !== input.state) {
    throw new ApiError("invalid_oauth_transaction", 400);
  }

  const device = await getAuthDeviceDescriptor().catch(() => null);

  const data = await apiRequest<AuthResult>(
    oauthExchangePath(input.provider),
    {
      method: "POST",
      body: JSON.stringify({
        code: input.code,
        state: context.state,
        transactionSecret: context.transactionSecret,
        onboardingInterests: options?.onboardingInterests,
        ...(device ?? {}),
      }),
    },
    false,
  );
  if (!data?.session?.access_token) {
    throw new ApiError("oauth_response_invalid", 502);
  }
  return returnAuthResultWithAdoption(data, options, adoptAuthResult);
}

export interface OAuthLink {
  provider: OAuthProvider;
  /** 같은 provider 에 계정이 여러 개일 수 있어 이 값으로 각 연결을 식별한다. */
  providerId: string;
  email: string;
  createdAt?: string;
}

export interface OAuthLinksResponse {
  links: OAuthLink[];
  /** 비밀번호 로그인이 가능한 계정인가 — 마지막 로그인 수단 판정에 쓴다. */
  hasPasswordLogin: boolean;
}

/** 서버가 계정 연결(POST /oauth/:provider/link)을 지원하는 provider. 네이버는 로그인만 지원한다. */
export const LINKABLE_PROVIDERS: readonly OAuthProvider[] = ["kakao", "google"];

/** 내 계정에 연결된 소셜 로그인 목록(인증 필요). */
export function fetchOAuthLinks(): Promise<OAuthLinksResponse> {
  return apiRequest<OAuthLinksResponse>("/api/auth/oauth/links");
}

/**
 * 소셜 연결 해제. 서버가 마지막 로그인 수단이면 409 last_login_method 로 막는다
 * (해제하면 계정에 다시 못 들어가기 때문).
 */
export function unlinkOAuthAccount(input: {
  provider: OAuthProvider;
  providerId: string;
}): Promise<{ unlinked: boolean; provider: string; providerId: string }> {
  return apiRequest(`/api/auth/oauth/${input.provider}/unlink`, {
    method: "POST",
    body: JSON.stringify({ provider_id: input.providerId }),
  });
}

/**
 * 이미 로그인한 계정에 소셜 로그인을 추가 연결.
 *
 * 왜 필요한가: 전화(ID/PW)로 가입한 계정은 users.email 이 비어 있어, 같은 사람이 소셜로 로그인하면
 * 서버가 "다른 계정"으로 보고 막거나(409) 엉뚱한 계정으로 보낸다. 로그인된 상태에서 명시적으로
 * 연결해 두면 이후 그 소셜 로그인이 항상 이 계정으로 들어온다.
 */
export async function linkOAuthAccount(input: {
  provider: OAuthProvider;
  code: string;
  state?: string;
}): Promise<{ linked: boolean; already: boolean; provider: string; email?: string }> {
  if (!LINKABLE_PROVIDERS.includes(input.provider)) {
    throw new Error("이 소셜 계정은 아직 연결을 지원하지 않아요.");
  }
  if (!input.code) throw new Error("로그인 인증 코드가 없어요. 다시 시도해 주세요!");

  const context = takeOAuthContext();
  if (!context
    || context.mode !== "link"
    || context.provider !== input.provider
    || !input.state
    || context.state !== input.state) {
    throw new ApiError("invalid_oauth_transaction", 400);
  }

  return apiRequest(`/api/auth/oauth/${input.provider}/link`, {
    method: "POST",
    body: JSON.stringify({
      code: input.code,
      state: context.state,
      transactionSecret: context.transactionSecret,
    }),
  });
}

/** 서버가 검증·소비한 OAuth 취소 결과를 로컬 context와 대조하고 한 번만 폐기한다. */
export function finishOAuthCancellation(input: {
  provider: OAuthProvider;
  state: string;
}): OAuthFlowMode {
  const context = takeOAuthContext();
  if (
    !context
    || context.provider !== input.provider
    || !input.state
    || context.state !== input.state
  ) {
    throw new ApiError("invalid_oauth_transaction", 400);
  }
  return context.mode;
}

/** 현재 URL 쿼리에서 OAuth 콜백(code) 감지. provider 는 sessionStorage 에서 복원. */
export function readOAuthCallback(): { provider: OAuthProvider; code: string; state: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state") || "";
  if (!code || !state) return null;
  let provider: unknown = params.get("provider");
  if (!isOAuthProvider(provider)) {
    provider = readOAuthProviderHint();
  }
  if (!isOAuthProvider(provider)) return null;
  return { provider, code, state };
}

/** 현재 웹 URL에서 Worker가 정규화한 사용자 취소 결과를 읽는다. */
export function readOAuthCancellation(): { provider: OAuthProvider; state: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("error") !== "oauth_cancelled" || params.get("code")) return null;
  const state = params.get("state") || "";
  if (!state) return null;
  let provider: unknown = params.get("provider");
  if (!isOAuthProvider(provider)) provider = readOAuthProviderHint();
  if (!isOAuthProvider(provider)) return null;
  return { provider, state };
}

/** 콜백 처리 후 URL 쿼리(?code&state) 제거 — 새로고침 시 재교환 방지. */
export function clearOAuthCallbackUrl(): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const clean = window.location.origin + window.location.pathname + window.location.hash;
  window.history.replaceState({}, "", clean);
}

// 전화 정규화는 온보딩에서도 쓰이므로 재노출.
export { normalizePhoneForStorage };

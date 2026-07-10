/**
 * 인증 엔드포인트(순수 API 호출 + 세션 상태 반영).
 * 캐시 무효화(queryClient.clear)·React 상태 반영은 상위(AuthProvider/온보딩)가 담당한다.
 * OAuth(카카오/구글/네이버)·브리지는 Slice 2(온보딩)에서 추가한다.
 */
import { API_BASE, NAVER_CLIENT_ID } from "@/config/env";
import {
  isOAuthProvider,
  oauthExchangePath,
  usesWorkerStartRedirect,
  type OAuthProvider,
} from "@/transform/oauthProvider";
import { apiRequest, apiPost } from "../client";
import { applyApiSession, setApiUser, clearApiSession, notifyTokens, type ApiUser } from "../session";
import { isNativePlatform } from "@/lib/native/plugins";
import { openExternal } from "@/lib/native/browser";
import { getAuthDeviceInstallId } from "@/lib/native/deviceIdentity";
import {
  normalizeLoginId,
  isValidLoginId,
  normalizePhoneForAuth,
  normalizePhoneForStorage,
  validateParentSignupForm,
  firstSignupValidationError,
  type ParentSignupInput,
} from "@/transform/phone";

export interface AuthSession {
  access_token: string;
  refresh_token?: string | null;
  user?: ApiUser;
}

export interface AuthResult {
  user: ApiUser | null;
  session: AuthSession;
}

// 로그인/가입 성공 응답을 세션 상태에 반영(토큰 + user) 후 리스너 알림.
function adoptSession(data: { user?: ApiUser | null; session?: AuthSession }): void {
  applyApiSession({
    access_token: data.session?.access_token,
    refresh_token: data.session?.refresh_token ?? null,
  });
  setApiUser(data.user ?? data.session?.user ?? null);
  notifyTokens();
}

/** 부모 ID+비밀번호 로그인. 단회용이라 allowRetry=false. */
export async function signInWithLoginId(input: { loginId: string; password: string }): Promise<AuthResult> {
  const loginId = normalizeLoginId(input.loginId);
  if (!isValidLoginId(loginId) || !input.password) {
    throw new Error("ID 또는 비밀번호를 확인해 주세요");
  }
  // 기기 바인딩 — 이 기기에서 발급된 refresh 체인은 이 기기만 회전할 수 있게 스탬핑한다.
  const deviceInstallId = await getAuthDeviceInstallId().catch(() => null);
  const data = await apiRequest<AuthResult>(
    "/auth/login-password",
    {
      method: "POST",
      body: JSON.stringify({
        loginId,
        password: input.password,
        ...(deviceInstallId ? { device_install_id: deviceInstallId } : {}),
      }),
    },
    false,
  );
  adoptSession(data);
  return data;
}

/** 아이(child) 익명 로그인. 매 호출 새 익명 세션. allowRetry=false. */
export async function anonymousLogin(): Promise<AuthResult> {
  const deviceInstallId = await getAuthDeviceInstallId().catch(() => null);
  const data = await apiRequest<AuthResult>(
    "/auth/anonymous",
    {
      method: "POST",
      body: JSON.stringify(deviceInstallId ? { device_install_id: deviceInstallId } : {}),
    },
    false,
  );
  if (!data?.user) {
    throw new Error("아이 모드 준비에 실패했어. 잠시 후 다시 시도해줘!");
  }
  adoptSession(data);
  return data;
}

/** 회원가입 ID 중복확인. 사용 가능하면 true. */
export async function checkLoginIdAvailability(loginId: string): Promise<boolean> {
  const normalized = normalizeLoginId(loginId);
  if (!isValidLoginId(normalized)) {
    throw new Error("ID는 영문 소문자, 숫자, ., _, - 조합 4~24자로 입력해 주세요");
  }
  const data = await apiPost<{ available?: boolean }>("/auth/check-login-id", { loginId: normalized });
  return data?.available !== false;
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
    throw new Error(firstSignupValidationError(validation.errors));
  }
  const { name, loginId, password, gender, birthdate, phoneAuth, phoneStorage } = validation.values;
  const available = await checkLoginIdAvailability(loginId);
  if (!available) throw new Error("이미 사용 중인 ID예요");

  await apiPost("/auth/signup/request-otp", { phone: phoneAuth, password, loginId });
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
}): Promise<AuthResult> {
  const phoneAuth = normalizePhoneForAuth(input.phone);
  const token = String(input.token || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(token)) {
    throw new Error("인증번호 6자리를 입력해 주세요");
  }
  const data = await apiPost<AuthResult>("/auth/signup/verify", {
    phone: phoneAuth,
    token,
    password: input.password ?? "",
    loginId: input.profile?.login_id,
    name: input.profile?.display_name,
    gender: input.profile?.gender,
    birthdate: input.profile?.birthdate,
  });
  if (!data?.user || !data?.session?.access_token) {
    throw new Error("인증 후 사용자 정보를 확인하지 못했어요");
  }
  adoptSession(data);
  return data;
}

/** 로그아웃 — 메모리 세션 제거(캐시 clear 는 AuthProvider 가 수행). */
export function logout(): void {
  clearApiSession();
}

/** 가족/계정 영구 삭제. 성공 시 세션 제거. */
export async function deleteAccount(): Promise<{ ok?: boolean; error?: string }> {
  const data = await apiPost<{ ok?: boolean; error?: string }>("/api/account/delete", {});
  if (data && data.ok === false) {
    throw new Error(data.error || "계정 삭제에 실패했어요.");
  }
  clearApiSession();
  return data;
}

// ── OAuth(카카오/구글/네이버) — 웹 리다이렉트 + 네이티브 딥링크 복귀 ──────────────
// 웹: 현재 창을 인가 URL 로 이동(origin 복귀). 네이티브(Capacitor): 시스템 브라우저로 열고,
// 복귀는 딥링크(hyenicalendar://auth-callback)를 initOAuthDeepLink 가 처리.
// provider 별 계약 차이는 transform/oauthProvider 주석 참조.
export type { OAuthProvider };

/** 네이버 개발자센터 Callback URL 에 등록해야 하는 값과 정확히 일치해야 한다. */
export const NAVER_CALLBACK_URL = `${API_BASE}/api/auth/naver`;
const NAVER_AUTHORIZE_URL = "https://nid.naver.com/oauth2.0/authorize";

const OAUTH_STATE_KEY = "hyeni-oauth-state";
const OAUTH_PROVIDER_KEY = "hyeni-oauth-provider";
const OAUTH_MODE_KEY = "hyeni-oauth-mode";

/** 로그인(login) 인지, 이미 로그인한 계정에 소셜을 붙이는 연결(link) 인지. */
export type OAuthFlowMode = "login" | "link";

// nonce 는 localStorage 에도 둔다. 네이티브는 OAuth 왕복 중 프로세스가 재생성될 수 있고,
// 그러면 sessionStorage 가 비어 CSRF 검사(savedNonce)가 조용히 건너뛰어진다(코드 주입 방어 상실).
function writeOAuthNonce(nonce: string, provider: string, mode: OAuthFlowMode): void {
  for (const store of [window.sessionStorage, window.localStorage]) {
    try {
      store.setItem(OAUTH_STATE_KEY, nonce);
      store.setItem(OAUTH_PROVIDER_KEY, provider);
      store.setItem(OAUTH_MODE_KEY, mode);
    } catch {
      /* 저장소 접근 불가 */
    }
  }
}

/** 복귀한 콜백이 로그인인지 계정 연결인지 — 폐기하지 않고 들여다본다. */
export function peekOAuthFlowMode(): OAuthFlowMode {
  for (const store of [window.sessionStorage, window.localStorage]) {
    try {
      if (store.getItem(OAUTH_MODE_KEY) === "link") return "link";
    } catch {
      /* 저장소 접근 불가 */
    }
  }
  return "login";
}

/** 저장된 nonce 를 읽고 즉시 폐기(재사용 금지). sessionStorage 우선, 없으면 localStorage. */
function takeOAuthNonce(): string {
  let nonce = "";
  for (const store of [window.sessionStorage, window.localStorage]) {
    try {
      nonce = nonce || store.getItem(OAUTH_STATE_KEY) || "";
      store.removeItem(OAUTH_STATE_KEY);
      store.removeItem(OAUTH_PROVIDER_KEY);
      store.removeItem(OAUTH_MODE_KEY);
    } catch {
      /* 저장소 접근 불가 */
    }
  }
  return nonce;
}

function readOAuthProviderHint(): string | null {
  for (const store of [window.sessionStorage, window.localStorage]) {
    try {
      const v = store.getItem(OAUTH_PROVIDER_KEY);
      if (v) return v;
    } catch {
      /* 저장소 접근 불가 */
    }
  }
  return null;
}

// 네이티브 OAuth 복귀 target. Worker /callback 이 이 스킴으로 재리다이렉트하고
// AndroidManifest 의 intent-filter(scheme=hyenicalendar, host=auth-callback)가 앱을 깨운다.
const NATIVE_OAUTH_REDIRECT_URL = "hyenicalendar://auth-callback";

function randomNonce(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `o-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

/**
 * OAuth 시작 — Worker /start 를 연다.
 * - 웹: 현재 창을 이동(location.href). 복귀 target = window.location.origin.
 * - 네이티브: 시스템 브라우저로 열고(openExternal), 복귀 target = 딥링크 스킴.
 *   복귀는 initOAuthDeepLink 의 appUrlOpen 리스너가 받아 finishOAuthLogin 을 호출한다.
 *
 * nonce(CSRF)·provider 를 sessionStorage 에 저장하고 복귀 시 콜백에서 대조한다.
 * (네이티브도 WebView 는 백그라운드로 살아 있어 sessionStorage 가 왕복 동안 유지된다.)
 */
export function startWorkerOAuth(provider: OAuthProvider, mode: OAuthFlowMode = "login"): void {
  // 키 미설정이면 깨진 인가 URL 로 보내지 않고 명시적으로 알린다(가짜 성공 금지).
  // UI 는 hasNaverClientId 로 버튼 자체를 숨기므로 여기까지 오면 설정 실수다.
  if (provider === "naver" && !NAVER_CLIENT_ID) {
    throw new Error("네이버 로그인 설정이 아직 안 됐어요. 운영자에게 문의해 주세요.");
  }
  const native = isNativePlatform();
  const target = native ? NATIVE_OAUTH_REDIRECT_URL : window.location.origin;
  const nonce = randomNonce();
  const encoded = btoa(JSON.stringify({ nonce, target }));
  writeOAuthNonce(nonce, provider, mode);

  // 네이버는 Worker /start 가 없다 — 클라가 인가 URL 을 직접 조립하고 redirect_uri 로 Worker 콜백을 준다.
  const startUrl = usesWorkerStartRedirect(provider)
    ? `${API_BASE}/api/auth/oauth/${provider}/start?state=${encodeURIComponent(encoded)}`
    : `${NAVER_AUTHORIZE_URL}?${new URLSearchParams({
        response_type: "code",
        client_id: NAVER_CLIENT_ID,
        redirect_uri: NAVER_CALLBACK_URL,
        state: encoded,
      }).toString()}`;

  if (native) {
    // 네이티브: 시스템 브라우저에서 열고 딥링크로 복귀. 실패는 로깅만(웹 리다이렉트와 달리 페이지 전환 없음).
    void openExternal(startUrl).catch((error) => {
      console.error("OAuth 시작 실패:", error);
    });
  } else {
    window.location.href = startUrl;
  }
}

/** OAuth 콜백에서 code+state 로 세션 교환. code 는 단회용이라 allowRetry=false. */
export async function finishOAuthLogin(input: {
  provider: OAuthProvider;
  code: string;
  state?: string;
}): Promise<AuthResult> {
  if (!isOAuthProvider(input.provider)) {
    throw new Error("지원하지 않는 로그인 방식이에요.");
  }
  if (!input.code) throw new Error("로그인 인증 코드가 없어요. 다시 시도해 주세요!");

  const savedNonce = takeOAuthNonce();
  if (savedNonce && input.state && savedNonce !== input.state) {
    throw new Error("로그인 인증 정보가 어긋났어요. 보안을 위해 처음부터 다시 해주세요!");
  }

  // 네이버는 인가 때와 동일한 redirect_uri 를 토큰 교환에도 보내야 한다(서버가 필수 검증).
  const body: Record<string, unknown> = { code: input.code, state: input.state || savedNonce };
  if (input.provider === "naver") body.redirect_uri = NAVER_CALLBACK_URL;

  const data = await apiRequest<AuthResult>(
    oauthExchangePath(input.provider),
    { method: "POST", body: JSON.stringify(body) },
    false,
  );
  if (!data?.session?.access_token) {
    throw new Error("로그인 응답이 이상해요. 다시 시도해 주세요!");
  }
  adoptSession(data);
  return data;
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

  const savedNonce = takeOAuthNonce();
  if (savedNonce && input.state && savedNonce !== input.state) {
    throw new Error("로그인 인증 정보가 어긋났어요. 보안을 위해 처음부터 다시 해주세요!");
  }

  return apiRequest(`/api/auth/oauth/${input.provider}/link`, {
    method: "POST",
    body: JSON.stringify({ code: input.code, state: input.state || savedNonce }),
  });
}

/** 현재 URL 쿼리에서 OAuth 콜백(code) 감지. provider 는 sessionStorage 에서 복원. */
export function readOAuthCallback(): { provider: OAuthProvider; code: string; state: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return null;
  const state = params.get("state") || "";
  let provider: unknown = params.get("provider");
  if (!isOAuthProvider(provider)) {
    provider = readOAuthProviderHint();
  }
  if (!isOAuthProvider(provider)) return null;
  return { provider, code, state };
}

/** 콜백 처리 후 URL 쿼리(?code&state) 제거 — 새로고침 시 재교환 방지. */
export function clearOAuthCallbackUrl(): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const clean = window.location.origin + window.location.pathname + window.location.hash;
  window.history.replaceState({}, "", clean);
}

// 전화 정규화는 온보딩에서도 쓰이므로 재노출.
export { normalizePhoneForStorage };

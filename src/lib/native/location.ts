/**
 * 백그라운드 위치 추적 브리지(아이 기기 전용).
 * hyeni-1 `nativeLocationService.js` 를 TS 로 충실 이관.
 *
 * - 네이티브(Android)에서만 `BackgroundLocation` 포그라운드 서비스를 시작/중지한다.
 * - 웹(PWA)·iOS 사파리에선 플러그인이 null → 전부 안전한 no-op(부모 조회 앱이 깨지지 않게).
 *
 * 위치 전송 경로: 시작 시 { base(Worker URL)·accessToken·refreshToken·userId·familyId }
 * 를 네이티브 서비스에 주입하면, 이후 백그라운드에서 네이티브가 **직접** Worker 로
 * 위치를 upsert 한다(WebView 왕복 없음). 그래서 base·토큰을 여기서 세션으로부터 넘긴다.
 * access token(1h) 만료 후 네이티브가 스스로 갱신할 수 있게 refresh token(30일)도 함께 전달.
 *
 * 네이티브 계약(LocationPlugin.java)은 여전히 `supabaseUrl`/`supabaseKey` 라는 파라미터명을
 * 쓴다(레거시). 실제로는 supabaseUrl = Worker base, supabaseKey = "" 로 넘긴다.
 */
import { getNativePlugin, isNativePlatform } from "./plugins";
import {
  getApiAccessToken,
  getApiRefreshToken,
  getNativeBackendUrl,
  notifyTokens,
  setApiTokens,
  setApiUser,
  type ApiUser,
  userFromAccessToken,
} from "@/lib/api/session";
import type { LocationIntervalMode } from "@/lib/api/endpoints/location";
import { shouldAdoptNativeSessionTokens, shouldRestoreNativeRefreshOnlySession } from "@/transform/nativeTokenSync";

const PLUGIN_NAME = "BackgroundLocation";

/** 추적 대상 역할. 아이 기기 추적이 기본(부모도 위치 공유 시 "parent"). */
export type LocationRole = "child" | "parent";

/** 네이티브 서비스에 넘기는 컨텍스트(레거시 supabase* 파라미터명 유지). */
interface StartServiceOptions {
  userId: string;
  familyId: string;
  supabaseUrl: string;
  supabaseKey: string;
  accessToken: string;
  refreshToken: string;
  role: LocationRole;
  intervalMode: LocationIntervalMode;
}

/** BackgroundLocation 커스텀 플러그인(사용 메서드만). */
interface BackgroundLocationPlugin {
  startService(options: StartServiceOptions): Promise<{ status?: string }>;
  requestCurrentLocation(options: StartServiceOptions): Promise<{ status?: string }>;
  stopService(options?: { clearSession?: boolean }): Promise<{ status?: string }>;
  updateToken(options: { accessToken: string; refreshToken?: string }): Promise<{ status?: string }>;
  getSessionTokens?(): Promise<{ accessToken?: string; refreshToken?: string; serviceEnabled?: boolean }>;
  getPushContext?(): Promise<{ userId?: string; familyId?: string; role?: string }>;
}

/** startLocationTracking/requestImmediateLocation 호출 시 넘기는 최소 컨텍스트. */
export interface LocationTrackingContext {
  familyId: string;
  userId: string;
  /** 기본 "child"(아이 기기 추적). */
  role?: LocationRole;
  /** 부모가 설정한 위치 전송 주기. 기본 balanced. */
  intervalMode?: LocationIntervalMode;
}

// 세션(session.ts)에서 base·토큰을 읽어 네이티브 파라미터로 조립. 항상 새 객체(불변).
function buildServiceOptions(ctx: LocationTrackingContext): StartServiceOptions {
  return {
    userId: ctx.userId,
    familyId: ctx.familyId,
    supabaseUrl: getNativeBackendUrl(),
    // non-blank placeholder — 네이티브 게이트가 blank supabaseKey 를 미설정으로 간주(Worker 는 무시).
    supabaseKey: "worker",
    accessToken: getApiAccessToken() ?? "",
    refreshToken: getApiRefreshToken() ?? "",
    role: ctx.role ?? "child",
    intervalMode: ctx.intervalMode ?? "balanced",
  };
}

/**
 * 백그라운드 위치 서비스 시작(아이 세션 로그인 시 App 에서 호출).
 * 웹/iOS(플러그인 null)에선 no-op 으로 false 반환.
 * @returns 네이티브 서비스가 실제로 시작됐으면 true.
 */
export async function startLocationTracking(ctx: LocationTrackingContext): Promise<boolean> {
  const plugin = getNativePlugin<BackgroundLocationPlugin>(PLUGIN_NAME);
  if (!plugin) return false; // 웹(PWA)·iOS = no-op
  if (!ctx.familyId || !ctx.userId) return false; // 세션 미확정 시 시작 금지
  try {
    await plugin.startService(buildServiceOptions(ctx));
    return true;
  } catch (error) {
    console.error("[location] 백그라운드 위치 서비스 시작 실패:", error);
    return false;
  }
}

/**
 * 백그라운드 위치 서비스 중지(로그아웃·역할 전환 시 호출).
 * 웹/iOS 에선 no-op.
 */
export async function stopLocationTracking(options: { clearSession?: boolean } = {}): Promise<boolean> {
  const plugin = getNativePlugin<BackgroundLocationPlugin>(PLUGIN_NAME);
  if (!plugin) return false;
  try {
    await plugin.stopService({ clearSession: options.clearSession === true });
    return true;
  } catch (error) {
    console.error("[location] 백그라운드 위치 서비스 중지 실패:", error);
    return false;
  }
}

/**
 * 즉시 1회 위치 새로고침 요청(부모가 위치 화면에서 '새로고침'을 누른 경우 등).
 * 서비스가 켜져 있지 않아도 네이티브가 단발 위치를 잡아 upsert 한다. 웹/iOS 에선 no-op.
 */
export async function requestImmediateLocation(ctx: LocationTrackingContext): Promise<boolean> {
  const plugin = getNativePlugin<BackgroundLocationPlugin>(PLUGIN_NAME);
  if (!plugin) return false;
  if (!ctx.familyId || !ctx.userId) return false;
  try {
    await plugin.requestCurrentLocation(buildServiceOptions(ctx));
    return true;
  } catch (error) {
    console.error("[location] 즉시 위치 새로고침 실패:", error);
    return false;
  }
}

/**
 * WebView 가 access token 을 회전했을 때 네이티브 서비스에 최신 토큰을 동기화한다.
 * (네이티브 백그라운드가 stale 토큰으로 upsert 401 나는 것을 막는다.)
 * App 이 토큰 변경 구독(setOnApiTokensChanged)에서 호출하면 좋다. 웹/iOS 에선 no-op.
 */
export async function syncNativeLocationToken(): Promise<void> {
  const plugin = getNativePlugin<BackgroundLocationPlugin>(PLUGIN_NAME);
  if (!plugin) return;
  const accessToken = getApiAccessToken();
  if (!accessToken) return;
  try {
    await plugin.updateToken({
      accessToken,
      refreshToken: getApiRefreshToken() ?? undefined,
    });
  } catch (error) {
    console.error("[location] 네이티브 토큰 동기화 실패:", error);
  }
}

interface NativeRefreshResponse {
  session?: { access_token?: string; refresh_token?: string; user?: ApiUser };
  user?: ApiUser;
}

async function restoreNativeRefreshOnlySession(
  plugin: BackgroundLocationPlugin,
  nativeRefresh: string,
  expected: { userId: string; familyId: string; role: string },
): Promise<boolean> {
  try {
    const res = await fetch(`${getNativeBackendUrl()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: nativeRefresh }),
    });
    if (res.status === 401 || res.status === 403 || !res.ok) return false;
    const data = (await res.json()) as NativeRefreshResponse;
    const nextAccess = data.session?.access_token?.trim() ?? "";
    const nextRefresh = data.session?.refresh_token?.trim() || nativeRefresh;
    if (!nextAccess) return false;
    const nextUser = data.session?.user ?? data.user ?? userFromAccessToken(nextAccess);
    if (!nextUser) return false;
    const nextRole = nextUser.role ?? nextUser.app_metadata?.role ?? nextUser.user_metadata?.role ?? "";
    const nextFamilyId =
      nextUser.family_id ?? nextUser.app_metadata?.family_id ?? nextUser.user_metadata?.family_id ?? "";
    if (nextUser.id !== expected.userId || nextFamilyId !== expected.familyId || nextRole !== expected.role) {
      return false;
    }
    setApiTokens({ access: nextAccess, refresh: nextRefresh });
    setApiUser(nextUser);
    notifyTokens();
    await plugin.updateToken({ accessToken: nextAccess, refreshToken: nextRefresh });
    return true;
  } catch (error) {
    console.error("[location] 네이티브 refresh-only 세션 복구 실패:", error);
    return false;
  }
}

/**
 * 백그라운드 위치 서비스가 WebView 없이 refresh token 을 회전한 경우, WebView localStorage 의
 * refresh token 이 낡아져 다음 API 401 때 로그아웃될 수 있다. refresh 직전 네이티브가 가진
 * 최신 토큰을 보수적으로 채택해 저장소 불일치를 복구한다.
 */
export async function adoptNativeLocationSessionTokens(): Promise<boolean> {
  const plugin = getNativePlugin<BackgroundLocationPlugin>(PLUGIN_NAME);
  if (!plugin || typeof plugin.getSessionTokens !== "function") return false;
  try {
    const native = await plugin.getSessionTokens();
    const nativeAccess = native?.accessToken?.trim() ?? "";
    const nativeRefresh = native?.refreshToken?.trim() ?? "";
    const nativeServiceEnabled = native?.serviceEnabled === true;
    const currentAccess = getApiAccessToken();
    const currentRefresh = getApiRefreshToken();
    const pushContext =
      typeof plugin.getPushContext === "function" ? await plugin.getPushContext() : null;
    if (
      shouldAdoptNativeSessionTokens({
        currentAccessToken: currentAccess,
        currentRefreshToken: currentRefresh,
        nativeAccessToken: nativeAccess,
        nativeRefreshToken: nativeRefresh,
        nativeServiceEnabled,
      })
    ) {
      const nativeUser = userFromAccessToken(nativeAccess);
      if (!nativeUser) return false;
      setApiTokens({ access: nativeAccess, refresh: nativeRefresh });
      setApiUser(nativeUser);
      notifyTokens();
      return true;
    }
    if (
      shouldRestoreNativeRefreshOnlySession({
        currentAccessToken: currentAccess,
        currentRefreshToken: currentRefresh,
        nativeAccessToken: nativeAccess,
        nativeRefreshToken: nativeRefresh,
        nativeUserId: pushContext?.userId,
        nativeFamilyId: pushContext?.familyId,
        nativeRole: pushContext?.role,
        nativeServiceEnabled,
      })
    ) {
      return restoreNativeRefreshOnlySession(plugin, nativeRefresh, {
        userId: pushContext?.userId?.trim() ?? "",
        familyId: pushContext?.familyId?.trim() ?? "",
        role: pushContext?.role?.trim() ?? "",
      });
    }
    return false;
  } catch (error) {
    console.error("[location] 네이티브 세션 토큰 채택 실패:", error);
    return false;
  }
}

/** 이 기기에서 백그라운드 위치 추적이 가능한지(네이티브 + 플러그인 존재). 웹=false. */
export function isLocationTrackingSupported(): boolean {
  return isNativePlatform() && getNativePlugin(PLUGIN_NAME) !== null;
}

/**
 * FCM 푸시 등록 브리지(hyeni-1 pushNotifications.js + App.jsx FCM 등록 흐름 이관).
 *
 * 안드로이드 네이티브에서만 동작한다:
 *   1) POST_NOTIFICATIONS 런타임 권한 요청(Android 13+, `NativeNotification` 플러그인).
 *      토큰 취득/등록과 독립적인 흐름 — 권한을 미허용해도 토큰은 정상 발급된다.
 *   2) 네이티브에 push context 주입(`BackgroundLocation.setPushContext`). FCM 수신부
 *      (MyFirebaseMessagingService)가 prefs 의 userId/familyId/role 로 대상 필터링에 쓴다.
 *   3) FCM 토큰 취득(`BackgroundLocation.getFcmToken` → Firebase SDK, 캐시 우선).
 *   4) 토큰을 Worker 로 등록(`POST /rest/v1/rpc/upsert_fcm_token`). apiPost 가 Bearer(JWT)를
 *      부착하므로 서버는 caller.sub 로 소유권을 검증하고 fcm_tokens 를 upsert 한다(성공=204).
 *      네이티브 NativePushTokenSync.syncViaRpc 와 동일한 바디를 JS 에서 보내는 방식.
 *   5) 앱 재개(resume) 시 토큰 회전 대비 재등록 리스너를 건다(네이티브 onNewToken 은
 *      Worker 경로에서 JS 로 전달되지 않으므로, 재개 시점에 최신 토큰을 다시 확인).
 *
 * 웹(PWA)·iOS 사파리: 플러그인이 null → 전부 안전한 no-op(부모 조회용 웹앱이 깨지지 않게).
 * 실제 푸시 수신·표시는 전적으로 네이티브(MyFirebaseMessagingService)가 담당한다 —
 * hyeni-1 과 동일하게 JS 측 메시지 수신 핸들러는 존재하지 않는다.
 *
 * ※ App 배선: 인증 완료(로그인 + familyId 확정) 후 `initPush({ userId, familyId, role })`
 *   를 호출하고, 로그아웃 시 `disposePush()` 로 재개 리스너를 정리한다.
 */
import { getNativePlugin, isNativePlatform, getPlatform } from "./plugins";
import { apiPost } from "@/lib/api/client";
import { getApiAccessToken, getApiRefreshToken, getNativeBackendUrl } from "@/lib/api/session";

// 커스텀 플러그인 이름(android MainActivity registerPlugin 과 일치).
const NOTIFICATION_PLUGIN = "NativeNotification"; // 권한(POST_NOTIFICATIONS)
const LOCATION_PLUGIN = "BackgroundLocation"; // FCM 토큰 + push context(레거시 위치 플러그인에 동거)

/** `NativeNotification` 중 이 브리지가 쓰는 메서드(권한 요청)만. */
interface NativeNotificationPerm {
  requestPostNotifications(): Promise<{ granted?: boolean; requested?: boolean; notRequired?: boolean }>;
}

/** setPushContext 파라미터(레거시 supabase* 파라미터명 유지 — 실제 supabaseUrl=Worker base, supabaseKey=""). */
interface PushContextOptions {
  userId: string;
  familyId: string;
  role: string;
  supabaseUrl: string;
  supabaseKey: string;
  accessToken: string;
  refreshToken: string;
}

/** `BackgroundLocation` 중 이 브리지가 쓰는 FCM 관련 메서드만(위치 메서드는 native/location.ts). */
interface BackgroundLocationFcm {
  getFcmToken(): Promise<{ token: string }>;
  setPushContext(options: PushContextOptions): Promise<{ status?: string }>;
}

/** Capacitor 리스너 핸들(제거용). */
interface RemovableListener {
  remove: () => Promise<void>;
}

/** initPush 입력. familyId 는 서버 RPC 필수 — 가족 확정 전엔 호출하지 않는다. */
export interface InitPushParams {
  userId: string;
  familyId: string;
  /** 수신부 대상 필터링용("parent" | "child" | "teacher"). 미지정 시 "". */
  role?: string;
}

/** initPush 결과(호출부 로깅/조건 분기용). */
export interface PushInitResult {
  platform: string;
  /** 알림 권한이 이미 부여됨(Android 13+ 최초 요청은 다이얼로그 대기 중이라 false 일 수 있음). */
  permissionGranted: boolean;
  /** 취득한 FCM 토큰(웹/실패 시 null). */
  token: string | null;
  /** 토큰이 Worker 에 등록됨. */
  registered: boolean;
}

// 마지막으로 등록 성공한 토큰(재개 시 동일 토큰 중복 등록을 피하기 위한 경량 dedup).
let lastRegisteredToken: string | null = null;
// 재개 리스너 핸들(중복 등록 방지 + dispose).
let resumeHandle: RemovableListener | null = null;

/**
 * 알림 권한(POST_NOTIFICATIONS) 요청. Android<13 은 notRequired+granted 로 즉시 true,
 * 13+ 최초 요청은 다이얼로그를 띄우고 requested 로 즉시 resolve(granted=false).
 */
async function requestNotificationPermission(): Promise<boolean> {
  const plugin = getNativePlugin<NativeNotificationPerm>(NOTIFICATION_PLUGIN);
  if (!plugin || typeof plugin.requestPostNotifications !== "function") return false;
  try {
    const res = await plugin.requestPostNotifications();
    return !!res?.granted;
  } catch (error) {
    console.error("[push] 알림 권한 요청 실패:", error);
    return false;
  }
}

/**
 * 네이티브 push context 주입. FCM 수신부가 대상 사용자/가족을 식별하는 데 쓴다.
 * 실패해도 토큰 등록은 별개로 진행되므로 예외를 삼킨다.
 *
 * ★ 콜드스타트 레이스 방어: 로그인 직후 플러그인이 아직 초기화 전이면 setPushContext 가 유실돼
 *   원격청취/force_ring FCM 이 "push context missing" 으로 skip 된다. 플러그인이 준비될 때까지
 *   짧게 재시도해, SharedPreferences 에 context 가 확실히 저장되도록 한다.
 */
async function setNativePushContext(params: InitPushParams, retries = 6): Promise<void> {
  const plugin = getNativePlugin<BackgroundLocationFcm>(LOCATION_PLUGIN);
  if (!plugin || typeof plugin.setPushContext !== "function") {
    // 플러그인 미준비 — 잠시 후 재시도(콜드스타트 초기 레이스 완화).
    if (retries > 0 && isNativePlatform()) {
      await new Promise((r) => setTimeout(r, 500));
      return setNativePushContext(params, retries - 1);
    }
    return;
  }
  try {
    await plugin.setPushContext({
      userId: params.userId,
      familyId: params.familyId,
      role: params.role ?? "",
      supabaseUrl: getNativeBackendUrl(),
      // 네이티브 원격청취/force_ring 게이트는 supabaseKey 가 blank 면 "push context missing" 으로
      // 캡처를 skip 한다(MainActivity/RemoteListenActivity). Worker 는 이 값을 무시하므로(인증은
      // accessToken Bearer) non-blank placeholder 를 넣어 판정을 통과시킨다.
      supabaseKey: "worker",
      accessToken: getApiAccessToken() ?? "",
      refreshToken: getApiRefreshToken() ?? "",
    });
  } catch (error) {
    console.error("[push] push context 설정 실패:", error);
  }
}

/** FCM 토큰 취득(Firebase SDK). 웹/실패 시 null. */
async function acquireFcmToken(): Promise<string | null> {
  const plugin = getNativePlugin<BackgroundLocationFcm>(LOCATION_PLUGIN);
  if (!plugin || typeof plugin.getFcmToken !== "function") return null;
  try {
    const res = await plugin.getFcmToken();
    const token = res?.token?.trim();
    return token ? token : null;
  } catch (error) {
    console.error("[push] FCM 토큰 취득 실패:", error);
    return null;
  }
}

/**
 * FCM 토큰을 Worker 에 등록(upsert). NativePushTokenSync.syncViaRpc 와 동일 바디.
 * apiPost 가 Bearer(access token)를 부착 → 서버가 caller.sub 로 소유권 검증. 성공=204(void).
 */
async function registerFcmToken(userId: string, familyId: string, token: string): Promise<boolean> {
  try {
    await apiPost("/rest/v1/rpc/upsert_fcm_token", {
      p_user_id: userId,
      p_family_id: familyId,
      p_fcm_token: token,
      p_platform: getPlatform(),
    });
    return true;
  } catch (error) {
    console.error("[push] FCM 토큰 등록 실패:", error);
    return false;
  }
}

/** 토큰 취득 + 등록(동일 토큰이면 재등록 생략). 등록된 토큰을 반환. */
async function syncFcmToken(params: InitPushParams): Promise<string | null> {
  const token = await acquireFcmToken();
  if (!token) return null;
  if (token === lastRegisteredToken) return token; // 이미 등록된 동일 토큰 — 생략
  const ok = await registerFcmToken(params.userId, params.familyId, token);
  if (ok) lastRegisteredToken = token;
  return ok ? token : null;
}

/** 기존 재개 리스너 제거(멱등). */
async function removeResumeListener(): Promise<void> {
  if (!resumeHandle) return;
  const handle = resumeHandle;
  resumeHandle = null;
  try {
    await handle.remove();
  } catch {
    /* 이미 제거됨 — 무시 */
  }
}

/**
 * 앱 재개 시 최신 FCM 토큰을 재확인·재등록하고 네이티브 push context 를 재주입하는 리스너를 건다.
 * 네이티브 onNewToken(토큰 회전)이 Worker 경로에서 JS 로 오지 않으므로,
 * 앱이 다시 활성화되는 시점에 토큰을 다시 확인해 stale 등록을 방지한다.
 *
 * ★ push context 재주입: 콜드스타트 직후 initPush 의 setPushContext 가 플러그인 준비 전
 *   타이밍으로 유실되면, 네이티브 FCM 액션(remote_listen·force_ring·location/device refresh)이
 *   "push context missing" 으로 skip 된다. 앱 활성화마다 context 를 다시 심어 이 유실을 복구한다.
 */
async function registerResumeListener(params: InitPushParams): Promise<void> {
  await removeResumeListener(); // 재로그인 등으로 params 가 바뀌면 새 클로저로 교체
  try {
    const { App } = await import("@capacitor/app");
    resumeHandle = await App.addListener("appStateChange", (state) => {
      if (state.isActive) {
        void setNativePushContext(params);
        void syncFcmToken(params);
      }
    });
  } catch (error) {
    console.error("[push] 재개 리스너 등록 실패:", error);
  }
}

/**
 * 푸시 초기화. 인증 완료(로그인 + familyId 확정) 직후 App 에서 호출한다.
 * 웹(PWA)·iOS·가족 미확정 시 안전한 no-op 결과를 반환한다.
 */
export async function initPush(params: InitPushParams): Promise<PushInitResult> {
  const platform = getPlatform();
  const noop: PushInitResult = { platform, permissionGranted: false, token: null, registered: false };

  if (!isNativePlatform()) return noop; // 웹/iOS 사파리 = no-op
  if (!params.userId || !params.familyId) return noop; // 세션/가족 미확정 시 등록 금지

  const permissionGranted = await requestNotificationPermission();
  await setNativePushContext(params);
  const token = await syncFcmToken(params);
  await registerResumeListener(params);

  return {
    platform,
    permissionGranted,
    token,
    registered: token !== null && token === lastRegisteredToken,
  };
}

/** 재개 리스너·등록 캐시 정리(로그아웃 시 App 에서 호출). */
export async function disposePush(): Promise<void> {
  await removeResumeListener();
  lastRegisteredToken = null;
}

/** 이 기기에서 FCM 푸시 등록이 가능한지(네이티브 + 플러그인 존재). 웹=false. */
export function isPushSupported(): boolean {
  return isNativePlatform() && getNativePlugin(LOCATION_PLUGIN) !== null;
}

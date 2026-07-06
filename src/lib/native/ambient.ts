/**
 * 주변 소리 듣기(원격 청취) 네이티브 브리지.
 * hyeni-1 의 remoteAudio.js · remoteAudioCapture.js · AmbientListenPlugin.java 계약을 충실 이관.
 *
 * 역할 분담(비유: 무전기 한 세트):
 *  - 아이(child) 기기 = 송신기. AmbientListen 네이티브 플러그인이 마이크를 캡처해 서버로 보낸다.
 *    → startAmbientChildCapture / stopAmbientChildCapture (안드로이드 네이티브 전용).
 *  - 부모(parent) 기기 = 수신·제어기. "지금 들어도 되는지(킬 스위치)"를 확인하고 세션을 연다/닫는다.
 *    → isRemoteListenAllowed / openRemoteListenSession / closeRemoteListenSession.
 *
 * 원칙: 네이티브가 아니면(플러그인 null) 아이 캡처는 안전한 no-op, 부모 제어(API)는 그대로 동작한다.
 *       모든 API 헬퍼는 실패해도 UI 를 막지 않도록 best-effort(로그 후 기본값)로 degrade 한다.
 */
import { API_BASE } from "@/config/env";
import { apiGet, apiPost, apiPatch } from "@/lib/api/client";
import { getApiAccessToken } from "@/lib/api/session";
import { getNativePlugin, isNativePlatform } from "./plugins";

/** 원격 청취 기본 제한 시간(초). 위급 시 1분 청취. (hyeni-1 remoteAudio.js) */
export const REMOTE_AUDIO_DEFAULT_DURATION_SEC = 60;

/** 캡처 최소 시간(초). durationSec 하한 clamp 에 사용. */
const REMOTE_AUDIO_MIN_DURATION_SEC = 5;

// ── 네이티브 플러그인 계약 (AmbientListenPlugin.java) ──
interface AmbientListenPlugin {
  /** 아이 기기에서 포그라운드 서비스로 마이크 캡처 시작. */
  start(options: {
    userId: string;
    familyId: string;
    initiatorUserId: string;
    requestId: string;
    supabaseUrl: string;
    supabaseKey: string;
    accessToken: string;
    durationSec: number;
  }): Promise<{ status: string }>;
  /** 캡처 중지(reason = 종료 사유). */
  stop(options: { reason: string }): Promise<{ status: string }>;
}

/** AmbientListen 플러그인 핸들(웹/비네이티브면 null). */
function getAmbientPlugin(): AmbientListenPlugin | null {
  return getNativePlugin<AmbientListenPlugin>("AmbientListen");
}

/** 원격 청취(주변 소리)가 이 기기의 네이티브에서 지원되는지. 웹(PWA)이면 false. */
export function isRemoteListenNativeSupported(): boolean {
  return isNativePlatform();
}

// ─────────────────────────────────────────────────────────────────────────────
// 아이(child) 캡처 — AmbientListen 네이티브 플러그인 (안드로이드 전용)
// ─────────────────────────────────────────────────────────────────────────────

export interface AmbientChildCaptureParams {
  /** 아이(child) 기기 사용자 id. */
  userId: string;
  familyId: string;
  /** 요청을 보낸 부모 user id. */
  initiatorUserId?: string;
  /** 요청 상관관계 id(중복 제거·audit용). */
  requestId?: string;
  /** 캡처 지속(초). 미지정 시 기본 60초, 5초 하한 clamp. */
  durationSec?: number;
  /** 서버 인증 토큰. 미지정 시 현재 세션 토큰 사용. */
  accessToken?: string;
}

/**
 * 아이 기기에서 주변 소리 캡처 시작(네이티브 플러그인 위임).
 * @returns 네이티브에서 실제 시작하면 true, 웹/비네이티브면 false(no-op).
 * @throws userId/familyId 누락 시. (네이티브에서 자동 마운트 금지 — 반드시 요청 수신 액션에서 호출)
 */
export async function startAmbientChildCapture(params: AmbientChildCaptureParams): Promise<boolean> {
  const plugin = getAmbientPlugin();
  if (!plugin) {
    // 아이 캡처는 안드로이드 네이티브 전용 → 웹/아이폰에선 안전한 no-op.
    console.warn("[원격청취] 아이 캡처는 안드로이드 네이티브에서만 지원돼요. (no-op)");
    return false;
  }
  if (!params.userId || !params.familyId) {
    throw new Error("[원격청취] userId, familyId 는 필수예요");
  }
  // Java intent extra 이름은 supabaseUrl/supabaseKey 로 유지(플러그인 호환).
  // Worker 는 anon 키를 무시(인증=accessToken Bearer)하므로 supabaseUrl=API_BASE.
  // supabaseKey 는 네이티브 게이트가 blank 를 미설정으로 간주하므로 non-blank placeholder.
  await plugin.start({
    userId: params.userId,
    familyId: params.familyId,
    initiatorUserId: params.initiatorUserId ?? "",
    requestId: params.requestId ?? "",
    supabaseUrl: API_BASE,
    supabaseKey: "worker",
    accessToken: params.accessToken ?? getApiAccessToken() ?? "",
    durationSec: Math.max(
      REMOTE_AUDIO_MIN_DURATION_SEC,
      params.durationSec ?? REMOTE_AUDIO_DEFAULT_DURATION_SEC,
    ),
  });
  return true;
}

/**
 * 아이 기기 주변 소리 캡처 중지. 웹/비네이티브면 no-op.
 * 플러그인 오류는 로그만 남기고 삼킨다(중지는 항상 성공한 것으로 취급).
 */
export async function stopAmbientChildCapture(reason = "stopped"): Promise<void> {
  const plugin = getAmbientPlugin();
  if (!plugin) return;
  try {
    await plugin.stop({ reason });
  } catch (error) {
    console.warn("[원격청취] 아이 캡처 중지 건너뜀:", error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 부모(parent) 제어 — 킬 스위치 + 세션 audit (모든 플랫폼 공용 API)
// ─────────────────────────────────────────────────────────────────────────────

interface RemoteListenFlagRow {
  remote_listen_enabled?: boolean | null;
}

/**
 * 가족 킬 스위치 확인 — 원격 청취를 시작해도 되는지.
 * remote_listen_enabled === false 인 경우만 하드 차단. 행 없음/조회 실패 → 기본 허용.
 * (hyeni-1 startRemoteAudioCapture 의 flag 검사 이관)
 */
export async function isRemoteListenAllowed(familyId: string | null | undefined): Promise<boolean> {
  if (!familyId) return true;
  try {
    const flag = await apiGet<RemoteListenFlagRow>(
      `/api/remote-listen/flag?family_id=${encodeURIComponent(familyId)}`,
    );
    return !(flag && flag.remote_listen_enabled === false);
  } catch (error) {
    // 조회 실패는 비치명적 — 기본 동작은 허용.
    console.warn("[원격청취] 킬 스위치 조회 실패 — 기본 허용:", error);
    return true;
  }
}

export interface OpenRemoteListenSessionParams {
  familyId: string | null | undefined;
  /** 요청을 시작한 부모 user id. */
  initiatorUserId?: string | null;
  /** 대상 아이 user id. */
  childUserId?: string | null;
}

/** 원격 청취 세션 핸들 — audit 행 id + 시작 시각(종료 시 duration 계산용). */
export interface RemoteListenSession {
  /** 서버 audit 행 id(생성 실패/무가족이면 null). */
  id: string | null;
  /** 세션 시작 epoch(ms). */
  startedAt: number;
}

/**
 * 원격 청취 audit 행 생성 — 마이크 캡처보다 먼저 열어, 중간 크래시가 나도
 * started/never-ended 행이 남아 다음 부팅에서 정리할 수 있게 한다.
 * (hyeni-1 remoteAudioCapture.js RL-01)
 * familyId 없음/생성 실패 시 id=null 로 degrade(청취 흐름은 계속).
 */
export async function openRemoteListenSession(
  params: OpenRemoteListenSessionParams,
): Promise<RemoteListenSession> {
  const startedAt = Date.now();
  if (!params.familyId) return { id: null, startedAt };
  try {
    const row = await apiPost<{ id?: string | null }>("/api/remote-listen/sessions", {
      family_id: params.familyId,
      initiator_user_id: params.initiatorUserId ?? null,
      child_user_id: params.childUserId ?? null,
      started_at: new Date(startedAt).toISOString(),
    });
    return { id: row?.id ?? null, startedAt };
  } catch (error) {
    console.error("[원격청취] 세션 audit 행 생성 실패:", error);
    return { id: null, startedAt };
  }
}

/**
 * 원격 청취 audit 행 종료 — ended_at/duration_ms/end_reason 기록.
 * 세션 id 없으면 no-op. 실패해도 로그만 남긴다(fire-and-forget).
 * (hyeni-1 closeRemoteListenSessionRow)
 */
export async function closeRemoteListenSession(
  session: RemoteListenSession | null,
  endReason: string,
): Promise<void> {
  if (!session?.id) return;
  const durationMs = Math.max(0, Date.now() - (session.startedAt || Date.now()));
  try {
    await apiPatch(`/api/remote-listen/sessions/${encodeURIComponent(session.id)}`, {
      ended_at: new Date().toISOString(),
      duration_ms: durationMs,
      end_reason: endReason || "unspecified",
    });
  } catch (error) {
    console.error("[원격청취] 세션 audit 행 종료 실패:", error);
  }
}

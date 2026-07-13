/**
 * 원격 제어(소리 울리기 · 원격 청취) 엔드포인트.
 * hyeni-1 forceRing.js + push-notify 액션 계약을 hyeni-3 로 이관.
 *
 * 서버(worker) 계약:
 *  - 소리울리기 발사/정지: POST /api/push-notify { action:'force_ring'|'force_ring_stop', ... }
 *  - 소리울리기 read: GET /api/force-ring/active|history|quota (routes/force-ring.ts)
 *  - 원격청취 명령: POST /api/push-notify { action:'remote_listen'|'remote_listen_stop', ... }
 *    (아이 기기가 명령을 받아 마이크 캡처 시작/중지. 프리미엄 게이트 402 가능)
 *
 * ⚠️ force_ring/remote_listen 은 실제 아이 기기를 제어하는 위험 액션이다.
 *    반드시 사용자 버튼(확인 모달 확정/시작) onClick 에서만 호출한다.
 */
import { apiGet, apiPost } from "../client";
import { ApiError } from "../errors";

/** 소리울리기 메시지 최대 길이(서버 handleForceRing 과 동일 slice(0,80)). */
const MAX_FORCE_RING_MESSAGE = 80;

/** 멱등키(client_request_hash) — race 1차 방어. crypto.randomUUID 우선. */
function makeRequestHash(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 소리 울리기(force_ring)
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/force-ring/active 진행 중 1건(또는 null). timestamp 는 서버가 ISO 정규화. */
export interface ForceRingActive {
  id: string;
  initiator_user_id: string | null;
  target_user_id: string | null;
  message: string | null;
  triggered_at: string | null;
  delivered_at: string | null;
  acknowledged_at: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
}

/** GET /api/force-ring/history 최근 이력 1행(target_user_id 미포함). */
export interface ForceRingHistoryItem {
  id: string;
  initiator_user_id: string | null;
  message: string | null;
  triggered_at: string | null;
  delivered_at: string | null;
  acknowledged_at: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
}

/** GET /api/force-ring/quota — force_ring_check_quota RPC 결과. */
export interface ForceRingQuota {
  allowed: boolean;
  quota: number;
  used: number;
  tier: string;
}

export interface TriggerForceRingInput {
  familyId: string;
  /** 다자녀 가정에서 대상 아이 user_id. 미지정 시 서버가 최초 가입 아이로 fallback. */
  targetChildUserId?: string | null;
  /** 아이 기기 알람에 함께 표시할 짧은 메시지(선택). */
  message?: string;
}

/** POST /api/push-notify(force_ring) 응답. 4xx(429 quota·423 active)는 error 로 정규화. */
export interface TriggerForceRingResult {
  event_id?: string;
  delivered?: boolean;
  quota_remaining?: number;
  deduplicated?: boolean;
  /** 정규화된 에러 코드(quota_exceeded/already_active/기타). 없으면 성공. */
  error?: string;
}

/**
 * 소리 울리기 발사 — 아이 기기에 고우선 알람 푸시.
 * 서버가 주 보호자 게이트·quota·one-active-per-family 를 강제한다.
 * 에러 status 를 hyeni-1 forceRing.js 와 동일하게 코드로 정규화(429→quota, 423→active).
 */
export async function triggerForceRing(input: TriggerForceRingInput): Promise<TriggerForceRingResult> {
  if (!input.familyId) throw new Error("familyId required");
  const body: Record<string, unknown> = {
    action: "force_ring",
    family_id: input.familyId,
    message: String(input.message ?? "").slice(0, MAX_FORCE_RING_MESSAGE),
    client_request_hash: makeRequestHash(),
  };
  if (input.targetChildUserId) body.target_user_id = input.targetChildUserId;
  try {
    return await apiPost<TriggerForceRingResult>("/api/push-notify", body);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : undefined;
    if (status === 429) return { error: "force_ring_quota_exceeded", delivered: false };
    if (status === 423) return { error: "force_ring_already_active", delivered: false };
    return { error: e instanceof Error ? e.message : "unknown_error", delivered: false };
  }
}

/** 소리 울리기 정지 — 발사한 부모만. 실패해도 throw 하지 않고 결과로 표면화. */
export async function stopForceRing(eventId: string): Promise<{ stopped: boolean; error?: string }> {
  if (!eventId) throw new Error("eventId required");
  try {
    return await apiPost<{ stopped: boolean }>("/api/push-notify", {
      action: "force_ring_stop",
      event_id: eventId,
    });
  } catch (e) {
    return { stopped: false, error: e instanceof Error ? e.message : "stop_failed" };
  }
}

/**
 * 아이 기기 상태 새로고침 요청(request_device_status) — 아이 네이티브(LocationService)가
 * 이 푸시를 받아야 배터리·화면시간·최근앱 등 device_health 를 publish 한다(안전지표 실데이터원).
 * ⚠️ 네이티브 리포트는 주기형이 아니라 on-demand: 부모 홈이 이 요청을 보내지 않으면 영영 안 온다.
 * 읽기성 갱신이라 홈 로드/갱신에서 자동 호출 가능(위험 원격제어 아님). 실패는 조용히 무시(다음 기회).
 */
export async function requestDeviceStatus(
  familyId: string,
  targetChildUserId?: string | null,
): Promise<void> {
  if (!familyId) return;
  const body: Record<string, unknown> = {
    action: "request_device_status",
    familyId,
    title: "",
    message: "",
    targetRole: "child",
  };
  if (targetChildUserId) body.targetUserId = targetChildUserId;
  try {
    await apiPost("/api/push-notify", body);
  } catch {
    // 상태 요청 실패는 화면을 막지 않는다(오프라인 등 — 다음 갱신에 재시도)
  }
}

/** 아이 기기에 즉시 위치 갱신을 요청(request_location). 실패는 호출부가 안내할 수 있게 결과로 반환한다. */
export async function requestLocationRefresh(
  familyId: string,
  targetChildUserId?: string | null,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!familyId) return { ok: false, error: "familyId required" };
  const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const body: Record<string, unknown> = {
    action: "request_location",
    familyId,
    title: "",
    message: "",
    targetRole: "child",
    requestId,
    requestedAt: new Date().toISOString(),
    idempotency_key: requestId,
  };
  if (targetChildUserId) body.targetUserId = targetChildUserId;
  try {
    await apiPost("/api/push-notify", body);
    return { ok: true };
  } catch (e) {
    const status = e instanceof ApiError ? e.status : undefined;
    return { ok: false, status, error: e instanceof Error ? e.message : "request_location_failed" };
  }
}

/** GET /api/force-ring/active — 조회 실패는 null 로 떨궈 패널 부팅을 막지 않는다. */
export async function fetchActiveForceRing(familyId: string): Promise<ForceRingActive | null> {
  if (!familyId) return null;
  try {
    return await apiGet<ForceRingActive | null>(
      `/api/force-ring/active?family_id=${encodeURIComponent(familyId)}`,
    );
  } catch {
    return null;
  }
}

/** GET /api/force-ring/history — 실패는 빈 배열. */
export async function fetchForceRingHistory(
  familyId: string,
  limit = 10,
): Promise<ForceRingHistoryItem[]> {
  if (!familyId) return [];
  try {
    const data = await apiGet<ForceRingHistoryItem[] | null>(
      `/api/force-ring/history?family_id=${encodeURIComponent(familyId)}&limit=${limit}`,
    );
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** GET /api/force-ring/quota — 실패는 null(호출부에서 기본 허용). */
export async function fetchForceRingQuota(familyId: string): Promise<ForceRingQuota | null> {
  if (!familyId) return null;
  try {
    return await apiGet<ForceRingQuota>(
      `/api/force-ring/quota?family_id=${encodeURIComponent(familyId)}`,
    );
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 원격 청취 명령(remote_listen) — 부모→아이 기기 캡처 시작/중지
// ─────────────────────────────────────────────────────────────────────────────

/** push-notify 명령 결과. status(402 프리미엄·403 권한)를 화면 안내에 쓴다. */
export interface RemoteListenCommandResult {
  ok: boolean;
  status?: number;
  error?: string;
  fcmSent?: number;
  total?: number;
  key?: string | null;
}

export interface RequestRemoteListenInput {
  familyId: string;
  /** 대상 아이 user_id(다자녀 격리). */
  targetChildUserId: string;
  /** 캡처 지속(초). 서버 pending_notifications data.durationSec 로 전달. */
  durationSec?: number;
  /** 서버가 먼저 만든 remote_listen_sessions.id. */
  requestId: string;
}

/**
 * 원격 청취 시작 명령 — 아이 기기가 이 푸시를 받아 마이크 캡처를 시작한다.
 * 서버가 주 보호자 게이트 + 프리미엄 엔타이틀먼트(402)를 강제한다.
 * 실패해도 throw 하지 않고 { ok:false, status } 로 정직 표면화한다.
 */
export async function requestRemoteListen(
  input: RequestRemoteListenInput,
): Promise<RemoteListenCommandResult> {
  if (!input.familyId) throw new Error("familyId required");
  const targetChildUserId = input.targetChildUserId.trim();
  const requestId = input.requestId.trim();
  if (!targetChildUserId) return { ok: false, error: "remote_listen_target_required" };
  if (!requestId) return { ok: false, error: "remote_listen_audit_session_required" };
  const durationSec = Math.min(60, Math.max(5, Math.trunc(input.durationSec ?? 60)));
  const requestedAt = new Date();
  const expiresAt = new Date(requestedAt.getTime() + 60_000);
  const body: Record<string, unknown> = {
    action: "remote_listen",
    familyId: input.familyId,
    targetUserId: targetChildUserId,
    durationSec,
    requestId,
    requestedAt: requestedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    idempotency_key: requestId,
  };
  try {
    const res = await apiPost<Pick<RemoteListenCommandResult, "fcmSent" | "total" | "key">>(
      "/api/push-notify",
      body,
    );
    return { ok: true, ...res };
  } catch (e) {
    const status = e instanceof ApiError ? e.status : undefined;
    return { ok: false, status, error: e instanceof Error ? e.message : "remote_listen_failed" };
  }
}

/** 원격 청취 중지 명령 — 아이 기기 캡처를 멈춘다. best-effort. */
export async function stopRemoteListen(input: {
  familyId: string;
  targetChildUserId: string;
  requestId: string;
}): Promise<RemoteListenCommandResult> {
  if (!input.familyId) throw new Error("familyId required");
  const targetChildUserId = input.targetChildUserId.trim();
  const requestId = input.requestId.trim();
  if (!targetChildUserId) return { ok: false, error: "remote_listen_target_required" };
  if (!requestId) return { ok: false, error: "remote_listen_request_required" };
  const body: Record<string, unknown> = {
    action: "remote_listen_stop",
    familyId: input.familyId,
    targetUserId: targetChildUserId,
    requestId,
  };
  try {
    await apiPost("/api/push-notify", body);
    return { ok: true };
  } catch (e) {
    const status = e instanceof ApiError ? e.status : undefined;
    return { ok: false, status, error: e instanceof Error ? e.message : "remote_listen_stop_failed" };
  }
}

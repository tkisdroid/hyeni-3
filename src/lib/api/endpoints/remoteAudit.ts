import { apiGet } from "../client";
import { parseRemoteListenMs } from "@/transform/remoteListenStatusMs";

interface RemoteListenAuditRow {
  id: string;
  initiator_user_id: string | null;
  initiator_name: string | null;
  child_user_id: string | null;
  child_name: string | null;
  started_at: string;
  consented_at: string | null;
  capture_expires_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  end_reason: string | null;
}

export interface RemoteListenAuditRecord {
  id: string;
  initiatorUserId: string | null;
  initiatorName: string;
  childUserId: string | null;
  childName: string;
  startedAt: string;
  consentedAt: string | null;
  captureExpiresAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  endReason: string | null;
}

/** 주변 소리 듣기 감사 메타데이터. 오디오 내용은 API 계약에 포함하지 않는다. */
export async function fetchRemoteListenAudit(
  familyId: string,
  limit = 50,
): Promise<RemoteListenAuditRecord[]> {
  const rows = await apiGet<RemoteListenAuditRow[]>(
    `/api/remote-listen/sessions?family_id=${encodeURIComponent(familyId)}&limit=${Math.min(100, Math.max(1, limit))}`,
  );
  return rows.map((row) => ({
    id: row.id,
    initiatorUserId: row.initiator_user_id,
    initiatorName: row.initiator_name?.trim() || "보호자",
    childUserId: row.child_user_id,
    childName: row.child_name?.trim() || "아이",
    startedAt: row.started_at,
    consentedAt: row.consented_at,
    captureExpiresAt: row.capture_expires_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    endReason: row.end_reason,
  }));
}

interface RemoteListenSessionStatusRow {
  id: string;
  child_user_id: string | null;
  started_at_ms: number | null;
  consented_at_ms: number | null;
  capture_expires_at_ms: number | null;
  ended_at_ms: number | null;
  end_reason: string | null;
  server_now_ms: number;
}

export interface RemoteListenSessionStatus {
  id: string;
  childUserId: string | null;
  startedAtMs: number | null;
  consentedAtMs: number | null;
  captureExpiresAtMs: number | null;
  endedAtMs: number | null;
  endReason: string | null;
  serverNowMs: number;
  receivedAtMs: number;
}

/** 요청한 부모 본인의 단일 세션 상태. 오디오 데이터는 반환하지 않는다. */
export async function fetchRemoteListenSessionStatus(
  familyId: string,
  requestId: string,
): Promise<RemoteListenSessionStatus> {
  const row = await apiGet<RemoteListenSessionStatusRow>(
    `/api/remote-listen/sessions/${encodeURIComponent(requestId)}?family_id=${encodeURIComponent(familyId)}`,
  );
  // parseRemoteListenMs 는 null/비숫자를 반드시 null 로 남긴다. Number(null)===0 로 강제하면
  // 미동의 세션의 endedAtMs 가 0(유한값)이 되어 resolver 가 즉시 "ended" 로 조기 종료한다.
  const serverNowMs = parseRemoteListenMs(row.server_now_ms);
  if (serverNowMs === null) throw new Error("remote_listen_server_time_missing");
  return {
    id: row.id,
    childUserId: row.child_user_id,
    startedAtMs: parseRemoteListenMs(row.started_at_ms),
    consentedAtMs: parseRemoteListenMs(row.consented_at_ms),
    captureExpiresAtMs: parseRemoteListenMs(row.capture_expires_at_ms),
    endedAtMs: parseRemoteListenMs(row.ended_at_ms),
    endReason: row.end_reason,
    serverNowMs,
    receivedAtMs: Date.now(),
  };
}

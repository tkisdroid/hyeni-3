import { resolveRealtimeBroadcastAudience } from "./realtimeAudience.ts";

type BroadcastPayload = Record<string, unknown>;

export type RealtimeBroadcastAuthorization =
  | {
      ok: true;
      targetUserId: string | null;
      targetUserIds: string[];
      payload: BroadcastPayload;
    }
  | {
      ok: false;
      status: 400 | 401 | 403;
      error: string;
    };

interface RealtimeBroadcastAuthorizationInput {
  callerUserId: string | null;
  familyId: string;
  event: string;
  payload: unknown;
  now?: string;
}

const CHILD_BROADCAST_EVENTS = new Set([
  "child_location",
  "child_device_status",
  "audio_chunk",
]);
const MAX_AUDIO_BASE64_CHARS = 512 * 1024;
const MAX_AUDIO_CHUNK_DURATION_MS = 60_000;

function currentTimestamp(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "+00");
}

function asPayload(value: unknown): BroadcastPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as BroadcastPayload;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function everyPresentIdentityMatches(
  payload: BroadcastPayload,
  keys: string[],
  expectedUserId: string,
): boolean {
  const values = keys
    .map((key) => nonEmptyString(payload[key]))
    .filter((value): value is string => value !== null);
  return values.length > 0 && values.every((value) => value === expectedUserId);
}

export async function authorizeRealtimeBroadcast(
  db: D1Database,
  input: RealtimeBroadcastAuthorizationInput,
): Promise<RealtimeBroadcastAuthorization> {
  const callerUserId = nonEmptyString(input.callerUserId);
  if (!callerUserId) {
    return { ok: false, status: 401, error: "authentication_required" };
  }
  if (!CHILD_BROADCAST_EVENTS.has(input.event)) {
    return { ok: false, status: 400, error: "unsupported_broadcast_event" };
  }
  const payload = asPayload(input.payload);
  if (!payload) return { ok: false, status: 400, error: "invalid_broadcast_payload" };

  const activeChild = await db
    .prepare(
      `SELECT user_id FROM family_members
        WHERE family_id = ? AND user_id = ? AND role = 'child' AND is_active = 1
        LIMIT 1`,
    )
    .bind(input.familyId, callerUserId)
    .first<{ user_id: string }>();
  if (!activeChild?.user_id) {
    return { ok: false, status: 403, error: "active_child_required" };
  }

  const payloadFamilyId = nonEmptyString(payload.family_id) ?? nonEmptyString(payload.familyId);
  if (payloadFamilyId && payloadFamilyId !== input.familyId) {
    return { ok: false, status: 403, error: "broadcast_family_mismatch" };
  }

  if (input.event === "child_location" || input.event === "child_device_status") {
    if (!everyPresentIdentityMatches(payload, ["user_id", "userId"], callerUserId)) {
      return { ok: false, status: 403, error: "broadcast_identity_mismatch" };
    }
    const targetUserIds = await resolveRealtimeBroadcastAudience(db, input.familyId, {
      childUserId: callerUserId,
    });
    return {
      ok: true,
      targetUserId: null,
      targetUserIds,
      payload: {
        ...payload,
        family_id: input.familyId,
        user_id: callerUserId,
        userId: callerUserId,
      },
    };
  }

  if (!everyPresentIdentityMatches(payload, ["childUserId", "child_user_id"], callerUserId)) {
    return { ok: false, status: 403, error: "broadcast_identity_mismatch" };
  }
  const requestId = nonEmptyString(payload.requestId) ?? nonEmptyString(payload.request_id);
  if (!requestId) return { ok: false, status: 400, error: "request_id_required" };
  const audioData = nonEmptyString(payload.data);
  if (
    !audioData
    || audioData.length > MAX_AUDIO_BASE64_CHARS
    || audioData.length % 4 !== 0
    || !audioData.startsWith("UklGR")
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(audioData)
  ) {
    return { ok: false, status: 400, error: "invalid_audio_data" };
  }
  if (payload.mimeType !== "audio/wav") {
    return { ok: false, status: 400, error: "invalid_audio_mime_type" };
  }
  const sequenceNumber = Number(payload.sequenceNumber);
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 0) {
    return { ok: false, status: 400, error: "invalid_audio_sequence" };
  }
  const durationMs = Number(payload.durationMs);
  if (
    !Number.isSafeInteger(durationMs)
    || durationMs <= 0
    || durationMs > MAX_AUDIO_CHUNK_DURATION_MS
  ) {
    return { ok: false, status: 400, error: "invalid_audio_duration" };
  }

  const session = await db
    .prepare(
      `SELECT r.id AS session_id, r.initiator_user_id
         FROM remote_listen_sessions r
        WHERE r.family_id = ?1
          AND r.child_user_id = ?2
          AND r.id = ?3
          AND r.ended_at IS NULL
          AND r.consented_at IS NOT NULL
          AND substr(COALESCE(r.capture_expires_at, ''), 1, 23) > substr(?4, 1, 23)
        ORDER BY substr(r.started_at, 1, 23) DESC, r.id DESC
        LIMIT 1`,
    )
    .bind(input.familyId, callerUserId, requestId, input.now ?? currentTimestamp())
    .first<{ session_id: string; initiator_user_id: string | null }>();
  const initiatorUserId = nonEmptyString(session?.initiator_user_id);
  if (!initiatorUserId) {
    return { ok: false, status: 403, error: "remote_listen_session_required" };
  }

  const targetUserIds = await resolveRealtimeBroadcastAudience(db, input.familyId, {
    targetUserIds: [initiatorUserId],
  });
  if (targetUserIds.length !== 1) {
    return { ok: false, status: 403, error: "remote_listen_session_required" };
  }

  return {
    ok: true,
    targetUserId: initiatorUserId,
    targetUserIds,
    payload: {
      data: audioData,
      mimeType: "audio/wav",
      childUserId: callerUserId,
      requestId,
      initiatorUserId,
      sequenceNumber,
      durationMs,
    },
  };
}

export const REMOTE_LISTEN_DURATION_SEC = 60;

const REMOTE_LISTEN_END_REASONS = new Set([
  "timeout",
  "request_timeout",
  "user_stop",
  "unmount",
  "unmount_before_command",
  "command_failed",
  "no_target_device",
  "audio_auth_failed",
  "audio_upload_failed",
]);
const REMOTE_LISTEN_COMMAND_HTTP_STATUSES = new Set([
  400, 401, 402, 403, 404, 409, 429, 500, 502, 503, 504,
]);

export type RemoteListenCommandAction = "remote_listen" | "remote_listen_stop";

export type RemoteListenCommandAuthorization =
  | { ok: true; targetUserId: string; requestId: string }
  | { ok: false; error: "remote_listen_session_mismatch" };

export async function authorizeRemoteListenCommand(
  db: D1Database,
  args: {
    action: RemoteListenCommandAction;
    familyId: string;
    callerUserId: string;
    targetUserId: string;
    requestId: string;
  },
): Promise<RemoteListenCommandAuthorization> {
  const row = await db
    .prepare(
      `SELECT r.id
         FROM remote_listen_sessions r
         JOIN family_members child
           ON child.family_id = r.family_id
          AND child.user_id = r.child_user_id
          AND child.role = 'child'
          AND child.is_active = 1
        WHERE r.id = ?1
          AND r.family_id = ?2
          AND r.initiator_user_id = ?3
          AND r.child_user_id = ?4
          AND r.ended_at IS NULL
        LIMIT 1`,
    )
    .bind(args.requestId, args.familyId, args.callerUserId, args.targetUserId)
    .first<{ id: string }>();
  if (!row?.id) return { ok: false, error: "remote_listen_session_mismatch" };
  return { ok: true, targetUserId: args.targetUserId, requestId: args.requestId };
}

export function normalizeRemoteListenEndReason(value: unknown): string {
  if (typeof value !== "string") return "unspecified";
  const reason = value.trim();
  if (REMOTE_LISTEN_END_REASONS.has(reason)) return reason;
  const commandHttp = /^command_http_(\d{3})$/.exec(reason);
  if (commandHttp && REMOTE_LISTEN_COMMAND_HTTP_STATUSES.has(Number(commandHttp[1]))) {
    return reason;
  }
  return "unspecified";
}

export function remoteListenDurationMs(startedAt: unknown, nowMs = Date.now()): number {
  if (typeof startedAt !== "string" || !Number.isFinite(nowMs)) return 0;
  const normalized = startedAt.trim()
    .replace(" ", "T")
    .replace(/\+00(?::?00)?$/, "Z");
  const startedAtMs = Date.parse(normalized);
  if (!Number.isFinite(startedAtMs)) return 0;
  return Math.min(REMOTE_LISTEN_DURATION_SEC * 1000, Math.max(0, Math.trunc(nowMs - startedAtMs)));
}

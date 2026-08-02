import { pgToMs, pgTs } from "./time.ts";
import { remoteListenDurationMs } from "./remoteListenSecurity.ts";

const REQUEST_TIMEOUT_WITH_SETTLE_MS = 65_000;

export interface RemoteListenExpiryRow {
  started_at: string;
  consented_at: string | null;
  capture_expires_at: string | null;
  ended_at: string | null;
}

export interface RemoteListenExpiryDecision {
  endedAtMs: number;
  durationMs: number;
  endReason: "request_timeout" | "timeout";
}

export function resolveRemoteListenExpiry(
  row: RemoteListenExpiryRow,
  nowMs = Date.now(),
): RemoteListenExpiryDecision | null {
  if (row.ended_at || !Number.isFinite(nowMs)) return null;
  const startedAtMs = pgToMs(row.started_at);
  if (!Number.isFinite(startedAtMs)) return null;

  if (row.consented_at) {
    const captureExpiresAtMs = pgToMs(row.capture_expires_at);
    if (!Number.isFinite(captureExpiresAtMs) || nowMs < captureExpiresAtMs) return null;
    return {
      endedAtMs: captureExpiresAtMs,
      durationMs: remoteListenDurationMs(row.consented_at, captureExpiresAtMs),
      endReason: "timeout",
    };
  }

  const requestDeadlineMs = startedAtMs + REQUEST_TIMEOUT_WITH_SETTLE_MS;
  if (nowMs < requestDeadlineMs) return null;
  return {
    endedAtMs: requestDeadlineMs,
    durationMs: 0,
    endReason: "request_timeout",
  };
}

interface CloseExpiredOptions {
  familyId?: string;
  sessionId?: string;
  limit?: number;
}

/** 조회/cron 공용. WHERE ended_at IS NULL 조건으로 여러 실행도 멱등이다. */
export async function closeExpiredRemoteListenSessions(
  db: D1Database,
  nowMs = Date.now(),
  options: CloseExpiredOptions = {},
): Promise<number> {
  const limit = Math.min(500, Math.max(1, Math.trunc(options.limit ?? 200)));
  const filters = ["ended_at IS NULL"];
  const bindings: unknown[] = [];
  if (options.familyId) {
    filters.push("family_id = ?");
    bindings.push(options.familyId);
  }
  if (options.sessionId) {
    filters.push("id = ?");
    bindings.push(options.sessionId);
  }
  bindings.push(limit);

  const { results } = await db.prepare(
    `SELECT id, started_at, consented_at, capture_expires_at, ended_at
       FROM remote_listen_sessions
      WHERE ${filters.join(" AND ")}
      ORDER BY substr(started_at, 1, 23) ASC
      LIMIT ?`,
  )
    .bind(...bindings)
    .all<(RemoteListenExpiryRow & { id: string })>();

  const updates: D1PreparedStatement[] = [];
  for (const row of results ?? []) {
    const decision = resolveRemoteListenExpiry(row, nowMs);
    if (!decision) continue;
    updates.push(db.prepare(
      `UPDATE remote_listen_sessions
          SET ended_at = ?, duration_ms = ?, end_reason = ?
        WHERE id = ? AND ended_at IS NULL`,
    ).bind(
      pgTs(new Date(decision.endedAtMs)),
      decision.durationMs,
      decision.endReason,
      row.id,
    ));
  }
  if (updates.length === 0) return 0;
  await db.batch(updates);
  return updates.length;
}

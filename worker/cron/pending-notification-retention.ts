// 만료 알림은 표시·ACK 복구를 위한 24시간 grace 뒤 bounded batch로 회수한다.
// parent_alerts가 사용자 알림 이력의 정본이므로 delivery queue 본문을 무기한 보존하지 않는다.
import type { Env } from "../types";
import { tsNorm } from "../lib/time";

export const PENDING_NOTIFICATION_RETENTION_GRACE_MS = 24 * 60 * 60_000;
export const PENDING_NOTIFICATION_RETENTION_BATCH = 5_000;

export async function cleanupPendingNotificationRetention(
  db: D1Database,
  now = new Date(),
  requestedLimit = PENDING_NOTIFICATION_RETENTION_BATCH,
): Promise<{ removed: number }> {
  const limit = Math.max(
    1,
    Math.min(PENDING_NOTIFICATION_RETENTION_BATCH, Math.trunc(requestedLimit)),
  );
  const cutoff = tsNorm(
    new Date(now.getTime() - PENDING_NOTIFICATION_RETENTION_GRACE_MS).toISOString(),
  );
  const result = await db.prepare(
    `DELETE FROM pending_notifications
      WHERE id IN (
        SELECT id FROM pending_notifications
         WHERE replace(substr(expires_at, 1, 19), 'T', ' ') <= ?
         ORDER BY replace(substr(expires_at, 1, 19), 'T', ' ') ASC, id ASC
         LIMIT ?
      )`,
  ).bind(cutoff, limit).run();
  return { removed: Number(result.meta?.changes ?? 0) };
}

export async function run(env: Env): Promise<{ removed: number }> {
  return cleanupPendingNotificationRetention(env.DB);
}

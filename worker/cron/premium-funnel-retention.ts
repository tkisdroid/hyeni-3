import type { Env } from "../types";

export const PREMIUM_FUNNEL_RETENTION_DAYS = 180;
export const PREMIUM_FUNNEL_DELETE_BATCH = 5_000;
const RATE_WINDOW_RETENTION_MS = 48 * 60 * 60_000;

export async function cleanupPremiumFunnelRetention(
  db: D1Database,
  now = new Date(),
): Promise<{
  removedEvents: number;
  removedRateWindows: number;
  removedLifecycleEvents: number;
  removedLifecycleDays: number;
}> {
  const eventCutoff = new Date(
    now.getTime() - PREMIUM_FUNNEL_RETENTION_DAYS * 24 * 60 * 60_000,
  ).toISOString();
  const rateCutoff = new Date(now.getTime() - RATE_WINDOW_RETENTION_MS).toISOString();
  const [events, rateWindows, lifecycleEvents, lifecycleDays] = await db.batch([
    db.prepare(
      `DELETE FROM premium_funnel_events
        WHERE event_id IN (
          SELECT event_id FROM premium_funnel_events
           WHERE received_at <= ? ORDER BY received_at ASC, event_id ASC LIMIT ?
        )`,
    ).bind(eventCutoff, PREMIUM_FUNNEL_DELETE_BATCH),
    db.prepare(
      `DELETE FROM premium_funnel_rate_limits
        WHERE rowid IN (
          SELECT rowid FROM premium_funnel_rate_limits
           WHERE updated_at <= ? ORDER BY updated_at ASC, rowid ASC LIMIT ?
        )`,
    ).bind(rateCutoff, PREMIUM_FUNNEL_DELETE_BATCH),
    db.prepare(
      `DELETE FROM family_lifecycle_events
        WHERE event_id IN (
          SELECT event_id FROM family_lifecycle_events
           WHERE received_at <= ? ORDER BY received_at ASC, event_id ASC LIMIT ?
        )`,
    ).bind(eventCutoff, PREMIUM_FUNNEL_DELETE_BATCH),
    db.prepare(
      `DELETE FROM family_lifecycle_daily
        WHERE rowid IN (
          SELECT rowid FROM family_lifecycle_daily
           WHERE updated_at <= ? ORDER BY updated_at ASC, rowid ASC LIMIT ?
        )`,
    ).bind(eventCutoff, PREMIUM_FUNNEL_DELETE_BATCH),
  ]);
  return {
    removedEvents: Number(events?.meta?.changes ?? 0),
    removedRateWindows: Number(rateWindows?.meta?.changes ?? 0),
    removedLifecycleEvents: Number(lifecycleEvents?.meta?.changes ?? 0),
    removedLifecycleDays: Number(lifecycleDays?.meta?.changes ?? 0),
  };
}

export async function run(env: Env): Promise<{
  removedEvents: number;
  removedRateWindows: number;
  removedLifecycleEvents: number;
  removedLifecycleDays: number;
}> {
  return cleanupPremiumFunnelRetention(env.DB);
}

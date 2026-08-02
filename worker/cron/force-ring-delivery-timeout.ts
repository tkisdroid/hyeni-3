// force_ring_delivery_timeout (cron */2) — 10분 넘은 미전달 force_ring 이벤트 정리.
import type { Env } from "../types";
import { pgNow, tsNorm } from "../lib/time";

export async function run(env: Env): Promise<Record<string, unknown>> {
  const cutoff = tsNorm(new Date(Date.now() - 10 * 60 * 1000).toISOString());
  const stoppedAt = pgNow();
  const result = await env.DB
    .prepare(
      `UPDATE force_ring_events
          SET stopped_at = ?, stop_reason = 'delivery_failed'
        WHERE delivered_at IS NULL
          AND stopped_at IS NULL
          AND substr(triggered_at, 1, 19) < ?`,
    )
    .bind(stoppedAt, cutoff)
    .run();

  return { timed_out: result.meta.changes ?? 0 };
}

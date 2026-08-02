// cleanup_push_idempotency (cron 0 * * * *) — 24시간 지난 푸시 멱등 키 제거.
import type { Env } from "../types";
import { tsNorm } from "../lib/time";

export async function run(env: Env): Promise<Record<string, unknown>> {
  const cutoff = tsNorm(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const result = await env.DB
    .prepare("DELETE FROM push_idempotency WHERE substr(created_at, 1, 19) < ?")
    .bind(cutoff)
    .run();

  return { deleted: result.meta.changes ?? 0 };
}

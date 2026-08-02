// force_ring_reminder_check (cron * * * * *) — delivery 후 5분 무응답 부모 리마인더.
import type { Env } from "../types";
import type { PushEnv } from "../lib/pushEnv";
import { handleForceRingReminder } from "../routes/push-notify";

export async function run(env: Env): Promise<Record<string, unknown>> {
  const res = await handleForceRingReminder(env as PushEnv, env.DB, "service_role");
  const body = (await res.json().catch(() => ({ ok: res.ok }))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`force-ring reminder failed (${res.status}): ${JSON.stringify(body).slice(0, 500)}`);
  }
  return { ...body, status: res.status };
}

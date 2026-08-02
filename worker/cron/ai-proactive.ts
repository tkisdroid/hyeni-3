// ai_proactive_generate_cron (cron */10) — 허용된 자녀에게 AI 친구 선제 메시지 큐잉.
import type { Env } from "../types";
import { runScheduledProactive } from "../routes/ai-proactive";

export async function run(env: Env): Promise<Record<string, unknown>> {
  return runScheduledProactive(env, env.DB, {
    limit: 50,
    minIntervalMinutes: 360,
  });
}

// push-notify (cron * * * * *) — 15/5/0분 일정 리마인더 + 미도착 긴급 알림.
// 라우트 핸들러를 직접 재사용해 FCM/Web Push/pending_notifications/멱등 경로를 하나로 유지한다.
import type { Env } from "../types";
import type { PushEnv } from "../lib/pushEnv";
import { handleCronNotification } from "../routes/push-notify";

export async function run(env: Env): Promise<Record<string, unknown>> {
  const res = await handleCronNotification(env as PushEnv, env.DB);
  let rawBody: unknown = null;

  try {
    rawBody = await res.json();
  } catch {
    rawBody = { ok: res.ok };
  }

  const body =
    typeof rawBody === "object" && rawBody !== null
      ? (rawBody as Record<string, unknown>)
      : { body: String(rawBody) };

  if (!res.ok) {
    throw new Error(`push-notify cron failed (${res.status}): ${JSON.stringify(body).slice(0, 500)}`);
  }

  return { ...body, status: res.status };
}

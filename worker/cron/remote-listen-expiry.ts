import type { Env } from "../types.ts";
import { closeExpiredRemoteListenSessions } from "../lib/remoteListenExpiry.ts";

export async function run(env: Env): Promise<{ closed: number }> {
  const closed = await closeExpiredRemoteListenSessions(env.DB, Date.now(), { limit: 500 });
  return { closed };
}

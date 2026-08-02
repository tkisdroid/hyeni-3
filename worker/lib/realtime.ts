// write 라우트 → FamilyRoom DO 변경 통지 헬퍼. write 성공 후 호출하면 DO가
// 구독 클라(부모/자녀 기기)에 fan-out 한다. Supabase postgres_changes 대체.
//
// best-effort: 통지 실패가 write 응답을 막지 않는다(클라는 missed-refetch 로 회복).
import type { Env } from "../types";
import { buildRealtimePgEnvelope } from "./realtimeAudience.ts";

type PgEvent = "INSERT" | "UPDATE" | "DELETE";

async function send(env: Env, familyId: string, msg: unknown, strict = false): Promise<void> {
  if (!familyId) return;
  try {
    const id = env.FAMILY_ROOM.idFromName(familyId);
    const stub = env.FAMILY_ROOM.get(id);
    const response = await stub.fetch("https://do.internal/notify", {
      method: "POST",
      body: JSON.stringify(msg),
    });
    if (strict && !response.ok) throw new Error("realtime_notify_failed");
  } catch (e) {
    if (strict) throw e;
    console.error("[realtime] notify failed");
  }
}

// postgres_changes 한 건 통지. newRow/oldRow 는 클라가 기대하는 Supabase 행 형태.
export function notifyPg(
  env: Env,
  familyId: string,
  table: string,
  eventType: PgEvent,
  newRow: unknown,
  oldRow: unknown = null,
  options: { strict?: boolean; targetUserIds?: readonly string[] } = {},
): Promise<void> {
  if (!familyId) return Promise.resolve();
  return buildRealtimePgEnvelope(env.DB, {
    familyId,
    table,
    eventType,
    newRow,
    oldRow,
    targetUserIds: options.targetUserIds,
  })
    .then((message) => {
      if (message.targetUserIds.length === 0) return;
      return send(env, familyId, message, options.strict === true);
    })
    .catch((error) => {
      if (options.strict) throw error;
      console.error("[realtime] audience resolution failed");
    });
}

export async function revokeFamilyRealtimeUser(
  env: Pick<Env, "FAMILY_ROOM">,
  familyId: string,
  userId: string,
): Promise<void> {
  if (!familyId || !userId) return;
  const id = env.FAMILY_ROOM.idFromName(familyId);
  const stub = env.FAMILY_ROOM.get(id);
  const response = await stub.fetch("https://do.internal/revoke-user", {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) throw new Error(`realtime_revoke_failed:${response.status}`);
}

export async function revokeFamilyRealtimeUsers(
  env: Pick<Env, "FAMILY_ROOM">,
  familyId: string,
  userIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(userIds.map((value) => value.trim()).filter(Boolean))];
  await Promise.all(unique.map((userId) => revokeFamilyRealtimeUser(env, familyId, userId)));
}

// 선생님 룸(TEACHER_ROOM)으로 통지 — teacher_notification_batches 처럼 teacher_id 키인
// 테이블 전용. FamilyRoom(family_id)으로는 격리가 안 맞아 분리한다(notifyPg 와 동일 형식).
async function sendTeacher(env: Env, teacherId: string, msg: unknown): Promise<void> {
  if (!teacherId) return;
  try {
    const id = env.TEACHER_ROOM.idFromName(teacherId);
    const stub = env.TEACHER_ROOM.get(id);
    await stub.fetch("https://do.internal/notify", {
      method: "POST",
      body: JSON.stringify(msg),
    });
  } catch (e) {
    console.error("[realtime] notifyTeacher failed");
  }
}

export function notifyTeacher(
  env: Env,
  teacherId: string,
  table: string,
  eventType: PgEvent,
  newRow: unknown,
  oldRow: unknown = null,
): Promise<void> {
  return sendTeacher(env, teacherId, { kind: "pg", table, eventType, new: newRow ?? null, old: oldRow ?? null });
}

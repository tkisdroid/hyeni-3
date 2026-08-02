// SOS audit log write API. sos.js sendSos + App.jsx 꾹(kkuk) 의 sos_events insert 직역.
// 원본 RLS(sos_events_insert): family_id ∈ 내 가족 AND sender_user_id = auth.uid().
// 설계상 immutable append-only audit — UPDATE/DELETE 없음. fire-and-forget(클라가
// 반환을 무시)이라 실패해도 긴급 신호를 막지 않는다.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { assertSafetyFamilyAccess } from "../db/authz";
import { pgNow, tsNorm } from "../lib/time";
import { toPgArray } from "../lib/serialize";

const sos = new Hono<{ Bindings: Env; Variables: Vars }>();

// GET /api/sos/kkuk-cooldown — kkuk_check_cooldown(sender) RPC 직역.
// 호출자(sender)가 최근 5초 내 sos_events 를 보낸 적이 없으면 true(다시 발사 가능),
// 있으면 false(쓰로틀). 원본 RPC 는 p_sender 파라미터를 받지만 클라가 항상 본인
// (authUser.id)을 넘기므로 인증 사용자(user.sub)를 sender 로 고정한다(파라미터 위조 차단).
// 클라는 이 호출이 throw 하면 fail-open(그냥 발사)하므로 긴급 신호를 막지 않는다.
sos.get("/kkuk-cooldown", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const cut5 = tsNorm(new Date(Date.now() - 5000).toISOString());
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM sos_events
      WHERE sender_user_id = ? AND substr(triggered_at, 1, 19) > ?`,
  )
    .bind(uid, cut5)
    .first<{ n: number }>();
  return c.json(Number(row?.n ?? 0) === 0);
});

// POST /api/sos/events — sos_events insert
// body: { family_id, sender_user_id, receiver_user_ids[], delivery_status{}, client_request_hash }
sos.post("/events", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const b = await c.req
    .json<{
      family_id?: string;
      sender_user_id?: string;
      receiver_user_ids?: string[];
      delivery_status?: Record<string, unknown>;
      client_request_hash?: string;
    }>()
    .catch(() => ({}) as any);

  const familyId = b.family_id ?? "";
  const senderUserId = b.sender_user_id ?? "";
  if (!familyId || !senderUserId) return c.json({ error: "bad_request" }, 400);

  // RLS sos_events_insert: 가족 소속 + 발신자 본인만.
  if (senderUserId !== uid) return c.json({ error: "forbidden" }, 403);
  if (!(await assertSafetyFamilyAccess(c.env.DB, uid, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const id = crypto.randomUUID();
  const now = pgNow();
  const receivers = Array.isArray(b.receiver_user_ids) ? b.receiver_user_ids : [];
  const delivery = b.delivery_status ? JSON.stringify(b.delivery_status) : "{}";
  await c.env.DB.prepare(
    `INSERT INTO sos_events
       (id, family_id, sender_user_id, receiver_user_ids, triggered_at, delivery_status, client_request_hash, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  )
    .bind(id, familyId, senderUserId, toPgArray(receivers), now, delivery, b.client_request_hash ?? null, now)
    .run();

  return c.json({ ok: true, id });
});

export default sos;

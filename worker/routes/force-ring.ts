// 응급 강제 알람(force_ring) read API. src/lib/forceRing.js 의 supabase read 를 D1 직역.
//   · fetchActiveForceRing  → GET /api/force-ring/active   (진행 중 행 1건 또는 null)
//   · fetchForceRingHistory → GET /api/force-ring/history  (최근 이력)
//   · force_ring_check_quota RPC → GET /api/force-ring/quota (push-notify.ts 의 quota 로직 재사용)
//
// force_ring 발사(trigger)·정지(stop)·realtime 구독은 이미 시임됨(push-notify 라우트 action +
// FamilyRoom DO onForceRingChange). 이 라우트는 패널 부팅 시 read 3종만 담당한다.
//
// timestamp 정규화: ForceRingHistory.jsx / ForceRingActiveStatus.jsx 가
// new Date(triggered_at|delivered_at|acknowledged_at) 로 파싱하므로 D1 pg 형식
// ('YYYY-MM-DD HH:MM:SS.ffffff+00')을 pgToIso 로 ISO 정규화해 돌려준다.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { assertFamilyAccess } from "../db/authz";
import { pgToIso, tsNorm } from "../lib/time";
import { forceRingCheckQuota } from "./push-notify";

const forceRing = new Hono<{ Bindings: Env; Variables: Vars }>();

// force_ring_events row 의 timestamp 컬럼을 ISO 로 정규화(클라 new Date() 안전).
function hydrate(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    triggered_at: r.triggered_at ? pgToIso(r.triggered_at as string) : null,
    delivered_at: r.delivered_at ? pgToIso(r.delivered_at as string) : null,
    acknowledged_at: r.acknowledged_at ? pgToIso(r.acknowledged_at as string) : null,
    stopped_at: r.stopped_at ? pgToIso(r.stopped_at as string) : null,
  };
}

// GET /api/force-ring/active?family_id=... — fetchActiveForceRing
// 진행 중(stopped_at IS NULL) 최신 1건 또는 null. RLS(가족 select)→assertFamilyAccess.
// 10분 초과 미정지(zombie) 행은 제외 — 좀비가 "진행 중 · 12일치 울린 시간"으로 표시되고
// 새 발사를 423 으로 막던 버그 방지(발사 가드·quota 의 zombie 컷과 동일 기준).
forceRing.get("/active", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const familyId = c.req.query("family_id") ?? "";
  if (!(await assertFamilyAccess(c.env.DB, uid, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const cutZombie = tsNorm(new Date(Date.now() - 10 * 60 * 1000).toISOString());
  const row = await c.env.DB.prepare(
    `SELECT id, initiator_user_id, target_user_id, message, triggered_at,
            delivered_at, acknowledged_at, stopped_at, stop_reason
       FROM force_ring_events
      WHERE family_id = ? AND stopped_at IS NULL AND substr(triggered_at, 1, 19) > ?
      ORDER BY substr(triggered_at, 1, 19) DESC
      LIMIT 1`,
  )
    .bind(familyId, cutZombie)
    .first<Record<string, unknown>>();
  if (!row) return c.json(null);
  return c.json(hydrate(row));
});

// GET /api/force-ring/history?family_id=...&limit=10 — fetchForceRingHistory
forceRing.get("/history", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const familyId = c.req.query("family_id") ?? "";
  if (!(await assertFamilyAccess(c.env.DB, uid, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const rawLimit = Number(c.req.query("limit") ?? 10) || 10;
  const limit = Math.max(1, Math.min(rawLimit, 50));
  const { results } = await c.env.DB.prepare(
    `SELECT id, initiator_user_id, message, triggered_at,
            delivered_at, acknowledged_at, stopped_at, stop_reason
       FROM force_ring_events
      WHERE family_id = ?
      ORDER BY substr(triggered_at, 1, 19) DESC
      LIMIT ?`,
  )
    .bind(familyId, limit)
    .all<Record<string, unknown>>();
  return c.json((results ?? []).map(hydrate));
});

// GET /api/force-ring/quota?family_id=... — force_ring_check_quota RPC 직역
// push-notify.ts forceRingCheckQuota 재사용 → { allowed, quota, used, tier }.
forceRing.get("/quota", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const familyId = c.req.query("family_id") ?? "";
  if (!(await assertFamilyAccess(c.env.DB, uid, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  try {
    const quota = await forceRingCheckQuota(c.env.DB, familyId);
    return c.json(quota);
  } catch (error) {
    console.error("force-ring quota read failed:");
    return c.json({ error: "feature_usage_unavailable" }, 503);
  }
});

export default forceRing;

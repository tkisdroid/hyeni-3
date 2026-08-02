// 원격청취 세션 audit API. remoteAudioCapture.js 의 remote_listen_sessions
// insert(세션 시작)/update(세션 종료) 를 D1 로 직역.
// 원본 RLS:
//   · insert: family_id ∈ 내 가족
//   · update: family_id ∈ 내 가족 AND (initiator_user_id=auth.uid() OR child_user_id=auth.uid())
// 종료 update 는 단발(single-shot)이며 행이 없으면 멱등 no-op 으로 처리한다.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { assertFamilyAccess, resolveVerifiedFamilyMembership } from "../db/authz";
import { pgNow, pgToMs } from "../lib/time";
import {
  normalizeRemoteListenEndReason,
  remoteListenDurationMs,
} from "../lib/remoteListenSecurity";
import { authorizeRemoteListenConsent } from "../lib/remoteListenConsent";
import { closeExpiredRemoteListenSessions } from "../lib/remoteListenExpiry";
import { resolveFamilyEntitlement } from "../shared/subscriptionEntitlement.js";

const rl = new Hono<{ Bindings: Env; Variables: Vars }>();

// GET /api/remote-listen/sessions?family_id=...&limit=50
// 가족의 활성 부모만 감사 기록을 조회한다. 오디오 내용은 저장·반환하지 않고,
// 요청자·대상·시작/종료·종료 사유 메타데이터만 최신순으로 제공한다.
rl.get("/sessions", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const familyId = c.req.query("family_id") ?? "";
  const membership = await resolveVerifiedFamilyMembership(c.env.DB, uid, familyId);
  if (!membership || membership.role !== "parent") {
    return c.json({ error: "forbidden" }, 403);
  }
  await closeExpiredRemoteListenSessions(c.env.DB, Date.now(), { familyId, limit: 200 });
  const requestedLimit = Number(c.req.query("limit"));
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(100, Math.max(1, Math.floor(requestedLimit)))
    : 50;
  const { results } = await c.env.DB.prepare(
    `SELECT r.id,
            r.initiator_user_id,
            CASE
              WHEN f.parent_id = r.initiator_user_id THEN '주 보호자'
              ELSE COALESCE(pm.name, '보호자')
            END AS initiator_name,
            r.child_user_id,
            COALESCE(cm.name, '아이') AS child_name,
            r.started_at,
            r.consented_at,
            r.capture_expires_at,
            r.ended_at,
            r.duration_ms,
            r.end_reason
       FROM remote_listen_sessions r
       JOIN families f ON f.id = r.family_id
       LEFT JOIN family_members pm
         ON pm.family_id = r.family_id AND pm.user_id = r.initiator_user_id AND pm.role = 'parent'
       LEFT JOIN family_members cm
         ON cm.family_id = r.family_id AND cm.user_id = r.child_user_id AND cm.role = 'child'
      WHERE r.family_id = ?
      ORDER BY substr(r.started_at,1,23) DESC, r.id DESC
      LIMIT ?`,
  )
    .bind(familyId, limit)
    .all<Record<string, unknown>>();
  return c.json(results ?? []);
});

// GET /api/remote-listen/sessions/:id?family_id=...
// 요청한 부모 본인이 시작한 단일 세션의 동의·종료 시각만 반환한다.
// 부모 카운트다운은 기기 시각이 아니라 server_now_ms/capture_expires_at_ms를 정본으로 쓴다.
rl.get("/sessions/:id", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const familyId = c.req.query("family_id") ?? "";
  const membership = await resolveVerifiedFamilyMembership(c.env.DB, uid, familyId);
  if (!membership || membership.role !== "parent") {
    return c.json({ error: "forbidden" }, 403);
  }
  await closeExpiredRemoteListenSessions(c.env.DB, Date.now(), {
    familyId,
    sessionId: c.req.param("id"),
    limit: 1,
  });
  const row = await c.env.DB.prepare(
    `SELECT r.id, r.child_user_id, r.started_at, r.consented_at,
            r.capture_expires_at, r.ended_at, r.end_reason
       FROM remote_listen_sessions r
      WHERE r.id = ?
        AND r.family_id = ?
        AND r.initiator_user_id = ?
      LIMIT 1`,
  )
    .bind(c.req.param("id"), familyId, uid)
    .first<{
      id: string;
      child_user_id: string | null;
      started_at: string;
      consented_at: string | null;
      capture_expires_at: string | null;
      ended_at: string | null;
      end_reason: string | null;
    }>();
  if (!row) return c.json({ error: "not_found" }, 404);

  const asNullableMs = (value: string | null): number | null => {
    const parsed = pgToMs(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return c.json({
    id: row.id,
    child_user_id: row.child_user_id,
    started_at_ms: asNullableMs(row.started_at),
    consented_at_ms: asNullableMs(row.consented_at),
    capture_expires_at_ms: asNullableMs(row.capture_expires_at),
    ended_at_ms: asNullableMs(row.ended_at),
    end_reason: row.end_reason,
    server_now_ms: Date.now(),
  });
});

// GET /api/remote-listen/flag?family_id=... — remote_listen_enabled kill-switch read.
// remoteAudioCapture.js 가 마이크 캡처 전 family_subscription.remote_listen_enabled 를
// 조회(maybeSingle)하던 것을 직역. 구독 행이 없으면 null(클라 maybeSingle null 과 동일 —
// 기본 허용). 컬럼은 D1 INTEGER(0/1/null)이라 0→false / 1→true / null→null 로 변환해
// 클라의 `flagRow.remote_listen_enabled === false` 게이트(하드 FALSE 만 차단)와 정합한다.
rl.get("/flag", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const familyId = c.req.query("family_id") ?? "";
  if (!(await assertFamilyAccess(c.env.DB, uid, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const row = await c.env.DB.prepare(
    `SELECT remote_listen_enabled FROM family_subscription WHERE family_id = ? LIMIT 1`,
  )
    .bind(familyId)
    .first<{ remote_listen_enabled: number | null }>();
  if (!row) return c.json(null); // 구독 행 없음 → 기본 허용
  const v = row.remote_listen_enabled;
  const flag = v == null ? null : Number(v) === 0 ? false : true;
  return c.json({ remote_listen_enabled: flag });
});

// POST /api/remote-listen/sessions — 세션 시작 audit 행 (마이크 캡처 전 선기록)
// body: { family_id, initiator_user_id, child_user_id, started_at? } → { id }
rl.post("/sessions", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const b = await c.req
    .json<{
      family_id?: string;
      initiator_user_id?: string | null;
      child_user_id?: string | null;
      started_at?: string | null;
    }>()
    .catch(() => ({}) as any);

  const familyId = b.family_id ?? "";
  const membership = await resolveVerifiedFamilyMembership(c.env.DB, uid, familyId);
  if (!membership || membership.role !== "parent") {
    return c.json({ error: "forbidden" }, 403);
  }
  const family = await c.env.DB.prepare(
    "SELECT parent_id FROM families WHERE id = ? LIMIT 1",
  ).bind(familyId).first<{ parent_id: string | null }>();
  if (family?.parent_id !== uid) {
    return c.json({ error: "primary_parent_required" }, 403);
  }

  try {
    const entitlement = await resolveFamilyEntitlement(c.env.DB, familyId);
    if (!entitlement.isPremium) {
      return c.json({ error: "remote_listen_requires_premium" }, 402);
    }
    if (!entitlement.remoteListenEnabled) {
      return c.json({ error: "remote_listen_disabled_by_family" }, 403);
    }
  } catch {
    return c.json({ error: "remote_listen_entitlement_unavailable" }, 503);
  }

  const childUserId = String(b.child_user_id ?? "");
  const child = await c.env.DB.prepare(
    `SELECT user_id FROM family_members
      WHERE family_id = ? AND user_id = ? AND role = 'child' AND is_active = 1
      LIMIT 1`,
  ).bind(familyId, childUserId).first<{ user_id: string }>();
  if (!child?.user_id) return c.json({ error: "invalid_child_target" }, 403);

  const id = crypto.randomUUID();
  const now = pgNow();
  await c.env.DB.prepare(
    `INSERT INTO remote_listen_sessions
       (id, family_id, initiator_user_id, child_user_id, started_at, created_at)
     VALUES (?,?,?,?,?,?)`,
  )
    .bind(id, familyId, uid, child.user_id, now, now)
    .run();

  return c.json({ id });
});

// POST /api/remote-listen/sessions/:id/consent — 대상 아이 기기의 투명 고지 화면이 서버 승인 증표를 1회 확정.
// 성공한 서버 시각부터 정확히 60초만 WAV 중계를 허용한다.
rl.post("/sessions/:id/consent", requireAuth, async (c) => {
  const childUserId = c.get("user").sub;
  const result = await authorizeRemoteListenConsent(c.env.DB, {
    requestId: c.req.param("id"),
    childUserId,
  });
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({
    consented_at: result.consentedAt,
    capture_expires_at: result.captureExpiresAt,
    capture_expires_at_ms: result.captureExpiresAtMs,
  });
});

// PATCH /api/remote-listen/sessions/:id — 세션 종료(ended_at / duration_ms / end_reason)
// body: { ended_at?, duration_ms?, end_reason? }
rl.patch("/sessions/:id", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const id = c.req.param("id");
  const b = await c.req
    .json<{ ended_at?: string | null; duration_ms?: number | null; end_reason?: string | null }>()
    .catch(() => ({}) as any);

  const row = await c.env.DB.prepare(
    `SELECT family_id, initiator_user_id, child_user_id, started_at, consented_at, ended_at
       FROM remote_listen_sessions WHERE id = ?`,
  )
    .bind(id)
    .first<{
      family_id: string;
      initiator_user_id: string | null;
      child_user_id: string | null;
      started_at: string;
      consented_at: string | null;
      ended_at: string | null;
    }>();
  if (!row) return c.json({ ok: true }); // 이미 없음 — 멱등

  // RLS rls_remote_listen_update_owner: 가족 소속 + (initiator 또는 child 본인)
  const isOwner = row.initiator_user_id === uid || row.child_user_id === uid;
  if (!isOwner || !(await assertFamilyAccess(c.env.DB, uid, row.family_id))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const nowMs = Date.now();
  const endedAt = pgNow();
  const durationMs = row.consented_at
    ? remoteListenDurationMs(row.consented_at, nowMs)
    : 0;
  const endReason = normalizeRemoteListenEndReason(b.end_reason);
  await c.env.DB.prepare(
    `UPDATE remote_listen_sessions
        SET ended_at = ?, duration_ms = ?, end_reason = ?
      WHERE id = ? AND ended_at IS NULL`,
  )
    .bind(endedAt, durationMs, endReason, id)
    .run();

  return c.json({ ok: true });
});

export default rl;

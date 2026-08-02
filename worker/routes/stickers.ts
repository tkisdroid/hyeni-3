// 스티커 read API. SECURITY DEFINER RPC 3종을 D1 SQL로 직역.
//   GET /api/stickers/date      ← get_stickers_for_date(p_family_id, p_date_key)
//   GET /api/stickers/summary   ← get_sticker_summary(p_family_id)
//   GET /api/stickers/received  ← get_received_praise_stickers(p_family_id, p_user_id)
// RPC의 게이트는 모두 "p_family_id IN get_my_family_ids()" → assertFamilyAccess로 대체.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { pgNow } from "../lib/time";
import { assertFamilyAccess, resolveVerifiedFamilyMembership } from "../db/authz";
import { notifyPg } from "../lib/realtime";
import type { PushEnv } from "../lib/pushEnv";
import { sendFcmToFamily } from "./push-notify";
import {
  acquireAccountMutationLeases,
  isActiveChildMutationTarget,
  loadFamilyNotificationMutationScopes,
  releaseAccountMutationLeases,
} from "../lib/accountMutationScope";
import { partitionNotificationRecipients } from "../lib/notificationQuietHours";

const stickers = new Hono<{ Bindings: Env; Variables: Vars }>();

const CHILD_STICKER_TYPES = new Set(["early", "on_time", "late"]);

function stickerTitle(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "칭찬";
}

// GET /api/stickers/date?family_id=...&date_key=...
stickers.get("/date", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const dateKey = c.req.query("date_key") ?? "";
  const user = c.get("user");

  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, user_id, event_id, sticker_type, emoji, title, earned_at
       FROM stickers
      WHERE family_id = ? AND date_key = ?
      ORDER BY earned_at`,
  )
    .bind(familyId, dateKey)
    .all();

  return c.json(results ?? []);
});

// GET /api/stickers/summary?family_id=...
stickers.get("/summary", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const user = c.get("user");

  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  // COUNT(*) FILTER 동등 — 호환성을 위해 SUM(CASE) 사용.
  const { results } = await c.env.DB.prepare(
    `SELECT user_id,
            COUNT(*) AS total_count,
            SUM(CASE WHEN sticker_type = 'early'   THEN 1 ELSE 0 END) AS early_count,
            SUM(CASE WHEN sticker_type = 'on_time' THEN 1 ELSE 0 END) AS on_time_count,
            SUM(CASE WHEN sticker_type = 'late'    THEN 1 ELSE 0 END) AS late_count
       FROM stickers
      WHERE family_id = ?
      GROUP BY user_id`,
  )
    .bind(familyId)
    .all();

  return c.json(results ?? []);
});

// GET /api/stickers/received?family_id=...&user_id=...
stickers.get("/received", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const targetUserId = c.req.query("user_id") ?? "";
  const user = c.get("user");

  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, emoji, title, sticker_type, date_key, earned_at
       FROM stickers
      WHERE family_id = ?
        AND user_id = ?
        AND sticker_type IN ('praise', 'early', 'on_time')
      ORDER BY earned_at DESC`,
  )
    .bind(familyId, targetUserId)
    .all();

  return c.json(results ?? []);
});

// ── write: add_sticker (role 기반 권한 + dedup) ───────────────────────────────
// 자녀=본인 대상 early/on_time/late, 부모=자녀 대상 praise. (user_id,event_id,sticker_type) dedup.
// POST /api/stickers  body:{ user_id, family_id, event_id, date_key, sticker_type, emoji, title }
stickers.post("/", requireAuth, async (c) => {
  const user = c.get("user");
  const b = await c.req.json<Record<string, string>>();
  const familyId = String(b.family_id ?? "");
  const targetUserId = String(b.user_id ?? "");
  const stickerType = String(b.sticker_type ?? "on_time");

  const callerRole = (await resolveVerifiedFamilyMembership(c.env.DB, user.sub, familyId))?.role;
  const targetRole = (await c.env.DB.prepare(
    `SELECT role FROM family_members WHERE family_id = ? AND user_id = ? AND is_active = 1 LIMIT 1`,
  ).bind(familyId, targetUserId).first<{ role: string }>())?.role;

  if (callerRole === "child") {
    if (targetUserId !== user.sub || !CHILD_STICKER_TYPES.has(stickerType)) {
      return c.json({ error: "forbidden" }, 403);
    }
  } else if (callerRole === "parent") {
    if (targetRole !== "child" || stickerType !== "praise") {
      return c.json({ error: "forbidden" }, 403);
    }
  } else {
    return c.json({ error: "forbidden" }, 403);
  }

  const shouldPush = callerRole === "parent" && stickerType === "praise";
  let stickerMutationLeases: Awaited<ReturnType<typeof acquireAccountMutationLeases>> | null = null;
  if (shouldPush) {
    const scopes = await loadFamilyNotificationMutationScopes(
      c.env.DB,
      familyId,
      [user.sub, targetUserId],
    );
    if (!scopes) return c.json({ error: "account_mutation_blocked" }, 409);
    stickerMutationLeases = await acquireAccountMutationLeases(c.env.DB, scopes);
    if (stickerMutationLeases.status !== "acquired") {
      return c.json(
        { error: stickerMutationLeases.status === "blocked" ? "account_mutation_blocked" : "account_mutation_unavailable" },
        stickerMutationLeases.status === "blocked" ? 409 : 503,
      );
    }
  }
  let stickerLeaseTransferred = false;
  let suppressedQuietHours: string[] = [];
  let pushAllowed = shouldPush;
  try {
    if (shouldPush && !(await isActiveChildMutationTarget(c.env.DB, familyId, targetUserId))) {
      return c.json({ error: "child_no_longer_active" }, 409);
    }
    const dup = await c.env.DB.prepare(
      `SELECT 1 FROM stickers WHERE user_id = ? AND event_id = ? AND sticker_type = ? LIMIT 1`,
    ).bind(targetUserId, b.event_id, stickerType).first();

    if (!dup) {
      if (shouldPush) {
        try {
          const quietPartition = await partitionNotificationRecipients(c.env.DB, {
            userIds: [targetUserId],
            identity: { action: "sticker" },
            atMs: Date.now(),
          });
          pushAllowed = quietPartition.allowed.has(targetUserId);
          suppressedQuietHours = [...quietPartition.suppressed].sort();
        } catch (error) {
          console.error("[stickers] quiet-hours routing failed:");
          return c.json({ error: "quiet_hours_routing_failed" }, 503);
        }
      }

      const id = crypto.randomUUID();
      const now = pgNow();
      const emoji = b.emoji ?? "⭐";
      const title = stickerTitle(b.title);
      await c.env.DB.prepare(
        `INSERT INTO stickers (id, user_id, family_id, event_id, date_key, sticker_type, emoji, title, earned_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).bind(id, targetUserId, familyId, b.event_id, b.date_key, stickerType, emoji, title, now).run();
      await notifyPg(c.env, familyId, "stickers", "INSERT",
        { id, user_id: targetUserId, family_id: familyId, event_id: b.event_id, date_key: b.date_key, sticker_type: stickerType, emoji, title, earned_at: now }, null);
      if (pushAllowed && stickerMutationLeases?.status === "acquired") {
        c.executionCtx.waitUntil((async () => {
          try {
            await sendFcmToFamily(
              c.env as unknown as PushEnv,
              c.env.DB,
              familyId,
              user.sub,
              "스티커 도착!",
              `부모님이 '${title}' 스티커를 보내줬어`,
              "sticker",
              {
                targetRole: "child",
                targetUserId,
                stickerId: id,
                stickerEmoji: emoji,
                stickerTitle: title,
                eventId: String(b.event_id ?? ""),
                route: "child-sticker",
              },
              new Set([targetUserId]),
            );
          } catch (e) {
            console.warn("[stickers] sticker push failed:");
          } finally {
            await releaseAccountMutationLeases(c.env.DB, stickerMutationLeases.leases);
          }
        })());
        stickerLeaseTransferred = true;
      }
    }
    if (shouldPush && !pushAllowed && suppressedQuietHours.length > 0) {
      return c.json({
        ok: true,
        webSent: 0,
        fcmSent: 0,
        total: 0,
        suppressedQuietHours,
      });
    }
    return c.json({ ok: true, suppressedQuietHours });
  } finally {
    if (stickerMutationLeases?.status === "acquired" && !stickerLeaseTransferred) {
      await releaseAccountMutationLeases(c.env.DB, stickerMutationLeases.leases);
    }
  }
});

export default stickers;

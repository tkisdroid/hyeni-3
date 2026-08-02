// 메모 read API.
//   GET /api/memos          — legacy public.memos (date_key→content). sync.js fetchMemos.
//   GET /api/memos/replies  — memo_replies 통합 스레드. sync.js fetchMemoReplies /
//                              fetchMemoRepliesForDateKeys (date_key 또는 date_keys).
// read_by 는 PG uuid[](array literal TEXT)이므로 JS 배열로 역직렬화한다.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { pgNow } from "../lib/time";
import { assertFamilyAccess, resolveVerifiedFamilyMembership } from "../db/authz";
import { pgArray, toPgArray } from "../lib/serialize";
import { notifyPg } from "../lib/realtime";
import { resolveMemoThreadScope } from "../lib/memoAuthorization";
import {
  insertContentReport,
  listBlockedUserIds,
  normalizeContentReportInput,
} from "../lib/contentSafety";
import {
  acquireAccountMutationLeases,
  isActiveChildMutationTarget,
  loadFamilyNotificationMutationScopes,
  releaseAccountMutationLeases,
} from "../lib/accountMutationScope";
import {
  buildMemoReplyOutboxStatements,
  processMemoNotificationOutboxReply,
} from "../lib/memoNotificationOutbox";
import {
  acquireMemoInteractionLease,
  releaseMemoInteractionLease,
} from "../lib/memoInteractionLease";

const memos = new Hono<{ Bindings: Env; Variables: Vars }>();

const REPLY_COLS =
  "id, family_id, date_key, child_id, user_id, user_role, content, created_at, origin, read_by";

function memoRealtimeRow(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null;
  return {
    id: row.id ?? null,
    family_id: row.family_id ?? null,
    date_key: row.date_key ?? null,
    child_id: row.child_id ?? null,
    user_id: row.user_id ?? null,
  };
}

async function isActiveFamilyParticipant(
  db: D1Database,
  familyId: string,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM family_members
        WHERE family_id = ?1 AND user_id = ?2 AND is_active = 1
          AND role IN ('parent', 'child')
       UNION
       SELECT 1 AS ok FROM families WHERE id = ?1 AND parent_id = ?2
       LIMIT 1`,
    )
    .bind(familyId, userId)
    .first<{ ok: number }>();
  return !!row;
}

// GET /api/memos?family_id=...  (legacy memos 테이블)
memos.get("/", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const user = c.get("user");

  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT date_key, content FROM memos WHERE family_id = ?`,
  )
    .bind(familyId)
    .all<{ date_key: string; content: string }>();

  return c.json(results ?? []);
});

// GET /api/memos/replies?family_id=...&date_key=...           (단일 날짜)
// GET /api/memos/replies?family_id=...&date_keys=k1,k2,...     (복수 날짜)
//   둘 다 선택적 &child_id= (multichild isolation)
memos.get("/replies", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const dateKey = c.req.query("date_key");
  const dateKeysRaw = c.req.query("date_keys");
  const childId = c.req.query("child_id");
  const user = c.get("user");

  if (!childId) return c.json({ error: "child_id_required" }, 400);
  const scope = await resolveMemoThreadScope(c.env.DB, user.sub, familyId, childId);
  if (!scope) {
    return c.json({ error: "forbidden" }, 403);
  }

  const keys = dateKeysRaw
    ? [...new Set(dateKeysRaw.split(",").map((k) => k.trim()).filter(Boolean))]
    : dateKey
      ? [dateKey]
      : [];
  if (keys.length === 0) return c.json([]);

  const keyPh = keys.map(() => "?").join(",");
  let sql = `SELECT ${REPLY_COLS} FROM memo_replies mr WHERE family_id = ? AND date_key IN (${keyPh})`;
  const binds: unknown[] = [familyId, ...keys];
  sql += ` AND child_id = ?`;
  binds.push(scope.childMemberId);
  // 메모 차단은 상호작용에만 적용한다. 가족 연결·SOS·위치·안전 알림 데이터는
  // 별도 도메인이므로 이 조건의 영향을 받지 않는다.
  sql += ` AND NOT EXISTS (
    SELECT 1 FROM user_interaction_blocks b
     WHERE b.family_id = ?
       AND (
         (b.blocker_user_id = ? AND b.blocked_user_id = mr.user_id)
         OR (b.blocker_user_id = mr.user_id AND b.blocked_user_id = ?)
       )
  )`;
  binds.push(familyId, user.sub, user.sub);
  sql += ` ORDER BY created_at ASC`;

  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all<Record<string, unknown>>();

  const out = (results ?? []).map((r) => ({ ...r, read_by: pgArray(r.read_by) }));
  return c.json(out);
});

// GET /api/memos/read-by?family_id=...&date_key=...   (legacy memos.read_by, 단일 날짜)
//   카드 상단 "✓ 읽음" 뱃지 전용(v1.1 MEMO-CLEANUP-01 까지 유지). read_by 는
//   uuid[](array literal TEXT) → JS 배열로 역직렬화. 행 없으면 [] (maybeSingle 미러).
memos.get("/read-by", requireAuth, async (c) => {
  const familyId = c.req.query("family_id") ?? "";
  const dateKey = c.req.query("date_key") ?? "";
  const user = c.get("user");

  if (!(await assertFamilyAccess(c.env.DB, user.sub, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (!dateKey) return c.json({ read_by: [] });

  const row = await c.env.DB.prepare(
    `SELECT read_by FROM memos WHERE family_id = ? AND date_key = ? LIMIT 1`,
  )
    .bind(familyId, dateKey)
    .first<{ read_by: string }>();

  return c.json({ read_by: row ? pgArray(row.read_by) : [] });
});

// ── write (family 소속; 메모는 부모·자녀 모두 작성) ───────────────────────────

// PUT /api/memos — 구버전도 이 테이블은 읽기 전용이었다. 작성자·아이 스레드가 없는
// 레거시 행은 신고·차단을 안전하게 적용할 수 없으므로 새 쓰기를 명시적으로 폐쇄한다.
memos.put("/", requireAuth, async (c) => {
  return c.json({ error: "legacy_memo_read_only" }, 410);
});

// POST /api/memos/replies — insertMemoReply (단건 작성, 작성 행 반환)
memos.post("/replies", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    family_id: string; date_key: string; child_id?: string | null;
    user_id?: string; user_role?: string; content: string; origin?: string;
  }>();
  const familyId = String(body.family_id ?? "");
  const childId = String(body.child_id ?? "");
  if (!childId) return c.json({ error: "child_id_required" }, 400);
  const scope = await resolveMemoThreadScope(c.env.DB, user.sub, familyId, childId);
  if (!scope) {
    return c.json({ error: "forbidden" }, 403);
  }
  const memoMutationScopes = await loadFamilyNotificationMutationScopes(
    c.env.DB,
    familyId,
    [scope.childUserId, user.sub],
  );
  if (!memoMutationScopes) return c.json({ error: "account_mutation_blocked" }, 409);
  const memoMutationLeases = await acquireAccountMutationLeases(c.env.DB, memoMutationScopes);
  if (memoMutationLeases.status !== "acquired") {
    return c.json(
      { error: memoMutationLeases.status === "blocked" ? "account_mutation_blocked" : "account_mutation_unavailable" },
      memoMutationLeases.status === "blocked" ? 409 : 503,
    );
  }
  let memoLeasesHandedOff = false;
  try {
    if (!(await isActiveChildMutationTarget(c.env.DB, familyId, scope.childUserId))) {
      return c.json({ error: "child_no_longer_active" }, 409);
    }
    const id = crypto.randomUUID();
    const now = pgNow();
    await c.env.DB.batch(buildMemoReplyOutboxStatements(c.env.DB, {
      id,
      familyId,
      dateKey: body.date_key,
      childMemberId: scope.childMemberId,
      senderUserId: user.sub,
      senderRole: scope.callerRole,
      content: body.content,
      origin: body.origin ?? "reply",
      createdAt: now,
    }));

    const saved = await c.env.DB.prepare(`SELECT ${REPLY_COLS} FROM memo_replies WHERE id = ?`)
      .bind(id).first<Record<string, unknown>>();
    const out = saved ? { ...saved, read_by: pgArray(saved.read_by) } : null;
    // realtime은 캐시 무효화에 필요한 식별자만 전송한다. 차단된 상대에게 메모 원문이
    // WebSocket payload로 우회 노출되지 않으며 허용 사용자는 즉시 GET으로 정본을 받는다.
    await notifyPg(c.env, familyId, "memo_replies", "INSERT", memoRealtimeRow(out), null);
    // 요청에서 확보한 lease를 즉시 outbox 처리까지 인계한다. 매분 재시도 경로는
    // 별도 lease를 새로 잡지만, 이 경로는 저장과 첫 발송 사이의 삭제 경합도 닫는다.
    memoLeasesHandedOff = true;
    c.executionCtx.waitUntil(
      (async () => {
        try {
          await processMemoNotificationOutboxReply(
            c.env,
            c.env.DB,
            id,
            Date.now(),
            memoMutationLeases.leases,
          );
        } catch (error) {
          console.warn("[memos] memo outbox immediate delivery error:");
        } finally {
          await releaseAccountMutationLeases(c.env.DB, memoMutationLeases.leases);
        }
      })(),
    );
    return c.json(out);
  } finally {
    if (!memoLeasesHandedOff) {
      await releaseAccountMutationLeases(c.env.DB, memoMutationLeases.leases);
    }
  }
});

// POST /api/memos/replies/:id/report — 상대가 보낸 저장 메시지를 운영 큐에 신고한다.
memos.post("/replies/:id/report", requireAuth, async (c) => {
  const user = c.get("user");
  const replyId = c.req.param("id").trim();
  const body = await c.req.json<{ reason?: unknown; detail?: unknown }>().catch(() => null);
  const report = normalizeContentReportInput("memo", body);
  if (!replyId || !report) return c.json({ error: "invalid_report" }, 400);

  const row = await c.env.DB
    .prepare("SELECT family_id, child_id, user_id FROM memo_replies WHERE id = ? LIMIT 1")
    .bind(replyId)
    .first<{ family_id: string; child_id: string | null; user_id: string | null }>();
  if (!row?.child_id) return c.json({ error: "message_not_found" }, 404);
  if (!(await resolveMemoThreadScope(c.env.DB, user.sub, row.family_id, row.child_id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  if (!row.user_id || row.user_id === user.sub) {
    return c.json({ error: "cannot_report_own_message" }, 400);
  }

  const saved = await insertContentReport(c.env.DB, {
    kind: "memo",
    familyId: row.family_id,
    reporterUserId: user.sub,
    contentId: replyId,
    reportedUserId: row.user_id,
    reason: report.reason,
    detail: report.detail,
    currentScreen: "/memo",
  });
  return c.json({ ok: true, duplicate: saved.duplicate });
});

// GET /api/memos/blocks?family_id= — 호출자가 직접 차단한 메모 상대만 반환한다.
// 상대가 나를 차단했는지는 노출하지 않는다.
memos.get("/blocks", requireAuth, async (c) => {
  const user = c.get("user");
  const familyId = c.req.query("family_id")?.trim() ?? "";
  const membership = await resolveVerifiedFamilyMembership(c.env.DB, user.sub, familyId);
  if (!membership) return c.json({ error: "forbidden" }, 403);
  return c.json({ blockedUserIds: await listBlockedUserIds(c.env.DB, familyId, user.sub) });
});

// POST /api/memos/blocks — 같은 가족의 활성 부모·아이와 메모 상호작용만 차단한다.
memos.post("/blocks", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ family_id?: unknown; target_user_id?: unknown }>().catch(() => null);
  const familyId = typeof body?.family_id === "string" ? body.family_id.trim() : "";
  const targetUserId = typeof body?.target_user_id === "string" ? body.target_user_id.trim() : "";
  if (!familyId || !targetUserId || targetUserId === user.sub) {
    return c.json({ error: "invalid_block_target" }, 400);
  }
  const membership = await resolveVerifiedFamilyMembership(c.env.DB, user.sub, familyId);
  if (!membership) return c.json({ error: "forbidden" }, 403);
  if (!(await isActiveFamilyParticipant(c.env.DB, familyId, targetUserId))) {
    return c.json({ error: "invalid_block_target" }, 404);
  }
  // 전달 경로와 같은 순서(account mutation → pair interaction)로 잡아 계정삭제와
  // 교차 대기하지 않고, 삭제되는 상대의 차단 행을 뒤늦게 만들지 않는다.
  const targetMutationLeases = await acquireAccountMutationLeases(c.env.DB, [
    { userId: targetUserId, familyId },
  ]);
  if (targetMutationLeases.status !== "acquired") {
    return c.json(
      { error: targetMutationLeases.status === "blocked" ? "account_mutation_blocked" : "account_mutation_unavailable" },
      targetMutationLeases.status === "blocked" ? 409 : 503,
    );
  }
  try {
    const leaseResult = await acquireMemoInteractionLease(c.env.DB, {
      familyId,
      userId: user.sub,
      peerUserId: targetUserId,
    });
    if (leaseResult.status !== "acquired") {
      return c.json(
        { error: leaseResult.status === "busy" ? "memo_interaction_busy" : "memo_interaction_unavailable" },
        leaseResult.status === "busy" ? 409 : 503,
      );
    }
    try {
      const currentMembership = await resolveVerifiedFamilyMembership(c.env.DB, user.sub, familyId);
      const currentTargetActive = await isActiveFamilyParticipant(c.env.DB, familyId, targetUserId);
      if (!currentMembership || !currentTargetActive) {
        return c.json({ error: "memo_interaction_changed" }, 409);
      }
      const now = pgNow();
      await c.env.DB.batch([
        c.env.DB
          .prepare(
            `INSERT INTO user_interaction_blocks
               (family_id, blocker_user_id, blocked_user_id, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(family_id, blocker_user_id, blocked_user_id) DO NOTHING`,
          )
          .bind(familyId, user.sub, targetUserId, now),
        // 차단 전에 네트워크 전달에 실패해 남아 있던 durable memo pending도 다음
        // foreground 복구에서 다시 표시하지 않는다. 안전 알림 pending은 건드리지 않는다.
        c.env.DB
          .prepare(
            `UPDATE pending_notifications
                SET delivered = 1, delivered_at = ?
              WHERE family_id = ?
                AND delivered = 0
                AND COALESCE(json_extract(data, '$.type'), json_extract(data, '$.action'), '') = 'new_memo'
                AND (
                  (json_extract(data, '$.targetUserId') = ? AND json_extract(data, '$.senderUserId') = ?)
                  OR (json_extract(data, '$.targetUserId') = ? AND json_extract(data, '$.senderUserId') = ?)
                )`,
          )
          .bind(now, familyId, user.sub, targetUserId, targetUserId, user.sub),
      ]);
    } finally {
      await releaseMemoInteractionLease(c.env.DB, leaseResult.lease);
    }
  } finally {
    await releaseAccountMutationLeases(c.env.DB, targetMutationLeases.leases);
  }
  await notifyPg(
    c.env,
    familyId,
    "memo_replies",
    "UPDATE",
    { family_id: familyId },
    null,
    { targetUserIds: [user.sub, targetUserId] },
  );
  return c.json({ ok: true });
});

// DELETE /api/memos/blocks/:targetUserId?family_id= — 본인이 만든 차단만 해제한다.
memos.delete("/blocks/:targetUserId", requireAuth, async (c) => {
  const user = c.get("user");
  const familyId = c.req.query("family_id")?.trim() ?? "";
  const targetUserId = c.req.param("targetUserId").trim();
  if (!familyId || !targetUserId || targetUserId === user.sub) {
    return c.json({ error: "invalid_block_target" }, 400);
  }
  const membership = await resolveVerifiedFamilyMembership(c.env.DB, user.sub, familyId);
  if (!membership) return c.json({ error: "forbidden" }, 403);
  if (!(await isActiveFamilyParticipant(c.env.DB, familyId, targetUserId))) {
    return c.json({ error: "invalid_block_target" }, 404);
  }
  const targetMutationLeases = await acquireAccountMutationLeases(c.env.DB, [
    { userId: targetUserId, familyId },
  ]);
  if (targetMutationLeases.status !== "acquired") {
    return c.json(
      { error: targetMutationLeases.status === "blocked" ? "account_mutation_blocked" : "account_mutation_unavailable" },
      targetMutationLeases.status === "blocked" ? 409 : 503,
    );
  }
  try {
    const leaseResult = await acquireMemoInteractionLease(c.env.DB, {
      familyId,
      userId: user.sub,
      peerUserId: targetUserId,
    });
    if (leaseResult.status !== "acquired") {
      return c.json(
        { error: leaseResult.status === "busy" ? "memo_interaction_busy" : "memo_interaction_unavailable" },
        leaseResult.status === "busy" ? 409 : 503,
      );
    }
    try {
      const currentMembership = await resolveVerifiedFamilyMembership(c.env.DB, user.sub, familyId);
      const currentTargetActive = await isActiveFamilyParticipant(c.env.DB, familyId, targetUserId);
      if (!currentMembership || !currentTargetActive) {
        return c.json({ error: "memo_interaction_changed" }, 409);
      }
      await c.env.DB.batch([
        c.env.DB
          .prepare(
            `DELETE FROM user_interaction_blocks
              WHERE family_id = ? AND blocker_user_id = ? AND blocked_user_id = ?`,
          )
          .bind(familyId, user.sub, targetUserId),
      ]);
    } finally {
      await releaseMemoInteractionLease(c.env.DB, leaseResult.lease);
    }
  } finally {
    await releaseAccountMutationLeases(c.env.DB, targetMutationLeases.leases);
  }
  await notifyPg(
    c.env,
    familyId,
    "memo_replies",
    "UPDATE",
    { family_id: familyId },
    null,
    { targetUserIds: [user.sub, targetUserId] },
  );
  return c.json({ ok: true });
});

// POST /api/memos/replies/:id/read — markMemoReplyRead (read_by 에 호출자 멱등 append)
memos.post("/replies/:id/read", requireAuth, async (c) => {
  const replyId = c.req.param("id");
  const user = c.get("user");
  const body = await c.req.json<{ user_id: string }>().catch(() => ({ user_id: user.sub }));
  // p_user_id == caller 검증(원본 RPC 계약)
  if (body.user_id && body.user_id !== user.sub) {
    return c.json({ error: "forbidden" }, 403);
  }

  const row = await c.env.DB.prepare(`SELECT family_id, child_id, read_by FROM memo_replies WHERE id = ?`)
    .bind(replyId).first<{ family_id: string; child_id: string | null; read_by: string }>();
  if (!row) return c.json({ ok: true });
  if (!row.child_id || !(await resolveMemoThreadScope(c.env.DB, user.sub, row.family_id, row.child_id))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const arr = pgArray(row.read_by);
  if (!arr.includes(user.sub)) {
    arr.push(user.sub);
    await c.env.DB.prepare(`UPDATE memo_replies SET read_by = ? WHERE id = ?`)
      .bind(toPgArray(arr), replyId).run();
    const saved = await c.env.DB.prepare(`SELECT ${REPLY_COLS} FROM memo_replies WHERE id = ?`)
      .bind(replyId).first<Record<string, unknown>>();
    const out = saved ? { ...saved, read_by: pgArray(saved.read_by) } : null;
    await notifyPg(c.env, row.family_id, "memo_replies", "UPDATE", memoRealtimeRow(out), null);
  }
  return c.json({ ok: true });
});

export default memos;

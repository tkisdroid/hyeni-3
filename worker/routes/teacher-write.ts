// 선생님 모드 write API. teacherApi.js write 10종의 plpgsql RPC를 D1로 직역.
// 게이트(my_teacher_id / is_parent_of_member / 반 소유 / 페어링 승인)는 RPC 본문대로.
// 복합 unique 가 D1에 미이관이라 ON CONFLICT 대신 select-then-write 로 멱등 처리.
// 부모 알림은 parent_alerts insert + DO 통지까지(푸시 발행은 M5).
// 한글 에러는 { error: "메시지" } + 적절 status 로 반환(클라 apiRequest 가 표면화).
import { pgNow } from "../lib/time";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { getMyTeacherId, isParentOfMember } from "../db/authz";
import { notifyPg } from "../lib/realtime";
import {
  acquireAccountMutationLease,
  releaseAccountMutationLease,
} from "../lib/accountMutationLease";

const tw = new Hono<{ Bindings: Env; Variables: Vars }>();
type TeacherWriteContext = Context<{ Bindings: Env; Variables: Vars }>;

const ACCOUNT_WRITE_ALLOWED_SQL = `
  EXISTS(SELECT 1 FROM users WHERE id = ?)
  AND NOT EXISTS(
    SELECT 1 FROM account_deletion_scopes
     WHERE scope_type = 'user' AND scope_id = ?
  )
  AND (
    ? IS NULL OR NOT EXISTS(
      SELECT 1 FROM account_deletion_scopes
       WHERE scope_type = 'family' AND scope_id = ?
    )
  )`;

async function runAccountGuardedWrite(
  c: TeacherWriteContext,
  sql: string,
  bindings: readonly unknown[],
  targetFamilyId: string | null = null,
): Promise<boolean> {
  const uid = c.get("user").sub;
  const result = await c.env.DB
    .prepare(sql)
    .bind(...bindings, uid, uid, targetFamilyId, targetFamilyId)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

function accountDeletionConflict(c: TeacherWriteContext) {
  return c.json({ error: "account_deletion_in_progress" }, 409);
}

async function withTargetFamilyMutationLeases<T>(
  c: TeacherWriteContext,
  familyIds: readonly string[],
  operation: () => Promise<T>,
): Promise<T | Response> {
  const uid = c.get("user").sub;
  const uniqueFamilyIds = [...new Set(familyIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const leaseIds: string[] = [];
  const releaseLeases = async () => {
    for (const leaseId of [...leaseIds].reverse()) {
      try {
        await releaseAccountMutationLease(c.env.DB, leaseId);
      } catch (error) {
        console.error("[teacher-write] target family mutation lease release failed");
      }
    }
  };

  for (const familyId of uniqueFamilyIds) {
    const result = await acquireAccountMutationLease(c.env.DB, {
      userId: uid,
      familyId,
    });
    if (result.status !== "acquired") {
      await releaseLeases();
      return result.status === "blocked"
        ? accountDeletionConflict(c)
        : c.json({ error: "account_deletion_unavailable" }, 503);
    }
    leaseIds.push(result.lease.id);
  }

  try {
    return await operation();
  } finally {
    await releaseLeases();
  }
}

const VALID_SCOPES = new Set([
  "schedule_only", "schedule_attendance", "schedule_attendance_location",
]);
const ATTEND_SCOPES = new Set(["schedule_attendance", "schedule_attendance_location"]);
const ATTEND_STATUS = new Set(["pending", "attended", "absent", "left", "unknown"]);
const RL_WINDOW_MS = 3600_000; // 1h
const RL_MAX = 12;
const REJECT_COOLDOWN_MS = 24 * 3600_000;

const normPhone = (p: unknown) => String(p ?? "").replace(/[^0-9]/g, "");
const nowIso = () => pgNow();
const fail = (c: any, msg: string, status = 400) => c.json({ error: msg }, status);
const APP_DATE_KEY_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

function addDaysAppDateKey(dateKey: string, days: number): string | null {
  const m = APP_DATE_KEY_RE.exec(String(dateKey || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]), Number(m[3]) + days));
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

// POST /api/teacher/profile — ensure_teacher_profile
tw.post("/profile", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const body = await c.req.json<{ display_name?: string }>().catch(() => ({}) as any);
  const dn = (body.display_name ?? "").trim() || "선생님";
  const now = nowIso();
  const ex = await c.env.DB.prepare(`SELECT id FROM teacher_profiles WHERE user_id = ?`)
    .bind(uid).first<{ id: string }>();
  if (ex) {
    const applied = await runAccountGuardedWrite(
      c,
      `UPDATE teacher_profiles
          SET display_name = ?, updated_at = ?
        WHERE user_id = ? AND ${ACCOUNT_WRITE_ALLOWED_SQL}`,
      [dn, now, uid],
    );
    if (!applied) return accountDeletionConflict(c);
    return c.json(ex.id);
  }
  const id = crypto.randomUUID();
  const applied = await runAccountGuardedWrite(
    c,
    `INSERT INTO teacher_profiles (id, user_id, display_name, created_at, updated_at)
     SELECT ?,?,?,?,?
      WHERE ${ACCOUNT_WRITE_ALLOWED_SQL}`,
    [id, uid, dn, now, now],
  );
  if (!applied) return accountDeletionConflict(c);
  return c.json(id);
});

// POST /api/teacher/classes — create_teacher_class
tw.post("/classes", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const teacher = await getMyTeacherId(c.env.DB, uid);
  if (!teacher) return fail(c, "선생님 프로필을 먼저 만들어 주세요");
  const body = await c.req.json<{ class_name?: string }>().catch(() => ({}) as any);
  const name = (body.class_name ?? "").trim();
  if (!name) return fail(c, "반 이름을 입력해 주세요");
  const id = crypto.randomUUID();
  const now = nowIso();
  const applied = await runAccountGuardedWrite(
    c,
    `INSERT INTO teacher_classes (id, teacher_id, class_name, created_at, updated_at)
     SELECT ?,?,?,?,?
      WHERE ${ACCOUNT_WRITE_ALLOWED_SQL}`,
    [id, teacher, name, now, now],
  );
  if (!applied) return accountDeletionConflict(c);
  return c.json(id);
});

// PATCH /api/teacher/classes/:id — renameTeacherClass (본인 반)
tw.patch("/classes/:id", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const classId = c.req.param("id");
  const teacher = await getMyTeacherId(c.env.DB, uid);
  const body = await c.req.json<{ class_name?: string }>().catch(() => ({}) as any);
  const name = (body.class_name ?? "").trim();
  if (!name) return fail(c, "반 이름을 입력해 주세요");
  const owns = await c.env.DB.prepare(`SELECT 1 AS ok FROM teacher_classes WHERE id = ? AND teacher_id = ?`)
    .bind(classId, teacher).first();
  if (!owns) return fail(c, "본인 반만 이름을 바꿀 수 있어요", 403);
  const applied = await runAccountGuardedWrite(
    c,
    `UPDATE teacher_classes
        SET class_name = ?, updated_at = ?
      WHERE id = ? AND ${ACCOUNT_WRITE_ALLOWED_SQL}`,
    [name, nowIso(), classId],
  );
  if (!applied) return accountDeletionConflict(c);
  return c.json({ id: classId, class_name: name });
});

// POST /api/teacher/classes/:id/invite — rotate_class_invite (24h 만료)
tw.post("/classes/:id/invite", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const classId = c.req.param("id");
  const teacher = await getMyTeacherId(c.env.DB, uid);
  if (!teacher) return fail(c, "선생님 프로필을 먼저 만들어 주세요");
  const owns = await c.env.DB.prepare(`SELECT 1 AS ok FROM teacher_classes WHERE id = ? AND teacher_id = ?`)
    .bind(classId, teacher).first();
  if (!owns) return fail(c, "본인 반에만 초대 코드를 만들 수 있어요", 403);
  const code = "CLS-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const expires = new Date(Date.now() + RL_WINDOW_MS * 24).toISOString();
  const applied = await runAccountGuardedWrite(
    c,
    `UPDATE teacher_classes
        SET invite_code = ?, invite_expires_at = ?, updated_at = ?
      WHERE id = ? AND ${ACCOUNT_WRITE_ALLOWED_SQL}`,
    [code, expires, nowIso(), classId],
  );
  if (!applied) return accountDeletionConflict(c);
  return c.json({ invite_code: code, invite_expires_at: expires });
});

// POST /api/teacher/classes/:id/schedule/copy-week
// 본인 반의 선택 주간(월~일) 일정을 다음 주 같은 요일로 복사한다.
// 대상은 승인된 학생 + 일정 공유 권한 + class schedule 에 노출되는 카테고리만.
tw.post("/classes/:id/schedule/copy-week", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const classId = c.req.param("id");
  const teacher = await getMyTeacherId(c.env.DB, uid);
  if (!teacher) return fail(c, "선생님 프로필을 먼저 만들어 주세요");

  const owns = await c.env.DB.prepare(
    `SELECT 1 AS ok FROM teacher_classes WHERE id = ? AND teacher_id = ?`,
  )
    .bind(classId, teacher)
    .first();
  if (!owns) return fail(c, "본인 반의 시간표만 복사할 수 있어요", 403);

  const body = await c.req
    .json<{ week_start_date_key?: unknown }>()
    .catch(() => ({}) as any);
  const weekStart = String(body.week_start_date_key ?? "");
  if (!APP_DATE_KEY_RE.test(weekStart)) return fail(c, "복사할 주간 날짜가 올바르지 않아요");

  const sourceKeys = Array.from({ length: 7 }, (_, i) => addDaysAppDateKey(weekStart, i))
    .filter((v): v is string => !!v);
  if (sourceKeys.length !== 7) return fail(c, "복사할 주간 날짜가 올바르지 않아요");

  const ph = sourceKeys.map(() => "?").join(",");
  const rows = (await c.env.DB.prepare(
    `SELECT e.id AS source_event_id, e.family_id, e.date_key, e.title, e.time, e.category,
            e.emoji, e.color, e.bg, e.memo, e.location, e.notif_override, e.end_time,
            tcc.child_member_id AS child_id
       FROM teacher_class_children tcc
       JOIN teacher_child_pairings tcp ON tcp.id = tcc.pairing_id
       JOIN events_children ec ON ec.child_id = tcc.child_member_id
       JOIN events e ON e.id = ec.event_id
      WHERE tcc.class_id = ?
        AND tcp.pairing_status = 'approved'
        AND tcp.permission_scope IN ('schedule_only','schedule_attendance','schedule_attendance_location')
        AND e.date_key IN (${ph})
        AND e.category IN ('school','sports','hobby','other')
      ORDER BY e.date_key, e.time, e.title`,
  )
    .bind(classId, ...sourceKeys)
    .all<Record<string, any>>()).results ?? [];

  const targetFamilyIds = rows.map((row) => String(row.family_id || "")).filter(Boolean);
  return withTargetFamilyMutationLeases(c, targetFamilyIds, async () => {
    const now = nowIso();
    const insertedByFamily = new Map<string, Record<string, unknown>[]>();
    let copied = 0;
    let skipped = 0;

  for (const row of rows) {
    const targetKey = addDaysAppDateKey(String(row.date_key || ""), 7);
    if (!targetKey) {
      skipped++;
      continue;
    }
    const title = String(row.title ?? "").trim();
    if (!title) {
      skipped++;
      continue;
    }
    const familyId = String(row.family_id || "");
    const childId = String(row.child_id || "");
    const time = row.time ?? "";
    const duplicate = await c.env.DB.prepare(
      `SELECT 1 AS ok
         FROM events e
         JOIN events_children ec ON ec.event_id = e.id
        WHERE e.family_id = ? AND ec.child_id = ? AND e.date_key = ?
          AND e.title = ? AND COALESCE(e.time,'') = COALESCE(?,'')
          AND COALESCE(e.category,'') = COALESCE(?,'')
        LIMIT 1`,
    )
      .bind(familyId, childId, targetKey, title, time, row.category ?? "school")
      .first();
    if (duplicate) {
      skipped++;
      continue;
    }

    const id = crypto.randomUUID();
    const eventRow = {
      id,
      family_id: familyId,
      date_key: targetKey,
      title,
      time,
      category: row.category ?? "school",
      emoji: row.emoji ?? "📚",
      color: row.color ?? "var(--hyeni-cat-school)",
      bg: row.bg ?? "var(--hyeni-cat-school-bg)",
      memo: row.memo ?? "",
      location: row.location ?? null,
      notif_override: row.notif_override ?? null,
      end_time: row.end_time ?? null,
      is_family_event: 0,
      created_by: uid,
      created_at: now,
      updated_at: now,
    };
    const eventApplied = await runAccountGuardedWrite(
      c,
      `INSERT INTO events
         (id, family_id, date_key, title, time, category, emoji, color, bg, memo,
          location, notif_override, end_time, is_family_event, created_by, created_at, updated_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        WHERE ${ACCOUNT_WRITE_ALLOWED_SQL}`,
      [
        eventRow.id,
        eventRow.family_id,
        eventRow.date_key,
        eventRow.title,
        eventRow.time,
        eventRow.category,
        eventRow.emoji,
        eventRow.color,
        eventRow.bg,
        eventRow.memo,
        eventRow.location,
        eventRow.notif_override,
        eventRow.end_time,
        eventRow.is_family_event,
        eventRow.created_by,
        eventRow.created_at,
        eventRow.updated_at,
      ],
      familyId,
    );
    if (!eventApplied) return accountDeletionConflict(c);
    const childLinkApplied = await runAccountGuardedWrite(
      c,
      `INSERT INTO events_children (event_id, child_id)
       SELECT ?, ?
        WHERE ${ACCOUNT_WRITE_ALLOWED_SQL}`,
      [id, childId],
      familyId,
    );
    if (!childLinkApplied) {
      await c.env.DB.prepare("DELETE FROM events WHERE id = ? AND created_by = ?").bind(id, uid).run();
      return accountDeletionConflict(c);
    }

    const notifyRows = insertedByFamily.get(familyId) ?? [];
    notifyRows.push({ ...eventRow, is_family_event: false });
    insertedByFamily.set(familyId, notifyRows);
    copied++;
  }

  for (const [familyId, notifyRows] of insertedByFamily) {
    for (const row of notifyRows) {
      await notifyPg(c.env, familyId, "events", "INSERT", row, null);
    }
  }

    return c.json({ copied, skipped, sourceCount: rows.length });
  });
});

// POST /api/teacher/accept-invite — accept_class_invite (부모가 코드+아이 선택해 승인)
tw.post("/accept-invite", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const body = await c.req.json<{ invite_code: string; child_member_id: string; permission_scope?: string }>();
  const scope = body.permission_scope || "schedule_attendance";
  if (!VALID_SCOPES.has(scope)) return fail(c, "권한 범위가 올바르지 않아요");

  const cls = await c.env.DB.prepare(`SELECT * FROM teacher_classes WHERE invite_code = ?`)
    .bind((body.invite_code || "").trim().toUpperCase()).first<Record<string, any>>();
  if (!cls) return fail(c, "초대 코드를 찾을 수 없어요");
  if (!cls.invite_expires_at || cls.invite_expires_at < nowIso()) {
    return fail(c, "초대 코드가 만료되었어요. 선생님께 새 코드를 받아주세요");
  }

  const fam = await c.env.DB.prepare(
    `SELECT child_fm.family_id AS fid FROM family_members child_fm
       JOIN family_members parent_fm ON parent_fm.family_id = child_fm.family_id
      WHERE child_fm.id = ?1 AND parent_fm.user_id = ?2 AND parent_fm.role = 'parent' LIMIT 1`,
  ).bind(body.child_member_id, uid).first<{ fid: string }>();
  if (!fam) return fail(c, "내 아이만 선생님과 연결할 수 있어요", 403);

  const tuid = (await c.env.DB.prepare(`SELECT user_id FROM teacher_profiles WHERE id = ?`)
    .bind(cls.teacher_id).first<{ user_id: string }>())?.user_id ?? null;
  return withTargetFamilyMutationLeases(c, [fam.fid], async () => {
    const now = nowIso();

  // pairing upsert (teacher_id, child_member_id)
  const exP = await c.env.DB.prepare(
    `SELECT id FROM teacher_child_pairings WHERE teacher_id = ? AND child_member_id = ?`,
  ).bind(cls.teacher_id, body.child_member_id).first<{ id: string }>();
  let pairingId: string;
  if (exP) {
    pairingId = exP.id;
    const pairingApplied = await runAccountGuardedWrite(
      c,
      `UPDATE teacher_child_pairings
          SET pairing_status='approved', class_id=?, permission_scope=?,
              approved_by=?, approved_at=?, updated_at=?
        WHERE id=? AND ${ACCOUNT_WRITE_ALLOWED_SQL}`,
      [cls.id, scope, uid, now, now, pairingId],
      fam.fid,
    );
    if (!pairingApplied) return accountDeletionConflict(c);
  } else {
    pairingId = crypto.randomUUID();
    const pairingApplied = await runAccountGuardedWrite(
      c,
      `INSERT INTO teacher_child_pairings (id, teacher_id, class_id, child_member_id, family_id,
          pairing_status, permission_scope, requested_by, approved_by, approved_at, created_at, updated_at)
       SELECT ?,?,?,?,?, 'approved', ?,?,?,?,?,?
        WHERE ${ACCOUNT_WRITE_ALLOWED_SQL}`,
      [pairingId, cls.teacher_id, cls.id, body.child_member_id, fam.fid, scope, tuid, uid, now, now, now],
      fam.fid,
    );
    if (!pairingApplied) return accountDeletionConflict(c);
  }

  // 반 명단 추가 (class_id, child_member_id) dedup
  const exC = await c.env.DB.prepare(
    `SELECT 1 AS ok FROM teacher_class_children WHERE class_id = ? AND child_member_id = ?`,
  ).bind(cls.id, body.child_member_id).first();
  if (!exC) {
    const classChildApplied = await runAccountGuardedWrite(
      c,
      `INSERT INTO teacher_class_children (id, class_id, pairing_id, child_member_id, added_at)
       SELECT ?,?,?,?,?
        WHERE ${ACCOUNT_WRITE_ALLOWED_SQL}`,
      [crypto.randomUUID(), cls.id, pairingId, body.child_member_id, now],
      fam.fid,
    );
    if (!classChildApplied) return accountDeletionConflict(c);
  }
    return c.json(pairingId);
  });
});

// POST /api/teacher/pairings/:id/revoke — revoke_teacher_pairing (부모 또는 선생님)
tw.post("/pairings/:id/revoke", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const pid = c.req.param("id");
  const p = await c.env.DB.prepare(
    `SELECT child_member_id, teacher_id, family_id FROM teacher_child_pairings WHERE id = ?`,
  )
    .bind(pid)
    .first<{ child_member_id: string | null; teacher_id: string; family_id: string }>();
  if (!p) return fail(c, "연결 정보를 찾을 수 없어요");
  const isParent = p.child_member_id ? await isParentOfMember(c.env.DB, uid, p.child_member_id) : false;
  const myTeacher = await getMyTeacherId(c.env.DB, uid);
  if (!(isParent || p.teacher_id === myTeacher)) return fail(c, "이 연결을 해제할 권한이 없어요", 403);
  return withTargetFamilyMutationLeases(c, [p.family_id], async () => {
  const pairingApplied = await runAccountGuardedWrite(
    c,
    `UPDATE teacher_child_pairings
        SET pairing_status='revoked', updated_at=?
      WHERE id=? AND ${ACCOUNT_WRITE_ALLOWED_SQL}`,
    [nowIso(), pid],
    p.family_id,
  );
  if (!pairingApplied) return accountDeletionConflict(c);
  await runAccountGuardedWrite(
    c,
    `DELETE FROM teacher_class_children
      WHERE pairing_id = ? AND ${ACCOUNT_WRITE_ALLOWED_SQL}`,
    [pid],
    p.family_id,
  );
    return c.json(true);
  });
});

// POST /api/teacher/pairings/:id/accept — accept_teacher_pairing_request (부모)
tw.post("/pairings/:id/accept", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const pid = c.req.param("id");
  const body = await c.req.json<{ permission_scope?: string; child_member_id?: string | null }>().catch(() => ({}) as any);
  const scope = body.permission_scope || "schedule_attendance";
  if (!VALID_SCOPES.has(scope)) return fail(c, "권한 범위가 올바르지 않아요");

  const pair = await c.env.DB.prepare(`SELECT * FROM teacher_child_pairings WHERE id = ?`)
    .bind(pid).first<Record<string, any>>();
  if (!pair) return fail(c, "연결 요청을 찾을 수 없어요");
  if (pair.pairing_status !== "pending") return fail(c, "이미 처리된 요청이에요");

  let child: string;
  if (pair.child_member_id) {
    if (!(await isParentOfMember(c.env.DB, uid, pair.child_member_id))) {
      return fail(c, "내 아이의 연결 요청만 수락할 수 있어요", 403);
    }
    child = pair.child_member_id;
  } else {
    if (!body.child_member_id) return fail(c, "연결할 아이를 선택해 주세요");
    const mine = await c.env.DB.prepare(
      `SELECT 1 AS ok FROM (SELECT family_id FROM family_members WHERE user_id=?1
         UNION SELECT id FROM families WHERE parent_id=?1) f WHERE f.family_id = ?2`,
    ).bind(uid, pair.family_id).first();
    if (!mine) return fail(c, "내 가족의 연결 요청만 수락할 수 있어요", 403);
    const childOk = await c.env.DB.prepare(
      `SELECT 1 AS ok FROM family_members WHERE id=? AND family_id=? AND role='child'`,
    ).bind(body.child_member_id, pair.family_id).first();
    if (!childOk) return fail(c, "이 가족의 아이만 선택할 수 있어요", 403);
    child = body.child_member_id;
  }

  return withTargetFamilyMutationLeases(c, [String(pair.family_id)], async () => {
  const now = nowIso();
  const pairingApplied = await runAccountGuardedWrite(
    c,
    `UPDATE teacher_child_pairings
        SET child_member_id=?, pairing_status='approved', permission_scope=?,
            approved_by=?, approved_at=?, updated_at=?
      WHERE id=? AND ${ACCOUNT_WRITE_ALLOWED_SQL}`,
    [child, scope, uid, now, now, pid],
    String(pair.family_id),
  );
  if (!pairingApplied) return accountDeletionConflict(c);

  if (pair.class_id) {
    const exC = await c.env.DB.prepare(
      `SELECT 1 AS ok FROM teacher_class_children WHERE class_id=? AND child_member_id=?`,
    ).bind(pair.class_id, child).first();
    if (!exC) {
      const classChildApplied = await runAccountGuardedWrite(
        c,
        `INSERT INTO teacher_class_children (id, class_id, pairing_id, child_member_id, added_at)
         SELECT ?,?,?,?,?
          WHERE ${ACCOUNT_WRITE_ALLOWED_SQL}`,
        [crypto.randomUUID(), pair.class_id, pid, child, now],
        String(pair.family_id),
      );
      if (!classChildApplied) return accountDeletionConflict(c);
    }
  }
    return c.json(pid);
  });
});

// POST /api/teacher/pairings/:id/reject — reject_teacher_pairing_request (부모)
tw.post("/pairings/:id/reject", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const pid = c.req.param("id");
  const pair = await c.env.DB.prepare(
    `SELECT child_member_id, pairing_status, family_id FROM teacher_child_pairings WHERE id = ?`,
  )
    .bind(pid)
    .first<{ child_member_id: string | null; pairing_status: string; family_id: string }>();
  if (!pair) return fail(c, "연결 요청을 찾을 수 없어요");
  if (!(await isParentOfMember(c.env.DB, uid, pair.child_member_id ?? ""))) {
    return fail(c, "내 아이의 연결 요청만 거절할 수 있어요", 403);
  }
  if (pair.pairing_status !== "pending") return fail(c, "이미 처리된 요청이에요");
  return withTargetFamilyMutationLeases(c, [pair.family_id], async () => {
  const pairingApplied = await runAccountGuardedWrite(
    c,
    `UPDATE teacher_child_pairings
        SET pairing_status='rejected', updated_at=?
      WHERE id=? AND ${ACCOUNT_WRITE_ALLOWED_SQL}`,
    [nowIso(), pid],
    pair.family_id,
  );
  if (!pairingApplied) return accountDeletionConflict(c);
    return c.json(pid);
  });
});

// POST /api/teacher/attendance — set_teacher_attendance (출석 + 부모 알림 DB, 푸시는 M5)
tw.post("/attendance", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const teacher = await getMyTeacherId(c.env.DB, uid);
  if (!teacher) return fail(c, "선생님 프로필을 먼저 만들어 주세요");
  const b = await c.req.json<{ child_member_id: string; date_key: string; schedule_id?: string | null; status: string; note?: string | null }>();
  if (!ATTEND_STATUS.has(b.status)) return fail(c, "참석 상태가 올바르지 않아요");

  const pair = await c.env.DB.prepare(
    `SELECT * FROM teacher_child_pairings WHERE teacher_id=? AND child_member_id=? AND pairing_status='approved'`,
  ).bind(teacher, b.child_member_id).first<Record<string, any>>();
  if (!pair) return fail(c, "부모 승인을 받은 아이만 참석을 기록할 수 있어요", 403);
  if (!ATTEND_SCOPES.has(pair.permission_scope)) {
    return fail(c, "참석 확인 권한이 없어요. 부모님께 권한을 요청해 주세요", 403);
  }

  return withTargetFamilyMutationLeases(c, [String(pair.family_id)], async () => {
  const cm = await c.env.DB.prepare(`SELECT name, user_id FROM family_members WHERE id = ?`)
    .bind(b.child_member_id).first<{ name: string; user_id: string | null }>();
  const childName = cm?.name || "아이";
  const childUser = cm?.user_id ?? null;
  const schedId = b.schedule_id ?? null;
  const now = nowIso();

  // 기존 로그 (COALESCE(schedule_id, child_member_id) 매칭)
  const prevRow = await c.env.DB.prepare(
    `SELECT id, attendance_status, corrected_from FROM teacher_attendance_logs
      WHERE child_member_id=? AND date_key=? AND COALESCE(schedule_id, child_member_id)=COALESCE(?, child_member_id)`,
  ).bind(b.child_member_id, b.date_key, schedId).first<{ id: string; attendance_status: string; corrected_from: string | null }>();
  const prev = prevRow?.attendance_status ?? null;

  let logId: string;
  if (prevRow) {
    logId = prevRow.id;
    const correctedFrom = prev !== b.status ? prev : prevRow.corrected_from;
    const attendanceApplied = await runAccountGuardedWrite(
      c,
      `UPDATE teacher_attendance_logs
          SET attendance_status=?, checked_at=?, corrected_from=?,
              note=COALESCE(?, note), updated_at=?
        WHERE id=? AND ${ACCOUNT_WRITE_ALLOWED_SQL}`,
      [b.status, now, correctedFrom, b.note ?? null, now, logId],
      String(pair.family_id),
    );
    if (!attendanceApplied) return accountDeletionConflict(c);
  } else {
    logId = crypto.randomUUID();
    const attendanceApplied = await runAccountGuardedWrite(
      c,
      `INSERT INTO teacher_attendance_logs (id, teacher_id, class_id, child_member_id, family_id,
          schedule_id, date_key, attendance_status, checked_at, corrected_from, note, created_at, updated_at)
       SELECT ?,?,?,?,?,?,?,?,?, NULL, ?,?,?
        WHERE ${ACCOUNT_WRITE_ALLOWED_SQL}`,
      [
        logId, teacher, pair.class_id, b.child_member_id, pair.family_id,
        schedId, b.date_key, b.status, now, b.note ?? null, now, now,
      ],
      String(pair.family_id),
    );
    if (!attendanceApplied) return accountDeletionConflict(c);
  }

  // 부모 알림 (정정 시 [정정] 접두사) — DB insert + DO 통지. 푸시는 M5.
  const prefix = prev && prev !== b.status ? "[정정] " : "";
  let title: string | null = null;
  let message = "";
  let severity = "info";
  if (b.status === "attended") { title = "방과후 참석"; message = `${prefix}${childName}이가 방과후에 참석했어요`; }
  else if (b.status === "absent") { title = "방과후 결석"; severity = "warning"; message = `${prefix}${childName}이가 오늘 방과후에 참석하지 않았어요`; }
  else if (b.status === "left") { title = "하교"; message = `${prefix}${childName}이가 하교했어요`; }

  if (title) {
    const aid = crypto.randomUUID();
    const alertApplied = await runAccountGuardedWrite(
      c,
      `INSERT INTO parent_alerts (id, family_id, alert_type, title, message, severity, event_id, child_user_id, read, read_by, created_at)
       SELECT ?,?, 'teacher_attendance', ?,?,?, NULL, ?, 0, '{}', ?
        WHERE ${ACCOUNT_WRITE_ALLOWED_SQL}`,
      [aid, pair.family_id, title, message, severity, childUser, now],
      String(pair.family_id),
    );
    if (!alertApplied) return accountDeletionConflict(c);
    const notificationMarked = await runAccountGuardedWrite(
      c,
      `UPDATE teacher_attendance_logs
          SET notified_parent_at=?
        WHERE id=? AND ${ACCOUNT_WRITE_ALLOWED_SQL}`,
      [now, logId],
      String(pair.family_id),
    );
    if (!notificationMarked) return accountDeletionConflict(c);
    await notifyPg(c.env, pair.family_id, "parent_alerts", "INSERT", {
      id: aid, family_id: pair.family_id, alert_type: "teacher_attendance", title, message,
      severity, event_id: null, child_user_id: childUser, read: false, created_at: now,
    }, null);
  }
    return c.json(logId);
  });
});

// POST /api/teacher/pairings/request — request_teacher_pairing
// 전화번호로 가족/아이 특정 → pending pairing + 부모 알림. jsonb status 반환.
// (전화 정규화 비교는 SQLite regexp 부재로 JS 매칭. family_members phone 소량.)
tw.post("/pairings/request", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const teacher = await getMyTeacherId(c.env.DB, uid);
  if (!teacher) return fail(c, "선생님 프로필을 먼저 만들어 주세요");
  const b = await c.req.json<{ class_id: string; phone: string; child_name?: string }>();

  const owns = await c.env.DB.prepare(`SELECT 1 AS ok FROM teacher_classes WHERE id=? AND teacher_id=?`)
    .bind(b.class_id, teacher).first();
  if (!owns) return fail(c, "본인 반에만 연결을 요청할 수 있어요");

  const now = nowIso();
  // attempts 1행(빗나간 probe 도 rate-limit 비용)
  const attemptApplied = await runAccountGuardedWrite(
    c,
    `INSERT INTO teacher_pairing_attempts (id, teacher_id, attempted_at)
     SELECT ?,?,?
      WHERE ${ACCOUNT_WRITE_ALLOWED_SQL}`,
    [crypto.randomUUID(), teacher, now],
  );
  if (!attemptApplied) return accountDeletionConflict(c);
  const since = new Date(Date.now() - RL_WINDOW_MS).toISOString();
  const cnt = await c.env.DB.prepare(
    `SELECT count(*) AS n FROM teacher_pairing_attempts WHERE teacher_id=? AND attempted_at > ?`,
  ).bind(teacher, since).first<{ n: number }>();
  if ((cnt?.n ?? 0) > RL_MAX) return c.json({ status: "rate_limited" });

  const norm = normPhone(b.phone);
  if (norm.length < 9) return c.json({ status: "not_found" });

  const tp = await c.env.DB.prepare(`SELECT user_id, display_name FROM teacher_profiles WHERE id=?`)
    .bind(teacher).first<{ user_id: string; display_name: string }>();
  const teacherUid = tp?.user_id ?? null;
  const teacherName = (tp?.display_name ?? "").trim() || "선생님";

  // 전화 매칭 (부모 우선)
  const all = (await c.env.DB.prepare(
    `SELECT family_id, role, id, name, user_id, phone FROM family_members WHERE phone IS NOT NULL AND phone <> ''`,
  ).all<Record<string, any>>()).results ?? [];
  const matched = all.filter((m) => normPhone(m.phone) === norm)
    .sort((x, y) => (x.role === "parent" ? 0 : 1) - (y.role === "parent" ? 0 : 1))[0];
  if (!matched) return c.json({ status: "not_found" });
  const familyId = matched.family_id;
  return withTargetFamilyMutationLeases(c, [familyId], async () => {

  let childMember: string | null = null;
  let childName: string | null = null;
  let childUser: string | null = null;
  if (matched.role === "child") {
    childMember = matched.id; childName = matched.name; childUser = matched.user_id;
  } else {
    const children = (await c.env.DB.prepare(
      `SELECT id, name, user_id FROM family_members WHERE family_id=? AND role='child'`,
    ).bind(familyId).all<Record<string, any>>()).results ?? [];
    if (children.length === 1) {
      childMember = children[0].id; childName = children[0].name; childUser = children[0].user_id;
    } else if (children.length > 1 && (b.child_name ?? "").trim()) {
      const named = children.filter((ch) => (ch.name ?? "").trim() === (b.child_name ?? "").trim());
      if (named.length === 1) { childMember = named[0].id; childName = named[0].name; childUser = named[0].user_id; }
    }
  }
  const pending = childMember === null;
  if (!pending) childName = (childName ?? "").trim() || "아이";

  const cooldown = new Date(Date.now() - REJECT_COOLDOWN_MS).toISOString();
  // 중복/revoked/cooldown 가드 (확정/미정 경로 동등)
  if (!pending) {
    if (await c.env.DB.prepare(`SELECT 1 AS ok FROM teacher_child_pairings WHERE teacher_id=? AND child_member_id=? AND pairing_status IN ('pending','approved')`).bind(teacher, childMember).first()) {
      return c.json({ status: "duplicate" });
    }
    if ((await c.env.DB.prepare(`SELECT updated_at FROM teacher_child_pairings WHERE teacher_id=? AND child_member_id=? AND pairing_status='revoked' LIMIT 1`).bind(teacher, childMember).first<{ updated_at: string }>())?.updated_at) {
      return c.json({ status: "revoked_blocked" });
    }
    const blk = await c.env.DB.prepare(`SELECT max(updated_at) AS m FROM teacher_child_pairings WHERE teacher_id=? AND child_member_id=? AND pairing_status IN ('rejected','expired')`).bind(teacher, childMember).first<{ m: string }>();
    if (blk?.m && blk.m > cooldown) return c.json({ status: "duplicate" });
  } else {
    if (await c.env.DB.prepare(`SELECT 1 AS ok FROM teacher_child_pairings WHERE teacher_id=? AND family_id=? AND child_member_id IS NULL AND pairing_status='pending'`).bind(teacher, familyId).first()) {
      return c.json({ status: "duplicate" });
    }
    if ((await c.env.DB.prepare(`SELECT updated_at FROM teacher_child_pairings WHERE teacher_id=? AND family_id=? AND child_member_id IS NULL AND pairing_status='revoked' LIMIT 1`).bind(teacher, familyId).first<{ updated_at: string }>())?.updated_at) {
      return c.json({ status: "revoked_blocked" });
    }
    const blk = await c.env.DB.prepare(`SELECT max(updated_at) AS m FROM teacher_child_pairings WHERE teacher_id=? AND family_id=? AND child_member_id IS NULL AND pairing_status IN ('rejected','expired')`).bind(teacher, familyId).first<{ m: string }>();
    if (blk?.m && blk.m > cooldown) return c.json({ status: "duplicate" });
  }

  // pending pairing 생성
  let pairingId: string;
  if (!pending) {
    const exP = await c.env.DB.prepare(`SELECT id FROM teacher_child_pairings WHERE teacher_id=? AND child_member_id=?`).bind(teacher, childMember).first<{ id: string }>();
    if (exP) {
      pairingId = exP.id;
      const pairingApplied = await runAccountGuardedWrite(
        c,
        `UPDATE teacher_child_pairings
            SET pairing_status='pending', class_id=?, permission_scope='schedule_attendance',
                requested_by=?, updated_at=?
          WHERE id=? AND ${ACCOUNT_WRITE_ALLOWED_SQL}`,
        [b.class_id, teacherUid, now, pairingId],
        familyId,
      );
      if (!pairingApplied) return accountDeletionConflict(c);
    } else {
      pairingId = crypto.randomUUID();
      const pairingApplied = await runAccountGuardedWrite(
        c,
        `INSERT INTO teacher_child_pairings
           (id,teacher_id,class_id,child_member_id,family_id,pairing_status,
            permission_scope,requested_by,created_at,updated_at)
         SELECT ?,?,?,?,?, 'pending','schedule_attendance',?,?,?
          WHERE ${ACCOUNT_WRITE_ALLOWED_SQL}`,
        [pairingId, teacher, b.class_id, childMember, familyId, teacherUid, now, now],
        familyId,
      );
      if (!pairingApplied) return accountDeletionConflict(c);
    }
  } else {
    pairingId = crypto.randomUUID();
    const pairingApplied = await runAccountGuardedWrite(
      c,
      `INSERT INTO teacher_child_pairings
         (id,teacher_id,class_id,child_member_id,family_id,pairing_status,
          permission_scope,requested_by,created_at,updated_at)
       SELECT ?,?,?,NULL,?, 'pending','schedule_attendance',?,?,?
        WHERE ${ACCOUNT_WRITE_ALLOWED_SQL}`,
      [pairingId, teacher, b.class_id, familyId, teacherUid, now, now],
      familyId,
    );
    if (!pairingApplied) return accountDeletionConflict(c);
  }

  // 부모 알림 (event_id+alert_type dedup)
  const msg = pending
    ? `${teacherName} 선생님이 연결을 요청했어요. 수락할 때 아이를 선택해 주세요`
    : `${teacherName} 선생님이 ${childName} 연결을 요청했어요. 수락하면 일정·출석을 공유해요`;
  const eventId = pending ? `tcpf:${teacher}:${familyId}` : `tcp:${pairingId}`;
  const exA = await c.env.DB.prepare(`SELECT id FROM parent_alerts WHERE event_id=? AND alert_type='teacher_pairing_request' LIMIT 1`).bind(eventId).first();
  if (!exA) {
    const aid = crypto.randomUUID();
    const alertApplied = await runAccountGuardedWrite(
      c,
      `INSERT INTO parent_alerts (id,family_id,alert_type,title,message,severity,event_id,child_user_id,read,read_by,created_at)
       SELECT ?,?, 'teacher_pairing_request', '선생님 연결 요청', ?, 'info', ?, ?, 0, '{}', ?
        WHERE ${ACCOUNT_WRITE_ALLOWED_SQL}`,
      [aid, familyId, msg, eventId, childUser, now],
      familyId,
    );
    if (!alertApplied) return accountDeletionConflict(c);
    await notifyPg(c.env, familyId, "parent_alerts", "INSERT", {
      id: aid, family_id: familyId, alert_type: "teacher_pairing_request", title: "선생님 연결 요청",
      message: msg, severity: "info", event_id: eventId, child_user_id: childUser, read: false, created_at: now,
    }, null);
  }

    return c.json({ status: "ok", pairing_id: pairingId });
  });
});

export default tw;

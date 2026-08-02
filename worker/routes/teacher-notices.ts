// 선생님 알림장 (P6) write/read API. teacherNotices.js 4종 + 3 RPC 를 D1 로 직역.
//   · publish_teacher_notice  → POST   /api/teacher/notices
//   · loadSentTeacherNotices  → GET    /api/teacher/notices/sent
//   · get_my_teacher_notices  → GET    /api/teacher/notices/mine
//   · mark_teacher_notice_read→ POST   /api/teacher/notices/:id/read
//
// 게이트(my_teacher_id / 반 소유 / get_my_family_ids / read_by uuid[])는 RPC 본문대로.
// 복합 unique(teacher_notice_recipients) 미이관이라 select-then-write 로 멱등 처리.
// events RLS 는 넓히지 않는다 — 본 라우트가 approved 페어링을 검증한 뒤 자동등록한다.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { getMyTeacherId, getMyFamilyIds } from "../db/authz";
import { pgNow, pgToIso } from "../lib/time";
import type { PushEnv } from "../lib/pushEnv";
import { handleTeacherNotice } from "./push-notify";
import { parseJson, pgArray, toBool, toPgArray } from "../lib/serialize";
import { notifyPg } from "../lib/realtime";
import {
  TEACHER_NOTICE_CONTENT_TYPES,
  validateStoredObjectMetadata,
} from "../lib/storageObjectValidation";
import {
  acquireAccountMutationLeases,
  isActiveChildMemberMutationTarget,
  loadFamilyNotificationMutationScopes,
  releaseAccountMutationLeases,
  type AccountMutationScope,
} from "../lib/accountMutationScope";
import { partitionNotificationRecipients } from "../lib/notificationQuietHours";
import {
  claimTeacherNoticeTerminalSuppression,
  loadTeacherNoticeAudience,
} from "../lib/teacherNoticeDelivery";

const tn = new Hono<{ Bindings: Env; Variables: Vars }>();

const fail = (c: any, msg: string, status = 400) => c.json({ error: msg }, status);
const DATE_KEY_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;

type NoticeEvent = {
  dateKey?: string;
  title?: string;
  time?: string;
  endTime?: string | null;
  category?: string;
  emoji?: string;
  color?: string;
  bg?: string;
  memo?: string;
};

type NoticeAttachment = {
  name?: string;
  path?: string;
  contentType?: string;
  size?: number;
};

type AttachmentValidationResult =
  | { ok: true; attachments: NoticeAttachment[] }
  | { ok: false; error: string; status: 400 | 403 | 413 | 415 | 503 };

async function validateAttachments(
  bucket: R2Bucket,
  ownerUserId: string,
  raw: unknown,
): Promise<AttachmentValidationResult> {
  if (raw == null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "첨부 파일 정보가 올바르지 않아요", status: 400 };
  if (raw.length > 5) return { ok: false, error: "첨부는 5개까지 가능해요", status: 400 };
  const out: NoticeAttachment[] = [];
  const ownerPrefix = `teacher-notices/${ownerUserId}/`;
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "첨부 파일 정보가 올바르지 않아요", status: 400 };
    }
    const r = item as Record<string, unknown>;
    const name = String(r.name ?? "").trim();
    const path = String(r.path ?? "").trim();
    if (!name || !path || path.includes("..") || path.includes("\\")) {
      return { ok: false, error: "첨부 파일 경로가 올바르지 않아요", status: 400 };
    }
    if (!path.startsWith(ownerPrefix) || path.length <= ownerPrefix.length) {
      return { ok: false, error: "본인이 올린 첨부 파일만 보낼 수 있어요", status: 403 };
    }
    let object: R2Object | null;
    try {
      object = await bucket.head(path);
    } catch (error) {
      console.error("[teacher-notice] attachment head failed");
      return { ok: false, error: "첨부 파일을 확인하지 못했어요. 다시 시도해 주세요", status: 503 };
    }
    if (!object) return { ok: false, error: "첨부 파일을 찾지 못했어요", status: 400 };
    const validation = validateStoredObjectMetadata(object, TEACHER_NOTICE_CONTENT_TYPES);
    if (!validation.ok) {
      if (validation.error === "file_too_large") {
        return { ok: false, error: "첨부 파일은 8MB 이하만 가능해요", status: 413 };
      }
      if (validation.error === "unsupported_media_type") {
        return { ok: false, error: "사진 또는 PDF만 첨부할 수 있어요", status: 415 };
      }
      return { ok: false, error: "빈 첨부 파일은 보낼 수 없어요", status: 400 };
    }
    out.push({
      name,
      path,
      contentType: validation.contentType,
      size: validation.size,
    });
  }
  return { ok: true, attachments: out };
}

function parseJsonArray(value: unknown): unknown[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

// 한 수신 아이(가족)에 대해 p_events 를 events + events_children 로 자동등록.
// 생성된 event_id 배열과 (realtime 통지용) 역직렬화 행을 반환한다.
async function createEventsForRecipient(
  db: D1Database,
  familyId: string,
  childMemberId: string,
  events: NoticeEvent[],
  createdBy: string,
  now: string,
): Promise<{ ids: string[]; rows: Record<string, unknown>[] }> {
  const ids: string[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const ev of events) {
    const id = crypto.randomUUID();
    const title = String(ev.title ?? "").trim();
    const endTime = ev.endTime ? String(ev.endTime) : null;
    const row = {
      id,
      family_id: familyId,
      date_key: String(ev.dateKey),
      title,
      time: ev.time ?? "",
      category: ev.category ?? "school",
      emoji: ev.emoji ?? "📚",
      color: ev.color ?? "var(--hyeni-cat-school)",
      bg: ev.bg ?? "var(--hyeni-cat-school-bg)",
      memo: ev.memo ?? "",
      location: null as string | null,
      notif_override: null as string | null,
      end_time: endTime,
      is_family_event: 0,
      created_by: createdBy,
      created_at: now,
      updated_at: now,
    };
    await db
      .prepare(
        `INSERT INTO events
           (id, family_id, date_key, title, time, category, emoji, color, bg, memo,
            location, notif_override, end_time, is_family_event, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        row.id, row.family_id, row.date_key, row.title, row.time, row.category,
        row.emoji, row.color, row.bg, row.memo, row.location, row.notif_override,
        row.end_time, row.is_family_event, row.created_by, row.created_at, row.updated_at,
      )
      .run();
    await db
      .prepare(`INSERT INTO events_children (event_id, child_id) VALUES (?, ?)`)
      .bind(id, childMemberId)
      .run();
    ids.push(id);
    rows.push({ ...row, location: null, notif_override: null, is_family_event: false });
  }
  return { ids, rows };
}

// POST /api/teacher/notices — publish_teacher_notice
// body: { class_id, title, body, source_type, events[] }
tn.post("/notices", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const teacher = await getMyTeacherId(c.env.DB, uid);
  if (!teacher) return fail(c, "선생님 프로필을 먼저 만들어 주세요");

  const b = await c.req
    .json<{
      class_id?: string;
      title?: string;
      body?: string;
      source_type?: string;
      events?: NoticeEvent[];
      attachments?: NoticeAttachment[];
    }>()
    .catch(() => ({}) as any);
  const classId = b.class_id ?? "";
  const title = String(b.title ?? "").trim();
  const body = b.body ?? "";
  const sourceType = b.source_type ?? "text";
  const events = Array.isArray(b.events) ? b.events : [];

  const owns = await c.env.DB.prepare(
    `SELECT 1 AS ok FROM teacher_classes WHERE id = ? AND teacher_id = ?`,
  ).bind(classId, teacher).first();
  if (!owns) return fail(c, "본인 반에만 알림장을 보낼 수 있어요", 403);
  if (!title) return fail(c, "알림장 제목을 입력해 주세요");
  if (sourceType !== "text" && sourceType !== "photo") return fail(c, "잘못된 입력 형식이에요");
  if (events.length > 20) return fail(c, "일정은 한 번에 20개까지만 등록할 수 있어요");
  for (const ev of events) {
    if (!ev?.dateKey || !DATE_KEY_RE.test(ev.dateKey)) return fail(c, "일정 날짜 형식이 잘못됐어요");
    if (!String(ev.title ?? "").trim()) return fail(c, "일정 제목이 비어 있어요");
  }
  const attachmentValidation = await validateAttachments(c.env.PHOTOS, uid, b.attachments);
  if (!attachmentValidation.ok) {
    return fail(c, attachmentValidation.error, attachmentValidation.status);
  }
  const attachments = attachmentValidation.attachments;

  // 대상 가족/아이를 먼저 확정하고 모두 lease로 고정한다. 선생님이 첨부 확인을 끝낸 뒤
  // 대상 계정 삭제가 완료돼도 events/recipient 행을 다시 만들 수 없다.
  const recipients = (await c.env.DB.prepare(
    `SELECT tcp.child_member_id, tcp.family_id,
            fm.user_id AS child_user_id, f.parent_id AS owner_user_id
       FROM teacher_child_pairings tcp
       JOIN family_members fm
         ON fm.id=tcp.child_member_id AND fm.family_id=tcp.family_id
        AND fm.role='child' AND fm.is_active=1 AND fm.user_id IS NOT NULL
       JOIN families f ON f.id=tcp.family_id
      WHERE tcp.class_id = ? AND tcp.teacher_id = ? AND tcp.pairing_status = 'approved'`,
  ).bind(classId, teacher).all<{
    child_member_id: string;
    family_id: string;
    child_user_id: string | null;
    owner_user_id: string;
  }>()).results ?? [];
  const noticeMutationScopes: AccountMutationScope[] = [{ userId: uid }];
  const targetUsersByFamily = new Map<string, Set<string>>();
  for (const recipient of recipients) {
    const targets = targetUsersByFamily.get(recipient.family_id) ?? new Set<string>();
    if (recipient.child_user_id) targets.add(recipient.child_user_id);
    targetUsersByFamily.set(recipient.family_id, targets);
  }
  for (const [familyId, targetUserIds] of targetUsersByFamily) {
    const familyScopes = await loadFamilyNotificationMutationScopes(c.env.DB, familyId, targetUserIds);
    if (!familyScopes) return c.json({ error: "account_mutation_blocked" }, 409);
    noticeMutationScopes.push(...familyScopes);
  }
  const noticeMutationLeases = await acquireAccountMutationLeases(c.env.DB, noticeMutationScopes);
  if (noticeMutationLeases.status !== "acquired") {
    return c.json(
      { error: noticeMutationLeases.status === "blocked" ? "account_mutation_blocked" : "account_mutation_unavailable" },
      noticeMutationLeases.status === "blocked" ? 409 : 503,
    );
  }

  let noticeLeaseTransferred = false;
  try {
  for (const recipient of recipients) {
    if (!(await isActiveChildMemberMutationTarget(c.env.DB, recipient.family_id, recipient.child_member_id))) {
      return c.json({ error: "child_no_longer_active" }, 409);
    }
  }

  let quietAllowedRecipientCount = 0;
  let suppressedQuietHours: string[] = [];
  if (recipients.length > 0) {
    try {
      const audience = await loadTeacherNoticeAudience(
        c.env.DB,
        recipients.map((recipient) => ({
          familyId: recipient.family_id,
          childMemberId: recipient.child_member_id,
        })),
      );
      const quietPartition = await partitionNotificationRecipients(c.env.DB, {
        userIds: audience.map((member) => member.userId),
        identity: { action: "teacher_notice" },
        atMs: Date.now(),
      });
      quietAllowedRecipientCount = quietPartition.allowed.size;
      suppressedQuietHours = [...quietPartition.suppressed].sort();
    } catch (error) {
      console.error("[teacher-notice] quiet-hours routing failed");
      return c.json({ error: "quiet_hours_routing_failed" }, 503);
    }
  }

  const hasSchedule = events.length > 0;
  const now = pgNow();
  const noticeId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO teacher_notices
       (id, teacher_id, class_id, title, body, source_type, has_schedule, parsed_events, attachments, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      noticeId, teacher, classId, title, body, sourceType,
      hasSchedule ? 1 : 0,
      hasSchedule ? JSON.stringify(events) : null,
      attachments.length ? JSON.stringify(attachments) : null,
      now,
      now,
    )
    .run();

  // 반의 approved 아이들에게 배포 (+ 일정 자동등록)
  let eventsCreated = 0;
  const notify: { familyId: string; rows: Record<string, unknown>[] }[] = [];
  for (const r of recipients) {
    const { ids, rows } = await createEventsForRecipient(
      c.env.DB, r.family_id, r.child_member_id, events, uid, now,
    );
    eventsCreated += ids.length;
    await c.env.DB.prepare(
      `INSERT INTO teacher_notice_recipients
         (id, notice_id, child_member_id, family_id, event_ids, read_by, created_at)
       VALUES (?,?,?,?,?, '{}', ?)`,
    ).bind(crypto.randomUUID(), noticeId, r.child_member_id, r.family_id, toPgArray(ids), now).run();
    if (rows.length) notify.push({ familyId: r.family_id, rows });
  }

  // 캘린더 실시간 갱신(postgres_changes 대체). best-effort.
  for (const n of notify) {
    for (const row of n.rows) {
      await notifyPg(c.env, n.familyId, "events", "INSERT", row, null);
    }
  }

  if (recipients.length > 0 && quietAllowedRecipientCount === 0 && suppressedQuietHours.length > 0) {
    try {
      await claimTeacherNoticeTerminalSuppression(c.env.DB, noticeId);
    } catch (error) {
      console.error("[teacher-notice] terminal claim failed");
      return c.json({ error: "teacher_notice_terminal_claim_failed" }, 503);
    }
  }

  if (recipients.length > 0 && quietAllowedRecipientCount > 0) {
    c.executionCtx.waitUntil((async () => {
      try {
        await handleTeacherNotice(c.env as PushEnv, c.env.DB, { notice_id: noticeId }, uid, "authenticated");
      } catch (error) {
        console.error("[teacher-notice] push-notify failed");
      } finally {
        await releaseAccountMutationLeases(c.env.DB, noticeMutationLeases.leases);
      }
    })());
    noticeLeaseTransferred = true;
  }

  return c.json({
    noticeId,
    recipients: recipients.length,
    eventsCreated,
    ...(suppressedQuietHours.length > 0 ? { suppressedQuietHours } : {}),
    ...(quietAllowedRecipientCount === 0 && suppressedQuietHours.length > 0
      ? { webSent: 0, fcmSent: 0, total: 0 }
      : {}),
  });
  } finally {
    if (!noticeLeaseTransferred) {
      await releaseAccountMutationLeases(c.env.DB, noticeMutationLeases.leases);
    }
  }
});

// GET /api/teacher/notices/sent?class_id=...&limit=N — loadSentTeacherNotices (선생님 본인)
tn.get("/notices/sent", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const teacher = await getMyTeacherId(c.env.DB, uid);
  if (!teacher) return c.json([]);
  const classId = c.req.query("class_id") ?? "";
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 20, 1), 100);

  const where = classId ? `teacher_id = ? AND class_id = ?` : `teacher_id = ?`;
  const binds = classId ? [teacher, classId, limit] : [teacher, limit];
  const { results } = await c.env.DB.prepare(
    `SELECT id, class_id, title, body, source_type, has_schedule, attachments, created_at
       FROM teacher_notices
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT ?`,
  )
    .bind(...binds)
    .all<Record<string, unknown>>();

  const out = (results ?? []).map((r) => ({
    ...r,
    has_schedule: toBool(r.has_schedule),
    attachments: parseJsonArray(r.attachments),
    created_at: pgToIso(r.created_at as string),
  }));
  return c.json(out);
});

// GET /api/teacher/notices/mine?limit=N — get_my_teacher_notices (부모/아이 수신)
tn.get("/notices/mine", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 20, 1), 100);
  const familyIds = await getMyFamilyIds(c.env.DB, uid);
  if (familyIds.length === 0) return c.json([]);

  const ph = familyIds.map(() => "?").join(",");
  const { results } = await c.env.DB.prepare(
    `SELECT n.id, n.title, n.body, n.has_schedule, n.source_type, n.attachments,
            tp.display_name AS teacher_name, tc.class_name,
            r.child_member_id, fm.name AS child_name,
            r.event_ids, r.read_by, n.created_at
       FROM teacher_notice_recipients r
       JOIN teacher_notices n ON n.id = r.notice_id
       JOIN teacher_profiles tp ON tp.id = n.teacher_id
       JOIN teacher_classes tc ON tc.id = n.class_id
       JOIN family_members fm ON fm.id = r.child_member_id
      WHERE r.family_id IN (${ph})
      ORDER BY n.created_at DESC
      LIMIT ?`,
  )
    .bind(...familyIds, limit)
    .all<Record<string, unknown>>();

  const out = (results ?? []).map((r) => {
    const { read_by, ...rest } = r;
    return {
      ...rest,
      has_schedule: toBool(r.has_schedule),
      attachments: parseJsonArray(r.attachments),
      event_ids: pgArray(r.event_ids),
      read: pgArray(read_by).includes(uid),
      created_at: pgToIso(r.created_at as string),
    };
  });
  return c.json(out);
});

// POST /api/teacher/notices/:id/read — mark_teacher_notice_read (사용자별 멱등 read_by append)
tn.post("/notices/:id/read", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const noticeId = c.req.param("id");
  const familyIds = await getMyFamilyIds(c.env.DB, uid);
  if (familyIds.length === 0) return c.json({ ok: true });

  const ph = familyIds.map(() => "?").join(",");
  const rows = (await c.env.DB.prepare(
    `SELECT id, read_by FROM teacher_notice_recipients
      WHERE notice_id = ? AND family_id IN (${ph})`,
  ).bind(noticeId, ...familyIds).all<{ id: string; read_by: string }>()).results ?? [];

  const now = pgNow();
  for (const row of rows) {
    const readers = pgArray(row.read_by);
    if (readers.includes(uid)) continue;
    await c.env.DB.prepare(`UPDATE teacher_notice_recipients SET read_by = ? WHERE id = ?`)
      .bind(toPgArray([...readers, uid]), row.id)
      .run();
  }
  return c.json({ ok: true });
});

export default tn;

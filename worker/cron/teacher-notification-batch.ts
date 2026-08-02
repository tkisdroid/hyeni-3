// teacher-notification-batch (cron */5) — supabase edge 직역. 선생님 모드 P5.
// 모든 선생님×반의 '곧 이동할 아이'(10분 창)와 '참석 확인 남은 아이'를 묶어
// teacher_notification_batches 에 멱등 기록 + 묶음당 push-notify(teacher_batch) 1건(best-effort).
// ⚠️ 안전 알림(SOS/위험장소)은 절대 수집·발송하지 않는다 — events(화이트리스트)·출석·승인 페어링만 읽음.
import type { Env } from "../types";
import type { PushEnv } from "../lib/pushEnv";
import {
  groupUpcomingByWindow,
  buildAttendanceCheckBatch,
  makeBatchKey,
  hhmmToMinutes,
} from "../shared/teacherBatch.js";
import { handleTeacherBatch } from "../routes/push-notify";
import { toPgArray } from "../lib/serialize";
import { notifyTeacher } from "../lib/realtime";
import {
  acquireAccountMutationLease,
  releaseAccountMutationLease,
  type AccountMutationLease,
} from "../lib/accountMutationLease";
import { isActiveChildMutationTarget } from "../lib/accountMutationScope";
import { writeOperationalLog } from "../lib/safeOperationalLog";

// get_class_today_schedule 화이트리스트(family/friend/NULL 사적 일정 제외).
const SCHEDULE_CATEGORIES = ["school", "sports", "hobby", "other"];
const SCHEDULE_SCOPES = ["schedule_only", "schedule_attendance", "schedule_attendance_location"];
const WINDOW_MIN = 10;

// 멱등키 문자열 → 결정적 UUID(v4 레이아웃). 같은 (선생님,종류,창) → 같은 UUID → push dedup.
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0, k: number; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function keyToUuid(key: string): string {
  const [a, b, c, d] = cyrb128(key);
  const hex = [a, b, c, d].map((n) => n.toString(16).padStart(8, "0")).join("");
  const timeHiVer = "4" + hex.slice(13, 16);
  const variantNibble = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const clockSeq = variantNibble + hex.slice(17, 20);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${timeHiVer}-${clockSeq}-${hex.slice(20, 32)}`;
}

function todayDateKeyKst(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
function nowMinutesKst(now: Date): number {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

interface TeacherClass {
  teacherId: string;
  teacherUserId: string;
  classId: string;
}
interface ScheduleRow {
  childMemberId: string;
  childName: string;
  eventId: string;
  title: string;
  time: string | null;
  endTime: string | null;
  category: string | null;
  location: string | null;
}
interface PendingBatch {
  batchType: string;
  windowLabel?: string;
  childMemberIds: (string | null)[];
  childNames: string[];
  message: string;
}

async function loadAllClasses(db: D1Database): Promise<TeacherClass[]> {
  const { results } = await db.prepare(
    `SELECT tc.id, tc.teacher_id, tp.user_id AS teacher_user_id
       FROM teacher_classes tc
       JOIN teacher_profiles tp ON tp.id=tc.teacher_id`,
  ).all<{ id: string; teacher_id: string; teacher_user_id: string }>();
  return (results ?? [])
    .filter((r) => r.id && r.teacher_id && r.teacher_user_id)
    .map((r) => ({
      teacherId: String(r.teacher_id),
      teacherUserId: String(r.teacher_user_id),
      classId: String(r.id),
    }));
}

async function loadClassFamilyMutationScopes(
  db: D1Database,
  classId: string,
): Promise<Array<{ familyId: string; ownerUserId: string; childUserId: string }>> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT fm.family_id, f.parent_id AS owner_user_id, fm.user_id AS child_user_id
         FROM teacher_class_children tcc
         JOIN teacher_child_pairings tcp ON tcp.id=tcc.pairing_id
         JOIN family_members fm ON fm.id=tcc.child_member_id
         JOIN families f ON f.id=fm.family_id
        WHERE tcc.class_id=?
          AND fm.role='child' AND fm.is_active=1 AND fm.user_id IS NOT NULL
          AND tcp.pairing_status='approved'
          AND tcp.permission_scope IN ('schedule_only','schedule_attendance','schedule_attendance_location')`,
    )
    .bind(classId)
    .all<{ family_id: string; owner_user_id: string; child_user_id: string }>();
  return (results ?? [])
    .filter((row) => row.family_id && row.owner_user_id)
    .map((row) => ({
      familyId: String(row.family_id),
      ownerUserId: String(row.owner_user_id),
      childUserId: String(row.child_user_id),
    }));
}

// get_class_today_schedule 게이트(approved 페어링 + scope + 카테고리)를 명시 조인으로 재현.
async function loadClassSchedule(db: D1Database, classId: string, dateKey: string): Promise<ScheduleRow[]> {
  // 1) 반의 승인된 아이(approved + schedule scope) — teacher_class_children JOIN teacher_child_pairings.
  const pairs = await db
    .prepare(
      `SELECT tcc.child_member_id AS child_member_id, tcp.pairing_status AS pairing_status, tcp.permission_scope AS permission_scope
         FROM teacher_class_children tcc
         JOIN teacher_child_pairings tcp ON tcp.id = tcc.pairing_id
        WHERE tcc.class_id = ?`,
    )
    .bind(classId)
    .all<{ child_member_id: string | null; pairing_status: string | null; permission_scope: string | null }>();
  const approvedChildIds: string[] = [];
  for (const row of pairs.results ?? []) {
    if (row.pairing_status !== "approved") continue;
    if (!SCHEDULE_SCOPES.includes(String(row.permission_scope))) continue;
    if (row.child_member_id) approvedChildIds.push(String(row.child_member_id));
  }
  if (!approvedChildIds.length) return [];

  // 2) 아이 이름.
  const phc = approvedChildIds.map(() => "?").join(",");
  const nameById = new Map<string, string>();
  const members = await db
    .prepare(`SELECT id, name FROM family_members WHERE id IN (${phc})`)
    .bind(...approvedChildIds)
    .all<{ id: string; name: string | null }>();
  for (const m of members.results ?? []) nameById.set(String(m.id), String(m.name || "아이"));

  // 3) events_children → events(카테고리 화이트리스트, 그날).
  const links = await db
    .prepare(`SELECT event_id, child_id FROM events_children WHERE child_id IN (${phc})`)
    .bind(...approvedChildIds)
    .all<{ event_id: string; child_id: string }>();
  const linkRows = links.results ?? [];
  const eventIds = [...new Set(linkRows.map((l) => String(l.event_id)).filter(Boolean))];
  if (!eventIds.length) return [];

  const phe = eventIds.map(() => "?").join(",");
  const phcat = SCHEDULE_CATEGORIES.map(() => "?").join(",");
  const events = await db
    .prepare(
      `SELECT id, title, time, end_time, category, location, date_key FROM events
        WHERE id IN (${phe}) AND date_key = ? AND category IN (${phcat})`,
    )
    .bind(...eventIds, dateKey, ...SCHEDULE_CATEGORIES)
    .all<Record<string, unknown>>();
  const eventById = new Map<string, Record<string, unknown>>();
  for (const ev of events.results ?? []) eventById.set(String(ev.id), ev);

  const rows: ScheduleRow[] = [];
  for (const link of linkRows) {
    const ev = eventById.get(String(link.event_id));
    if (!ev) continue;
    const childId = String(link.child_id);
    rows.push({
      childMemberId: childId,
      childName: nameById.get(childId) || "아이",
      eventId: String(ev.id),
      title: String(ev.title || "일정"),
      time: ev.time ? String(ev.time) : null,
      endTime: ev.end_time ? String(ev.end_time) : null,
      category: ev.category ? String(ev.category) : null,
      location: ev.location ? String(ev.location) : null,
    });
  }
  return rows;
}

// 그날 이미 참석 확인된 아이(attended/absent/left) → '참석 확인 묶음'에서 제외.
async function loadCheckedChildIds(db: D1Database, classId: string, dateKey: string): Promise<Set<string>> {
  const set = new Set<string>();
  const { results } = await db
    .prepare(`SELECT child_member_id, attendance_status FROM teacher_attendance_logs WHERE class_id = ? AND date_key = ?`)
    .bind(classId, dateKey)
    .all<{ child_member_id: string | null; attendance_status: string | null }>();
  for (const row of results ?? []) {
    const status = String(row.attendance_status || "");
    if ((status === "attended" || status === "absent" || status === "left") && row.child_member_id) {
      set.add(String(row.child_member_id));
    }
  }
  return set;
}

// 묶음 1건 → teacher_notification_batches 멱등 insert(read-before-write) + handleTeacherBatch(push).
async function deliverBatch(
  env: Env,
  penv: PushEnv,
  db: D1Database,
  tc: TeacherClass,
  windowStartIso: string,
  windowEndIso: string,
  batch: PendingBatch,
): Promise<{ delivered: boolean; deduped: boolean }> {
  const idempotencyKey = keyToUuid(makeBatchKey(tc.teacherId, batch.batchType, windowStartIso));
  const childMemberIds = batch.childMemberIds.filter((id): id is string => typeof id === "string" && id.length > 0);

  // 멱등: 같은 (teacher_id, batch_type, window_start) 묶음이 이미 있으면 재발사 안 함.
  const existing = await db
    .prepare(
      `SELECT id FROM teacher_notification_batches WHERE teacher_id = ? AND batch_type = ? AND window_start = ? LIMIT 1`,
    )
    .bind(tc.teacherId, batch.batchType, windowStartIso)
    .first<{ id: string }>();
  if (existing) return { delivered: false, deduped: true };

  // 묶음 행 insert — child_member_ids 는 uuid[] → pg array literal TEXT 로 직렬화.
  const batchRowId = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO teacher_notification_batches
           (id, teacher_id, class_id, batch_type, window_start, window_end, child_member_ids, summary)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .bind(
        batchRowId,
        tc.teacherId,
        tc.classId,
        batch.batchType,
        windowStartIso,
        windowEndIso,
        toPgArray(childMemberIds),
        batch.message,
      )
      .run();
  } catch (e) {
    console.error("[teacher-batch] batch insert failed");
    return { delivered: false, deduped: false };
  }

  // realtime — 새 묶음(INSERT)을 선생님 룸(TEACHER_ROOM)으로 fan-out (best-effort).
  //   클라 teacherSocket 구독자가 폴링 없이 즉시 재로딩한다. 통지 실패는 적재를 막지 않는다.
  await notifyTeacher(env, tc.teacherId, "teacher_notification_batches", "INSERT", {
    id: batchRowId,
    teacher_id: tc.teacherId,
    class_id: tc.classId,
    batch_type: batch.batchType,
    window_start: windowStartIso,
    window_end: windowEndIso,
    child_member_ids: childMemberIds,
    summary: batch.message,
  }, null);

  // push-notify teacher_batch 핸들러 재사용(service_role) — 멱등키로 push_idempotency dedup.
  try {
    const res = await handleTeacherBatch(
      penv,
      db,
      {
        action: "teacher_batch",
        teacherId: tc.teacherId,
        classId: tc.classId,
        batchType: batch.batchType,
        title: "오늘 반 알림",
        message: batch.message,
        idempotency_key: idempotencyKey,
      },
      "service_role",
    );
    if (!res.ok) {
      writeOperationalLog("error", "teacher_batch_push_notify_failed", { status: res.status });
      return { delivered: false, deduped: false };
    }
  } catch (err) {
    console.error("[teacher-batch] push-notify threw");
    return { delivered: false, deduped: false };
  }
  return { delivered: true, deduped: false };
}

export async function run(env: Env): Promise<Record<string, unknown>> {
  const db = env.DB;
  const penv = env as PushEnv;

  const now = new Date();
  const dateKey = todayDateKeyKst(now);
  const nowMin = nowMinutesKst(now);
  const windowEndIso = new Date(now.getTime() + WINDOW_MIN * 60_000).toISOString();
  const slotIso = new Date(Math.floor(now.getTime() / (WINDOW_MIN * 60_000)) * (WINDOW_MIN * 60_000)).toISOString();
  const attendanceWindowIso = new Date(`${dateKey}T00:00:00+09:00`).toISOString();

  const classes = await loadAllClasses(db);
  let delivered = 0;
  let batchCount = 0;

  for (const tc of classes) {
    const teacherMutationLease = await acquireAccountMutationLease(db, { userId: tc.teacherUserId });
    if (teacherMutationLease.status !== "acquired") continue;
    const teacherTargetMutationLeases: AccountMutationLease[] = [];
    try {
      const familyScopes = await loadClassFamilyMutationScopes(db, tc.classId);
      let familyScopesAcquired = true;
      const acquiredScopeKeys = new Set<string>();
      for (const scope of familyScopes) {
        const ownerScopeKey = `${scope.ownerUserId}:${scope.familyId}`;
        if (!acquiredScopeKeys.has(ownerScopeKey)) {
          const ownerLease = await acquireAccountMutationLease(db, {
            userId: scope.ownerUserId,
            familyId: scope.familyId,
          });
          if (ownerLease.status !== "acquired") {
            familyScopesAcquired = false;
            break;
          }
          acquiredScopeKeys.add(ownerScopeKey);
          teacherTargetMutationLeases.push(ownerLease.lease);
        }
        if (scope.childUserId) {
          const childScopeKey = `${scope.childUserId}:${scope.familyId}`;
          if (acquiredScopeKeys.has(childScopeKey)) continue;
          const childLease = await acquireAccountMutationLease(db, {
            userId: scope.childUserId,
            familyId: scope.familyId,
          });
          if (childLease.status !== "acquired") {
            familyScopesAcquired = false;
            break;
          }
          acquiredScopeKeys.add(childScopeKey);
          teacherTargetMutationLeases.push(childLease.lease);
        }
      }
      if (!familyScopesAcquired) continue;
      for (const scope of familyScopes) {
        if (
          scope.childUserId
          && !(await isActiveChildMutationTarget(db, scope.familyId, scope.childUserId))
        ) {
          familyScopesAcquired = false;
          break;
        }
      }
      if (!familyScopesAcquired) continue;

      const schedule = await loadClassSchedule(db, tc.classId, dateKey);

      // ① 임박 이동 묶음.
      const upcoming = groupUpcomingByWindow(schedule, nowMin, WINDOW_MIN) as PendingBatch[];

      // ② 참석 확인 묶음 — 그날 일정이 있고 시작 시각이 지났는데 아직 미확인인 아이.
      const checked = await loadCheckedChildIds(db, tc.classId, dateKey);
      const byChild = new Map<string, string>();
      for (const row of schedule) {
        if (!byChild.has(row.childMemberId)) byChild.set(row.childMemberId, row.childName);
      }
      const pendingChildren = [...byChild.entries()]
        .filter(([id]) => !checked.has(id))
        .filter(([id]) => {
          const childRows = schedule.filter((r) => r.childMemberId === id);
          return childRows.some((r) => {
            const start = hhmmToMinutes(r.time);
            return start !== null && start <= nowMin;
          });
        })
        .map(([id, name]) => ({ childMemberId: id, childName: name }));
      const attendance = buildAttendanceCheckBatch(pendingChildren) as PendingBatch[];

      const batches: PendingBatch[] = [...upcoming, ...attendance];
      for (const batch of batches) {
        batchCount++;
        const windowStart = batch.batchType === "departure_soon" ? slotIso : attendanceWindowIso;
        const res = await deliverBatch(env, penv, db, tc, windowStart, windowEndIso, batch);
        if (res.delivered) delivered++;
      }
    } finally {
      try {
        await releaseAccountMutationLease(db, teacherMutationLease.lease.id);
      } catch (error) {
        console.error("[teacher-batch] teacher mutation lease release failed");
      }
      for (const lease of teacherTargetMutationLeases) {
        try {
          await releaseAccountMutationLease(db, lease.id);
        } catch (error) {
          console.error("[teacher-batch] family mutation lease release failed");
        }
      }
    }
  }

  return { classes: classes.length, batches: batchCount, delivered };
}

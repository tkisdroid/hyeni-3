// 선생님 모드 read API. teacherApi.js의 read 10종을 D1 SQL로 직역.
// RLS 2축 중 (2) teacher 교차접근: PG 헬퍼(my_teacher_id / is_parent_of_member)와
// reader RPC(get_class_roster 등)의 게이트를 SQL 서브쿼리/EXISTS로 인라인 직역한다.
// 미소유·무권한은 PG 함수와 동일하게 0행(빈 배열)으로 반환한다(403 아님).
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { getMyTeacherId, assertClassOwner, getMyFamilyIds } from "../db/authz";

const teacher = new Hono<{ Bindings: Env; Variables: Vars }>();

// is_parent_of_member(memberCol) PG 헬퍼의 EXISTS 본문(바인딩: uid).
const isParentOf = (memberCol: string, uidPlaceholder: string) => `EXISTS (
  SELECT 1 FROM family_members child_fm
  JOIN family_members parent_fm ON parent_fm.family_id = child_fm.family_id
  WHERE child_fm.id = ${memberCol}
    AND parent_fm.user_id = ${uidPlaceholder}
    AND parent_fm.role = 'parent'
)`;

// GET /api/teacher/me — my_teacher_id (scalar uuid 또는 null)
teacher.get("/me", requireAuth, async (c) => {
  const user = c.get("user");
  const teacherId = await getMyTeacherId(c.env.DB, user.sub);
  return c.json(teacherId);
});

// GET /api/teacher/classes — loadMyClasses (본인 소유 반)
teacher.get("/classes", requireAuth, async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT id, class_name, invite_code, invite_expires_at, created_at
       FROM teacher_classes
      WHERE teacher_id = (SELECT id FROM teacher_profiles WHERE user_id = ?1 LIMIT 1)
      ORDER BY created_at ASC`,
  )
    .bind(user.sub)
    .all();
  return c.json(results ?? []);
});

// GET /api/teacher/classes/:id/roster — get_class_roster (반 명단, approved만)
teacher.get("/classes/:id/roster", requireAuth, async (c) => {
  const classId = c.req.param("id");
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT tcc.id AS roster_id, tcc.child_member_id, fm.name, fm.emoji,
            tcp.id AS pairing_id, tcp.permission_scope
       FROM teacher_class_children tcc
       JOIN teacher_child_pairings tcp ON tcp.id = tcc.pairing_id
       JOIN family_members fm ON fm.id = tcc.child_member_id
      WHERE tcc.class_id = ?1
        AND tcp.pairing_status = 'approved'
        AND EXISTS (
          SELECT 1 FROM teacher_classes tc
           WHERE tc.id = ?1
             AND tc.teacher_id = (SELECT id FROM teacher_profiles WHERE user_id = ?2 LIMIT 1)
        )
      ORDER BY fm.name`,
  )
    .bind(classId, user.sub)
    .all();
  return c.json(results ?? []);
});

// GET /api/teacher/classes/:id/schedule?date_key=... — get_class_today_schedule (4중 게이트)
// location 은 원본 RPC가 text로 반환하므로 D1 TEXT를 그대로 둔다(파싱하지 않음).
teacher.get("/classes/:id/schedule", requireAuth, async (c) => {
  const classId = c.req.param("id");
  const dateKey = c.req.query("date_key") ?? "";
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT tcc.child_member_id, fm.name AS child_name, e.id AS event_id,
            e.title, e.time, e.end_time, e.category, e.location
       FROM teacher_class_children tcc
       JOIN teacher_child_pairings tcp ON tcp.id = tcc.pairing_id
       JOIN family_members fm ON fm.id = tcc.child_member_id
       JOIN events_children ec ON ec.child_id = tcc.child_member_id
       JOIN events e ON e.id = ec.event_id
      WHERE tcc.class_id = ?1
        AND e.date_key = ?2
        AND tcp.pairing_status = 'approved'
        AND tcp.permission_scope IN ('schedule_only','schedule_attendance','schedule_attendance_location')
        AND e.category IN ('school','sports','hobby','other')
        AND EXISTS (
          SELECT 1 FROM teacher_classes tc
           WHERE tc.id = ?1
             AND tc.teacher_id = (SELECT id FROM teacher_profiles WHERE user_id = ?3 LIMIT 1)
        )
      ORDER BY fm.name, e.time`,
  )
    .bind(classId, dateKey, user.sub)
    .all();
  return c.json(results ?? []);
});

// GET /api/teacher/classes/:id/attendance?date_key=... — loadClassAttendance (선생님: 자기 반)
// RLS teacher_attendance_select 대체: 반 소유 검증 후 class_id+date_key 필터(미소유 0행).
teacher.get("/classes/:id/attendance", requireAuth, async (c) => {
  const classId = c.req.param("id");
  const dateKey = c.req.query("date_key") ?? "";
  const user = c.get("user");

  if (!(await assertClassOwner(c.env.DB, user.sub, classId))) {
    return c.json([]);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, child_member_id, schedule_id, attendance_status, checked_at,
            corrected_from, note, notified_parent_at
       FROM teacher_attendance_logs
      WHERE class_id = ?1 AND date_key = ?2
      ORDER BY checked_at ASC`,
  )
    .bind(classId, dateKey)
    .all();
  return c.json(results ?? []);
});

// GET /api/teacher/parent-links — get_parent_teacher_links (부모: 내 아이들의 선생님 연결)
// 최신(pairing_phone_first): child 미정(NULL) pending 도 내 가족이면 노출(LEFT JOIN +
// child NULL OR 분기) — 부모가 아이 선택해 수락할 수 있게.
teacher.get("/parent-links", requireAuth, async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT tcp.id AS pairing_id, tp.display_name AS teacher_name, tc.class_name,
            tcp.child_member_id, fm.name AS child_name, tcp.pairing_status AS status,
            tcp.permission_scope
       FROM teacher_child_pairings tcp
       JOIN teacher_profiles tp ON tp.id = tcp.teacher_id
       LEFT JOIN teacher_classes tc ON tc.id = tcp.class_id
       LEFT JOIN family_members fm ON fm.id = tcp.child_member_id
      WHERE ${isParentOf("tcp.child_member_id", "?1")}
         OR (tcp.child_member_id IS NULL AND tcp.family_id IN (
              SELECT family_id FROM family_members WHERE user_id = ?1
              UNION SELECT id FROM families WHERE parent_id = ?1))
      ORDER BY tcp.created_at DESC`,
  )
    .bind(user.sub)
    .all();
  return c.json(results ?? []);
});

// GET /api/teacher/child-links — get_child_teacher_links (자녀 본인: 내 선생님)
teacher.get("/child-links", requireAuth, async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT tcp.id AS pairing_id, tp.display_name AS teacher_name, tc.class_name,
            tcp.pairing_status AS status
       FROM teacher_child_pairings tcp
       JOIN teacher_profiles tp ON tp.id = tcp.teacher_id
       LEFT JOIN teacher_classes tc ON tc.id = tcp.class_id
      WHERE tcp.pairing_status = 'approved'
        AND tcp.child_member_id IN (
          SELECT fm.id FROM family_members fm WHERE fm.user_id = ?1
        )
      ORDER BY tp.display_name`,
  )
    .bind(user.sub)
    .all();
  return c.json(results ?? []);
});

// GET /api/teacher/parent-attendance?date_key=... — loadParentAttendance (부모: 내 아이 출석)
// 클라가 row.family_members?.name 으로 접근하므로 PostgREST 임베드 형태로 재구성한다.
teacher.get("/parent-attendance", requireAuth, async (c) => {
  const dateKey = c.req.query("date_key") ?? "";
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT tal.id, tal.child_member_id, tal.schedule_id, tal.attendance_status,
            tal.checked_at, tal.corrected_from, tal.note, tal.notified_parent_at,
            fm.name AS child_name
       FROM teacher_attendance_logs tal
       JOIN family_members fm ON fm.id = tal.child_member_id
      WHERE tal.date_key = ?1
        AND ${isParentOf("tal.child_member_id", "?2")}
      ORDER BY tal.checked_at ASC`,
  )
    .bind(dateKey, user.sub)
    .all<Record<string, unknown>>();

  const out = (results ?? []).map((r) => {
    const { child_name, ...rest } = r;
    return { ...rest, family_members: { name: child_name } };
  });
  return c.json(out);
});

// GET /api/teacher/parent-children — loadParentChildrenForPairing (부모: 내 가족 자녀)
teacher.get("/parent-children", requireAuth, async (c) => {
  const user = c.get("user");
  const familyIds = await getMyFamilyIds(c.env.DB, user.sub);
  if (familyIds.length === 0) return c.json([]);

  const ph = familyIds.map(() => "?").join(",");
  const { results } = await c.env.DB.prepare(
    `SELECT id, family_id, name, emoji, color_hex, photo_url, role
       FROM family_members
      WHERE role = 'child' AND family_id IN (${ph})
      ORDER BY name ASC`,
  )
    .bind(...familyIds)
    .all();
  return c.json(results ?? []);
});

export default teacher;

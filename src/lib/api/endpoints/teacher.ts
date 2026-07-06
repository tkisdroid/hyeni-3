/**
 * 선생님 도메인 엔드포인트(순수 fetch 래퍼 + 타입).
 * hyeni-1 teacherApi.js 계약 이관: me/classes/roster/attendance(읽기) + notices/attendance/pairings(쓰기).
 *
 * ⚠️ 출석 date_key 는 표준 "YYYY-MM-DD"(events 도메인의 0-index 월 규칙과 다름).
 * 읽기 계열은 미배포/미존재(404·501)면 isMissingFunction 으로 판별해 빈값 폴백한다
 * (선생님 Worker 함수가 아직 배포 전일 수 있음 — 화면은 빈 상태로 안내).
 */
import { apiGet, apiPost } from "../client";
import { isMissingFunction } from "../errors";

/* ── 타입 ─────────────────────────────────────────────────────────────────── */

export interface TeacherClass {
  classId: string;
  className: string;
  inviteCode: string | null;
  inviteExpiresAt: string | null;
  createdAt: string | null;
}

export interface RosterChild {
  rosterId: string;
  classId: string;
  pairingId: string | null;
  childMemberId: string;
  name: string;
  emoji: string;
  permissionScope: string | null;
}

/**
 * 반 시간표 한 줄 = 우리 반 아이 한 명의 특정 날짜 일정(events join).
 * time/endTime 은 "HH:MM"(events.time). location 은 서버가 text 로 반환(파싱 안 함).
 */
export interface ClassScheduleRow {
  childMemberId: string;
  childName: string;
  eventId: string;
  title: string;
  time: string | null;
  endTime: string | null;
  category: string | null;
  location: string | null;
}

export interface TeacherNoticeAttachment {
  name: string;
  path: string;
  contentType: string;
  size: number;
}

/** 출석 상태 계약(teacher_attendance_logs.attendance_status). */
export type AttendanceStatus = "pending" | "attended" | "absent" | "left" | "unknown";

export interface AttendanceRow {
  id: string;
  childMemberId: string;
  scheduleId: string | null;
  status: AttendanceStatus;
  checkedAt: string | null;
  correctedFrom: string | null;
  note: string | null;
  notifiedParentAt: string | null;
}

/* ── 서버 원본 행(raw) 타입 ───────────────────────────────────────────────── */

interface RawClassRow {
  id: string;
  class_name: string;
  invite_code?: string | null;
  invite_expires_at?: string | null;
  created_at?: string | null;
}

interface RawRosterRow {
  roster_id: string;
  pairing_id?: string | null;
  child_member_id: string;
  name?: string | null;
  emoji?: string | null;
  permission_scope?: string | null;
}

interface RawAttendanceRow {
  id: string;
  child_member_id: string;
  schedule_id?: string | null;
  attendance_status?: string | null;
  checked_at?: string | null;
  corrected_from?: string | null;
  note?: string | null;
  notified_parent_at?: string | null;
}

interface RawClassScheduleRow {
  child_member_id: string;
  child_name?: string | null;
  event_id: string;
  title?: string | null;
  time?: string | null;
  end_time?: string | null;
  category?: string | null;
  location?: string | null;
}

const VALID_STATUSES: readonly AttendanceStatus[] = [
  "pending",
  "attended",
  "absent",
  "left",
  "unknown",
];

function toStatus(value: string | null | undefined): AttendanceStatus {
  return VALID_STATUSES.includes(value as AttendanceStatus)
    ? (value as AttendanceStatus)
    : "pending";
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAttendanceRow(row: RawAttendanceRow): AttendanceRow {
  return {
    id: row.id,
    childMemberId: row.child_member_id,
    scheduleId: row.schedule_id ?? null,
    status: toStatus(row.attendance_status),
    checkedAt: row.checked_at ?? null,
    correctedFrom: row.corrected_from ?? null,
    note: trimOrNull(row.note),
    notifiedParentAt: row.notified_parent_at ?? null,
  };
}

/* ── 읽기(미배포 시 빈값 graceful 폴백) ───────────────────────────────────── */

/**
 * 내 선생님 식별자(teacher_profiles.id). 선생님 프로필이 없거나 미배포면 null.
 * 서버가 스칼라(id 문자열) 또는 { id } 로 응답하는 두 형태 모두 수용한다.
 */
export async function getTeacherMe(): Promise<string | null> {
  try {
    const data = await apiGet<unknown>("/api/teacher/me");
    if (!data) return null;
    if (typeof data === "string") return data;
    if (typeof data === "object" && data !== null && "id" in data) {
      const id = (data as { id?: unknown }).id;
      return typeof id === "string" ? id : null;
    }
    return null;
  } catch (error) {
    if (isMissingFunction(error)) return null;
    throw error;
  }
}

/** 내 반 목록(선생님 본인). 미배포면 빈 배열. */
export async function fetchTeacherClasses(): Promise<TeacherClass[]> {
  try {
    const rows = await apiGet<RawClassRow[] | null>("/api/teacher/classes");
    return (rows ?? []).map((r) => ({
      classId: r.id,
      className: r.class_name,
      inviteCode: r.invite_code ?? null,
      inviteExpiresAt: r.invite_expires_at ?? null,
      createdAt: r.created_at ?? null,
    }));
  } catch (error) {
    if (isMissingFunction(error)) return [];
    throw error;
  }
}

/** 반 명단(승인된 아이만). 미배포/반없음이면 빈 배열. */
export async function fetchRoster(classId: string): Promise<RosterChild[]> {
  if (!classId) return [];
  try {
    const rows = await apiGet<RawRosterRow[] | null>(
      `/api/teacher/classes/${encodeURIComponent(classId)}/roster`,
    );
    return (rows ?? []).map((r) => ({
      rosterId: r.roster_id,
      classId,
      pairingId: r.pairing_id ?? null,
      childMemberId: r.child_member_id,
      name: trimOrNull(r.name) ?? "아이",
      emoji: trimOrNull(r.emoji) ?? "🐰",
      permissionScope: r.permission_scope ?? null,
    }));
  } catch (error) {
    if (isMissingFunction(error)) return [];
    throw error;
  }
}

/** 반의 특정 날짜 출석 로그. dateKey = "YYYY-MM-DD". 미배포면 빈 배열. */
export async function fetchAttendance(
  classId: string,
  dateKey: string,
): Promise<AttendanceRow[]> {
  if (!classId || !dateKey) return [];
  try {
    const rows = await apiGet<RawAttendanceRow[] | null>(
      `/api/teacher/classes/${encodeURIComponent(classId)}/attendance?date_key=${encodeURIComponent(dateKey)}`,
    );
    return (rows ?? []).map(normalizeAttendanceRow);
  } catch (error) {
    if (isMissingFunction(error)) return [];
    throw error;
  }
}

/**
 * 반 시간표 = 반 아이들의 특정 날짜 일정(events join).
 * ⚠️ dateKey 는 events 도메인 규칙(0-index 월 · transform/dateKey.dateToDateKey) 이다.
 *    출석 date_key(표준 ISO)와 다르다 — 반드시 dateToDateKey 로 만든 값을 넘길 것.
 * 서버엔 '주간 그리드 셀 편집·주 복사' 엔드포인트가 없다(읽기만). 반 일정 편집은
 * 알림장(publishNotice)의 events 자동등록으로만 반영된다(각 가족 캘린더).
 * 미배포/미존재(404·501)면 빈 배열로 graceful 폴백한다.
 */
export async function fetchClassSchedule(
  classId: string,
  dateKey: string,
): Promise<ClassScheduleRow[]> {
  if (!classId || !dateKey) return [];
  try {
    const rows = await apiGet<RawClassScheduleRow[] | null>(
      `/api/teacher/classes/${encodeURIComponent(classId)}/schedule?date_key=${encodeURIComponent(dateKey)}`,
    );
    return (rows ?? []).map((r) => ({
      childMemberId: r.child_member_id,
      childName: trimOrNull(r.child_name) ?? "아이",
      eventId: r.event_id,
      title: trimOrNull(r.title) ?? "일정",
      time: trimOrNull(r.time),
      endTime: trimOrNull(r.end_time),
      category: r.category ?? null,
      location: trimOrNull(r.location),
    }));
  } catch (error) {
    if (isMissingFunction(error)) return [];
    throw error;
  }
}

/* ── 쓰기(배선만 — 화면은 사용자 액션에만 호출, 에러는 그대로 표면화) ────────── */

/** 서버가 c.json(id) 로 반환하는 스칼라(id 문자열) 또는 { id } 를 모두 수용한다. */
function idFromResponse(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "id" in data) {
    const id = (data as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/**
 * 선생님 프로필 보장(생성/갱신, 멱등). teacher_profiles.id 반환.
 * 반 생성 전 반드시 선행돼야 한다(서버는 프로필 없으면 "선생님 프로필을 먼저 만들어 주세요").
 */
export async function ensureTeacherProfile(
  displayName?: string | null,
): Promise<string | null> {
  const data = await apiPost<unknown>("/api/teacher/profile", {
    display_name: trimOrNull(displayName ?? null),
  });
  return idFromResponse(data);
}

/** 반 생성. teacher_classes.id 반환. 프로필이 없으면 서버가 한글 에러로 안내한다. */
export async function createClass(className: string): Promise<string | null> {
  const name = trimOrNull(className);
  if (!name) throw new Error("반 이름을 입력해 주세요.");
  const data = await apiPost<unknown>("/api/teacher/classes", { class_name: name });
  return idFromResponse(data);
}

export interface PublishNoticeInput {
  classId: string;
  title: string;
  body?: string;
  sourceType?: string;
  events?: unknown[];
  attachments?: TeacherNoticeAttachment[];
}

export interface PublishNoticeResult {
  noticeId: string | null;
  recipients: number;
  eventsCreated: number;
}

/** 알림장 등록 + 반 전체 배포(+ 일정 자동등록). */
export async function publishNotice(
  input: PublishNoticeInput,
): Promise<PublishNoticeResult> {
  if (!input.classId) throw new Error("반 정보가 없어 알림장을 보낼 수 없어요.");
  const data = await apiPost<PublishNoticeResult | null>("/api/teacher/notices", {
    class_id: input.classId,
    title: input.title,
    body: input.body ?? "",
    source_type: input.sourceType ?? "text",
    events: input.events ?? [],
    attachments: input.attachments ?? [],
  });
  return data ?? { noticeId: null, recipients: 0, eventsCreated: 0 };
}

export interface SetAttendanceInput {
  childMemberId: string;
  dateKey: string; // "YYYY-MM-DD"
  scheduleId?: string | null;
  status: AttendanceStatus;
  note?: string | null;
}

export interface CopyClassWeekScheduleResult {
  copied: number;
  skipped: number;
  sourceCount: number;
}

/** 한 아이의 참석 상태 기록(참석·결석·하교·확인필요). { logId } 반환. */
export async function setAttendance(
  input: SetAttendanceInput,
): Promise<{ logId: string | null }> {
  if (!input.childMemberId) throw new Error("아이 정보가 없어 참석을 기록할 수 없어요.");
  if (!input.dateKey) throw new Error("날짜 정보가 없어 참석을 기록할 수 없어요.");
  const data = await apiPost<string | null>("/api/teacher/attendance", {
    child_member_id: input.childMemberId,
    date_key: input.dateKey,
    schedule_id: input.scheduleId ?? null,
    status: input.status,
    note: trimOrNull(input.note),
  });
  return { logId: data ?? null };
}

/** 선택 주간(월~일)의 반 일정을 다음 주로 복사. 중복 일정은 서버가 건너뛴다. */
export async function copyClassWeekSchedule(
  classId: string,
  weekStartDateKey: string,
): Promise<CopyClassWeekScheduleResult> {
  if (!classId) throw new Error("반 정보가 없어 시간표를 복사할 수 없어요.");
  if (!weekStartDateKey) throw new Error("복사할 주간 날짜가 없어요.");
  const data = await apiPost<CopyClassWeekScheduleResult | null>(
    `/api/teacher/classes/${encodeURIComponent(classId)}/schedule/copy-week`,
    { week_start_date_key: weekStartDateKey },
  );
  return data ?? { copied: 0, skipped: 0, sourceCount: 0 };
}

export interface RequestPairingInput {
  classId: string;
  phone: string;
  childName?: string | null;
}

/** 선생님 → 부모 '연결 요청'(전화번호 기반). { status, pairingId } 반환. */
export async function requestPairing(
  input: RequestPairingInput,
): Promise<{ status: string | null; pairingId: string | null }> {
  if (!input.classId) throw new Error("반 정보가 없어 연결 요청을 보낼 수 없어요.");
  const phone = trimOrNull(input.phone);
  if (!phone) throw new Error("부모님 전화번호를 입력해 주세요.");
  const data = await apiPost<{ status?: string; pairing_id?: string } | null>(
    "/api/teacher/pairings/request",
    { class_id: input.classId, phone, child_name: trimOrNull(input.childName) },
  );
  return { status: data?.status ?? null, pairingId: data?.pairing_id ?? null };
}

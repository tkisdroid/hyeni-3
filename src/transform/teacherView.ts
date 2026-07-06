/**
 * 선생님 반/명단/출석 → 화면 뷰모델(순수).
 * 도메인 데이터(반이름·아이이름·출석상태)는 실값, 표현(아바타·배경·배지색)은 파생.
 * 배지 색은 목업 디자인의 색 언어(민트=출석/앰버=확인필요/레드=결석/그레이=미확인)를 보존한다.
 */
import type {
  RosterChild,
  AttendanceRow,
  AttendanceStatus,
} from "@/lib/api/endpoints/teacher";
import { DEFAULT_CHILD_AVATAR } from "@/lib/avatar";

/**
 * 출석용 ISO date_key("YYYY-MM-DD").
 * ⚠️ events 도메인의 0-index 월 date_key 와 다르다 — 출석은 표준 ISO 로컬 날짜.
 * toISOString(UTC)은 자정 부근에 하루가 밀릴 수 있어 로컬 필드로 직접 조립한다.
 */
export function isoDateKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* ── 출석 배지(상태 → 라벨/색) ────────────────────────────────────────────── */

export interface AttendBadge {
  label: string;
  tone: string;
  bg: string;
}

// 목업(TeacherHome)이 쓰던 CSS 변수 팔레트 재사용 → 디자인 색 언어 보존.
const ATTEND_BADGE: Record<AttendanceStatus, AttendBadge> = {
  attended: { label: "출석", tone: "var(--mint-text)", bg: "var(--mint-soft)" },
  left: { label: "하교", tone: "var(--mint-text)", bg: "var(--mint-soft)" },
  absent: { label: "결석", tone: "var(--danger-text)", bg: "var(--danger-soft)" },
  unknown: { label: "확인 필요", tone: "var(--gold-text)", bg: "var(--cream-soft)" },
  pending: { label: "미확인", tone: "#8B7E84", bg: "#F2EEF0" },
};

export function attendBadge(status: AttendanceStatus | null | undefined): AttendBadge {
  return ATTEND_BADGE[status ?? "pending"] ?? ATTEND_BADGE.pending;
}

/**
 * 출석 로그 배열 → { [childMemberId]: status } 평탄 맵.
 * 입력이 checked_at 오름차순이라 뒤(최근)가 앞을 덮어써 최신 상태만 남는다.
 */
export function buildAttendanceMap(
  rows: AttendanceRow[],
): Record<string, AttendanceStatus> {
  const map: Record<string, AttendanceStatus> = {};
  for (const row of rows) {
    if (!row?.childMemberId) continue;
    map[row.childMemberId] = row.status;
  }
  return map;
}

/* ── 부제(공유 범위) ──────────────────────────────────────────────────────── */

// 명단 API 는 보호자 이름을 주지 않으므로 부제는 '공유 범위'로 대체한다.
const SCOPE_LABEL: Record<string, string> = {
  schedule_only: "일정 공유",
  schedule_attendance: "일정·출석",
  schedule_attendance_location: "일정·출석·위치",
};

export function scopeLabel(scope: string | null | undefined): string {
  return (scope && SCOPE_LABEL[scope]) || "연결됨";
}

/* ── 학생 카드 뷰모델 ─────────────────────────────────────────────────────── */

// 명단 API 는 사진 미제공이라 기본 혜니 캐릭터를 사용한다.
const STUDENT_SOFTS = ["#E6F2FB", "#FDE7F1", "#FFEEE3", "#E7F8F0", "#F1ECFF", "#FFF3D6"];

export interface StudentView {
  id: string;
  childMemberId: string;
  name: string;
  subtitle: string;
  emoji: string;
  avatar: string;
  soft: string;
  attend: AttendBadge;
  status: AttendanceStatus;
}

/** 명단 + 출석 로그 → 학생 카드 목록. */
export function mapRosterToStudents(
  roster: RosterChild[],
  attendance: AttendanceRow[],
): StudentView[] {
  const statusMap = buildAttendanceMap(attendance);
  return roster.map((r, i) => {
    const status = statusMap[r.childMemberId] ?? "pending";
    return {
      id: r.rosterId,
      childMemberId: r.childMemberId,
      name: r.name,
      subtitle: scopeLabel(r.permissionScope),
      emoji: r.emoji,
      avatar: DEFAULT_CHILD_AVATAR,
      soft: STUDENT_SOFTS[i % STUDENT_SOFTS.length],
      attend: attendBadge(status),
      status,
    };
  });
}

/** '등원 완료' 카운트 = 참석(attended) + 하교(left). */
export function countPresent(students: StudentView[]): number {
  return students.filter((s) => s.status === "attended" || s.status === "left").length;
}

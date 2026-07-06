/**
 * 선생님 도메인 TanStack Query 훅.
 * 컴포넌트는 이 훅만 import(endpoints/teacher 직접 호출 금지).
 * 읽기 훅은 authenticated 에서만 활성화하고, roster/attendance 는 classId 가 있어야 활성화한다.
 * 쓰기(알림장·출석·연결요청)는 배선만 — 화면의 사용자 액션에서만 호출한다.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "./keys";
import { useAuth } from "@/auth/AuthContext";
import {
  getTeacherMe,
  fetchTeacherClasses,
  fetchRoster,
  fetchAttendance,
  fetchClassSchedule,
  publishNotice,
  setAttendance,
  requestPairing,
  ensureTeacherProfile,
  createClass,
  type PublishNoticeInput,
  type SetAttendanceInput,
  type RequestPairingInput,
} from "@/lib/api/endpoints/teacher";

/** 내 선생님 프로필 식별자(없으면 null). */
export function useTeacherMe() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.teacherMe,
    queryFn: getTeacherMe,
    enabled: status === "authenticated",
  });
}

/** 내 반 목록(선생님 본인). */
export function useTeacherClasses() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.teacherClasses,
    queryFn: fetchTeacherClasses,
    enabled: status === "authenticated",
  });
}

/** 반 명단(승인된 아이만). classId 필수. */
export function useRoster(classId: string | null) {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.teacherRoster(classId ?? ""),
    queryFn: () => fetchRoster(classId as string),
    enabled: status === "authenticated" && !!classId,
  });
}

/** 반의 특정 날짜 출석 로그. classId·dateKey 필수. */
export function useAttendance(classId: string | null, dateKey: string) {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.teacherAttendance(classId ?? "", dateKey),
    queryFn: () => fetchAttendance(classId as string, dateKey),
    enabled: status === "authenticated" && !!classId && !!dateKey,
  });
}

/**
 * 반 시간표 = 반 아이들의 특정 날짜 일정. classId·dateKey 필수.
 * ⚠️ dateKey 는 events 도메인 date_key(0-index 월 · transform/dateKey.dateToDateKey).
 * (qk 팩토리에 없는 도메인이라 키를 인라인으로 둔다 — 통합 담당자의 keys.ts 와 충돌 회피.)
 */
export function useClassSchedule(classId: string | null, dateKey: string) {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["teacher", "schedule", classId ?? "", dateKey],
    queryFn: () => fetchClassSchedule(classId as string, dateKey),
    enabled: status === "authenticated" && !!classId && !!dateKey,
  });
}

/* ── 쓰기(배선만) ─────────────────────────────────────────────────────────── */

/** 알림장 등록 + 반 전체 배포 → 명단 캐시 무효화. */
export function usePublishNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PublishNoticeInput) => publishNotice(input),
    onSuccess: (_data, input) =>
      qc.invalidateQueries({ queryKey: qk.teacherRoster(input.classId) }),
  });
}

/** 출석 기록 → 출석 캐시(prefix) 무효화. */
export function useSetAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetAttendanceInput) => setAttendance(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teacher", "attendance"] }),
  });
}

/** 선생님 → 부모 연결 요청 → 명단 캐시 무효화. */
export function useRequestPairing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RequestPairingInput) => requestPairing(input),
    onSuccess: (_data, input) =>
      qc.invalidateQueries({ queryKey: qk.teacherRoster(input.classId) }),
  });
}

/** 선생님 프로필 보장(생성/갱신) → 선생님 식별자 캐시 무효화. */
export function useEnsureTeacherProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (displayName?: string | null) => ensureTeacherProfile(displayName ?? null),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.teacherMe }),
  });
}

/**
 * 반 만들기 = 프로필 보장 후 반 생성(멱등). 성공 시 me/classes 캐시 무효화.
 * className 만 필수(teacherName 은 선택 — 없으면 서버가 "선생님" 기본값).
 */
export function useCreateClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { className: string; teacherName?: string | null }) => {
      await ensureTeacherProfile(input.teacherName ?? null);
      return createClass(input.className);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.teacherMe });
      qc.invalidateQueries({ queryKey: qk.teacherClasses });
    },
  });
}

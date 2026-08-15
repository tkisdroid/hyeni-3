/**
 * 계정 도메인 엔드포인트.
 * - 계정 조회는 /api/family/mine 의 "caller 중심" 필드(myName/myRole/isPrimaryParent)를 쓴다.
 * - 회원 탈퇴(delete)는 auth 엔드포인트(/api/account/delete)를 AuthProvider 가 감싼다(캐시 clear 포함).
 * - 아이별 테마색은 /api/family/member/profile(primary parent) 로 실제 영속화한다.
 * - legal(약관/개인정보)은 Worker 루트가 공개 HTML 을 서빙(/privacy, /data-deletion) → 외부 브라우저로 연다.
 * - 데이터 내보내기(buildFamilyDataExport)는 hyeni-1 dataExport.js 이관 — 기존 fetch 엔드포인트만 재사용.
 *
 * 원칙: 컴포넌트는 이 모듈을 직접 쓰지 않는다. queries/useAccount 훅이 감싼다.
 */
import { API_BASE } from "@/config/env";
import { apiGet, apiPost } from "../client";
import { ApiError } from "../errors";
import type { FamilyMember } from "./family";
import { fetchEvents, fetchAcademies, type CalendarEvent, type Academy } from "./schedule";
import { fetchSavedPlaces, fetchDangerZones, type SavedPlace, type DangerZone } from "./location";

/** 로그인 사용자(caller) 중심 계정 정보. /api/family/mine 응답에서 파생. */
export interface AccountInfo {
  familyId: string;
  myName: string;
  myRole: "parent" | "child" | "teacher";
  parentName: string | null;
  isPrimaryParent: boolean;
  isCoParent: boolean;
  members: FamilyMember[];
}

interface FamilyMineAccountResponse {
  familyId: string;
  myName?: string | null;
  myRole?: string | null;
  parentName?: string | null;
  isPrimaryParent?: boolean;
  isCoParent?: boolean;
  members?: FamilyMember[];
}

function toRole(value: string | null | undefined): AccountInfo["myRole"] {
  return value === "child" || value === "teacher" ? value : "parent";
}

/** 현재 사용자의 계정 정보. 비로그인/가족없음이면 null. */
export async function getMyAccount(): Promise<AccountInfo | null> {
  const data = await apiGet<FamilyMineAccountResponse | null>("/api/family/mine");
  if (!data) return null;
  return {
    familyId: data.familyId,
    myName: (data.myName ?? "").trim() || "보호자",
    myRole: toRole(data.myRole),
    parentName: data.parentName ?? null,
    isPrimaryParent: data.isPrimaryParent === true,
    isCoParent: data.isCoParent === true,
    members: data.members ?? [],
  };
}

/**
 * 아이 멤버의 이름 + 테마색(color_hex) 저장(primary parent 전용, 서버 강제).
 * 서버는 new_name 이 비면 400, hex 형식이 아니면 400, 권한 없으면 403 을 돌려준다.
 */
export async function setChildTheme(
  familyId: string,
  memberId: string,
  name: string,
  colorHex: string,
): Promise<void> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("아이 이름이 비어 있어요");
  if (!/^#[0-9A-Fa-f]{6}$/.test(colorHex)) throw new Error("테마 색상이 올바르지 않아요");
  await apiPost("/api/family/member/profile", {
    family_id: familyId,
    member_id: memberId,
    new_name: trimmedName,
    color_hex: colorHex.toUpperCase(),
  });
}

/** 현재 비밀번호 확인 후 새 비밀번호 저장. */
export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const currentPassword = input.currentPassword;
  const newPassword = input.newPassword;
  if (!currentPassword) throw new ApiError("current_password_required", 400);
  if (newPassword.length < 6) throw new ApiError("weak_password", 400);
  await apiPost("/auth/change-password", { currentPassword, newPassword });
}

// ── legal(약관 / 개인정보) — Worker 루트 공개 HTML ─────────────────────────
export const PRIVACY_POLICY_URL = `${API_BASE}/privacy`;
export const TERMS_OF_SERVICE_URL = `${API_BASE}/terms`;
export const DATA_DELETION_URL = `${API_BASE}/data-deletion`;

// ── 데이터 내보내기(데이터 이동권) — hyeni-1 dataExport.js 이관 ─────────────
export const DATA_EXPORT_SCHEMA_VERSION = 1;

export interface FamilyDataExport {
  meta: {
    schemaVersion: number;
    generatedAt: string;
    familyId: string | null;
    note: string;
    errors: Array<{ section: string; message: string }>;
  };
  account: { name: string; role: string } | null;
  members: FamilyMember[];
  events: CalendarEvent[];
  savedPlaces: SavedPlace[];
  dangerZones: DangerZone[];
  academies: Academy[];
}

/**
 * 가족 데이터를 모아 직렬화 가능한 JSON 객체로 반환한다.
 * 부분 실패는 삼키지 않고 meta.errors 에 명시(hyeni-1 계약).
 * 위치 이력·대화는 방대/키단위라 이 내보내기에는 미포함(meta.note 안내).
 */
export async function buildFamilyDataExport(params: {
  familyId: string;
  account?: { name: string; role: string } | null;
  members?: FamilyMember[];
}): Promise<FamilyDataExport> {
  const { familyId, account = null, members = [] } = params;
  const errors: Array<{ section: string; message: string }> = [];
  const now = new Date();

  async function safe<T>(section: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      errors.push({
        section,
        message: e instanceof ApiError ? e.code ?? "export_section_failed" : "export_section_failed",
      });
      return null;
    }
  }

  const events = await safe("events", () => fetchEvents(familyId));
  const savedPlaces = await safe("savedPlaces", () => fetchSavedPlaces(familyId));
  const dangerZones = await safe("dangerZones", () => fetchDangerZones(familyId));
  const academies = await safe("academies", () => fetchAcademies(familyId));

  return {
    meta: {
      schemaVersion: DATA_EXPORT_SCHEMA_VERSION,
      generatedAt: now.toISOString(),
      familyId,
      note: "위치 이력과 대화 내용은 용량이 커서 이 내보내기에는 포함되지 않아요. 전체 이력이 필요하면 문의해 주세요.",
      errors,
    },
    account,
    members,
    events: events ?? [],
    savedPlaces: savedPlaces ?? [],
    dangerZones: dangerZones ?? [],
    academies: academies ?? [],
  };
}

/** 내보내기 객체를 보기 좋은 JSON 문자열로 직렬화. */
export function serializeDataExport(exportObj: FamilyDataExport): string {
  return JSON.stringify(exportObj, null, 2);
}

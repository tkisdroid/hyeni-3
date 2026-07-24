import { apiGet, apiPut } from "../client";

/**
 * 운영자(관리자) 전용 API.
 *
 * 서버는 ADMIN_USER_IDS 화이트리스트에 없는 계정에 404를 준다(관리자 API의 존재를
 * 노출하지 않기 위해). 화면은 /me 의 isAdmin 으로 먼저 판정해 404를 오류로 보이지 않게 한다.
 */
export interface AdminStatus {
  isAdmin: boolean;
}

export interface AdminAiPrompt {
  prompt: string;
  updatedBy: string | null;
  updatedAt: string | null;
  maxLength: number;
}

export function fetchAdminStatus(): Promise<AdminStatus> {
  return apiGet<AdminStatus>("/api/admin/me");
}

export function fetchAdminAiPrompt(): Promise<AdminAiPrompt> {
  return apiGet<AdminAiPrompt>("/api/admin/ai-prompt");
}

export function saveAdminAiPrompt(prompt: string): Promise<AdminAiPrompt> {
  return apiPut<AdminAiPrompt>("/api/admin/ai-prompt", { prompt });
}

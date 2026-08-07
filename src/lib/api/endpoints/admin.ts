import { apiGet, apiPut } from "../client";
import { ApiError } from "../errors";

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

export interface AdminCommerceControlValues {
  webSubscriptionNewCheckoutsEnabled: boolean;
  webAiCreditNewCheckoutsEnabled: boolean;
}

export interface AdminCommerceControls extends AdminCommerceControlValues {
  configured: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseAdminCommerceControlValuesResponse(
  value: unknown,
): AdminCommerceControlValues {
  const record = asRecord(value);
  if (
    record === null ||
    typeof record.webSubscriptionNewCheckoutsEnabled !== "boolean" ||
    typeof record.webAiCreditNewCheckoutsEnabled !== "boolean"
  ) {
    throw new ApiError("invalid_admin_commerce_controls_response", 502);
  }

  return {
    webSubscriptionNewCheckoutsEnabled: record.webSubscriptionNewCheckoutsEnabled,
    webAiCreditNewCheckoutsEnabled: record.webAiCreditNewCheckoutsEnabled,
  };
}

export function parseAdminCommerceControlsResponse(value: unknown): AdminCommerceControls {
  const record = asRecord(value);
  if (record === null || typeof record.configured !== "boolean") {
    throw new ApiError("invalid_admin_commerce_controls_response", 502);
  }

  return {
    ...parseAdminCommerceControlValuesResponse(record),
    configured: record.configured,
  };
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

export async function fetchAdminCommerceControls(): Promise<AdminCommerceControls> {
  const response = await apiGet<unknown>("/api/admin/commerce-controls");
  return parseAdminCommerceControlsResponse(response);
}

export async function saveAdminCommerceControls(
  controls: AdminCommerceControlValues,
): Promise<AdminCommerceControlValues> {
  const response = await apiPut<unknown>("/api/admin/commerce-controls", controls);
  return parseAdminCommerceControlValuesResponse(response);
}

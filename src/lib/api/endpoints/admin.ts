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


/**
 * 부모 홈 히어로 캐러셀 표시 개수(운영자 전역).
 * 광고 성격 슬라이드를 구독 가족에게 숨기는 판정은 `transform/parentHomeHeroCarousel` 이 하고,
 * 여기서는 개수·자동 전환 간격만 다룬다.
 */
export interface AdminHeroCarouselValues {
  freeVisibleCount: number;
  premiumVisibleCount: number;
  /** 0 이면 자동 전환하지 않는다. */
  autoPlayMs: number;
}

export interface AdminHeroCarousel extends AdminHeroCarouselValues {
  configured: boolean;
  maxSlides: number;
}

function isCountValue(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseAdminHeroCarouselValuesResponse(value: unknown): AdminHeroCarouselValues {
  const record = asRecord(value);
  if (
    record === null
    || !isCountValue(record.freeVisibleCount)
    || !isCountValue(record.premiumVisibleCount)
    || !isCountValue(record.autoPlayMs)
  ) {
    // 확인되지 않은 값을 현재 설정처럼 보여주지 않는다.
    throw new ApiError("invalid_admin_hero_carousel_response", 502);
  }
  return {
    freeVisibleCount: record.freeVisibleCount,
    premiumVisibleCount: record.premiumVisibleCount,
    autoPlayMs: record.autoPlayMs,
  };
}

export function parseAdminHeroCarouselResponse(value: unknown): AdminHeroCarousel {
  const record = asRecord(value);
  if (
    record === null
    || typeof record.configured !== "boolean"
    || !isCountValue(record.maxSlides)
  ) {
    throw new ApiError("invalid_admin_hero_carousel_response", 502);
  }
  return {
    ...parseAdminHeroCarouselValuesResponse(record),
    configured: record.configured,
    maxSlides: record.maxSlides,
  };
}

export async function fetchAdminHeroCarousel(): Promise<AdminHeroCarousel> {
  return parseAdminHeroCarouselResponse(await apiGet<unknown>("/api/admin/hero-carousel"));
}

export async function saveAdminHeroCarousel(
  controls: AdminHeroCarouselValues,
): Promise<AdminHeroCarousel> {
  return parseAdminHeroCarouselResponse(await apiPut<unknown>("/api/admin/hero-carousel", controls));
}

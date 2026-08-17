import { apiGet, apiPost } from "../client";
import { normalizeReferralCode } from "@/transform/referralLink";

export interface ReferralStatus {
  code: string | null;
  rewardChildUserId: string | null;
  /** 서버가 정하는 보상 크레딧. 화면은 이 값을 그대로 보여 준다(클라가 숫자를 정하지 않는다). */
  rewardCredits: number;
  qualificationHours: number;
  locationRetentionHours: number;
  /** 지급까지 끝난 초대 가족 수. 상한은 없다(2026-08-17). */
  successfulCount: number;
  pendingCount: number;
}

const SAFE_USER_ID = /^[A-Za-z0-9_-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function count(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}

/** 보상 크레딧·조건 시간은 서버 정책이라 값을 고정하지 않고 상식 범위만 확인한다. */
function policyValue(value: unknown, max: number): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= max ? parsed : null;
}

function validateReferralStatus(value: unknown): ReferralStatus {
  if (!isRecord(value)) throw new Error("친구 초대 상태 응답이 올바르지 않아요");
  const successfulCount = count(value.successfulCount);
  const pendingCount = count(value.pendingCount);
  const rewardCredits = policyValue(value.rewardCredits, 10_000);
  const qualificationHours = policyValue(value.qualificationHours, 8_760);
  const locationRetentionHours = policyValue(value.locationRetentionHours, 8_760);
  if (
    (value.code !== null && !normalizeReferralCode(value.code))
    || (value.rewardChildUserId !== null
      && (typeof value.rewardChildUserId !== "string" || !SAFE_USER_ID.test(value.rewardChildUserId)))
    || rewardCredits === null
    || qualificationHours === null
    || locationRetentionHours === null
    || successfulCount === null
    || pendingCount === null
  ) {
    throw new Error("친구 초대 상태 응답이 올바르지 않아요");
  }
  return {
    code: value.code ? normalizeReferralCode(value.code) : null,
    rewardChildUserId: value.rewardChildUserId,
    rewardCredits,
    qualificationHours,
    locationRetentionHours,
    successfulCount,
    pendingCount,
  };
}

export async function fetchReferralStatus(): Promise<ReferralStatus> {
  const value = await apiGet<ReferralStatus>("/api/referrals/me");
  return validateReferralStatus(value);
}

export async function ensureReferralCode(rewardChildUserId: string): Promise<ReferralStatus> {
  const childUserId = rewardChildUserId.trim();
  if (!SAFE_USER_ID.test(childUserId)) throw new Error("크레딧을 받을 아이를 선택해 주세요");
  const value = await apiPost<ReferralStatus>("/api/referrals/code", {
    rewardChildUserId: childUserId,
  });
  return validateReferralStatus(value);
}

import { apiGet, apiPost } from "../client";
import { normalizeReferralCode } from "@/transform/referralLink";

export interface ReferralStatus {
  code: string | null;
  rewardChildUserId: string | null;
  rewardCredits: 10;
  successCap: 3;
  qualificationHours: 72;
  locationRetentionHours: 48;
  successfulCount: number;
  pendingCount: number;
  remainingCount: number;
  canInvite: boolean;
}

const SAFE_USER_ID = /^[A-Za-z0-9_-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function count(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}

function validateReferralStatus(value: unknown): ReferralStatus {
  if (!isRecord(value)) throw new Error("친구 초대 상태 응답이 올바르지 않아요");
  const successfulCount = count(value.successfulCount, 3);
  const pendingCount = count(value.pendingCount);
  const remainingCount = count(value.remainingCount, 3);
  if (
    (value.code !== null && !normalizeReferralCode(value.code))
    || (value.rewardChildUserId !== null
      && (typeof value.rewardChildUserId !== "string" || !SAFE_USER_ID.test(value.rewardChildUserId)))
    || value.rewardCredits !== 10
    || value.successCap !== 3
    || value.qualificationHours !== 72
    || value.locationRetentionHours !== 48
    || successfulCount === null
    || pendingCount === null
    || remainingCount === null
    || typeof value.canInvite !== "boolean"
  ) {
    throw new Error("친구 초대 상태 응답이 올바르지 않아요");
  }
  const status: ReferralStatus = {
    code: value.code ? normalizeReferralCode(value.code) : null,
    rewardChildUserId: value.rewardChildUserId,
    rewardCredits: value.rewardCredits,
    successCap: value.successCap,
    qualificationHours: value.qualificationHours,
    locationRetentionHours: value.locationRetentionHours,
    successfulCount,
    pendingCount,
    remainingCount,
    canInvite: value.canInvite,
  };
  if (status.remainingCount !== status.successCap - status.successfulCount
    || status.canInvite !== (status.successfulCount < status.successCap)) {
    throw new Error("친구 초대 상태 응답이 올바르지 않아요");
  }
  return status;
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

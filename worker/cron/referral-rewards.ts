// 친구 초대 보상 자격 확인·지급. index.ts의 hourly maintenance slot에 mount해야 실행된다.
import type { Env } from "../types";
import { processPendingReferralRewards } from "../lib/referralRewardsV2";

// 후보 1건 성공 경로: 자격 5 + lease 8 + entitlement 8 + 지급 batch 7 + 통지 audience 2 = 최대 30.
export const REFERRAL_REWARD_CRON_MAX_D1_QUERIES = 30;

export async function run(env: Env) {
  return processPendingReferralRewards(env, { limit: 1 });
}

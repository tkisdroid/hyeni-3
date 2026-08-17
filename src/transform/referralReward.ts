/**
 * 친구 초대 보상 표시값(순수).
 *
 * 서버 정본은 `worker/lib/referralRewardsV2.ts` 의 REFERRAL_REWARD_CREDITS 다.
 * 상태 조회가 아직 없는 자리(설정 행·홈 카드)에서 보여줄 기본값만 여기 둔다 —
 * 실제 상태를 받은 화면은 `status.rewardCredits` 를 그대로 쓴다.
 * 두 값이 어긋나지 않게 tests/referralReward.test.ts 가 서버 상수와 대조한다.
 */
export const REFERRAL_REWARD_CREDITS_DISPLAY = 50;

/** 상태가 있으면 서버 값, 없으면 표시 기본값. */
export function referralRewardCredits(rewardCredits?: number | null): number {
  return typeof rewardCredits === "number" && Number.isSafeInteger(rewardCredits) && rewardCredits > 0
    ? rewardCredits
    : REFERRAL_REWARD_CREDITS_DISPLAY;
}

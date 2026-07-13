export const GOOGLE_PLAY_LISTING_URL =
  "https://play.google.com/store/apps/details?id=com.hyeni.calendar";

export interface ReviewRewardClaimFlowResult {
  rewardApplied: true;
  storeOpened: boolean;
  storeError?: unknown;
}

export interface ReviewRewardClaimInFlightRef {
  current: Promise<ReviewRewardClaimFlowResult> | null;
}

/** Google Play의 실제 앱 상세 페이지를 시스템 브라우저로 연다. */
export function openGooglePlayReviewListing(
  openUrl: (url: string) => Promise<void>,
): Promise<void> {
  return openUrl(GOOGLE_PLAY_LISTING_URL);
}

/**
 * 지급 성공 뒤에만 cache/UI 성공 처리를 수행하고 Play listing을 연다.
 * 같은 ref로 연속 호출되면 진행 중 Promise를 공유해 서버 지급과 스토어 이동을 한 번만 실행한다.
 */
export function runReviewRewardClaimFlow(
  inFlightRef: ReviewRewardClaimInFlightRef,
  claimReward: () => Promise<unknown>,
  onRewardApplied: () => void,
  openStore: () => Promise<void>,
): Promise<ReviewRewardClaimFlowResult> {
  if (inFlightRef.current) return inFlightRef.current;

  const pending = (async (): Promise<ReviewRewardClaimFlowResult> => {
    await claimReward();
    onRewardApplied();
    try {
      await openStore();
      return { rewardApplied: true, storeOpened: true };
    } catch (storeError) {
      return { rewardApplied: true, storeOpened: false, storeError };
    }
  })();

  inFlightRef.current = pending;
  const clear = () => {
    if (inFlightRef.current === pending) inFlightRef.current = null;
  };
  void pending.then(clear, clear);
  return pending;
}

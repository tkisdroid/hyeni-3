/**
 * Kakao SDK의 첫 일시 실패만 내부에서 한 번 복구한다.
 * 두 번째 실패는 그대로 전달해 화면의 명시적 재시도 경로를 유지한다.
 */
export async function retryKakaoMapLoad<T>(
  load: () => Promise<T>,
  waitBeforeRetry: () => Promise<void>,
): Promise<T> {
  try {
    return await load();
  } catch {
    await waitBeforeRetry();
    return load();
  }
}

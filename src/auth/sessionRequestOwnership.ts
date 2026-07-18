export interface SessionRequestOwner {
  sessionInstanceId: string | null;
  userId: string | null;
}

function isSameOwner(a: SessionRequestOwner, b: SessionRequestOwner): boolean {
  return a.sessionInstanceId === b.sessionInstanceId && a.userId === b.userId;
}

/** 요청을 시작한 세션이 그대로일 때만 응답의 세션 보정 부작용을 적용한다. */
export async function requestWithSessionOwnership<T>(
  request: () => Promise<T>,
  readOwner: () => SessionRequestOwner,
  applyOwnedResponse: (result: T) => void,
): Promise<T> {
  const requestOwner = readOwner();
  const result = await request();
  if (isSameOwner(requestOwner, readOwner())) {
    applyOwnedResponse(result);
  }
  return result;
}

export type SessionEndReason = "device_session_inactive";

const SESSION_END_REASON_KEY = "hyeni-session-end-reason-v1";

export function rememberSessionEndReason(reason: SessionEndReason): void {
  try {
    localStorage.setItem(SESSION_END_REASON_KEY, reason);
  } catch {
    /* 저장소를 쓸 수 없어도 세션 종료 자체는 계속한다. */
  }
}

export function consumeSessionEndReason(): SessionEndReason | null {
  try {
    const reason = localStorage.getItem(SESSION_END_REASON_KEY);
    localStorage.removeItem(SESSION_END_REASON_KEY);
    return reason === "device_session_inactive" ? reason : null;
  } catch {
    return null;
  }
}

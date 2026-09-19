/** 서버가 세션 무효를 명시한 경우에만 로그아웃한다. 프록시 오류와 기기 준비 지연은 재시도한다. */
export function classifyRefreshFailure(code: string | null): "inactive" | "rejected" | "error" {
  if (code === "device_session_inactive") return "inactive";
  if (code === "invalid_token") return "rejected";
  return "error";
}

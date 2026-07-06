/**
 * API 에러 타입.
 * Worker 가 보낸 한글 에러 메시지(teacher RPC 등)를 message 로 표면화하고
 * HTTP status 를 함께 실어 화면이 401/404 등을 분기할 수 있게 한다.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/** 인증 만료/미인증. 가드·로그아웃 처리 트리거. */
export function isUnauthorized(err: unknown): boolean {
  return isApiError(err) && err.status === 401;
}

/**
 * 서버 함수/엔드포인트 미배포(404 계열).
 * teacher 등 일부 기능은 Worker 함수가 아직 배포 전일 수 있어, 빈 상태 폴백과
 * 진짜 오류를 구분하는 데 쓴다.
 */
export function isMissingFunction(err: unknown): boolean {
  return isApiError(err) && (err.status === 404 || err.status === 501);
}

/**
 * API 에러 타입.
 * HTTP status와 제한된 안정 code만 보존한다. Worker 자유 message·raw body는
 * Error.message나 stack에 넣지 않아 사용자 표면으로 흐르지 않게 한다.
 */
const API_ERROR_MESSAGE = "API request failed";
const API_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export function normalizeApiErrorCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim();
  return API_ERROR_CODE_PATTERN.test(code) ? code : null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(code: unknown, status: number) {
    super(API_ERROR_MESSAGE);
    this.name = "ApiError";
    this.status = status;
    this.code = normalizeApiErrorCode(code);
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

// NOT NULL인 기존 expires_at 스키마에서 명시적 종료까지 유지하는 부모 세션을 표시한다.
// access JWT의 1시간 만료·기기 바인딩·로그아웃·새 로그인에 의한 철회는 그대로 적용한다.
export const PERSISTENT_PARENT_SESSION_EXPIRY = "9999-12-31T23:59:59.999Z";

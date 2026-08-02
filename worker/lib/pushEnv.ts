// push-notify 가 참조하는 추가 Secret 들. 메인이 types.ts 의 Env 에 이 필드들을
// 추가하기 전까지 tsc 가 통과하도록 Env 를 확장한 로컬 타입을 둔다(메인이 Env 에
// 동일 필드를 추가해도 optional 이라 호환). 라우트는 `c.env as PushEnv` 로 캐스트.
import type { Env } from "../types";

export interface PushEnv extends Env {
  // FCM HTTP v1 — 서비스계정 JSON(우선) 또는 개별 폴백.
  FCM_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string; // 원본 별칭
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string; // PEM(개행은 \n 이스케이프 허용)
  FCM_PRIVATE_KEY_B64?: string; // base64 PEM 폴백(원본 보존)
  // VAPID Web Push (raw base64url 키).
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  // 내부(cron/edge) 호출 공유 시크릿.
  PUSH_INTERNAL_SECRET?: string;
}

import type { CalendarStudyServiceBinding } from "./contracts/studyRpc";

// Worker 환경 바인딩 타입. 마일스톤 진행에 따라 KV/R2 추가.
export interface Env {
  DB: D1Database;
  /** Calendar가 Study 기능을 호출하는 서비스 바인딩. 인증은 별도 HMAC 계약으로 고정한다. */
  STUDY_SERVICE: CalendarStudyServiceBinding;
  /** Calendar → Study RPC 요청 서명 전용 secret. */
  STUDY_RPC_HMAC_SECRET: string;
  // 배포 버전별 출시 직후 request/cron 관측을 위한 Cloudflare 정본 메타데이터.
  CF_VERSION_METADATA: WorkerVersionMetadata;
  // ES256 JWT 키 (wrangler secret) — M1에서 사용
  JWT_PRIVATE_KEY: string; // PKCS8 PEM
  JWT_PUBLIC_KEY: string; // SPKI PEM
  // 익명 가입 IP/설치-id 버킷 HMAC 전용 키. 미설정 시 JWT_PRIVATE_KEY를
  // 고정 도메인 분리해 사용하므로 기존 운영 배포를 막지 않는다.
  ANONYMOUS_SIGNUP_RATE_LIMIT_SECRET?: string;
  // 프리미엄 전환 분석 가족 가명키 HMAC 전용 secret. JWT 키로 폴백하지 않는다.
  PREMIUM_FUNNEL_HASH_SECRET?: string;
  // 위치 확인자료 감사 API의 keyset cursor HMAC 전용 secret. 32바이트 미만이면 fail-closed한다.
  LOCATION_AUDIT_CURSOR_SECRET?: string;
  // M3 Realtime — 가족별 WebSocket 룸 (idFromName(familyId))
  FAMILY_ROOM: DurableObjectNamespace;
  // 선생님별 WebSocket 룸 (idFromName(teacherId)) — teacher_notification_batches realtime
  TEACHER_ROOM: DurableObjectNamespace;
  // P1-storage — child-photos(Supabase Storage private bucket) 대체 R2 버킷.
  // routes/storage.ts 가 토큰+가족 격리 게이트로 업로드/조회를 중계한다.
  PHOTOS: R2Bucket;
  // M4 Edge Functions → Worker Secrets (wrangler secret / .dev.vars)
  KAKAO_REST_KEY?: string; // kakao-proxy 도보 길찾기
  RESEND_API_KEY?: string; // feedback-email 발송
  FEEDBACK_FROM_EMAIL?: string;
  FEEDBACK_TO_EMAIL?: string;
  // M4 AI 함수군 (ai-child-chat / ai-proactive / ai-day-summary / ai-voice-parse / ai-child-monitor)
  // 운영자(관리자) 계정 화이트리스트 — 콤마/공백 구분 user_id 목록.
  // 전역 AI 프롬프트 등 모든 가족에 적용되는 설정을 바꿀 수 있는 유일한 통로다.
  // 미설정이면 아무도 관리자가 아니다(fail-closed, lib/adminAccess.ts).
  ADMIN_USER_IDS?: string;
  /** AI 친구 대화 한도·차감을 적용하지 않을 가족의 소유 부모 계정 목록(fail-closed). */
  AI_UNLIMITED_OWNER_IDS?: string;
  /** OpenRouteService 도보 경로 키. 없으면 ORS 호출을 건너뛴다(설정 누락이 오류가 되지 않게). */
  ORS_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string; // Cloudflare AI Gateway openai 엔드포인트(OpenAI 지역차단 우회). 미설정 시 api.openai.com 직접.
  ANTHROPIC_API_KEY?: string;
  KAKAO_REST_API_KEY?: string; // _shared/kakaoReverseGeocode 호환 별칭
  // M5 push-notify (FCM HTTP v1 + VAPID Web Push)
  FCM_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
  FCM_PRIVATE_KEY_B64?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  PUSH_INTERNAL_SECRET?: string;
  // M5 결제(Qonversion/Google Play)/SMS(NCP)/OAuth(Naver)
  QONVERSION_API_KEY?: string;
  QONVERSION_API_BASE_URL?: string;
  QONVERSION_API_KEY_HEADER?: string;
  QONVERSION_API_KEY_PREFIX?: string;
  QONVERSION_RECONCILE_LOOKBACK_HOURS?: string;
  QONVERSION_RECONCILE_DRY_RUN?: string;
  QONVERSION_WEBHOOK_SECRET?: string;
  QONVERSION_WEBHOOK_SIGNING_SECRET?: string;
  QONVERSION_WEBHOOK_SIGNATURE_HEADER?: string;
  QONVERSION_ALLOW_UNSIGNED_WEBHOOKS?: string;
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_PLAY_PACKAGE_NAME?: string;
  GOOGLE_PLAY_RTDN_AUDIENCE?: string;
  GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL?: string;
  // iPhone 홈 화면 PWA Toss Payments 자동결제. 세 값 중 하나라도 없거나
  // 형식이 맞지 않으면 catalog/checkout/cron을 fail-closed 한다.
  TOSS_PAYMENTS_CLIENT_KEY?: string;
  TOSS_PAYMENTS_SECRET_KEY?: string;
  // 32바이트 원문을 base64로 인코딩한 AES-256-GCM 키.
  WEB_BILLING_KEY_ENCRYPTION_SECRET?: string;
  // 보고서에 팩 가격 정본이 없으므로 설정된 양의 정수 KRW 팩만 웹 카탈로그에 노출한다.
  TOSS_AI_CREDIT_30_AMOUNT_KRW?: string;
  TOSS_AI_CREDIT_80_AMOUNT_KRW?: string;
  TOSS_AI_CREDIT_200_AMOUNT_KRW?: string;
  NCP_SENS_ACCESS_KEY?: string;
  NCP_SENS_SECRET_KEY?: string;
  NCP_SENS_SERVICE_ID?: string;
  NCP_SENS_FROM_NUMBER?: string;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  // P0-b OAuth(kakao/google) — routes/oauth.ts.
  // Kakao: client_id = REST API key(KAKAO_REST_API_KEY/KAKAO_REST_KEY 재사용, 위 선언).
  //   client_secret 은 콘솔에서 "보안" 활성 시에만 필요(선택).
  // Google: client_id/secret 필수(둘 다 미설정이면 503 graceful).
  KAKAO_CLIENT_SECRET?: string;
  //   콘솔 동의항목과 다를 때 요청 scope 를 코드 배포 없이 조정(예: 이메일 미승인 시
  //   "profile_nickname profile_image"). 미설정이면 기본값. routes/oauth.ts resolveScope.
  KAKAO_OAUTH_SCOPE?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
}

// auth 미들웨어가 컨텍스트에 주입하는 인증 사용자
export interface AuthUser {
  sub: string; // 기존 auth.users uuid 보존
  role: "parent" | "child" | "teacher" | "anonymous";
  family_id: string | null;
  is_anonymous: boolean;
  /** 계정당 활성 설치 대조용 서명 claim. 레거시 access token만 생략될 수 있다. */
  device_id?: string | null;
}

// hono Variables 확장
export type Vars = {
  user: AuthUser;
  familyIds: string[];
  accessTokenExp: number;
  /** recovery ACK가 현재 로그인 세대와 정확히 같은지 확인한다. 레거시 토큰은 null. */
  accessTokenJti: string | null;
};

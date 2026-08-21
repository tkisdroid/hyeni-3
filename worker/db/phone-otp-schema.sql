-- 전화 OTP 저장 — GoTrue signInWithOtp/verifyOtp(SMS) 대체.
-- P3 OAuth→phone 브리지: OAuth 신규 user 가 기존 전화 계정과 연결할 때 본인 확인용.
--
-- 보안 모델:
--   - code 평문 저장 금지 — HMAC-SHA256(key=서버 pepper, msg=`${phone}:${code}`) hex 만 저장.
--   - 만료(expires_at, 5분) + 시도 제한(attempts, 최대 5) + 재발송 cooldown(60초, created_at 비교).
--   - phone 당 단일 활성 OTP — 발송 시 기존 행 DELETE 후 INSERT.
-- timestamp 는 D1 이관 데이터와 동일한 pg COPY 형식('YYYY-MM-DD HH:MM:SS.ffffff+00', lib/time.ts pgTs).
--
-- ⚠ prod 적재 별도 필요: 이 파일은 .wrangler/state(로컬)에만 적재된다. 원격 D1 에는
--   `wrangler d1 execute hyeni-calendar --remote --file=worker/db/phone-otp-schema.sql` 로 별도 생성.
CREATE TABLE IF NOT EXISTS phone_otp (
  phone TEXT NOT NULL,              -- E.164 KR ('+8210########')
  code_hash TEXT NOT NULL,          -- HMAC-SHA256 hex (평문 금지)
  expires_at TEXT NOT NULL,         -- 발송 + 5분
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_otp_phone_unique ON phone_otp(phone);

-- 신규가입 진입점의 동시 요청을 DB에서 선형화한다.
-- 적용 전 반드시 README의 익명 중복 그룹 진단 3개가 모두 0인지 확인한다.
-- 기존 행을 삭제·병합·수정하지 않는 additive UNIQUE 인덱스다.

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique_nonempty
  ON users(phone)
  WHERE phone IS NOT NULL AND TRIM(phone) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_phone_unique_nonempty
  ON user_profiles(phone)
  WHERE phone IS NOT NULL AND TRIM(phone) <> '';

-- Worker가 login_id를 trim+lower로 정규화해 저장하지만, 기존 이관 행의 대소문자까지
-- 같은 ID로 취급하도록 expression UNIQUE를 사용한다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_login_id_unique_normalized
  ON user_profiles(LOWER(TRIM(login_id)))
  WHERE login_id IS NOT NULL AND TRIM(login_id) <> '';

-- sendPhoneOtp의 ON CONFLICT(phone) 원자 cooldown/교체 계약에 필요한 정확한 UNIQUE다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_otp_phone_unique
  ON phone_otp(phone);

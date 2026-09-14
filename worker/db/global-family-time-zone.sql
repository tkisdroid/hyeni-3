-- 사전 PRAGMA로 컬럼 부재를 확인한 뒤 정확히 한 번 적용한다. 기존 가족의 날짜는 재작성하지 않는다.
ALTER TABLE families ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'Asia/Seoul';
ALTER TABLE notification_settings ADD COLUMN time_zone TEXT;
-- NULL은 가족 시간대 상속, 명시 값은 수신자별 시간대다. 기존 계정은 한국 시간대를 보존한다.
UPDATE notification_settings SET time_zone='Asia/Seoul';

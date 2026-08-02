-- 선생님 알림장 파일 첨부 metadata(JSON 배열).
-- 운영 적용 전 PRAGMA table_info(teacher_notices)로 컬럼 부재를 확인한 뒤 1회 실행.
ALTER TABLE teacher_notices ADD COLUMN attachments TEXT;


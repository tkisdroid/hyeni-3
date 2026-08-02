-- 위험구역별 진입/이탈 알림 저장 옵션.
-- 기본값은 기존 동작 보존: 진입 알림 켜짐, 이탈 알림 꺼짐.
-- 운영 적용 전 PRAGMA table_info(danger_zones)로 컬럼 부재를 확인한 뒤 1회 실행.
ALTER TABLE danger_zones ADD COLUMN alert_on_entry INTEGER DEFAULT 1;
ALTER TABLE danger_zones ADD COLUMN alert_on_exit INTEGER DEFAULT 0;

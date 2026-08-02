-- 실제 위치 fix 정확도를 이력에 보존해 서버 geofence가 부정확·추정 좌표를
-- 도착/출발 근거로 쓰지 않게 한다. 원격 적용 전 pragma_table_info로 미적용 확인.
ALTER TABLE location_history ADD COLUMN accuracy_m REAL;

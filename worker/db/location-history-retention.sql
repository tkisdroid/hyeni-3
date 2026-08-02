-- 위치 원본 이력 보존 cron의 범위 탐색용 additive 인덱스.
-- recorded_at은 PostgreSQL 이관값과 Worker 신규값의 소수초·offset 길이가 달라
-- 조회 API와 같은 앞 19자 UTC 정규형을 인덱싱한다.
CREATE INDEX IF NOT EXISTS idx_location_history_recorded_family
  ON location_history (substr(recorded_at, 1, 19), family_id);

CREATE INDEX IF NOT EXISTS idx_location_history_family_recorded_norm
  ON location_history (family_id, substr(recorded_at, 1, 19));

-- 위치 이력 오프라인 flush 누적 상한. Android 이동 주기 15초의 이론상 5,760행/일보다
-- 여유 있는 7,200행을 KST 기록일별로 허용한다. 실제 INSERT가 성공한 행만 BEFORE
-- trigger가 원자적으로 claim하므로 동시 중복 flush는 quota를 소모하지 않는다.
CREATE TABLE IF NOT EXISTS location_history_ingest_daily_usage (
  user_id TEXT NOT NULL,
  date_key TEXT NOT NULL
    CHECK (length(date_key)=10 AND date_key GLOB '????-??-??'),
  row_count INTEGER NOT NULL DEFAULT 0
    CHECK (row_count BETWEEN 0 AND 7200),
  last_claim_id TEXT NOT NULL
    CHECK (length(last_claim_id)=36),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id,date_key)
);

CREATE INDEX IF NOT EXISTS idx_location_history_ingest_usage_date
  ON location_history_ingest_daily_usage(date_key,user_id);

-- 기존 위치 이력을 먼저 반영한다. 재실행되어도 이미 기록한 사용량은 줄이지 않는다.
INSERT INTO location_history_ingest_daily_usage
  (user_id,date_key,row_count,last_claim_id,updated_at)
SELECT
  user_id,
  strftime('%Y-%m-%d', substr(recorded_at,1,19), '+9 hours'),
  MIN(COUNT(*),7200),
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
  CURRENT_TIMESTAMP
FROM location_history
WHERE strftime('%Y-%m-%d', substr(recorded_at,1,19), '+9 hours') IS NOT NULL
GROUP BY user_id,strftime('%Y-%m-%d', substr(recorded_at,1,19), '+9 hours')
ON CONFLICT(user_id,date_key) DO UPDATE SET
  row_count=MAX(location_history_ingest_daily_usage.row_count,excluded.row_count),
  updated_at=excluded.updated_at;

CREATE TRIGGER IF NOT EXISTS trg_location_history_ingest_daily_quota
BEFORE INSERT ON location_history
BEGIN
  INSERT INTO location_history_ingest_daily_usage
    (user_id,date_key,row_count,last_claim_id,updated_at)
  VALUES (
    NEW.user_id,
    strftime('%Y-%m-%d', substr(NEW.recorded_at,1,19), '+9 hours'),
    1,
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
      lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' ||
      lower(hex(randomblob(6))),
    CURRENT_TIMESTAMP
  )
  ON CONFLICT(user_id,date_key) DO UPDATE SET
    row_count=location_history_ingest_daily_usage.row_count+1,
    last_claim_id=excluded.last_claim_id,
    updated_at=excluded.updated_at
  WHERE location_history_ingest_daily_usage.row_count<7200;

  SELECT CASE WHEN changes()<>1
    THEN RAISE(ABORT,'location_history_daily_quota_exceeded') END;
END;

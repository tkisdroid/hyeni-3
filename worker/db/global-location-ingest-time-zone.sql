-- 사전 컬럼 부재 확인 후 한 번 적용한다. 과거 위치·사용량은 재작성하지 않는다.
ALTER TABLE location_history ADD COLUMN ingest_date_key TEXT
  CHECK (ingest_date_key IS NULL OR (length(ingest_date_key)=10 AND ingest_date_key GLOB '????-??-??'));
-- 구 Worker가 migration 직후 쓰는 행은 기존 KST quota를 유지한다.
DROP TRIGGER trg_location_history_ingest_daily_quota;
CREATE TRIGGER trg_location_history_ingest_daily_quota
BEFORE INSERT ON location_history
BEGIN
  INSERT INTO location_history_ingest_daily_usage
    (user_id,date_key,row_count,last_claim_id,updated_at)
  VALUES (
    NEW.user_id,
    COALESCE(NEW.ingest_date_key, strftime('%Y-%m-%d', substr(NEW.recorded_at,1,19), '+9 hours')),
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

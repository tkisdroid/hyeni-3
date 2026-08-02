-- 이동경로 location_history 멱등 dup 조회 + 범위 prefetch 가속.
-- record_location_history_rows RPC(worker/routes/rest-shim-rpc.ts)가
-- (user_id, recorded_at 범위)로 기존 행을 일괄 조회해 멱등 판정하므로,
-- 이 복합 인덱스가 없으면 행마다 풀스캔 → 대량 버퍼 flush 가 타임아웃된다.
--
-- 적용(사용자): wrangler d1 execute hyeni-calendar --remote --file worker/db/location-history-index.sql
CREATE INDEX IF NOT EXISTS idx_location_history_user_recorded
  ON location_history (user_id, recorded_at);

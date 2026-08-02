-- MIGRATION FIRST (Worker 배포 전에 production D1에 먼저 적용):
-- cd worker
-- npx wrangler d1 execute hyeni-calendar --remote --file=db/google-play-rtdn-schema.sql -y
-- 적용 성공을 확인한 뒤에만 npx wrangler deploy를 실행한다.
-- Google Play RTDN 멱등 처리 상태. 원문 Pub/Sub payload와 구매 토큰은 저장하지 않는다.
CREATE TABLE IF NOT EXISTS google_play_rtdn_events (
  message_id TEXT PRIMARY KEY,
  package_name TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('test','subscription')),
  notification_type INTEGER,
  purchase_token_hash TEXT,
  family_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing','retryable','processed','ignored')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  claim_token TEXT NOT NULL,
  lease_until TEXT,
  event_time_ms INTEGER NOT NULL,
  last_error TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_google_play_rtdn_events_status_lease
  ON google_play_rtdn_events(status, lease_until);
CREATE INDEX IF NOT EXISTS idx_google_play_rtdn_events_purchase_hash
  ON google_play_rtdn_events(purchase_token_hash);

-- 일회성 상품 환불/취소 전용 멱등 처리 상태. 주문번호와 원문 token은 저장하지 않는다.
CREATE TABLE IF NOT EXISTS google_play_voided_purchase_events (
  message_id TEXT PRIMARY KEY,
  package_name TEXT NOT NULL,
  purchase_token_hash TEXT NOT NULL,
  product_type INTEGER NOT NULL,
  refund_type INTEGER NOT NULL,
  family_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing','retryable','processed','ignored')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts>=1),
  claim_token TEXT NOT NULL,
  lease_until TEXT,
  event_time_ms INTEGER NOT NULL,
  last_error TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_google_play_voided_status_lease
  ON google_play_voided_purchase_events(status,lease_until);
CREATE INDEX IF NOT EXISTS idx_google_play_voided_purchase_hash
  ON google_play_voided_purchase_events(purchase_token_hash);

-- Play가 검증한 obfuscated 식별자 쌍만 가족/부모 소유권에 연결한다.
CREATE TABLE IF NOT EXISTS google_play_billing_owners (
  obfuscated_account_id TEXT NOT NULL,
  obfuscated_profile_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  last_purchase_token_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (obfuscated_account_id, obfuscated_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_google_play_billing_owners_family_parent
  ON google_play_billing_owners(family_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_google_play_billing_owners_token_hash
  ON google_play_billing_owners(last_purchase_token_hash);

CREATE TABLE IF NOT EXISTS map_autocomplete_sessions (
  handle_digest TEXT PRIMARY KEY,
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  CHECK (expires_at_ms > created_at_ms)
);

CREATE TABLE IF NOT EXISTS map_request_quota (
  family_scope_digest TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'autocomplete', 'details', 'reverse_object', 'reverse_raw', 'directions'
  )),
  bucket_start_ms INTEGER NOT NULL,
  family_count INTEGER NOT NULL CHECK (family_count >= 0),
  user_counts_json TEXT NOT NULL CHECK (json_valid(user_counts_json)),
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (family_scope_digest, action, bucket_start_ms)
);

CREATE INDEX IF NOT EXISTS map_autocomplete_sessions_expiry_idx
  ON map_autocomplete_sessions(expires_at_ms);
CREATE INDEX IF NOT EXISTS map_request_quota_expiry_idx
  ON map_request_quota(expires_at_ms);

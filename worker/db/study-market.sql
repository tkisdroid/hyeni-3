-- Study 시장 설정은 기존 행을 삭제하거나 재작성하지 않는 expand-only migration이다.
ALTER TABLE users ADD COLUMN registration_country TEXT
  CHECK (registration_country IS NULL OR length(registration_country) = 2);
ALTER TABLE families ADD COLUMN service_country TEXT
  CHECK (service_country IS NULL OR length(service_country) = 2);
ALTER TABLE families ADD COLUMN service_country_source TEXT
  CHECK (service_country_source IS NULL OR service_country_source IN ('edge_suggested','guardian_confirmed','guardian_changed'));
ALTER TABLE families ADD COLUMN service_country_confirmed_at TEXT;
ALTER TABLE families ADD COLUMN study_market TEXT
  CHECK (study_market IS NULL OR study_market = 'KR');
ALTER TABLE families ADD COLUMN service_country_row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE family_members ADD COLUMN learning_grade_override INTEGER
  CHECK (learning_grade_override IS NULL OR learning_grade_override BETWEEN 3 AND 6);
ALTER TABLE family_members ADD COLUMN learning_grade_row_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS study_setting_audit (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  member_id TEXT,
  actor_user_id TEXT NOT NULL,
  setting TEXT NOT NULL CHECK (setting IN ('service_country','learning_grade_override')),
  previous_value TEXT,
  next_value TEXT,
  request_id TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL
);

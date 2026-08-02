ALTER TABLE notification_settings ADD COLUMN quiet_hours_enabled INTEGER NOT NULL DEFAULT 0 CHECK (quiet_hours_enabled IN (0, 1));
ALTER TABLE notification_settings ADD COLUMN quiet_hours_start_minute INTEGER NOT NULL DEFAULT 1320 CHECK (quiet_hours_start_minute BETWEEN 0 AND 1439);
ALTER TABLE notification_settings ADD COLUMN quiet_hours_end_minute INTEGER NOT NULL DEFAULT 420 CHECK (quiet_hours_end_minute BETWEEN 0 AND 1439);
ALTER TABLE notification_settings ADD COLUMN quiet_hours_updated_by TEXT NULL;
ALTER TABLE notification_settings ADD COLUMN quiet_hours_updated_at TEXT NULL;

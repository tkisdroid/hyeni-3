CREATE TABLE IF NOT EXISTS location_confirmation_records (
  id TEXT NOT NULL PRIMARY KEY,
  family_id TEXT NOT NULL,
  subject_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('collect','use','provide')),
  requester_kind TEXT NOT NULL CHECK (requester_kind IN ('subject','parent','system')),
  requester_user_id TEXT,
  recipient_kind TEXT NOT NULL CHECK (recipient_kind IN ('none','subject','family_parent')),
  recipient_user_id TEXT,
  collection_method TEXT NOT NULL CHECK (collection_method IN ('android_fused_location','not_applicable')),
  acquisition_path TEXT NOT NULL CHECK (acquisition_path IN (
    'android_native_app','location_upload_payload','current_location_store',
    'location_history_store','location_alert_store'
  )),
  service_code TEXT NOT NULL CHECK (service_code IN (
    'current_location_ingest','location_history_ingest','child_self_location',
    'parent_live_map','parent_location_history','location_incident_history',
    'registered_place_monitor','danger_zone_monitor','location_staleness_monitor',
    'unregistered_stay_monitor','playdate_auto_end','arbitrary_arrival_monitor',
    'schedule_arrival_monitor','playdate_matching','schedule_not_arrived_monitor',
    'location_alert_delivery'
  )),
  delivery_method TEXT NOT NULL CHECK (delivery_method IN (
    'https_worker_api','worker_internal','push_notification'
  )),
  purpose_code TEXT NOT NULL CHECK (purpose_code IN (
    'family_location_safety','family_location_display','route_history_display',
    'incident_history_display','arrival_departure_alert','danger_zone_alert',
    'location_staleness_alert','unregistered_stay_alert','playdate_safety',
    'schedule_arrival_alert','schedule_suggestion'
  )),
  occurred_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (requester_kind='system' AND requester_user_id IS NULL)
    OR (requester_kind IN ('subject','parent') AND requester_user_id IS NOT NULL AND length(requester_user_id)>0)
  ),
  CHECK (
    (recipient_kind='none' AND recipient_user_id IS NULL)
    OR (recipient_kind IN ('subject','family_parent') AND recipient_user_id IS NOT NULL AND length(recipient_user_id)>0)
  ),
  CHECK (
    (action='collect' AND collection_method='android_fused_location'
      AND acquisition_path='android_native_app' AND recipient_kind='none')
    OR (action='use' AND collection_method='not_applicable' AND recipient_kind='none')
    OR (action='provide' AND collection_method='not_applicable' AND recipient_kind<>'none')
  )
);

CREATE INDEX IF NOT EXISTS idx_location_confirmation_recorded
  ON location_confirmation_records (substr(recorded_at,1,19));

CREATE INDEX IF NOT EXISTS idx_location_confirmation_family_subject_occurred
  ON location_confirmation_records (family_id, subject_user_id, substr(occurred_at,1,19));

CREATE TRIGGER IF NOT EXISTS trg_child_locations_confirmation_insert
AFTER INSERT ON child_locations
BEGIN
  INSERT INTO location_confirmation_records (
    id,family_id,subject_user_id,action,requester_kind,requester_user_id,
    recipient_kind,recipient_user_id,collection_method,acquisition_path,
    service_code,delivery_method,purpose_code,occurred_at,completed_at,recorded_at
  ) SELECT
    lower(hex(randomblob(16))),NEW.family_id,NEW.user_id,'collect','subject',NEW.user_id,
    'none',NULL,'android_fused_location','android_native_app',
    'current_location_ingest','https_worker_api','family_location_safety',
    NEW.updated_at,NEW.updated_at,CURRENT_TIMESTAMP
  WHERE NOT EXISTS (
    SELECT 1 FROM location_confirmation_records existing
     WHERE existing.family_id=NEW.family_id
       AND existing.subject_user_id=NEW.user_id
       AND existing.action='collect'
       AND existing.acquisition_path='android_native_app'
       AND existing.service_code='location_history_ingest'
       AND substr(existing.occurred_at,1,19)=substr(NEW.updated_at,1,19)
       AND existing.occurred_at=NEW.updated_at
     LIMIT 1
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_child_locations_confirmation_update
AFTER UPDATE OF lat, lng, updated_at ON child_locations
WHEN NEW.updated_at IS NOT OLD.updated_at OR NEW.lat IS NOT OLD.lat OR NEW.lng IS NOT OLD.lng
BEGIN
  INSERT INTO location_confirmation_records (
    id,family_id,subject_user_id,action,requester_kind,requester_user_id,
    recipient_kind,recipient_user_id,collection_method,acquisition_path,
    service_code,delivery_method,purpose_code,occurred_at,completed_at,recorded_at
  ) SELECT
    lower(hex(randomblob(16))),NEW.family_id,NEW.user_id,'collect','subject',NEW.user_id,
    'none',NULL,'android_fused_location','android_native_app',
    'current_location_ingest','https_worker_api','family_location_safety',
    NEW.updated_at,NEW.updated_at,CURRENT_TIMESTAMP
  WHERE NOT EXISTS (
    SELECT 1 FROM location_confirmation_records existing
     WHERE existing.family_id=NEW.family_id
       AND existing.subject_user_id=NEW.user_id
       AND existing.action='collect'
       AND existing.acquisition_path='android_native_app'
       AND existing.service_code='location_history_ingest'
       AND substr(existing.occurred_at,1,19)=substr(NEW.updated_at,1,19)
       AND existing.occurred_at=NEW.updated_at
     LIMIT 1
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_location_history_confirmation_insert
AFTER INSERT ON location_history
WHEN NEW.is_estimated=0
BEGIN
  INSERT INTO location_confirmation_records (
    id,family_id,subject_user_id,action,requester_kind,requester_user_id,
    recipient_kind,recipient_user_id,collection_method,acquisition_path,
    service_code,delivery_method,purpose_code,occurred_at,completed_at,recorded_at
  ) SELECT
    lower(hex(randomblob(16))),NEW.family_id,NEW.user_id,'collect','subject',NEW.user_id,
    'none',NULL,'android_fused_location','android_native_app',
    'location_history_ingest','https_worker_api','family_location_safety',
    NEW.recorded_at,NEW.recorded_at,CURRENT_TIMESTAMP
  WHERE NOT EXISTS (
    SELECT 1 FROM location_confirmation_records existing
     WHERE existing.family_id=NEW.family_id
       AND existing.subject_user_id=NEW.user_id
       AND existing.action='collect'
       AND existing.acquisition_path='android_native_app'
       AND existing.service_code='current_location_ingest'
       AND substr(existing.occurred_at,1,19)=substr(NEW.recorded_at,1,19)
       AND existing.occurred_at=NEW.recorded_at
     LIMIT 1
  );
END;

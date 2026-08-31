-- 혜니캘린더 D1(SQLite) 부트스트랩 정본
-- PostgreSQL 덤프 변환본에 Worker 운영 스키마·인덱스를 합친 새 환경용 기준이다.
-- 함수/RLS/트리거는 Worker 코드에서 처리하고, 기존 운영 DB에는 개별 additive migration을 적용한다.
PRAGMA foreign_keys = OFF;

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "encrypted_password" TEXT,
  "is_anonymous" INTEGER DEFAULT 0 NOT NULL,
  "raw_user_meta_data" TEXT,
  "registration_country" TEXT CHECK ("registration_country" IS NULL OR length("registration_country") = 2),
  "created_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_users_phone" ON "users" ("phone");
CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_phone_unique_nonempty"
  ON "users" ("phone")
  WHERE "phone" IS NOT NULL AND TRIM("phone") <> '';

CREATE TABLE "auth_identities" (
  "id" TEXT,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_id" TEXT NOT NULL,
  "identity_data" TEXT,
  "created_at" TEXT,
  PRIMARY KEY ("provider", "provider_id")
);

CREATE INDEX IF NOT EXISTS "idx_auth_identities_user" ON "auth_identities" ("user_id");

CREATE TABLE "oauth_state_transactions" (
  "state_hash" TEXT NOT NULL,
  "transaction_secret_hash" TEXT NOT NULL,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('kakao', 'google', 'naver')),
  -- native는 Android/iOS 앱 capability 공통값이며 정확한 복귀 방식은 redirect_target에 저장한다.
  "client_kind" TEXT NOT NULL CHECK ("client_kind" IN ('native', 'web')),
  "redirect_target" TEXT NOT NULL,
  "flow_mode" TEXT NOT NULL CHECK ("flow_mode" IN ('login', 'link')),
  "user_id" TEXT,
  "authorization_code_hash" TEXT,
  "callback_received_at" TEXT,
  "consumed_at" TEXT,
  "recovery_id_hash" TEXT,
  "recovery_binding_hash" TEXT,
  "recovery_user_id" TEXT,
  "recovery_account_status" TEXT CHECK (
    "recovery_account_status" IS NULL
    OR "recovery_account_status" IN ('created', 'existing', 'linked')
  ),
  "recovery_access_jti" TEXT,
  "recovery_refresh_token_hash" TEXT,
  "recovery_ready_at" TEXT,
  "recovery_expires_at" TEXT,
  "recovery_acknowledged_at" TEXT,
  "created_at" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  CHECK (
    ("flow_mode" = 'link' AND "user_id" IS NOT NULL)
    OR ("flow_mode" = 'login' AND "user_id" IS NULL)
  ),
  PRIMARY KEY ("state_hash")
);

CREATE INDEX IF NOT EXISTS "idx_oauth_state_expiry"
  ON "oauth_state_transactions" ("expires_at", "consumed_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_oauth_recovery_id"
  ON "oauth_state_transactions" ("recovery_id_hash")
  WHERE "recovery_id_hash" IS NOT NULL;

CREATE TABLE "refresh_tokens" (
  "token" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "family_id" TEXT,
  "device_id" TEXT,
  "issued_at" TEXT,
  "expires_at" TEXT,
  "revoked" INTEGER DEFAULT 0 NOT NULL,
  "rotated_to" TEXT,
  "rotated_at" TEXT,
  PRIMARY KEY ("token")
);

CREATE INDEX IF NOT EXISTS "idx_refresh_user" ON "refresh_tokens" ("user_id");

CREATE TABLE "account_device_sessions" (
  "user_id" TEXT NOT NULL,
  "device_id" TEXT NOT NULL,
  "device_label" TEXT,
  "device_platform" TEXT CHECK ("device_platform" IS NULL OR "device_platform" IN ('android','ios','web')),
  "claimed_at" TEXT NOT NULL,
  "last_seen_at" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "revoked_at" TEXT,
  PRIMARY KEY ("user_id")
);

CREATE INDEX IF NOT EXISTS "idx_account_device_sessions_expiry"
  ON "account_device_sessions" ("expires_at", "revoked_at");

CREATE TABLE "ai_credit_balances" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "parent_id" TEXT,
  "is_premium" INTEGER DEFAULT 0 NOT NULL,
  "daily_included_limit" INTEGER DEFAULT 5 NOT NULL,
  "daily_included_used" INTEGER DEFAULT 0 NOT NULL,
  "daily_reset_date" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "purchased_credits" INTEGER DEFAULT 0 NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_credit_balances_family_child_unique"
  ON "ai_credit_balances" ("family_id", "child_user_id");

CREATE TABLE "events" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "date_key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "time" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "bg" TEXT NOT NULL,
  "memo" TEXT DEFAULT '',
  "location" TEXT,
  "notif_override" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "end_time" TEXT,
  "is_family_event" INTEGER DEFAULT 0 NOT NULL,
  "series_id" TEXT,
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_events_series_id" ON "events" ("series_id");
CREATE INDEX IF NOT EXISTS "idx_events_date_key" ON "events" ("date_key");
CREATE INDEX IF NOT EXISTS "idx_events_family_datekey" ON "events" ("family_id", "date_key");

CREATE TABLE "daily_supplies" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "child_id" TEXT NOT NULL,
  "date_key" TEXT NOT NULL,
  "supplies" TEXT DEFAULT '' NOT NULL,
  "homework" TEXT DEFAULT '' NOT NULL,
  "note" TEXT DEFAULT '' NOT NULL,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_daily_supplies_family_date"
  ON "daily_supplies" ("family_id", "date_key");
CREATE INDEX IF NOT EXISTS "idx_daily_supplies_family_child_date"
  ON "daily_supplies" ("family_id", "child_id", "date_key");

CREATE TABLE "academies" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "location" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "schedule" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE "ai_chat_messages" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "animal_character" TEXT,
  "flagged" INTEGER DEFAULT 0 NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "ai_chat_settings" (
  "family_id" TEXT NOT NULL,
  "enabled" INTEGER DEFAULT 0 NOT NULL,
  "daily_limit" INTEGER DEFAULT 20 NOT NULL,
  "credit_balance" INTEGER DEFAULT 0 NOT NULL,
  "updated_by" TEXT,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id")
);

CREATE TABLE "ai_chat_usage" (
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "usage_date" TEXT NOT NULL,
  "count" INTEGER DEFAULT 0 NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id", "child_user_id", "usage_date")
);

CREATE TABLE "ai_credit_ledger" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "parent_id" TEXT,
  "delta" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT DEFAULT 'chat' NOT NULL,
  "message_id" TEXT,
  "transaction_id" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "ai_day_summaries" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "date_key" TEXT NOT NULL,
  "summary" TEXT DEFAULT '' NOT NULL,
  "signals" TEXT DEFAULT '{}' NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "ai_long_term_memories" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "confidence" REAL DEFAULT 0.70 NOT NULL,
  "source" TEXT DEFAULT 'conversation' NOT NULL,
  "parent_visible" INTEGER DEFAULT 1 NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "ai_memory_summaries" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "summary" TEXT DEFAULT '' NOT NULL,
  "important_facts" TEXT DEFAULT '[]' NOT NULL,
  "emotional_signals" TEXT DEFAULT '[]' NOT NULL,
  "interests" TEXT DEFAULT '[]' NOT NULL,
  "unresolved_issues" TEXT DEFAULT '[]' NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "ai_parent_settings" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "ai_enabled" INTEGER DEFAULT 0 NOT NULL,
  "ai_friend_name" TEXT DEFAULT '혜니' NOT NULL,
  "parent_instructions" TEXT DEFAULT '' NOT NULL,
  "forbidden_topics" TEXT DEFAULT '[]' NOT NULL,
  "forbidden_phrases" TEXT DEFAULT '[]' NOT NULL,
  "allowed_topics" TEXT DEFAULT '[]' NOT NULL,
  "child_traits" TEXT DEFAULT '' NOT NULL,
  "sensitive_triggers" TEXT DEFAULT '' NOT NULL,
  "education_style" TEXT DEFAULT '' NOT NULL,
  "proactive_enabled" INTEGER DEFAULT 0 NOT NULL,
  "proactive_start_time" TEXT DEFAULT '08:00:00' NOT NULL,
  "proactive_end_time" TEXT DEFAULT '20:00:00' NOT NULL,
  "quiet_hours_start" TEXT DEFAULT '21:00:00' NOT NULL,
  "quiet_hours_end" TEXT DEFAULT '07:00:00' NOT NULL,
  "daily_limit" INTEGER DEFAULT 20 NOT NULL,
  "memory_enabled" INTEGER DEFAULT 1 NOT NULL,
  "long_term_memory_enabled" INTEGER DEFAULT 1 NOT NULL,
  "allow_schedule_actions" INTEGER DEFAULT 1 NOT NULL,
  "allow_contact_actions" INTEGER DEFAULT 1 NOT NULL,
  -- 플로팅 AI 친구가 스스로 커졌다 화면을 채우며 아이를 부를지(부모 스위치, 기본 켜짐).
  "buddy_attention_enabled" INTEGER DEFAULT 1 NOT NULL,
  "safety_notification_level" TEXT DEFAULT 'medium' NOT NULL,
  "updated_by" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_ai_parent_settings_family_child"
  ON "ai_parent_settings" ("family_id", "child_user_id");

-- 서비스 전역 운영 설정. 가족·아이 단위 설정과 분리하며 additive로 유지한다.
CREATE TABLE IF NOT EXISTS "app_global_settings" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL DEFAULT '',
  "updated_by" TEXT,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 아이 하루 대시보드(프리미엄 보호자에게 하루 한 번). 운영 migration = worker/db/child-daily-digest.sql
CREATE TABLE IF NOT EXISTS "child_daily_digests" (
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "date_key" TEXT NOT NULL,
  "payload" TEXT NOT NULL DEFAULT '{}',
  "alert_id" TEXT,
  "notified_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("family_id", "child_user_id", "date_key")
);

CREATE INDEX IF NOT EXISTS "idx_child_daily_digests_created"
  ON "child_daily_digests" ("created_at");

CREATE TABLE "ai_safety_events" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "summary" TEXT DEFAULT '' NOT NULL,
  "parent_notified" INTEGER DEFAULT 0 NOT NULL,
  "metadata" TEXT DEFAULT '{}' NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "child_location_link_state" (
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "state" TEXT DEFAULT 'connected' NOT NULL,
  "last_location_at" TEXT,
  "last_alerted_at" TEXT,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "last_unpair_alerted_at" TEXT,
  "stale_reason" TEXT,
  "last_power_save_alerted_at" TEXT,
  "unpair_alert_count" INTEGER DEFAULT 0 NOT NULL,
  "last_shutdown_at" TEXT,
  PRIMARY KEY ("family_id", "child_user_id")
);

CREATE TABLE "child_locations" (
  "user_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "lat" REAL NOT NULL,
  "lng" REAL NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "accuracy_m" REAL,
  PRIMARY KEY ("user_id")
);

CREATE INDEX IF NOT EXISTS "idx_child_locations_family" ON "child_locations" ("family_id");

CREATE TABLE "child_place_presence" (
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "place_key" TEXT NOT NULL,
  "phase" TEXT DEFAULT 'out' NOT NULL,
  "first_inside_at_ms" INTEGER,
  "departure_armed_at_ms" INTEGER,
  "last_departed_at_ms" INTEGER,
  "last_alerted_at" TEXT,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id", "child_user_id", "place_key")
);

CREATE TABLE "child_stay_presence" (
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "grid_key" TEXT NOT NULL,
  "last_alerted_at_ms" INTEGER,
  "last_episode_start_ms" INTEGER,
  "last_area_label" TEXT,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id", "child_user_id", "grid_key")
);

CREATE TABLE "danger_zones" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "lat" REAL NOT NULL,
  "lng" REAL NOT NULL,
  "radius_m" INTEGER DEFAULT 200 NOT NULL,
  "zone_type" TEXT DEFAULT 'custom' NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "alert_on_entry" INTEGER DEFAULT 1,
  "alert_on_exit" INTEGER DEFAULT 0,
  PRIMARY KEY ("id")
);

CREATE TABLE "emergency_audio_chunks" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "child_id" TEXT NOT NULL,
  "parent_id" TEXT NOT NULL,
  "file_url" TEXT NOT NULL,
  "duration_seconds" INTEGER DEFAULT 10 NOT NULL,
  "sequence_number" INTEGER NOT NULL,
  "recorded_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "latitude" REAL,
  "longitude" REAL,
  PRIMARY KEY ("id")
);

CREATE TABLE "events_children" (
  "event_id" TEXT NOT NULL,
  "child_id" TEXT NOT NULL,
  PRIMARY KEY ("event_id", "child_id")
);

CREATE TABLE "families" (
  "id" TEXT NOT NULL,
  "parent_id" TEXT NOT NULL,
  "pair_code" TEXT NOT NULL,
  "parent_name" TEXT DEFAULT '',
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "user_tier" TEXT DEFAULT 'free' NOT NULL,
  "referral_code" TEXT,
  "referred_by_family_id" TEXT,
  "pair_code_expires_at" TEXT,
  "subscription_tier" TEXT DEFAULT 'free' NOT NULL,
  "playdate_enabled" INTEGER DEFAULT 0 NOT NULL,
  "planned_child_count" INTEGER DEFAULT 1 NOT NULL,
  "name" TEXT,
  "theme" TEXT DEFAULT 'warm-pink' NOT NULL,
  "registered_place_alerts_enabled" INTEGER DEFAULT 1 NOT NULL,
  "unregistered_stay_alert_enabled" INTEGER DEFAULT 1 NOT NULL,
  "service_country" TEXT CHECK ("service_country" IS NULL OR length("service_country") = 2),
  "service_country_source" TEXT CHECK ("service_country_source" IS NULL OR "service_country_source" IN ('edge_suggested','guardian_confirmed','guardian_changed')),
  "service_country_confirmed_at" TEXT,
  "study_market" TEXT CHECK ("study_market" IS NULL OR "study_market" = 'KR'),
  "service_country_row_version" INTEGER NOT NULL DEFAULT 1,
  "country_code" TEXT NOT NULL DEFAULT 'KR',
  PRIMARY KEY ("id")
);

CREATE TABLE "map_autocomplete_sessions" (
  "handle_digest" TEXT PRIMARY KEY,
  "expires_at_ms" INTEGER NOT NULL,
  "consumed_at_ms" INTEGER,
  "created_at_ms" INTEGER NOT NULL,
  CHECK ("expires_at_ms" > "created_at_ms")
);

CREATE TABLE "map_request_quota" (
  "family_scope_digest" TEXT NOT NULL,
  "action" TEXT NOT NULL CHECK ("action" IN ('autocomplete','details','reverse_object','reverse_raw','directions')),
  "bucket_start_ms" INTEGER NOT NULL,
  "family_count" INTEGER NOT NULL CHECK ("family_count" >= 0),
  "user_counts_json" TEXT NOT NULL CHECK (json_valid("user_counts_json")),
  "expires_at_ms" INTEGER NOT NULL,
  PRIMARY KEY ("family_scope_digest", "action", "bucket_start_ms")
);

CREATE INDEX "map_autocomplete_sessions_expiry_idx"
  ON "map_autocomplete_sessions"("expires_at_ms");
CREATE INDEX "map_request_quota_expiry_idx"
  ON "map_request_quota"("expires_at_ms");

CREATE TABLE "family_members" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "user_id" TEXT,
  "role" TEXT NOT NULL,
  "name" TEXT DEFAULT '' NOT NULL,
  "emoji" TEXT DEFAULT '🐰',
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "birthdate" TEXT,
  "color_hex" TEXT,
  "photo_url" TEXT,
  "child_order" INTEGER,
  "device_label" TEXT,
  "device_health" TEXT,
  "phone" TEXT DEFAULT '' NOT NULL,
  "gender" TEXT,
  "is_active" INTEGER DEFAULT 1 NOT NULL,
  "last_selected_at" TEXT,
  "learning_grade_override" INTEGER CHECK ("learning_grade_override" IS NULL OR "learning_grade_override" BETWEEN 3 AND 6),
  "learning_grade_row_version" INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_family_members_user_current"
  ON "family_members" ("user_id", "is_active", "last_selected_at");

CREATE INDEX IF NOT EXISTS "idx_family_members_family_role_active"
  ON "family_members" ("family_id", "role", "is_active");

CREATE TABLE IF NOT EXISTS "study_setting_audit" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "member_id" TEXT,
  "actor_user_id" TEXT NOT NULL,
  "setting" TEXT NOT NULL CHECK ("setting" IN ('service_country','learning_grade_override')),
  "previous_value" TEXT,
  "next_value" TEXT,
  "request_id" TEXT NOT NULL UNIQUE,
  "request_row_version" INTEGER NOT NULL,
  "occurred_at" TEXT NOT NULL
);

CREATE TABLE "family_subscription" (
  "family_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "qonversion_user_id" TEXT NOT NULL,
  "trial_ends_at" TEXT,
  "current_period_end" TEXT,
  "cancelled_at" TEXT,
  "last_event_id" TEXT,
  "last_event_at" TEXT,
  "raw_event" TEXT DEFAULT '{}' NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "remote_listen_enabled" INTEGER DEFAULT 1,
  "provider" TEXT DEFAULT 'google_play' NOT NULL,
  "base_plan_id" TEXT,
  "purchase_token_hash" TEXT,
  "latest_order_id" TEXT,
  "acknowledged_at" TEXT,
  "google_play_raw" TEXT DEFAULT '{}' NOT NULL,
  PRIMARY KEY ("family_id")
);

CREATE TABLE "family_review_rewards" (
  "family_id" TEXT NOT NULL,
  "parent_id" TEXT NOT NULL,
  "reward_type" TEXT DEFAULT 'store_visit' NOT NULL,
  "granted_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("family_id")
);

CREATE INDEX IF NOT EXISTS "idx_family_review_rewards_parent_id"
  ON "family_review_rewards" ("parent_id");

CREATE TABLE "fcm_tokens" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "fcm_token" TEXT NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "platform" TEXT DEFAULT 'android' NOT NULL,
  "registration_instance_id" TEXT,
  "disabled_at" TEXT,
  "disabled_reason" TEXT,
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_fcm_tokens_user" ON "fcm_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_fcm_tokens_family" ON "fcm_tokens" ("family_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_fcm_tokens_token_active_unique"
  ON "fcm_tokens" ("fcm_token") WHERE "disabled_at" IS NULL;

CREATE TABLE "force_ring_events" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "initiator_user_id" TEXT,
  "target_user_id" TEXT,
  "message" TEXT,
  "triggered_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "delivered_at" TEXT,
  "acknowledged_at" TEXT,
  "stopped_at" TEXT,
  "stop_reason" TEXT,
  "reminder_sent_at" TEXT,
  "delivery_status" TEXT DEFAULT '{}',
  "client_request_hash" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE "friend_playdate_sessions" (
  "id" TEXT NOT NULL,
  "public_place_id" TEXT NOT NULL,
  "family_a_id" TEXT NOT NULL,
  "family_b_id" TEXT NOT NULL,
  "child_a_id" TEXT,
  "child_b_id" TEXT,
  "initiator_user_id" TEXT,
  "started_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "stopped_at" TEXT,
  "stop_reason" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "friend_playdate_invites" (
  "id" TEXT NOT NULL,
  "public_place_id" TEXT NOT NULL,
  "requester_family_id" TEXT NOT NULL,
  "receiver_family_id" TEXT NOT NULL,
  "requester_child_id" TEXT NOT NULL,
  "receiver_child_id" TEXT NOT NULL,
  "requester_user_id" TEXT NOT NULL,
  "status" TEXT DEFAULT 'pending' NOT NULL,
  "session_id" TEXT,
  "requested_at" TEXT NOT NULL,
  "responded_at" TEXT,
  "responded_by" TEXT,
  "expires_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS idx_friend_playdate_invites_requester_status
  ON friend_playdate_invites(requester_family_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_friend_playdate_invites_receiver_status
  ON friend_playdate_invites(receiver_family_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_friend_playdate_invites_requester_child_status
  ON friend_playdate_invites(requester_child_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_friend_playdate_invites_receiver_child_status
  ON friend_playdate_invites(receiver_child_id, status, expires_at);

CREATE TABLE "google_play_purchase_events" (
  "purchase_token_hash" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT,
  "parent_id" TEXT,
  "product_type" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "base_plan_id" TEXT,
  "credit_amount" INTEGER,
  "debt_applied" INTEGER DEFAULT 0 NOT NULL CHECK (
    "debt_applied">=0 AND ("credit_amount" IS NULL OR "debt_applied"<="credit_amount")
  ),
  "order_id" TEXT,
  "status" TEXT DEFAULT 'received' NOT NULL,
  "verification_result" TEXT DEFAULT '{}' NOT NULL,
  "granted_at" TEXT,
  "acknowledged_at" TEXT,
  "consumed_at" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("purchase_token_hash")
);

CREATE TABLE "google_play_rtdn_events" (
  "message_id" TEXT NOT NULL,
  "package_name" TEXT NOT NULL,
  "event_kind" TEXT NOT NULL CHECK ("event_kind" IN ('test', 'subscription')),
  "notification_type" INTEGER,
  "purchase_token_hash" TEXT,
  "family_id" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('processing', 'retryable', 'processed', 'ignored')),
  "attempts" INTEGER DEFAULT 1 NOT NULL CHECK ("attempts" >= 1),
  "claim_token" TEXT NOT NULL,
  "lease_until" TEXT,
  "event_time_ms" INTEGER NOT NULL,
  "last_error" TEXT,
  "received_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "processed_at" TEXT,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("message_id")
);

CREATE INDEX IF NOT EXISTS "idx_google_play_rtdn_events_status_lease"
  ON "google_play_rtdn_events" ("status", "lease_until");
CREATE INDEX IF NOT EXISTS "idx_google_play_rtdn_events_purchase_hash"
  ON "google_play_rtdn_events" ("purchase_token_hash");

CREATE TABLE "google_play_voided_purchase_events" (
  "message_id" TEXT NOT NULL,
  "package_name" TEXT NOT NULL,
  "purchase_token_hash" TEXT NOT NULL,
  "product_type" INTEGER NOT NULL,
  "refund_type" INTEGER NOT NULL,
  "family_id" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('processing','retryable','processed','ignored')),
  "attempts" INTEGER DEFAULT 1 NOT NULL CHECK ("attempts">=1),
  "claim_token" TEXT NOT NULL,
  "lease_until" TEXT,
  "event_time_ms" INTEGER NOT NULL,
  "last_error" TEXT,
  "received_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "processed_at" TEXT,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("message_id")
);

CREATE INDEX IF NOT EXISTS "idx_google_play_voided_status_lease"
  ON "google_play_voided_purchase_events" ("status","lease_until");
CREATE INDEX IF NOT EXISTS "idx_google_play_voided_purchase_hash"
  ON "google_play_voided_purchase_events" ("purchase_token_hash");

CREATE TABLE "google_play_billing_owners" (
  "obfuscated_account_id" TEXT NOT NULL,
  "obfuscated_profile_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "parent_id" TEXT NOT NULL,
  "last_purchase_token_hash" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("obfuscated_account_id", "obfuscated_profile_id")
);

CREATE INDEX IF NOT EXISTS "idx_google_play_billing_owners_family_parent"
  ON "google_play_billing_owners" ("family_id", "parent_id");
CREATE INDEX IF NOT EXISTS "idx_google_play_billing_owners_token_hash"
  ON "google_play_billing_owners" ("last_purchase_token_hash");

CREATE TABLE "location_history" (
  "id" INTEGER NOT NULL,
  "user_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "lat" REAL NOT NULL,
  "lng" REAL NOT NULL,
  "recorded_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "is_estimated" INTEGER DEFAULT 0 NOT NULL,
  "accuracy_m" REAL,
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_location_history_user_recorded"
  ON "location_history" ("user_id", "recorded_at");

CREATE INDEX IF NOT EXISTS "idx_location_history_recorded_family"
  ON "location_history" (substr("recorded_at", 1, 19), "family_id");

CREATE INDEX IF NOT EXISTS "idx_location_history_family_recorded_norm"
  ON "location_history" ("family_id", substr("recorded_at", 1, 19));

-- 위치 이력 오프라인 flush 누적 상한(KST 기록일별 7,200행).
CREATE TABLE "location_history_ingest_daily_usage" (
  "user_id" TEXT NOT NULL,
  "date_key" TEXT NOT NULL
    CHECK (length("date_key")=10 AND "date_key" GLOB '????-??-??'),
  "row_count" INTEGER DEFAULT 0 NOT NULL
    CHECK ("row_count" BETWEEN 0 AND 7200),
  "last_claim_id" TEXT NOT NULL
    CHECK (length("last_claim_id")=36),
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("user_id","date_key")
);

CREATE INDEX IF NOT EXISTS "idx_location_history_ingest_usage_date"
  ON "location_history_ingest_daily_usage" ("date_key","user_id");

CREATE TRIGGER "trg_location_history_ingest_daily_quota"
BEFORE INSERT ON "location_history"
BEGIN
  INSERT INTO "location_history_ingest_daily_usage"
    ("user_id","date_key","row_count","last_claim_id","updated_at")
  VALUES (
    NEW."user_id",
    strftime('%Y-%m-%d', substr(NEW."recorded_at",1,19), '+9 hours'),
    1,
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' ||
      lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' ||
      lower(hex(randomblob(6))),
    CURRENT_TIMESTAMP
  )
  ON CONFLICT("user_id","date_key") DO UPDATE SET
    "row_count"="location_history_ingest_daily_usage"."row_count"+1,
    "last_claim_id"=excluded."last_claim_id",
    "updated_at"=excluded."updated_at"
  WHERE "location_history_ingest_daily_usage"."row_count"<7200;

  SELECT CASE WHEN changes()<>1
    THEN RAISE(ABORT,'location_history_daily_quota_exceeded') END;
END;

-- 위치정보법 제16조의 수집·이용·제공사실 확인자료.
-- 좌표·주소·자유 JSON은 저장하지 않고 고정된 코드와 최소 내부 식별자만 보관한다.
CREATE TABLE "location_confirmation_records" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "subject_user_id" TEXT NOT NULL,
  "action" TEXT NOT NULL CHECK ("action" IN ('collect','use','provide')),
  "requester_kind" TEXT NOT NULL CHECK ("requester_kind" IN ('subject','parent','system')),
  "requester_user_id" TEXT,
  "recipient_kind" TEXT NOT NULL CHECK ("recipient_kind" IN ('none','subject','family_parent')),
  "recipient_user_id" TEXT,
  "collection_method" TEXT NOT NULL CHECK ("collection_method" IN ('android_fused_location','not_applicable')),
  "acquisition_path" TEXT NOT NULL CHECK ("acquisition_path" IN (
    'android_native_app','location_upload_payload','current_location_store',
    'location_history_store','location_alert_store'
  )),
  "service_code" TEXT NOT NULL CHECK ("service_code" IN (
    'current_location_ingest','location_history_ingest','child_self_location',
    'parent_live_map','parent_location_history','location_incident_history',
    'registered_place_monitor','danger_zone_monitor','location_staleness_monitor',
    'unregistered_stay_monitor','playdate_auto_end','arbitrary_arrival_monitor',
    'schedule_arrival_monitor','playdate_matching','schedule_not_arrived_monitor',
    'location_alert_delivery'
  )),
  "delivery_method" TEXT NOT NULL CHECK ("delivery_method" IN (
    'https_worker_api','worker_internal','push_notification'
  )),
  "purpose_code" TEXT NOT NULL CHECK ("purpose_code" IN (
    'family_location_safety','family_location_display','route_history_display',
    'incident_history_display','arrival_departure_alert','danger_zone_alert',
    'location_staleness_alert','unregistered_stay_alert','playdate_safety',
    'schedule_arrival_alert','schedule_suggestion'
  )),
  "occurred_at" TEXT NOT NULL,
  "completed_at" TEXT NOT NULL,
  "recorded_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  CHECK (
    ("requester_kind"='system' AND "requester_user_id" IS NULL)
    OR ("requester_kind" IN ('subject','parent') AND "requester_user_id" IS NOT NULL AND length("requester_user_id")>0)
  ),
  CHECK (
    ("recipient_kind"='none' AND "recipient_user_id" IS NULL)
    OR ("recipient_kind" IN ('subject','family_parent') AND "recipient_user_id" IS NOT NULL AND length("recipient_user_id")>0)
  ),
  CHECK (
    ("action"='collect' AND "collection_method"='android_fused_location'
      AND "acquisition_path"='android_native_app' AND "recipient_kind"='none')
    OR ("action"='use' AND "collection_method"='not_applicable' AND "recipient_kind"='none')
    OR ("action"='provide' AND "collection_method"='not_applicable' AND "recipient_kind"<>'none')
  )
);

CREATE INDEX "idx_location_confirmation_recorded"
  ON "location_confirmation_records" (substr("recorded_at",1,19));

CREATE INDEX "idx_location_confirmation_family_subject_occurred"
  ON "location_confirmation_records" ("family_id", "subject_user_id", substr("occurred_at",1,19));

CREATE TRIGGER "trg_child_locations_confirmation_insert"
AFTER INSERT ON "child_locations"
BEGIN
  INSERT INTO "location_confirmation_records" (
    "id","family_id","subject_user_id","action","requester_kind","requester_user_id",
    "recipient_kind","recipient_user_id","collection_method","acquisition_path",
    "service_code","delivery_method","purpose_code","occurred_at","completed_at","recorded_at"
  ) SELECT
    lower(hex(randomblob(16))),NEW."family_id",NEW."user_id",'collect','subject',NEW."user_id",
    'none',NULL,'android_fused_location','android_native_app',
    'current_location_ingest','https_worker_api','family_location_safety',
    NEW."updated_at",NEW."updated_at",CURRENT_TIMESTAMP
  WHERE NOT EXISTS (
    SELECT 1 FROM "location_confirmation_records" existing
     WHERE existing."family_id"=NEW."family_id"
       AND existing."subject_user_id"=NEW."user_id"
       AND existing."action"='collect'
       AND existing."acquisition_path"='android_native_app'
       AND existing."service_code"='location_history_ingest'
       AND substr(existing."occurred_at",1,19)=substr(NEW."updated_at",1,19)
       AND existing."occurred_at"=NEW."updated_at"
     LIMIT 1
  );
END;

CREATE TRIGGER "trg_child_locations_confirmation_update"
AFTER UPDATE OF "lat", "lng", "updated_at" ON "child_locations"
WHEN NEW."updated_at" IS NOT OLD."updated_at" OR NEW."lat" IS NOT OLD."lat" OR NEW."lng" IS NOT OLD."lng"
BEGIN
  INSERT INTO "location_confirmation_records" (
    "id","family_id","subject_user_id","action","requester_kind","requester_user_id",
    "recipient_kind","recipient_user_id","collection_method","acquisition_path",
    "service_code","delivery_method","purpose_code","occurred_at","completed_at","recorded_at"
  ) SELECT
    lower(hex(randomblob(16))),NEW."family_id",NEW."user_id",'collect','subject',NEW."user_id",
    'none',NULL,'android_fused_location','android_native_app',
    'current_location_ingest','https_worker_api','family_location_safety',
    NEW."updated_at",NEW."updated_at",CURRENT_TIMESTAMP
  WHERE NOT EXISTS (
    SELECT 1 FROM "location_confirmation_records" existing
     WHERE existing."family_id"=NEW."family_id"
       AND existing."subject_user_id"=NEW."user_id"
       AND existing."action"='collect'
       AND existing."acquisition_path"='android_native_app'
       AND existing."service_code"='location_history_ingest'
       AND substr(existing."occurred_at",1,19)=substr(NEW."updated_at",1,19)
       AND existing."occurred_at"=NEW."updated_at"
     LIMIT 1
  );
END;

CREATE TRIGGER "trg_location_history_confirmation_insert"
AFTER INSERT ON "location_history"
WHEN NEW."is_estimated"=0
BEGIN
  INSERT INTO "location_confirmation_records" (
    "id","family_id","subject_user_id","action","requester_kind","requester_user_id",
    "recipient_kind","recipient_user_id","collection_method","acquisition_path",
    "service_code","delivery_method","purpose_code","occurred_at","completed_at","recorded_at"
  ) SELECT
    lower(hex(randomblob(16))),NEW."family_id",NEW."user_id",'collect','subject',NEW."user_id",
    'none',NULL,'android_fused_location','android_native_app',
    'location_history_ingest','https_worker_api','family_location_safety',
    NEW."recorded_at",NEW."recorded_at",CURRENT_TIMESTAMP
  WHERE NOT EXISTS (
    SELECT 1 FROM "location_confirmation_records" existing
     WHERE existing."family_id"=NEW."family_id"
       AND existing."subject_user_id"=NEW."user_id"
       AND existing."action"='collect'
       AND existing."acquisition_path"='android_native_app'
       AND existing."service_code"='current_location_ingest'
       AND substr(existing."occurred_at",1,19)=substr(NEW."recorded_at",1,19)
       AND existing."occurred_at"=NEW."recorded_at"
     LIMIT 1
  );
END;

CREATE TABLE "memo_replies" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "date_key" TEXT NOT NULL,
  "user_id" TEXT,
  "user_role" TEXT DEFAULT 'child' NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "origin" TEXT DEFAULT 'reply',
  "read_by" TEXT DEFAULT '{}',
  "child_id" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE "memo_notification_outbox" (
  "reply_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "attempt_count" INTEGER DEFAULT 0 NOT NULL CHECK ("attempt_count" >= 0),
  "next_attempt_at" TEXT NOT NULL,
  "lease_token" TEXT,
  "lease_expires_at" TEXT,
  "last_error" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("reply_id")
);

CREATE INDEX IF NOT EXISTS "idx_memo_notification_outbox_due"
  ON "memo_notification_outbox" ("next_attempt_at", "lease_expires_at", "created_at");

CREATE INDEX IF NOT EXISTS "idx_memo_notification_outbox_family"
  ON "memo_notification_outbox" ("family_id");

CREATE TRIGGER "trg_memo_notification_outbox_reply_delete"
AFTER DELETE ON "memo_replies"
BEGIN
  DELETE FROM "memo_notification_outbox" WHERE "reply_id" = OLD."id";
END;

CREATE TABLE "memos" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "date_key" TEXT NOT NULL,
  "content" TEXT DEFAULT '',
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "read_by" TEXT DEFAULT '{}' NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "user_id" TEXT,
  "user_role" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE "notification_settings" (
  "user_id" TEXT NOT NULL,
  "family_id" TEXT,
  "child_enabled" INTEGER DEFAULT 1 NOT NULL,
  "parent_enabled" INTEGER DEFAULT 1 NOT NULL,
  "location_enabled" INTEGER DEFAULT 1 NOT NULL,
  "playdate_enabled" INTEGER DEFAULT 1 NOT NULL,
  "minutes_before" TEXT DEFAULT '{15,5}' NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "registered_place_enabled" INTEGER DEFAULT 1 NOT NULL,
  "quiet_hours_enabled" INTEGER NOT NULL DEFAULT 0 CHECK ("quiet_hours_enabled" IN (0, 1)),
  "quiet_hours_start_minute" INTEGER NOT NULL DEFAULT 1320 CHECK ("quiet_hours_start_minute" BETWEEN 0 AND 1439),
  "quiet_hours_end_minute" INTEGER NOT NULL DEFAULT 420 CHECK ("quiet_hours_end_minute" BETWEEN 0 AND 1439),
  "quiet_hours_updated_by" TEXT NULL,
  "quiet_hours_updated_at" TEXT NULL,
  PRIMARY KEY ("user_id")
);

CREATE TABLE "pair_attempts" (
  "id" INTEGER NOT NULL,
  "user_id" TEXT NOT NULL,
  "attempted_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE "parent_alerts" (
  "id" TEXT NOT NULL,
  "family_id" TEXT,
  "alert_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "severity" TEXT DEFAULT 'info',
  "event_id" TEXT,
  "metadata" TEXT,
  "read" INTEGER DEFAULT 0,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "child_user_id" TEXT,
  "read_by" TEXT DEFAULT '{}' NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "login_attempts" (
  "login_id" TEXT NOT NULL,
  "attempted_at" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_login_attempts_id_at"
  ON "login_attempts" ("login_id", "attempted_at");

CREATE TABLE "phone_otp" (
  "phone" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "attempts" INTEGER DEFAULT 0 NOT NULL,
  "created_at" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_phone_otp_phone" ON "phone_otp" ("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_phone_otp_phone_unique" ON "phone_otp" ("phone");

CREATE INDEX IF NOT EXISTS "idx_parent_alerts_family_created"
  ON "parent_alerts" ("family_id", "created_at");

CREATE TABLE "pending_notifications" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "delivered" INTEGER DEFAULT 0,
  "data" TEXT DEFAULT '{}',
  "delivered_at" TEXT,
  "expires_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "delivery_status" TEXT,
  "idempotency_key" TEXT,
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_pending_family_delivery_expiry_created"
  ON "pending_notifications" ("family_id", "delivered", "expires_at", "created_at");

CREATE INDEX IF NOT EXISTS idx_pending_notifications_expiry
  ON pending_notifications(replace(substr(expires_at, 1, 19), 'T', ' '), id);

CREATE TABLE "point_transactions" (
  "id" TEXT NOT NULL,
  "wallet_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "member_id" TEXT,
  "type" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "balance_after" INTEGER NOT NULL,
  "description" TEXT,
  "metadata" TEXT DEFAULT '{}',
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE "point_wallets" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "balance" INTEGER DEFAULT 0 NOT NULL,
  "total_earned" INTEGER DEFAULT 0 NOT NULL,
  "streak_days" INTEGER DEFAULT 0 NOT NULL,
  "streak_updated_at" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE "public_places" (
  "id" TEXT NOT NULL,
  "kakao_place_id" TEXT,
  "name" TEXT NOT NULL,
  "lat" REAL NOT NULL,
  "lng" REAL NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "push_idempotency" (
  "key" TEXT NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "first_sent_at" TEXT,
  "family_id" TEXT,
  "action" TEXT,
  PRIMARY KEY ("key")
);

CREATE TABLE "push_sent" (
  "id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "notif_key" TEXT NOT NULL,
  "sent_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_push_sent_event_notif"
  ON "push_sent" ("event_id", "notif_key");

CREATE TABLE "push_subscriptions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "subscription" TEXT NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "registration_instance_id" TEXT,
  "disabled_at" TEXT,
  "disabled_reason" TEXT,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_push_subscriptions_endpoint_active_unique"
  ON "push_subscriptions" ("endpoint") WHERE "disabled_at" IS NULL;

CREATE TABLE "referral_codes" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "total_referrals" INTEGER DEFAULT 0 NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE "referral_completions" (
  "id" TEXT NOT NULL,
  "referral_code_id" TEXT NOT NULL,
  "referrer_family_id" TEXT NOT NULL,
  "referee_family_id" TEXT NOT NULL,
  "status" TEXT DEFAULT 'pending' NOT NULL,
  "qualified_at" TEXT,
  "rewarded_at" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE "remote_listen_sessions" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "initiator_user_id" TEXT,
  "child_user_id" TEXT,
  "started_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "ended_at" TEXT,
  "duration_ms" INTEGER,
  "end_reason" TEXT,
  "consented_at" TEXT,
  "capture_expires_at" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_remote_listen_capture_window"
  ON "remote_listen_sessions" ("child_user_id", "id", "capture_expires_at")
  WHERE "ended_at" IS NULL AND "consented_at" IS NOT NULL;

CREATE TABLE "saved_places" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "is_playdate_safe" INTEGER DEFAULT 0 NOT NULL,
  "public_place_id" TEXT,
  "is_home" INTEGER DEFAULT 0 NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "sos_events" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "sender_user_id" TEXT NOT NULL,
  "receiver_user_ids" TEXT DEFAULT '{}',
  "triggered_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "delivery_status" TEXT DEFAULT '{}',
  "client_request_hash" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE "stickers" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "date_key" TEXT NOT NULL,
  "sticker_type" TEXT DEFAULT 'on_time' NOT NULL,
  "emoji" TEXT DEFAULT '⭐' NOT NULL,
  "title" TEXT DEFAULT '' NOT NULL,
  "earned_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);

CREATE TABLE "subscription_webhook_events" (
  "event_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "status" TEXT,
  "payload" TEXT DEFAULT '{}' NOT NULL,
  "received_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("event_id")
);

CREATE TABLE "subscriptions" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "child_id" TEXT NOT NULL,
  "qonversion_user_id" TEXT,
  "qonversion_entitlement_id" TEXT,
  "status" TEXT NOT NULL,
  "expires_at" TEXT,
  "product_id" TEXT NOT NULL,
  "price_krw" INTEGER NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "teacher_attendance_logs" (
  "id" TEXT NOT NULL,
  "teacher_id" TEXT NOT NULL,
  "class_id" TEXT,
  "child_member_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "schedule_id" TEXT,
  "date_key" TEXT NOT NULL,
  "attendance_status" TEXT DEFAULT 'pending' NOT NULL,
  "checked_at" TEXT,
  "notified_parent_at" TEXT,
  "corrected_from" TEXT,
  "note" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "teacher_child_pairings" (
  "id" TEXT NOT NULL,
  "teacher_id" TEXT NOT NULL,
  "class_id" TEXT,
  "child_member_id" TEXT,
  "family_id" TEXT NOT NULL,
  "pairing_status" TEXT DEFAULT 'pending' NOT NULL,
  "permission_scope" TEXT DEFAULT 'schedule_attendance' NOT NULL,
  "requested_by" TEXT,
  "approved_by" TEXT,
  "approved_at" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "teacher_class_children" (
  "id" TEXT NOT NULL,
  "class_id" TEXT NOT NULL,
  "pairing_id" TEXT NOT NULL,
  "child_member_id" TEXT NOT NULL,
  "added_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "teacher_classes" (
  "id" TEXT NOT NULL,
  "teacher_id" TEXT NOT NULL,
  "class_name" TEXT NOT NULL,
  "invite_code" TEXT,
  "invite_expires_at" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "teacher_notice_recipients" (
  "id" TEXT NOT NULL,
  "notice_id" TEXT NOT NULL,
  "child_member_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "event_ids" TEXT DEFAULT '{}' NOT NULL,
  "read_by" TEXT DEFAULT '{}' NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "teacher_notices" (
  "id" TEXT NOT NULL,
  "teacher_id" TEXT NOT NULL,
  "class_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT DEFAULT '' NOT NULL,
  "source_type" TEXT DEFAULT 'text' NOT NULL,
  "has_schedule" INTEGER DEFAULT 0 NOT NULL,
  "parsed_events" TEXT,
  "attachments" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "teacher_notification_batches" (
  "id" TEXT NOT NULL,
  "teacher_id" TEXT NOT NULL,
  "class_id" TEXT,
  "batch_type" TEXT NOT NULL,
  "window_start" TEXT NOT NULL,
  "window_end" TEXT NOT NULL,
  "child_member_ids" TEXT DEFAULT '{}' NOT NULL,
  "summary" TEXT,
  "seen_at" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "teacher_pairing_attempts" (
  "id" TEXT NOT NULL,
  "teacher_id" TEXT NOT NULL,
  "attempted_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "teacher_profiles" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "display_name" TEXT DEFAULT '선생님' NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "teacher_schedule_notes" (
  "id" TEXT NOT NULL,
  "teacher_id" TEXT NOT NULL,
  "child_member_id" TEXT NOT NULL,
  "schedule_id" TEXT,
  "date_key" TEXT,
  "note" TEXT NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "user_feedback" (
  "id" TEXT NOT NULL,
  "family_id" TEXT,
  "user_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "error_logs" TEXT,
  "device_info" TEXT,
  "current_screen" TEXT,
  "status" TEXT DEFAULT 'new' NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_user_feedback_feature_rate"
  ON "user_feedback" ("user_id", "type", "created_at");

CREATE TABLE "user_interaction_blocks" (
  "family_id" TEXT NOT NULL,
  "blocker_user_id" TEXT NOT NULL,
  "blocked_user_id" TEXT NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id", "blocker_user_id", "blocked_user_id"),
  CHECK ("blocker_user_id" <> "blocked_user_id")
);

CREATE INDEX IF NOT EXISTS "idx_user_interaction_blocks_blocked"
  ON "user_interaction_blocks" ("family_id", "blocked_user_id", "blocker_user_id");

CREATE TABLE "memo_interaction_leases" (
  "family_id" TEXT NOT NULL,
  "user_a_id" TEXT NOT NULL,
  "user_b_id" TEXT NOT NULL,
  "lease_token" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("family_id", "user_a_id", "user_b_id"),
  CHECK ("user_a_id" <> "user_b_id"),
  CHECK ("user_a_id" < "user_b_id")
);

CREATE INDEX IF NOT EXISTS "idx_memo_interaction_leases_expiry"
  ON "memo_interaction_leases" ("expires_at");

CREATE TABLE "user_profiles" (
  "user_id" TEXT NOT NULL,
  "login_id" TEXT,
  "display_name" TEXT DEFAULT '' NOT NULL,
  "phone" TEXT,
  "provider" TEXT DEFAULT 'unknown' NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "gender" TEXT,
  "birthdate" TEXT,
  "linked_providers" TEXT DEFAULT '{}' NOT NULL,
  PRIMARY KEY ("user_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_profiles_phone_unique_nonempty"
  ON "user_profiles" ("phone")
  WHERE "phone" IS NOT NULL AND TRIM("phone") <> '';

CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_profiles_login_id_unique_normalized"
  ON "user_profiles" (LOWER(TRIM("login_id")))
  WHERE "login_id" IS NOT NULL AND TRIM("login_id") <> '';

CREATE TABLE "storage_upload_daily_usage" (
  "user_id" TEXT NOT NULL,
  "day_key" TEXT NOT NULL,
  "object_count" INTEGER DEFAULT 0 NOT NULL CHECK ("object_count" >= 0),
  "byte_count" INTEGER DEFAULT 0 NOT NULL CHECK ("byte_count" >= 0),
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("user_id", "day_key")
);

CREATE INDEX IF NOT EXISTS "idx_storage_upload_daily_usage_updated"
  ON "storage_upload_daily_usage" ("updated_at");

CREATE TABLE "storage_upload_family_daily_usage" (
  "family_id" TEXT NOT NULL,
  "day_key" TEXT NOT NULL,
  "object_count" INTEGER DEFAULT 0 NOT NULL CHECK ("object_count" >= 0),
  "byte_count" INTEGER DEFAULT 0 NOT NULL CHECK ("byte_count" >= 0),
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id", "day_key")
);

CREATE INDEX IF NOT EXISTS "idx_storage_upload_family_daily_usage_updated"
  ON "storage_upload_family_daily_usage" ("updated_at");

CREATE TABLE "anonymous_signup_rate_limits" (
  "scope_type" TEXT NOT NULL CHECK ("scope_type" IN ('ip', 'device')),
  "scope_hash" TEXT NOT NULL CHECK (length("scope_hash") = 64),
  "window_key" TEXT NOT NULL,
  "request_count" INTEGER DEFAULT 0 NOT NULL CHECK ("request_count" >= 0),
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("scope_type", "scope_hash", "window_key")
);

CREATE INDEX IF NOT EXISTS "idx_anonymous_signup_rate_limits_updated"
  ON "anonymous_signup_rate_limits" ("updated_at");

CREATE INDEX IF NOT EXISTS "idx_users_anonymous_created"
  ON "users" ("is_anonymous", "created_at");

CREATE TABLE "family_unpair_cleanup_jobs" (
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "member_ids" TEXT DEFAULT '[]' NOT NULL CHECK (json_valid("member_ids")),
  "exact_photo_keys" TEXT DEFAULT '[]' NOT NULL CHECK (json_valid("exact_photo_keys")),
  "preserve_photo_keys" TEXT DEFAULT '[]' NOT NULL CHECK (json_valid("preserve_photo_keys")),
  "attempts" INTEGER DEFAULT 0 NOT NULL CHECK ("attempts" >= 0),
  "last_error" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id", "child_user_id")
);

CREATE INDEX IF NOT EXISTS "idx_family_unpair_cleanup_jobs_updated"
  ON "family_unpair_cleanup_jobs" ("updated_at");

CREATE TABLE "account_deletion_jobs" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT NOT NULL UNIQUE,
  "mode" TEXT NOT NULL CHECK ("mode" IN ('family', 'self')),
  "status" TEXT DEFAULT 'claimed' NOT NULL CHECK ("status" IN ('claimed', 'running', 'completed')),
  "attempts" INTEGER DEFAULT 0 NOT NULL CHECK ("attempts" >= 0),
  "last_error" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "account_deletion_scopes" (
  "job_id" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL CHECK ("scope_type" IN ('user', 'family')),
  "scope_id" TEXT NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("scope_type", "scope_id"),
  UNIQUE ("job_id", "scope_type", "scope_id")
);

CREATE INDEX IF NOT EXISTS "idx_account_deletion_scopes_job"
  ON "account_deletion_scopes" ("job_id", "scope_type", "scope_id");

CREATE TABLE "account_mutation_leases" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "family_id" TEXT,
  "expires_at" TEXT NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_account_mutation_leases_user_expiry"
  ON "account_mutation_leases" ("user_id", "expires_at");

CREATE INDEX "idx_account_mutation_leases_family_expiry"
  ON "account_mutation_leases" ("family_id", "expires_at");

CREATE TABLE "storage_invalid_upload_cleanup_jobs" (
  "object_key" TEXT NOT NULL,
  "upload_nonce" TEXT NOT NULL,
  "upload_protocol" TEXT DEFAULT 'multipart' NOT NULL
    CHECK ("upload_protocol" IN ('multipart', 'reservation')),
  "multipart_upload_id" TEXT,
  "cleanup_started_at" TEXT,
  "multipart_aborted_at" TEXT,
  "reservation_etag" TEXT,
  "reservation_retired_at" TEXT,
  "committed_at" TEXT,
  "cleaned_at" TEXT,
  "request_id" TEXT,
  "authorization_kind" TEXT,
  "authorization_target_id" TEXT,
  "content_sha256" TEXT,
  "user_id" TEXT NOT NULL,
  "user_day_key" TEXT NOT NULL,
  "family_id" TEXT,
  "family_day_key" TEXT,
  "byte_count" INTEGER NOT NULL CHECK ("byte_count" > 0),
  "attempts" INTEGER DEFAULT 0 NOT NULL CHECK ("attempts" >= 0),
  "last_error" TEXT,
  "cleanup_after" TEXT NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("object_key"),
  CHECK (
    ("family_id" IS NULL AND "family_day_key" IS NULL)
    OR ("family_id" IS NOT NULL AND "family_day_key" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "idx_storage_invalid_upload_cleanup_updated"
  ON "storage_invalid_upload_cleanup_jobs" ("cleanup_after", "updated_at");

CREATE UNIQUE INDEX "idx_storage_upload_request_owner"
  ON "storage_invalid_upload_cleanup_jobs" ("user_id", "request_id")
  WHERE "request_id" IS NOT NULL;

CREATE TABLE "premium_funnel_events" (
  "event_id" TEXT NOT NULL,
  "family_key" TEXT NOT NULL
    CHECK (length("family_key") = 64 AND "family_key" NOT GLOB '*[^0-9a-f]*'),
  "event" TEXT NOT NULL CHECK ("event" IN (
    'paywall_impression', 'paywall_continue_free', 'paywall_cta',
    'subscription_view', 'product_query_result', 'checkout_start', 'checkout_result',
    'subscription_cancel_requested', 'entitlement_activated', 'trial_start', 'renewal', 'refund'
  )),
  "source" TEXT CHECK ("source" IN (
    'second_child', 'saved_place', 'danger_zone', 'location_request', 'location_history', 'location_live_interval',
    'remote_ring', 'remote_audio', 'ai_friend_limit', 'ai_schedule_limit', 'ai_daily_summary', 'weekly_report', 'academy_schedule',
    'first_location', 'first_arrival', 'direct'
  )),
  "tier" TEXT CHECK ("tier" IN ('free', 'premium', 'unknown')),
  "provider" TEXT CHECK ("provider" IN ('google_play', 'toss_payments')),
  "plan" TEXT CHECK ("plan" IN ('month', 'year')),
  "result" TEXT CHECK ("result" IN ('success', 'fail', 'cancel')),
  "error_code" TEXT CHECK ("error_code" IN (
    'purchase_canceled', 'purchase_pending', 'product_unavailable',
    'product_offer_unavailable', 'billing_unavailable', 'verification_failed',
    'network_error', 'unknown'
  )),
  "app_version" TEXT CHECK (length("app_version") BETWEEN 1 AND 32),
  "occurred_at" TEXT NOT NULL,
  "received_at" TEXT NOT NULL,
  PRIMARY KEY ("event_id"),
  CHECK (
    ("event" IN ('paywall_impression', 'paywall_continue_free', 'paywall_cta')
      AND "source" IS NOT NULL AND "source" <> 'direct' AND "tier" IS NOT NULL
      AND "provider" IS NULL AND "plan" IS NULL AND "result" IS NULL
      AND "error_code" IS NULL AND "app_version" IS NOT NULL)
    OR
    ("event" = 'subscription_view'
      AND "source" IS NOT NULL AND "tier" IS NULL AND "provider" IS NULL
      AND "plan" IS NULL AND "result" IS NULL AND "error_code" IS NULL
      AND "app_version" IS NOT NULL)
    OR
    ("event" = 'product_query_result'
      AND "source" IS NULL AND "tier" IS NULL AND "provider" IS NOT NULL
      AND "plan" IS NULL AND "result" IN ('success', 'fail')
      AND "error_code" IS NULL AND "app_version" IS NOT NULL)
    OR
    ("event" = 'checkout_start'
      AND "source" IS NULL AND "tier" IS NULL AND "provider" IS NOT NULL
      AND "plan" IS NOT NULL AND "result" IS NULL AND "error_code" IS NULL
      AND "app_version" IS NOT NULL)
    OR
    ("event" = 'checkout_result'
      AND "source" IS NULL AND "tier" IS NULL AND "provider" IS NOT NULL
      AND "plan" IS NULL AND "result" IS NOT NULL AND "app_version" IS NOT NULL
      AND (("result" = 'success' AND "error_code" IS NULL)
        OR ("result" = 'cancel' AND "error_code" = 'purchase_canceled')
        OR ("result" = 'fail' AND "error_code" IS NOT NULL AND "error_code" <> 'purchase_canceled')))
    OR
    ("event" = 'subscription_cancel_requested'
      AND "source" IS NULL AND "tier" IS NULL AND "provider" IS NOT NULL
      AND "plan" IS NULL AND "result" IS NULL AND "error_code" IS NULL
      AND "app_version" IS NOT NULL)
    OR
    ("event" IN ('entitlement_activated', 'trial_start', 'renewal', 'refund')
      AND "source" IS NULL AND "tier" IS NULL AND "provider" IS NOT NULL
      AND "plan" IS NOT NULL AND "result" IS NULL AND "error_code" IS NULL
      AND "app_version" IS NULL)
  )
);

CREATE INDEX "idx_premium_funnel_received"
  ON "premium_funnel_events" ("received_at");

CREATE INDEX "idx_premium_funnel_event_received"
  ON "premium_funnel_events" ("event", "received_at");

CREATE INDEX "idx_premium_funnel_family_received"
  ON "premium_funnel_events" ("family_key", "received_at");

CREATE TABLE "premium_funnel_rate_limits" (
  "family_key" TEXT NOT NULL
    CHECK (length("family_key") = 64 AND "family_key" NOT GLOB '*[^0-9a-f]*'),
  "window_key" TEXT NOT NULL,
  "event_count" INTEGER DEFAULT 0 NOT NULL
    CHECK ("event_count" >= 0 AND "event_count" <= 600),
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("family_key", "window_key")
);

CREATE INDEX "idx_premium_funnel_rate_updated"
  ON "premium_funnel_rate_limits" ("updated_at");

-- 가족 생애주기 퍼널. premium_funnel_events와 같은 HMAC family_key만 저장하며
-- 원시 가족·사용자 식별자, 위치·주소, 콘텐츠, 인증/결제 토큰은 컬럼 자체가 없다.
CREATE TABLE "family_lifecycle_events" (
  "event_id" TEXT NOT NULL
    CHECK (length("event_id") = 36),
  "family_key" TEXT NOT NULL
    CHECK (length("family_key") = 64 AND "family_key" NOT GLOB '*[^0-9a-f]*'),
  "event" TEXT NOT NULL
    CHECK ("event" IN ('family_created', 'child_paired', 'first_location', 'first_arrival')),
  "elapsed_ms" INTEGER CHECK ("elapsed_ms" IS NULL OR "elapsed_ms" >= 0),
  "child_count" INTEGER CHECK ("child_count" IS NULL OR "child_count" BETWEEN 1 AND 20),
  "child_platform" TEXT CHECK ("child_platform" IS NULL OR "child_platform" = 'android'),
  "occurred_at" TEXT NOT NULL,
  "received_at" TEXT NOT NULL,
  PRIMARY KEY ("event_id"),
  CHECK (
    ("event" = 'family_created'
      AND "elapsed_ms" = 0 AND "child_count" IS NULL AND "child_platform" IS NULL)
    OR
    ("event" = 'child_paired'
      AND "elapsed_ms" IS NOT NULL AND "child_count" IS NOT NULL AND "child_platform" = 'android')
    OR
    ("event" IN ('first_location', 'first_arrival')
      AND "elapsed_ms" IS NOT NULL AND "child_count" IS NULL AND "child_platform" IS NULL)
  )
);

CREATE UNIQUE INDEX "idx_family_lifecycle_first_milestone"
  ON "family_lifecycle_events" ("family_key", "event")
  WHERE "event" IN ('family_created', 'first_location', 'first_arrival');

CREATE INDEX "idx_family_lifecycle_event_received"
  ON "family_lifecycle_events" ("event", "received_at");

CREATE INDEX "idx_family_lifecycle_received"
  ON "family_lifecycle_events" ("received_at", "event_id");

CREATE INDEX "idx_family_lifecycle_family_occurred"
  ON "family_lifecycle_events" ("family_key", "occurred_at");

CREATE TABLE "family_lifecycle_daily" (
  "family_key" TEXT NOT NULL
    CHECK (length("family_key") = 64 AND "family_key" NOT GLOB '*[^0-9a-f]*'),
  "activity_date" TEXT NOT NULL
    CHECK (length("activity_date") = 10 AND "activity_date" GLOB '????-??-??'),
  "parent_active" INTEGER DEFAULT 0 NOT NULL CHECK ("parent_active" IN (0, 1)),
  "child_signal" INTEGER DEFAULT 0 NOT NULL CHECK ("child_signal" IN (0, 1)),
  "first_recorded_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("family_key", "activity_date"),
  CHECK ("parent_active" = 1 OR "child_signal" = 1)
);

CREATE INDEX "idx_family_lifecycle_daily_date"
  ON "family_lifecycle_daily" ("activity_date", "parent_active", "child_signal");

CREATE INDEX "idx_family_lifecycle_daily_updated"
  ON "family_lifecycle_daily" ("updated_at", "family_key", "activity_date");

CREATE TABLE "web_billing_checkout_sessions" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "parent_id" TEXT NOT NULL,
  "customer_key" TEXT NOT NULL,
  "plan" TEXT NOT NULL CHECK ("plan" IN ('month', 'year')),
  "amount" INTEGER NOT NULL CHECK (
    ("plan" = 'month' AND "amount" = 4900)
    OR ("plan" = 'year' AND "amount" = 39000)
  ),
  "trial_eligible" INTEGER DEFAULT 0 NOT NULL CHECK ("trial_eligible" IN (0,1)),
  "trial_days" INTEGER DEFAULT 0 NOT NULL CHECK (
    ("trial_eligible"=1 AND "trial_days"=7)
    OR ("trial_eligible"=0 AND "trial_days"=0)
  ),
  "status" TEXT DEFAULT 'pending' NOT NULL
    CHECK ("status" IN ('pending', 'processing', 'completed', 'failed', 'expired')),
  "expires_at" TEXT NOT NULL,
  "claim_token" TEXT,
  "claim_expires_at" TEXT,
  "error_code" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("customer_key"),
  CHECK (
    ("claim_token" IS NULL AND "claim_expires_at" IS NULL)
    OR ("claim_token" IS NOT NULL AND "claim_expires_at" IS NOT NULL)
  )
);

CREATE INDEX "idx_web_billing_checkout_family_parent"
  ON "web_billing_checkout_sessions" ("family_id", "parent_id", "status", "expires_at");

CREATE INDEX "idx_web_billing_checkout_claim"
  ON "web_billing_checkout_sessions" ("status", "claim_expires_at");

CREATE TABLE "web_billing_customers" (
  "family_id" TEXT NOT NULL,
  "parent_id" TEXT NOT NULL,
  "customer_key" TEXT NOT NULL,
  "billing_key_ciphertext" TEXT,
  "billing_key_iv" TEXT,
  "billing_key_version" TEXT,
  "billing_key_revocation_status" TEXT
    CHECK ("billing_key_revocation_status" IN ('pending','revoked')),
  "billing_key_revocation_attempts" INTEGER DEFAULT 0 NOT NULL
    CHECK ("billing_key_revocation_attempts" >= 0),
  "billing_key_revocation_retry_at" TEXT,
  "billing_key_revocation_error" TEXT,
  "billing_key_revoked_at" TEXT,
  "plan" TEXT NOT NULL CHECK ("plan" IN ('month', 'year')),
  "status" TEXT NOT NULL
    CHECK ("status" IN ('pending_charge', 'trial', 'active', 'cancel_at_period_end', 'past_due', 'expired')),
  "trial_ends_at" TEXT,
  "current_period_end" TEXT,
  "next_charge_at" TEXT,
  "retry_after" TEXT,
  "failure_count" INTEGER DEFAULT 0 NOT NULL CHECK ("failure_count" >= 0),
  "cancelled_at" TEXT,
  "last_order_id" TEXT,
  "last_paid_order_id" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id"),
  UNIQUE ("customer_key"),
  CHECK (
    ("billing_key_ciphertext" IS NULL AND "billing_key_iv" IS NULL AND "billing_key_version" IS NULL)
    OR
    ("billing_key_ciphertext" IS NOT NULL AND "billing_key_iv" IS NOT NULL AND "billing_key_version" = 'v1')
  ),
  CHECK (
    "billing_key_revocation_status"<>'pending'
    OR (
      "billing_key_ciphertext" IS NOT NULL
      AND "billing_key_iv" IS NOT NULL
      AND "billing_key_version"='v1'
    )
  ),
  CHECK (
    ("status"='trial' AND "trial_ends_at" IS NOT NULL AND "next_charge_at"="trial_ends_at")
    OR "status"<>'trial'
  )
);

CREATE INDEX "idx_web_billing_customers_renewal"
  ON "web_billing_customers" ("status", "next_charge_at", "retry_after");

CREATE INDEX "idx_web_billing_customers_key_revocation"
  ON "web_billing_customers"
     ("billing_key_revocation_status", "billing_key_revocation_retry_at", "updated_at");

CREATE TABLE "web_billing_charge_attempts" (
  "order_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "checkout_session_id" TEXT,
  "plan" TEXT NOT NULL CHECK ("plan" IN ('month', 'year')),
  "amount" INTEGER NOT NULL CHECK (
    ("plan" = 'month' AND "amount" = 4900)
    OR ("plan" = 'year' AND "amount" = 39000)
  ),
  "kind" TEXT NOT NULL CHECK ("kind" IN ('initial', 'trial_conversion', 'renewal')),
  "customer_key" TEXT,
  "period_start" TEXT NOT NULL,
  "period_end" TEXT NOT NULL,
  "status" TEXT NOT NULL
    CHECK ("status" IN ('pending', 'processing', 'done', 'failed', 'unknown')),
  "claim_token" TEXT,
  "claim_expires_at" TEXT,
  "payment_key_hash" TEXT,
  "error_code" TEXT,
  "refund_status" TEXT DEFAULT 'none' NOT NULL
    CHECK ("refund_status" IN ('none','partial','full')),
  "refunded_amount" INTEGER DEFAULT 0 NOT NULL
    CHECK ("refunded_amount">=0 AND "refunded_amount"<="amount"),
  "refund_state_hash" TEXT CHECK (
    "refund_state_hash" IS NULL
    OR (length("refund_state_hash")=64 AND "refund_state_hash" NOT GLOB '*[^0-9a-f]*')
  ),
  "provider_checked_at" TEXT,
  "refund_committed_at" TEXT,
  "refund_webhook_checked_at" TEXT,
  "refund_funnel_status" TEXT DEFAULT 'none' NOT NULL
    CHECK ("refund_funnel_status" IN ('none','pending','sent')),
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "completed_at" TEXT,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("order_id"),
  CHECK (
    ("claim_token" IS NULL AND "claim_expires_at" IS NULL)
    OR ("claim_token" IS NOT NULL AND "claim_expires_at" IS NOT NULL)
  ),
  CHECK (
    ("refund_status"='none' AND "refunded_amount"=0
      AND "refund_state_hash" IS NULL AND "refund_committed_at" IS NULL)
    OR ("refund_status"='partial' AND "refunded_amount">0 AND "refunded_amount"<"amount"
        AND "refund_state_hash" IS NOT NULL AND "refund_committed_at" IS NOT NULL)
    OR ("refund_status"='full' AND "refunded_amount"="amount"
        AND "refund_state_hash" IS NOT NULL AND "refund_committed_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "idx_web_billing_charge_initial_session"
  ON "web_billing_charge_attempts" ("checkout_session_id")
  WHERE "kind" = 'initial' AND "checkout_session_id" IS NOT NULL;

CREATE INDEX "idx_web_billing_charge_family_created"
  ON "web_billing_charge_attempts" ("family_id", "created_at");

CREATE INDEX "idx_web_billing_charge_claim"
  ON "web_billing_charge_attempts" ("status", "claim_expires_at");

CREATE INDEX "idx_web_billing_charge_refund_reconcile"
  ON "web_billing_charge_attempts" ("provider_checked_at","completed_at","order_id")
  WHERE "status"='done' AND "refund_status"<>'full';

CREATE TABLE "web_billing_refund_records" (
  "record_id" TEXT NOT NULL CHECK (
    length("record_id")=71
    AND substr("record_id",1,7)='refund:'
    AND substr("record_id",8) NOT GLOB '*[^0-9a-f]*'
  ),
  "provider_reference" TEXT NOT NULL CHECK (length("provider_reference") BETWEEN 6 AND 64),
  "provider" TEXT DEFAULT 'toss_web' NOT NULL CHECK ("provider"='toss_web'),
  "plan" TEXT NOT NULL CHECK ("plan" IN ('month','year')),
  "amount" INTEGER NOT NULL CHECK (
    ("plan"='month' AND "amount"=4900) OR ("plan"='year' AND "amount"=39000)
  ),
  "currency" TEXT DEFAULT 'KRW' NOT NULL CHECK ("currency"='KRW'),
  "charge_kind" TEXT NOT NULL CHECK ("charge_kind" IN ('initial','trial_conversion','renewal')),
  "refund_status" TEXT NOT NULL CHECK ("refund_status" IN ('partial','full')),
  "refunded_amount" INTEGER NOT NULL CHECK ("refunded_amount">0 AND "refunded_amount"<="amount"),
  "balance_amount" INTEGER NOT NULL CHECK ("balance_amount">=0 AND "balance_amount"<"amount"),
  "payment_key_hash" TEXT NOT NULL CHECK (
    length("payment_key_hash")=64 AND "payment_key_hash" NOT GLOB '*[^0-9a-f]*'
  ),
  "refund_state_hash" TEXT NOT NULL CHECK (
    length("refund_state_hash")=64 AND "refund_state_hash" NOT GLOB '*[^0-9a-f]*'
  ),
  "transaction_count" INTEGER NOT NULL CHECK ("transaction_count">0),
  "provider_checked_at" TEXT NOT NULL,
  "retention_until" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("record_id"),
  UNIQUE ("provider_reference","refund_state_hash"),
  CHECK ("refunded_amount"+"balance_amount"="amount"),
  CHECK (
    ("refund_status"='partial' AND "balance_amount">0 AND "refunded_amount"<"amount")
    OR ("refund_status"='full' AND "balance_amount"=0 AND "refunded_amount"="amount")
  )
);

CREATE INDEX "idx_web_billing_refund_provider_checked"
  ON "web_billing_refund_records" ("provider_reference","provider_checked_at");

CREATE INDEX "idx_web_billing_refund_retention"
  ON "web_billing_refund_records" ("retention_until","record_id");

CREATE TABLE "web_billing_trial_claims" (
  "family_id" TEXT NOT NULL,
  "parent_id" TEXT NOT NULL,
  "checkout_session_id" TEXT NOT NULL,
  "provider" TEXT DEFAULT 'toss_web' NOT NULL CHECK ("provider" IN ('toss_web','google_play')),
  "plan" TEXT NOT NULL CHECK ("plan" IN ('month', 'year')),
  "status" TEXT NOT NULL CHECK ("status" IN ('active', 'converted', 'cancelled', 'expired')),
  "claimed_at" TEXT NOT NULL,
  "trial_ends_at" TEXT NOT NULL,
  "converted_order_id" TEXT,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id"),
  UNIQUE ("checkout_session_id")
);

CREATE INDEX "idx_web_billing_trial_status_end"
  ON "web_billing_trial_claims" ("status", "trial_ends_at");

CREATE TABLE IF NOT EXISTS "web_billing_financial_records" (
  "record_id" TEXT NOT NULL CHECK (length("record_id") BETWEEN 8 AND 200),
  "record_type" TEXT NOT NULL CHECK ("record_type" IN ('charge','trial')),
  "provider" TEXT DEFAULT 'toss_web' NOT NULL CHECK ("provider" IN ('toss_web','google_play')),
  "provider_reference" TEXT NOT NULL CHECK (length("provider_reference") BETWEEN 6 AND 128),
  "plan" TEXT NOT NULL CHECK ("plan" IN ('month','year')),
  "amount" INTEGER NOT NULL CHECK ("amount">=0),
  "currency" TEXT DEFAULT 'KRW' NOT NULL CHECK ("currency"='KRW'),
  "charge_kind" TEXT CHECK ("charge_kind" IN ('initial','trial_conversion','renewal')),
  "record_status" TEXT NOT NULL CHECK ("record_status" IN (
    'paid','trial_active','trial_converted','trial_cancelled','trial_expired'
  )),
  "period_start" TEXT NOT NULL,
  "period_end" TEXT NOT NULL,
  "payment_key_hash" TEXT CHECK (
    "payment_key_hash" IS NULL OR (
      length("payment_key_hash")=64 AND "payment_key_hash" NOT GLOB '*[^0-9a-f]*'
    )
  ),
  "detached_at" TEXT NOT NULL,
  "retention_until" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("record_id"),
  UNIQUE ("record_type","provider_reference"),
  CHECK (datetime(substr("period_start",1,19))<datetime(substr("period_end",1,19))),
  CHECK (
    (
      "record_type"='charge'
      AND "record_status"='paid'
      AND "charge_kind" IS NOT NULL
      AND "payment_key_hash" IS NOT NULL
      AND (
        ("plan"='month' AND "amount"=4900)
        OR ("plan"='year' AND "amount"=39000)
      )
    )
    OR (
      "record_type"='trial'
      AND "record_status" IN ('trial_active','trial_converted','trial_cancelled','trial_expired')
      AND "charge_kind" IS NULL
      AND "payment_key_hash" IS NULL
      AND "amount"=0
    )
  )
);

CREATE INDEX IF NOT EXISTS "idx_web_billing_financial_retention"
  ON "web_billing_financial_records" ("retention_until","record_id");

CREATE TABLE "web_ai_credit_orders" (
  "order_id" TEXT NOT NULL CHECK (length("order_id") BETWEEN 6 AND 64),
  "family_id" TEXT NOT NULL,
  "parent_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "customer_key" TEXT NOT NULL CHECK (length("customer_key") BETWEEN 2 AND 50),
  "product_code" TEXT NOT NULL CHECK ("product_code" IN (
    'ai-credit-30','ai-credit-80','ai-credit-200'
  )),
  "credits" INTEGER NOT NULL CHECK (
    ("product_code"='ai-credit-30' AND "credits"=30)
    OR ("product_code"='ai-credit-80' AND "credits"=80)
    OR ("product_code"='ai-credit-200' AND "credits"=200)
  ),
  "amount" INTEGER NOT NULL CHECK ("amount">0 AND "amount"<=10000000),
  "currency" TEXT DEFAULT 'KRW' NOT NULL CHECK ("currency"='KRW'),
  "status" TEXT DEFAULT 'pending' NOT NULL CHECK ("status" IN (
    'pending','processing','unknown','done','refund_processing','refund_unknown',
    'refunded','failed','expired'
  )),
  "expires_at" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "claim_token" TEXT,
  "claim_expires_at" TEXT,
  "payment_key_hash" TEXT,
  "debt_applied" INTEGER DEFAULT 0 NOT NULL CHECK (
    "debt_applied">=0 AND "debt_applied"<="credits"
  ),
  "record_scope" TEXT DEFAULT 'active' NOT NULL CHECK (
    "record_scope" IN ('active','detached')
  ),
  "balance_scope" TEXT DEFAULT 'active' NOT NULL CHECK (
    "balance_scope" IN ('active','detached')
  ),
  "detach_reason" TEXT CHECK (
    "detach_reason" IS NULL OR "detach_reason" IN (
      'account_deleted','family_deleted','child_unpaired'
    )
  ),
  "detached_at" TEXT,
  "granted_credits" INTEGER DEFAULT 0 NOT NULL CHECK (
    "granted_credits">=0 AND "granted_credits"<="credits"
  ),
  "grant_committed_at" TEXT,
  "refunded_credits" INTEGER DEFAULT 0 NOT NULL CHECK (
    "refunded_credits">=0 AND "refunded_credits"<="credits"
  ),
  "refund_committed_at" TEXT,
  "retention_until" TEXT,
  "refunded_amount" INTEGER DEFAULT 0 NOT NULL CHECK (
    "refunded_amount">=0 AND "refunded_amount"<="amount"
  ),
  "provider_checked_at" TEXT,
  "client_checked_at" TEXT,
  "webhook_checked_at" TEXT,
  "error_code" TEXT,
  "retry_after" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "completed_at" TEXT,
  PRIMARY KEY ("order_id"),
  UNIQUE ("customer_key"),
  UNIQUE ("idempotency_key"),
  CHECK (
    ("claim_token" IS NULL AND "claim_expires_at" IS NULL)
    OR ("claim_token" IS NOT NULL AND "claim_expires_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "idx_web_ai_credit_payment_hash"
  ON "web_ai_credit_orders" ("payment_key_hash")
  WHERE "payment_key_hash" IS NOT NULL;

CREATE INDEX "idx_web_ai_credit_family_parent"
  ON "web_ai_credit_orders" ("family_id","parent_id","child_user_id","status","created_at");

CREATE INDEX "idx_web_ai_credit_reconcile"
  ON "web_ai_credit_orders" ("status","retry_after","claim_expires_at","provider_checked_at");

CREATE INDEX "idx_web_ai_credit_detached_reconcile"
  ON "web_ai_credit_orders" ("record_scope","status","retry_after","claim_expires_at");

CREATE TABLE "web_ai_credit_detached_balances" (
  "family_id" TEXT NOT NULL,
  "child_user_id" TEXT NOT NULL,
  "purchased_credits" INTEGER DEFAULT 0 NOT NULL,
  "restoration_state" TEXT NOT NULL CHECK (
    "restoration_state" IN ('blocked','closed')
  ),
  "detached_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "retention_until" TEXT NOT NULL,
  PRIMARY KEY ("family_id","child_user_id")
);

CREATE INDEX "idx_web_ai_credit_detached_balance_retention"
  ON "web_ai_credit_detached_balances" ("retention_until");

CREATE TABLE "web_ai_credit_lookup_windows" (
  "family_id" TEXT NOT NULL,
  "window_started_at" TEXT NOT NULL,
  "attempts" INTEGER DEFAULT 0 NOT NULL CHECK ("attempts" BETWEEN 0 AND 30),
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id","window_started_at")
);

CREATE INDEX "idx_web_ai_credit_lookup_windows_updated"
  ON "web_ai_credit_lookup_windows" ("updated_at");


-- 가족 단위 결제 공급자 선점 정본. 결제 token·billing key 원문은 저장하지 않는다.
CREATE TABLE "billing_provider_reservations" (
  "family_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('google_play','toss_web')),
  "state" TEXT NOT NULL CHECK ("state" IN ('reserved','active','conflict','released')),
  "reservation_ref" TEXT NOT NULL CHECK (length("reservation_ref") BETWEEN 1 AND 200),
  "conflicting_provider" TEXT CHECK ("conflicting_provider" IN ('google_play','toss_web')),
  "conflict_ref" TEXT CHECK ("conflict_ref" IS NULL OR length("conflict_ref") BETWEEN 1 AND 200),
  "conflict_reason" TEXT CHECK ("conflict_reason" IN (
    'preexisting_toss_google_overlap',
    'google_purchase_after_toss_activation',
    'toss_charge_after_google_activation'
  )),
  "resolution_status" TEXT CHECK ("resolution_status" IN ('refund_required','manual_review')),
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("family_id"),
  CHECK (
    ("state"='conflict'
      AND "conflicting_provider" IS NOT NULL
      AND "conflicting_provider"<>"provider"
      AND "conflict_ref" IS NOT NULL
      AND "conflict_reason" IS NOT NULL
      AND "resolution_status" IS NOT NULL)
    OR
    ("state"<>'conflict'
      AND "conflicting_provider" IS NULL
      AND "conflict_ref" IS NULL
      AND "conflict_reason" IS NULL
      AND "resolution_status" IS NULL)
  )
);

CREATE INDEX "idx_billing_provider_state_updated"
  ON "billing_provider_reservations" ("state", "updated_at");

-- 친구 초대 보상 v2. 기존 포인트형 referral 테이블과 분리해 AI 크레딧만 지급한다.
CREATE TABLE "referral_codes_v2" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "owner_parent_id" TEXT NOT NULL,
  "reward_child_user_id" TEXT NOT NULL,
  "code" TEXT NOT NULL COLLATE NOCASE,
  "status" TEXT DEFAULT 'active' NOT NULL CHECK ("status" IN ('active','revoked')),
  "successful_referrals" INTEGER DEFAULT 0 NOT NULL CHECK ("successful_referrals" >= 0),
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "revoked_at" TEXT,
  PRIMARY KEY ("id"),
  UNIQUE ("family_id"),
  UNIQUE ("code"),
  CHECK (length("code")=22 AND substr("code",1,6)='HYENI-')
);

CREATE INDEX "idx_referral_codes_v2_owner"
  ON "referral_codes_v2" ("owner_parent_id","status");

CREATE TABLE "referral_completions_v2" (
  "id" TEXT NOT NULL,
  "referral_code_id" TEXT NOT NULL,
  "referrer_family_id" TEXT NOT NULL,
  "referrer_parent_id" TEXT NOT NULL,
  "referrer_child_user_id" TEXT NOT NULL,
  "referee_family_id" TEXT NOT NULL,
  "referee_parent_id" TEXT NOT NULL,
  "referee_child_user_id" TEXT,
  "status" TEXT DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending','qualified','rewarded','rejected')),
  "reward_credits" INTEGER DEFAULT 50 NOT NULL CHECK ("reward_credits" > 0),
  "first_location_at" TEXT,
  "latest_location_at" TEXT,
  "qualified_at" TEXT,
  "rewarded_at" TEXT,
  "rejection_reason" TEXT CHECK (
    "rejection_reason" IS NULL OR "rejection_reason" IN (
      'success_cap_reached','referrer_unavailable','referee_unavailable','reward_child_unavailable'
    )
  ),
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("referee_family_id"),
  UNIQUE ("referee_parent_id"),
  UNIQUE ("referrer_family_id","referee_family_id"),
  CHECK ("referrer_family_id"<>"referee_family_id"),
  CHECK ("referrer_parent_id"<>"referee_parent_id")
);

CREATE INDEX "idx_referral_completions_v2_pending"
  ON "referral_completions_v2" ("status",substr("created_at",1,19),"id");

CREATE INDEX "idx_referral_completions_v2_referrer"
  ON "referral_completions_v2" ("referrer_family_id","status","created_at");

CREATE INDEX "idx_referral_completions_v2_ready"
  ON "referral_completions_v2" (substr("created_at",1,19),"id")
  WHERE "status" IN ('pending','qualified')
    AND "referee_child_user_id" IS NOT NULL
    AND "first_location_at" IS NOT NULL
    AND "latest_location_at" IS NOT NULL
    AND datetime(substr("latest_location_at",1,19))
      >=datetime(substr("first_location_at",1,19),'+48 hours');

CREATE TRIGGER "trg_referral_location_evidence_snapshot"
AFTER INSERT ON "location_confirmation_records"
WHEN NEW."action"='collect'
 AND NEW."collection_method"='android_fused_location'
 AND NEW."acquisition_path"='android_native_app'
 AND NEW."service_code" IN ('current_location_ingest','location_history_ingest')
 AND NEW."purpose_code"='family_location_safety'
BEGIN
  UPDATE "referral_completions_v2"
     SET "referee_child_user_id"=COALESCE("referee_child_user_id",NEW."subject_user_id"),
         "first_location_at"=CASE
           WHEN "first_location_at" IS NULL
             OR substr(NEW."occurred_at",1,19)<substr("first_location_at",1,19)
           THEN NEW."occurred_at"
           ELSE "first_location_at"
         END,
         "latest_location_at"=CASE
           WHEN "first_location_at" IS NULL OR "latest_location_at" IS NULL
           THEN NEW."occurred_at"
           WHEN substr(NEW."occurred_at",1,19)<substr("first_location_at",1,19)
           THEN "latest_location_at"
           WHEN datetime(substr(NEW."occurred_at",1,19))
                >=datetime(substr("first_location_at",1,19),'+48 hours')
             AND substr(NEW."occurred_at",1,19)>substr("latest_location_at",1,19)
           THEN NEW."occurred_at"
           ELSE "latest_location_at"
         END,
         "updated_at"=CURRENT_TIMESTAMP
   WHERE "referee_family_id"=NEW."family_id"
     AND "status" IN ('pending','qualified')
     AND substr(NEW."occurred_at",1,19)>=substr("created_at",1,19)
     AND ("referee_child_user_id" IS NULL OR "referee_child_user_id"=NEW."subject_user_id")
     AND EXISTS (
       SELECT 1 FROM "family_members" member
        WHERE member."family_id"=NEW."family_id"
          AND member."user_id"=NEW."subject_user_id"
          AND member."role"='child'
          AND member."is_active"=1
     )
     AND NOT (
       "referee_child_user_id" IS NOT NULL
       AND "first_location_at" IS NOT NULL
       AND "latest_location_at" IS NOT NULL
       AND datetime(substr("latest_location_at",1,19))
           >=datetime(substr("first_location_at",1,19),'+48 hours')
     )
     AND (
       "first_location_at" IS NULL
       OR "latest_location_at" IS NULL
       OR substr(NEW."occurred_at",1,19)<substr("first_location_at",1,19)
       OR datetime(substr(NEW."occurred_at",1,19))
          >=datetime(substr("first_location_at",1,19),'+48 hours')
     );
END;

-- 채널별 순매출용 실제 비용 ledger. 원시 결제·가족 식별자와 자유 문구는 저장하지 않는다.
CREATE TABLE "revenue_cost_ledger" (
  "entry_id" TEXT NOT NULL CHECK (length("entry_id") = 36),
  "provider" TEXT NOT NULL CHECK ("provider" IN ('google_play', 'toss_payments')),
  "category" TEXT NOT NULL CHECK ("category" IN (
    'provider_fee', 'confirmed_refund', 'ai_variable_cost', 'support_cost'
  )),
  "amount_krw" INTEGER NOT NULL
    CHECK (typeof("amount_krw") = 'integer' AND "amount_krw" > 0),
  "occurred_on" TEXT NOT NULL
    CHECK (length("occurred_on") = 10 AND "occurred_on" GLOB '????-??-??'),
  "source_ref_hash" TEXT NOT NULL
    CHECK (length("source_ref_hash") = 64 AND "source_ref_hash" NOT GLOB '*[^0-9a-f]*'),
  "recorded_at" TEXT NOT NULL,
  PRIMARY KEY ("entry_id")
);

CREATE UNIQUE INDEX "idx_revenue_cost_ledger_source_unique"
  ON "revenue_cost_ledger" ("provider", "category", "source_ref_hash");

CREATE INDEX "idx_revenue_cost_ledger_provider_date"
  ON "revenue_cost_ledger" ("provider", "occurred_on", "category");

CREATE INDEX "idx_revenue_cost_ledger_category_date"
  ON "revenue_cost_ledger" ("category", "occurred_on", "provider");

-- coverage가 [period_start, period_end) 전체를 덮을 때만 비용 0원을 실제 0원으로 인정한다.
CREATE TABLE "revenue_cost_coverage" (
  "coverage_id" TEXT NOT NULL CHECK (length("coverage_id") = 36),
  "provider" TEXT NOT NULL CHECK ("provider" IN ('google_play', 'toss_payments')),
  "category" TEXT NOT NULL CHECK ("category" IN (
    'provider_fee', 'confirmed_refund', 'ai_variable_cost', 'support_cost'
  )),
  "period_start" TEXT NOT NULL
    CHECK (length("period_start") = 10 AND "period_start" GLOB '????-??-??'),
  "period_end" TEXT NOT NULL
    CHECK (length("period_end") = 10 AND "period_end" GLOB '????-??-??'),
  "source_ref_hash" TEXT NOT NULL
    CHECK (length("source_ref_hash") = 64 AND "source_ref_hash" NOT GLOB '*[^0-9a-f]*'),
  "confirmed_at" TEXT NOT NULL,
  PRIMARY KEY ("coverage_id"),
  CHECK ("period_start" < "period_end")
);

CREATE UNIQUE INDEX "idx_revenue_cost_coverage_source_unique"
  ON "revenue_cost_coverage" (
    "provider", "category", "period_start", "period_end", "source_ref_hash"
  );

CREATE INDEX "idx_revenue_cost_coverage_lookup"
  ON "revenue_cost_coverage" ("provider", "category", "period_start", "period_end");

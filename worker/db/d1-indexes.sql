-- D1 운영 인덱스 통합 셋 (§7 감사 B 수정)
--
-- 근본 원인: cloudflare/convert_schema.py 가 PG 덤프를 D1 로 변환할 때 CREATE INDEX
-- 와 UNIQUE 제약을 전부 누락(L122-123) → schema_d1.sql 에 CREATE INDEX 0건.
-- 그 결과 자주 쿼리되는 칼럼이 매 호출 풀스캔+정렬(이동경로 O(N) 버퍼 timeout,
-- parent_alerts/events 목록 풀스캔의 근본).
--
-- 이 파일은 location-history-index.sql 을 포함하는 상위 셋이다. 전부 비-UNIQUE +
-- IF NOT EXISTS 라 기존 데이터에 안전하게 멱등 적용된다(파괴적 아님).
--
-- 적용(사용자, prod):
--   wrangler d1 execute hyeni-calendar --remote --file worker/db/d1-indexes.sql
-- 로컬(--local) 검증:
--   wrangler d1 execute hyeni-calendar --local --file worker/db/d1-indexes.sql
--
-- ⚠️ UNIQUE 제약(parent_alerts dedup·notif_settings 등 select-then-write 경쟁조건
--    해소)은 기존 중복 행이 있으면 생성 실패하므로 여기 포함하지 않는다 — 별도
--    dedup-먼저 마이그레이션으로 처리한다(D1_SCHEMA_DATA_AUDIT.md 참조).

-- 이동경로 멱등 dup 조회 + 범위 prefetch (record_location_history_rows RPC).
CREATE INDEX IF NOT EXISTS idx_location_history_user_recorded
  ON location_history (user_id, recorded_at);

-- 부모 알림 목록: WHERE family_id=? ORDER BY created_at DESC (parent-alerts.ts:33,
-- location.ts incidents 범위쿼리).
CREATE INDEX IF NOT EXISTS idx_parent_alerts_family_created
  ON parent_alerts (family_id, created_at);

-- 일정 목록: WHERE family_id=? ORDER BY date_key DESC, id DESC (events.ts:51-58).
CREATE INDEX IF NOT EXISTS idx_events_family_datekey
  ON events (family_id, date_key);

-- 가족별 자녀 위치 조회 (PK 는 user_id 단일이라 family_id 조회는 비인덱스).
CREATE INDEX IF NOT EXISTS idx_child_locations_family
  ON child_locations (family_id);

-- 푸시 발송 대상 토큰 조회 (push-notify.ts).
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user
  ON fcm_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_family
  ON fcm_tokens (family_id);

-- 비고(§7 감사): location.ts/parent-alerts.ts 가 recorded_at/created_at 을
-- substr(col,1,19) 로 래핑해 비교 → 위 인덱스의 정렬/범위 부분이 non-sargable.
-- user_id/family_id prefix seek 은 활용되나, 완전 가속하려면 저장형식을 통일하고
-- substr 래핑을 제거하는 쿼리 수정이 별도로 필요(별도 작업).

# D1_SCHEMA_DATA_AUDIT

작성일: 2026-07-08 KST

## 결론

원격 D1 `hyeni-calendar`에 핵심 테이블이 존재하고, 이번 조회는 모두 `changed_db=false`였다.

## 실행 명령

```bash
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
npx wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_info(events);"
npx wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_info(family_members);"
npx wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_info(parent_alerts);"
npx wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_info(family_review_rewards);"
```

## 확인한 테이블

- `events`, `events_children`
- `family_members`, `families`
- `parent_alerts`, `push_sent`, `fcm_tokens`
- `child_locations`, `location_history`
- `family_review_rewards`
- `daily_supplies`, `memo_replies`, `memos`

## 컬럼 확인

| 테이블 | 확인한 핵심 컬럼 |
|---|---|
| events | `family_id`, `date_key`, `time`, `end_time`, `location`, `notif_override`, `is_family_event` |
| family_members | `family_id`, `user_id`, `role`, `birthdate`, `device_health`, `is_active` |
| parent_alerts | `family_id`, `alert_type`, `severity`, `event_id`, `child_user_id`, `read_by` |
| family_review_rewards | `family_id`, `parent_id`, `reward_type`, `granted_at`, `updated_at` |

## migrations

`npx wrangler d1 migrations list hyeni-calendar --remote`는 `migrations/` 폴더 부재로 실패했다. 현재 Worker 저장소는 SQL 스냅샷/수동 적용 파일 방식이라, 이 명령 실패는 런타임 스키마 부재가 아니라 관리 방식 차이다.

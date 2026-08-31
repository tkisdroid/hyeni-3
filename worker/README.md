# 혜니캘린더 백엔드 Worker (Supabase → Cloudflare 이전)

Supabase 백엔드를 Cloudflare(Workers + D1 + 향후 Durable Objects/R2)로 **전면 이전**하는 작업.
전체 로드맵·설계: `~/.claude/plans/cheerful-bouncing-hopper.md` (승인된 plan).

## 진행 상황

- ✅ **데이터 이관**: Supabase(PostgreSQL) 백업 → D1 `hyeni-calendar`(31,933행, location_history 제외). 변환 파이프라인 = `cloudflare/*.py`.
- ✅ **M0**: Worker 골격, `/api/health`, auth 스키마, `auth.users`/`identities` → D1 이행(users 739/identities 135), ES256 JWT + bcrypt.
- ✅ **M1**: 전화+비번 로그인, refresh 회전, authz(family 격리), `/api/events` read, 클라 시임(`VITE_API_BASE` 플래그).
- ✅ **M2**: read API 전체 — `sync.js` fetch\* 15종 + `teacherApi` read 10종을 `/api/*`로 직역. SECURITY DEFINER RPC(get_parent_alerts·get_\*\_stickers·get_class_roster·get_class_today_schedule 등) D1 SQL 직역 + jsonb/boolean/uuid[] 역직렬화(`lib/serialize.ts`) + authz 2축(family 격리 + teacher 교차접근). location_history·daily_supplies는 D1 미이관이라 빈 스텁(M5/v1.1 복원).
- ✅ **M3**: write + Realtime. `sync.js` write + `teacherApi` write 전체를 `/api/*`로 직역 — save_event_with_children(upsert+events_children+optimistic lock)·add_sticker(role 게이트)·insert_parent_alert_v2(멱등)·mark_*(read_by append)·teacher 10 RPC(페어링 전화탐색/rate limit/출석+알림 포함). authz write 게이트(primary parent/family/role/my_teacher_id). `FamilyRoom` Durable Object(WebSocket Hibernation)로 postgres_changes·broadcast 대체, write→DO `/notify` 통지. 클라 `realtime/familySocket.js` + subscribeFamily DO 분기. 복합 unique 미이관이라 ON CONFLICT 대신 select-then-write. location write는 M5(네이티브).
- ⬜ **M4~M6**: Edge Functions 21개+cron → 결제/푸시/네이티브 → 컷오버.

## 디렉토리

```
worker/
  index.ts            라우터 + /api/health + 라우트 마운트
  types.ts            Env/AuthUser/Vars
  wrangler.toml       D1 바인딩 (DB)
  lib/   jwt.ts(ES256) bcrypt.ts refresh.ts  serialize.ts(jsonb/boolean/uuid[] 역직렬화)
         realtime.ts(notifyPg → DO 통지)
  middleware/  auth.ts(JWT 검증)
  realtime/  FamilyRoom.ts(Durable Object — WebSocket Hibernation + broadcast)
  db/    auth-schema.sql(users/auth_identities/refresh_tokens)
         authz.ts(getMyFamilyIds·assertFamilyAccess·assertPrimaryParent·getMyTeacherId·assertClassOwner·isParentOfMember)
  routes/  auth.ts(login-password/refresh)
           events.ts  academies.ts  saved-places.ts  memos.ts(+replies)  daily-supplies.ts
           danger-zones.ts  stickers.ts(date/summary/received)  parent-alerts.ts
           location.ts(children/incidents/history)  [read+write 동일 파일에 공존]
           teacher.ts(read)  teacher-write.ts(profile/classes/invite/accept-invite/pairings/attendance)
```

> M3 Realtime: 클라 `src/lib/realtime/familySocket.js`(WS 재연결·ping) + `sync.js` subscribeFamily 가 `VITE_API_BASE` 시 DO 소켓으로 분기. write 라우트가 `notifyPg`로 변경을 FamilyRoom DO에 통지하면 구독 클라에 fan-out.

## 로컬 개발 셋업 (다음 세션 진입)

> **2026-08-01 통합 출시 안전 규칙:** 이번 가격·티어 출시는
> `C:\Users\TK\Desktop\hyeni-3\docs\store\play-release-checklist.md`의 7단계 manifest가 운영 정본이다.
> 아래 기능별 블록은 독립 변경 참고자료이며 위에서부터 이어 실행하거나 중간 `Worker` 배포에 사용하지 않는다.
> 7단계 migration·전체 secret·readback·clean release SHA의 green CI를 모두 확인한 뒤 태그와 메시지에 정확한
> Worker SHA를 기록해 **Worker를 한 번만 배포**한다. 개별 기능만 준비된 Worker를 운영에 노출하지 않는다.

### 계정 활성 설치 1대 migration-first 배포

`account_device_sessions`는 인증 계정별 현재 활성 설치를 정확히 한 행으로 보관한다. 비밀번호·OAuth·페어링처럼
본인 인증을 다시 끝낸 새 로그인은 활성 설치를 새 기기로 전환하고 이전 refresh 체인·FCM/Web Push endpoint·실시간
소켓을 닫는다. 기존 기기를 잃어 로그아웃할 수 없어도 새 기기로 들어갈 수 있지만, 비활성 설치의 refresh만으로는
인계할 수 없고 401로 닫힌다. Worker가 이 테이블 없이 먼저 배포되면 신규 세션 발급이 fail-closed하므로 반드시
migration을 먼저 적용한다. 운영 확인은 스키마 이름만 읽으며 user/device 식별자를 출력하지 않는다.

```bash
cd worker
npx wrangler d1 execute hyeni-calendar --remote --file=db/account-device-sessions.sql -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT type,name FROM sqlite_master WHERE name IN ('account_device_sessions','idx_account_device_sessions_expiry') ORDER BY type,name" -y
cd ..
npm run typecheck:worker
npm run test:worker
npm run deploy:worker
```

### 로그인·전화가입 UNIQUE migration-first 배포

전화번호·정규화 ID·활성 OTP는 각각 하나여야 한다. 가입 요청이 동시에 들어와도 두 계정이나
서로 다른 OTP가 생기지 않도록 Worker는 아래 UNIQUE 인덱스와 `ON CONFLICT(phone)` 원자 cooldown을
전제로 한다. 운영 적용은 원문 ID·전화번호를 출력하지 않는 중복 그룹 진단 3개가 모두 0일 때만
진행하며, 중복이 있으면 자동 삭제·병합하지 않고 배포를 중지한다. migration은 기존 값을 바꾸지
않는 additive 인덱스지만 반드시 Worker보다 먼저 적용한다.

```bash
cd worker
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT COUNT(*) AS duplicate_user_phone_groups FROM (SELECT phone FROM users WHERE phone IS NOT NULL AND TRIM(phone)<>'' GROUP BY phone HAVING COUNT(*)>1)" -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT COUNT(*) AS duplicate_profile_phone_groups FROM (SELECT phone FROM user_profiles WHERE phone IS NOT NULL AND TRIM(phone)<>'' GROUP BY phone HAVING COUNT(*)>1)" -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT COUNT(*) AS duplicate_login_id_groups FROM (SELECT LOWER(TRIM(login_id)) AS login_id FROM user_profiles WHERE login_id IS NOT NULL AND TRIM(login_id)<>'' GROUP BY LOWER(TRIM(login_id)) HAVING COUNT(*)>1)" -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT COUNT(*) AS duplicate_otp_phone_groups FROM (SELECT phone FROM phone_otp GROUP BY phone HAVING COUNT(*)>1)" -y
npx wrangler d1 execute hyeni-calendar --remote --file=db/auth-entry-uniqueness.sql -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name,[unique],partial FROM pragma_index_list('users') WHERE name='idx_users_phone_unique_nonempty' UNION ALL SELECT name,[unique],partial FROM pragma_index_list('user_profiles') WHERE name IN ('idx_user_profiles_phone_unique_nonempty','idx_user_profiles_login_id_unique_normalized') UNION ALL SELECT name,[unique],partial FROM pragma_index_list('phone_otp') WHERE name='idx_phone_otp_phone_unique' ORDER BY name" -y
# 통합 출시에서는 전체 readback 뒤 Worker를 한 번만 배포한다.
```

### AI 크레딧 balance UNIQUE migration-first 배포

`ai_credit_balances`는 `(family_id, child_user_id)`당 정확히 한 행이어야 한다. 기존
select-then-insert 동시 요청으로 생긴 중복은 Worker 배포 전에 병합한다. signed 구매 잔액은 중복
행의 합계나 0 clamp가 아니라 최댓값을 보존해 같은 잔액 복제본을 이중 지급하지 않고 환불 부채도 유지하며, 일일 사용량은
가장 최신 reset 날짜의 최댓값을 보존해 한도 우회를 막는다. 요청 body의 `usageDate`는 일정
문맥에만 쓰며, 5회/20회 한도 정산은 서버 KST 오늘 날짜만 사용한다.

운영 순서는 읽기 전용 중복 진단 → migration 1회 적용 → UNIQUE/중복 0건 확인 → Worker
배포다. 새 Worker를 migration보다 먼저 배포하면 conflict-safe seed가 fail-closed하므로 순서를
바꾸지 않는다. 이번 코드 작업에서는 운영 D1 migration과 Worker 배포를 실행하지 않았다.
중복 진단은 그룹 수·중복 행 수·병합 대상 행 수만 반환하며 원시 `family_id`·`child_user_id`나
개별 잔액을 운영 콘솔에 출력하지 않는다.

```bash
cd worker
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT COUNT(*) AS duplicate_groups,COALESCE(SUM(group_rows),0) AS duplicate_rows,COALESCE(SUM(group_rows-1),0) AS rows_to_merge FROM (SELECT COUNT(*) AS group_rows FROM ai_credit_balances GROUP BY family_id,child_user_id HAVING COUNT(*)>1)" -y
npx wrangler d1 execute hyeni-calendar --remote --file=db/ai-credit-balance-uniqueness.sql -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ai_credit_balances_family_child_unique'" -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT COUNT(*) AS duplicate_groups FROM (SELECT 1 FROM ai_credit_balances GROUP BY family_id,child_user_id HAVING COUNT(*)>1)" -y
# 통합 출시에서는 여기서 배포하지 않는다. 7단계 전체 readback 뒤 Worker를 한 번만 배포한다.
```

### AI 친구 부모 설정 UNIQUE migration-first 배포

`ai_parent_settings`도 `(family_id, child_user_id)`당 정확히 한 행이어야 현재 Worker의
`ON CONFLICT(family_id,child_user_id)` 원자 upsert가 동작한다. 아래 익명 집계가 0일 때만
UNIQUE migration을 적용한다. 중복이 있으면 설정값을 자동 삭제·병합하지 않고 출시를 HOLD해
restricted release record에서 별도 정규화 결정을 받는다.

```bash
cd worker
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT COUNT(*) AS duplicate_groups,COALESCE(SUM(group_rows),0) AS duplicate_rows,COALESCE(SUM(group_rows-1),0) AS rows_to_normalize,COALESCE(MAX(group_rows),0) AS max_group_rows FROM (SELECT COUNT(*) AS group_rows FROM ai_parent_settings GROUP BY family_id,child_user_id HAVING COUNT(*)>1)" -y
npx wrangler d1 execute hyeni-calendar --remote --file=db/ai-parent-settings-uniqueness.sql -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT CASE WHEN EXISTS (SELECT 1 FROM pragma_index_list('ai_parent_settings') i WHERE i.name='uq_ai_parent_settings_family_child' AND i.[unique]=1 AND i.partial=0 AND (SELECT group_concat(c.name,',') FROM (SELECT name FROM pragma_index_info('uq_ai_parent_settings_family_child') ORDER BY seqno) c)='family_id,child_user_id') THEN 1 ELSE 0 END AS exact_unique_index,COUNT(*) AS duplicate_groups FROM (SELECT 1 FROM ai_parent_settings GROUP BY family_id,child_user_id HAVING COUNT(*)>1)" -y
# 통합 출시에서는 여기서 배포하지 않는다. 7단계 전체 readback 뒤 Worker를 한 번만 배포한다.
```

### 프리미엄·가족 생애주기 KPI migration-first 배포

프리미엄 전환 이벤트와 가족 생성→Android 아이 연결→첫 실측 위치→첫 도착, KST 일별
부모 활동·자녀 신호는 같은 `PREMIUM_FUNNEL_HASH_SECRET` HMAC 가족키로만 연결한다.
원시 가족·사용자 식별자, 좌표·주소·메모, 인증·구매 토큰은 분석 테이블에 저장하지 않으며
매시 retention cron이 이벤트와 일별 fact를 180일 뒤 삭제한다.

운영 적용은 세 정본 migration과, 기존 테이블에 필요한 source forward migration을 HMAC secret과 함께
Worker보다 먼저 준비한다. 실제 secret 값은 저장소, 명령 인자, 로그에 남기지 않는다.

```bash
cd worker
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT CASE WHEN EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='premium_funnel_events') THEN 1 ELSE 0 END AS table_present,CASE WHEN EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='premium_funnel_events' AND instr(lower(COALESCE(sql,'')),'''ai_friend_limit''')>0) THEN 1 ELSE 0 END AS has_ai_friend_limit_source,CASE WHEN EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='premium_funnel_events' AND instr(lower(COALESCE(sql,'')),'''ai_schedule_limit''')>0) THEN 1 ELSE 0 END AS has_ai_schedule_limit_source" -y
# table_present=0일 때만 최신 정본 테이블을 만든다. 생성 뒤 두 forward migration은 실행하지 않는다.
npx wrangler d1 execute hyeni-calendar --remote --file=db/premium-funnel.sql -y
# table_present=1, has_ai_friend_limit_source=0일 때만 다음 forward migration을 정확히 1회 적용한다.
npx wrangler d1 execute hyeni-calendar --remote --file=db/premium-funnel-ai-friend-limit.sql -y
# table_present=1, has_ai_schedule_limit_source=0일 때만 다음 forward migration을 정확히 1회 적용한다.
# 두 source가 모두 없었다면 ai_friend_limit migration 다음에 이 파일을 적용한다.
npx wrangler d1 execute hyeni-calendar --remote --file=db/premium-funnel-ai-schedule-limit.sql -y
npx wrangler d1 execute hyeni-calendar --remote --file=db/family-lifecycle-funnel.sql -y
npx wrangler d1 execute hyeni-calendar --remote --file=db/revenue-cost-ledger.sql -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT CASE WHEN EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='premium_funnel_events' AND instr(lower(COALESCE(sql,'')),'''ai_friend_limit''')>0) THEN 1 ELSE 0 END AS has_ai_friend_limit_source,CASE WHEN EXISTS (SELECT 1 FROM sqlite_schema WHERE type='table' AND name='premium_funnel_events' AND instr(lower(COALESCE(sql,'')),'''ai_schedule_limit''')>0) THEN 1 ELSE 0 END AS has_ai_schedule_limit_source,(SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name IN ('premium_funnel_events','premium_funnel_rate_limits','family_lifecycle_events','family_lifecycle_daily','revenue_cost_ledger','revenue_cost_coverage')) AS present_tables" -y
npx wrangler secret put PREMIUM_FUNNEL_HASH_SECRET
# 통합 출시에서는 여기서 배포하지 않는다. 7단계 전체 readback 뒤 Worker를 한 번만 배포한다.
```

생애주기 운영 집계 정본은 `ops/family-lifecycle-kpis.sql`이다. D7·D30은 해당 관찰일이 지난 cohort만
분모에 넣고, MAF는 최근 30일 안에 부모 활동과 자녀 기기 신호가 각각 있는 가족으로 센다.
채널별 최근 90개 완료 KST 일자의 순매출 / 최근 30개 완료 KST 일자의 MAF 정본은
`ops/channel-90d-net-revenue.sql`이다. 서버가 검증한 월 4,900원·연 39,000원 구독 gross에서
`revenue_cost_ledger`에 입력한 실제 공급자 수수료·확정 환불액·AI 변동원가·지원비만 뺀다.
수수료율이나 미확정 비용을 코드로 추정하지 않는다.

비용 원장은 결제·가족 원시 식별자나 자유 문구를 받지 않는다. `source_ref_hash`에는 주문번호가 아니라
정산서·환불 확인서·AI 사용 명세·지원비 증빙 파일 자체의 SHA-256 소문자 hex만 넣고, 같은 공급자·비용종·
증빙의 중복 입력은 UNIQUE 인덱스로 거부한다. 채널에 직접 귀속할 수 없는 공통 비용은 임의 배분하지 않는다.
실제 금액이 0원인 기간은 ledger에 0원 행을 넣는 대신, 운영자가 전체 자료를 대사한 뒤
`revenue_cost_coverage`에 `[period_start, period_end)` 범위를 기록한다. Google Play와 Toss 각각의
네 비용종 coverage가 최근 90일 전체를 덮지 않으면 결과의 순매출과 순매출/MAF는 NULL이며
`calculation_status="계산 불가"`, `missing_cost_categories`에 누락 비용종이 표시된다.
coverage가 완전해도 MAF가 0이면 0으로 나누지 않고 순매출/MAF와 상태를 각각 NULL·`계산 불가`로 표시한다.

```bash
cd worker
npx wrangler d1 execute hyeni-calendar --remote --file=ops/channel-90d-net-revenue.sql -y
```

### 위치 확인자료·좌표 이력 보존 migration-first 배포

`location_history` 좌표 원본은 Free·기존 스토어 방문 혜택 가족은 한국시간 오전 8시를
경계로 한 현재 조회일만, Premium은 수집 시각부터 최대 30일만 보관한다. 매시 cron이 오래된 원본부터
가족당 최대 5,000행, 실행당 최대 9가족을 처리한다. 후보 조회·가족별 엔타이틀먼트 4회·삭제 1회·고아 삭제를
합쳐 D1 Free 호출당 한도 아래인 최대 47 queries로 제한하며, 엔타이틀먼트 조회에 실패한 가족은 삭제하지 않는다.

Android `record_location_history_rows` RPC는 요청당 최대 400행이다. 401행 이상은 저장 전에 413으로 거부하고,
과거 provider fix 시각은 보존하되 1분 이내 미래 오차만 현재 시각으로 보정하며 그보다 먼 미래 시각은 400으로 닫는다.
14행씩 최대 98 bind의 `SELECT UNION ALL` INSERT로 묶어 단일 사용자 400행 경로를 RPC 내부 최대 32 queries,
외부 가족·mutation lease 검증을 포함해 최대 35 queries로 제한한다. KST 기록일별 실제 신규 INSERT는
`location_history_ingest_daily_usage` trigger가 같은 transaction에서 최대 7,200행으로 제한한다. 중복 flush는
INSERT가 0건이라 quota도 증가하지 않고, 상한 초과나 INSERT 실패는 위치 행과 quota를 함께 rollback한다.

`location_confirmation_records`는 위치정보 수집·이용·제공사실 확인자료 전용 원장이다.
좌표·주소·자유 JSON 컬럼 없이 고정 allowlist 코드와 최소 내부 식별자·시각만 저장한다.
좌표 저장은 D1 trigger가 같은 transaction에서 수집 확인자료를 남긴다. Android와 SOS는 같은
실측 fix 시각을 current→history 두 저장 경로에 전달하며, reciprocal `service_code`와 정확히 같은
밀리초인 반대 저장 경로만 기존 인덱스로 합친다. 순서가 바뀌어도 동일하고, 별도 unique index나
광범위한 `OR IGNORE`로 위치 원본 write를 막지 않는다. 추정 이력은 실측 수집으로 기록하지 않는다.
중앙 위치 조회와 안전 판정은 확인자료 기록 실패 시 위치 기능을 fail-closed하며, 정기 안전 판정은
실제 조회·선택한 자녀와 source만 기록한다. 등록장소는 usable history 우선, 없을 때만 신선한 current를
사용한다. 100개 bind를 넘지 않도록 대규모 대상은 90개씩 나눈다.

hourly maintenance의 30·40·50분 작업은 정확히 6개월보다 오래된 확인자료를 실행당 최대 5,000행,
시간당 최대 15,000행 삭제하며 상한을 채우면 식별자 없는 포화 경고를 남긴다. 계정 삭제·위치 동의 철회·
페어링 해제 후에도 이미 생성된 확인자료는 법정 보존 예외로 원본 좌표와 분리해 6개월 동안만 보관하고,
6개월이 경과하면 같은 cron 삭제 대상에 포함한다.

상용 출시는 **Workers Paid 플랜 확인을 필수 게이트**로 둔다. Free는 DB당 500MB·일 100,000
rows_written·invocation당 50 queries 한도라 기존 운영 쓰기와 확인자료 table/TEXT PK/인덱스·보존 DELETE를
합치면 안전 여유가 없다. Paid도 DB당 10GB 상한은 늘릴 수 없으므로 아래 집계 모니터의 Free/Paid 두 행 중
실제 플랜을 대조하고, 전체 DB 50/70/85%에서 각각 용량 설계/분리 리허설/확대 HOLD를 적용한다.

운영 적용은 Worker 배포 전에 확인자료 테이블·trigger를 먼저 만들고, 위치 이력 일일 quota를 기존
이력에서 backfill한 뒤, 좌표 보존 인덱스를 만든다. 세 migration은 기존 좌표를 삭제하지 않으며 재실행 가능하다.

```bash
cd worker
npx wrangler d1 execute hyeni-calendar --remote --file=db/location-confirmation-records.sql -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT type,name FROM sqlite_master WHERE name IN ('location_confirmation_records','idx_location_confirmation_recorded','idx_location_confirmation_family_subject_occurred','trg_child_locations_confirmation_insert','trg_child_locations_confirmation_update','trg_location_history_confirmation_insert') ORDER BY type,name" -y
npx wrangler d1 execute hyeni-calendar --remote --file=db/location-history-ingest-quota.sql -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT type,name FROM sqlite_master WHERE name IN ('location_history_ingest_daily_usage','idx_location_history_ingest_usage_date','trg_location_history_ingest_daily_quota') ORDER BY type,name" -y
npx wrangler d1 execute hyeni-calendar --remote --file=db/location-history-retention.sql -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_location_history_recorded_family','idx_location_history_family_recorded_norm') ORDER BY name" -y
npx wrangler d1 execute hyeni-calendar --remote --file=ops/location-confirmation-capacity.sql -y
npx wrangler secret put LOCATION_AUDIT_CURSOR_SECRET
# 통합 출시에서는 여기서 배포하지 않는다. 7단계 전체 readback 뒤 Worker를 한 번만 배포한다.
```

용량 SQL은 집계만 반환하며 가족·사용자 식별자를 출력하지 않는다. 실제 일일 `rows_read`·`rows_written`은
D1 Dashboard/GraphQL Analytics의 계정 단위 값으로 확인한다. 플랜·최근 24시간 사용량·DB byte readback 중
하나라도 없거나 Free 한도에 의존하면 출시하지 않는다. 장기적으로는 자녀/가족 단위 D1 분리 또는 검토된
archive 설계가 필요하며, 법률 검토 없이 확인자료를 시간 버킷·세션 집계로 축약하지 않는다.

인증된 최소 열람 API는 `GET /api/location/audit?family_id=...&start=...&end=...`이며 부모는
해당 가족의 활성 자녀, 아이는 본인 확인자료만 최대 31일 창에서 조회한다. 모든 성공 응답은
`{ records, hasMore, nextCursor }`이며 `pageSize`를 생략하면 1,000건, 명시하면 1~1,000건이다.
`hasMore=true`이면 같은 가족·기간·자녀 조건에
`cursor=nextCursor`를 붙여 반복한다. cursor는 전용 `LOCATION_AUDIT_CURSOR_SECRET`으로 HMAC-SHA-256
서명되고 범위와 대상 scope에 묶인 불투명 값이다. payload·서명 변경이나 다른 조회 재사용은 400,
secret 누락·32바이트 미만·서명 생성 장애는 503으로 fail-closed한다. 응답에도 좌표·주소·자유문구는 없다. 이번 코드 작업에서는 운영
D1 migration과 Worker 배포를 실행하지 않았다. 출시 전에는 사업자의 위치정보법상 신고·등록 유형,
동의 화면의 필수 고지 항목, 확인자료 필드·보존기간·열람 절차가 실제 사업 형태에 맞는지 전문 법률
검토를 완료해야 한다.

### 신규 결제 운영 제어 (fail-closed)

레거시 웹 결제의 운영 정본은 `app_global_settings`의 단일 행 `commerce_runtime_controls_v1`이다. 이 행의
`webSubscriptionNewCheckoutsEnabled`와 `webAiCreditNewCheckoutsEnabled`를 운영자 숨은 화면
`#/admin/ai-prompt`에서 함께 선택하고 한 번의 PUT으로 원자 저장한다. 행 누락·형식 오류·D1 조회 오류는 모두 두 신규 결제 경로를 OFF로 판정한다.
조회 저장소 오류는 관리자 GET도 503으로 응답하며, 화면은 확인되지 않은 값을 ON으로 표시하지 않는다.

이 제어는 신규 웹 구독·신규 웹 AI 크레딧의 카탈로그와 checkout 진입만 차단한다. 기존 주문의 완료·대사·해지·환불에는 영향을 주지 않으며 기존 cron·webhook 처리도 계속 실행한다.
2026-09-01부터 신규 유료 결제는 Android Google Play만 사용하므로 두 값은 운영에서 항상 OFF다. 관리자 화면에서도
정책 변경 승인 없이 ON으로 바꾸지 않는다. iPhone·웹은 무료 기능을 제공하고, Android에서 얻은 프리미엄 권한은 같은
계정으로 이용할 수 있지만 신규 구매·Google Play 관리는 Android 앱에서만 진행한다.
사고가 발생하면 즉시 두 항목 모두 OFF로 원자 저장하고 readback으로 차단 상태를 확인한 뒤 원인을 조사한다.
운영 문서·명령·로그에는 인증값, 결제 토큰, 주문 토큰 또는 실제 secret 값을 남기지 않는다.

운영에는 아래 멱등 SQL을 적용하고 같은 키를 별도 조회해 두 값이 모두 `false`인지 확인한다.

```bash
cd worker
npx wrangler d1 execute hyeni-calendar --remote --file=db/android-only-payment-policy.sql
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT key,value,updated_by,updated_at FROM app_global_settings WHERE key='commerce_runtime_controls_v1';"
```

### 비활성 레거시: iPhone 홈 화면 PWA Toss 자동결제

신규 웹 구독은 운영하지 않는다. 아래 구조는 과거 주문이 발견될 때 완료·대사·해지·환불을 안전하게 처리하기 위한
레거시 보존 설명이며 활성화 절차가 아니다. `TOSS_PAYMENTS_CLIENT_KEY`·`TOSS_PAYMENTS_SECRET_KEY`를 신규로 연결하지 않고,
런타임 제어 두 값은 OFF로 유지한다. 카드번호·유효기간·CVC는 Worker로 받지 않으며, 기존에 발급된
`billingKey`만 AES-256-GCM으로 암호화한다. `WEB_BILLING_KEY_ENCRYPTION_SECRET`은 32바이트를 base64로
인코딩한 별도 secret이다. 기존 구독의 billingKey를 다시 암호화하기 전에는 이 값을 회전하면 안 된다.
`customerKey`는 사용자·가족·이메일·전화번호를 포함하지 않는 서버 난수이며 Toss가 후속 결제·조회에 같은 값을
요구하므로 운영 checkout/customer/order 행에만 원문으로 보관한다. `authKey`는 저장하지 않고 `paymentKey`와
Google Play purchase token은 비가역 해시만 저장한다. 이 식별자와 키는 로그·응답 진단에 넣지 않으며 계정 삭제 뒤
분리 보존하는 최소 금융 정본에는 `customerKey`·`billingKey` 원문을 남기지 않는다.

아래 명령은 레거시 스키마의 구조를 설명하는 역사 기록이다. Android 전용 결제 정책에서는 실행하거나 Toss secret을
추가하지 않는다. 실제 과거 주문이 발견되면 신규 결제를 계속 닫은 채 별도 승인된 복구 절차로만 처리한다.
먼저 `PRAGMA table_info`로 현재 스키마를 확인한다. 테이블이 없으면 최신 base migration만 적용하고,
기존 테이블이 존재하면 base를 다시 적용하지 않고, 누락 컬럼별 one-time 보강 migration만 적용한다.
`billing_key_revocation_status`, `web_billing_trial_claims.provider`, `web_billing_charge_attempts.refund_status`·`customer_key`는
각각 확인하며 one-time migration을 재실행하지 않는다. 환불 migration은 기존 결제 성공 주문과 활성 provider 참조를
`last_paid_order_id`로 복구하므로 Worker보다 먼저 적용한다. 금융 분리 정본 migration은 멱등이지만 역시 Worker보다 먼저 적용한다.

```bash
cd worker
npx wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_info(web_billing_customers)" -y
npx wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_info(web_billing_trial_claims)" -y
npx wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_info(web_billing_charge_attempts)" -y
# 위 결과가 비어 있을 때만 실행
npx wrangler d1 execute hyeni-calendar --remote --file=db/web-billing.sql -y
# 기존 테이블은 있고 billing_key_revocation_status가 없을 때 정확히 한 번 실행
npx wrangler d1 execute hyeni-calendar --remote --file=db/web-billing-key-revocation.sql -y
# 기존 web_billing_trial_claims는 있고 provider가 없을 때 정확히 한 번 실행
npx wrangler d1 execute hyeni-calendar --remote --file=db/google-play-family-trial-claim.sql -y
# 기존 web_billing_charge_attempts는 있고 refund_status가 없을 때 정확히 한 번 실행
npx wrangler d1 execute hyeni-calendar --remote --file=db/web-billing-refunds.sql -y
npx wrangler d1 execute hyeni-calendar --remote --file=db/web-billing-financial-retention.sql -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name IN ('billing_provider_reservations','web_billing_checkout_sessions','web_billing_customers','web_billing_charge_attempts','web_billing_refund_records','idx_web_billing_customers_key_revocation','idx_web_billing_charge_refund_reconcile','idx_web_billing_refund_provider_checked','idx_web_billing_refund_retention') ORDER BY name" -y
# 신규 적용 금지: Toss secret을 추가하거나 신규 checkout을 열지 않는다.
```

신규 앱은 `/api/billing/web/catalog`이나 checkout을 호출하지 않는다. 레거시 checkout session은 15분이며,
완료 API는 결제 응답의 order/customer/금액/KRW/DONE/BILLING을 모두 대조한 뒤에만
`family_subscription.provider=toss_web`을 활성화한다. 시간초과·5xx는 같은 order id 조회로 대조하기 전까지
권리를 열지 않는다.

`billing_provider_reservations`는 가족마다 Google Play 또는 Toss 하나만 `reserved/active`로 선점한다.
Toss 최초 주문이 `pending_charge/unknown`이면 Google verify와 RTDN은 권리·provider·기간을 덮지 않고
`billing_provider_reconciliation_pending`으로 재시도한다. 반대로 Google이 이미 활성인데 과거 Toss 주문이
결제 완료로 확인되면 Google 권리를 보존하고 상태를 `conflict`, `resolution_status=refund_required`로 격리한다.
이 경우 운영자는 `conflict_ref`의 충돌 결제사 order id(없을 때만 비가역 token hash)로 결제사 콘솔에서
환불을 완료한다. 해당 Toss 전액 환불이 서버 재조회로 확인되면 정확히 일치하는 충돌만 Google 활성 상태로 복구한다.
충돌 행을 자동으로 다른 provider에 넘기거나 다시 청구하지 않는다. 조회·조사 중에도 purchase token,
authKey, customerKey, billingKey, paymentKey, 카드정보를 출력하지 않는다.

Toss 개발자센터에는 `PAYMENT_STATUS_CHANGED` 웹훅 URL로
`https://hyeni-calendar-api.tkisdroid.workers.dev/api/billing/web/subscription/webhook`을 등록한다. 웹훅 본문은
서명 정본으로 신뢰하지 않고 알려진 order id만 힌트로 사용해 Toss 주문 조회 API로 상태·금액·통화·결제 타입·결제키 해시와
취소 합계를 다시 검증한다. 전액 환불은 현재 그 주문이 연 권리만 즉시 회수하고, 부분 환불은 현재 기간 권리는 유지하면서
추가 자동청구를 중지한다. 더 최신 주문의 권리는 과거 주문 환불로 회수하지 않는다.
같은 이벤트를 구독하는 AI 크레딧 endpoint의 주문이나 알 수 없는 이벤트는 결제사 재전송 폭주를 막기 위해 200으로 ACK하고,
이 endpoint가 소유한 주문의 결제사 조회·DB·삭제 lease가 일시 실패한 경우만 429/503으로 재시도를 요청한다.

매시 유지보수는 `0,5,10,15,20,25,30,35,40,45,50,55 * * * *` 열두 슬롯으로 나뉜다. 10분 슬롯은 웹 최초 결제,
20분 슬롯은 갱신을 각각 한 건 복구한다. 5·15·25·35·45·55분은 웹훅 누락 환불을 전역 FIFO로 한 건씩 처리해
하루 최대 144건을 대사한다. 실패한 환불 funnel 기록은 30분 슬롯의 별도 fail-soft 작업에서 재시도해 결제 정본 대사를
막지 않는다. 결제 복구 경로는 원격 billingKey 폐기 대상을
먼저 복구하고 D1 호출당 50-query 상한을 넘지 않는다. 해지 예약은 결제한 기간 말까지 권리를 유지하되 `next_charge_at`을
즉시 제거해 이후 청구를 막는다. 암호화 billingKey는 Toss 원격 DELETE가 200 또는 404로 확인된 뒤에만
로컬에서 제거한다. 실패하면 새 청구에 사용하지 않은 채 15분→1시간→6시간→24시간, 이후 24시간 간격으로
재시도하며 계정 삭제도 원격 폐기가 끝날 때까지 fail-closed한다. 결제·reconcile 오류를 조사할 때도 authKey,
customerKey, billingKey, paymentKey, 카드정보는 로그로 출력하지 않는다.

환불 migration·배포·코드 전용 롤백·집계 모니터링의 실행 정본은
`ops/web-billing-refund-runbook.md`이며, 읽기 전용 운영 쿼리는
`ops/web-billing-refund-monitor.sql`이다. 코드 롤백 때 D1 additive migration과 5년 금융 정본은 되돌리지 않는다.

### 비활성 레거시: iPhone 홈 화면 PWA Toss AI 크레딧 일회성 결제

신규 AI 크레딧 구매는 Android Google Play만 사용한다. iPhone·웹은 무료 제공량만 사용하며 Toss 가격 환경값과
결제 secret을 새로 설정하지 않는다. 아래 내용은 과거 주문 복구 코드의 데이터 안전 계약을 보존하기 위한 역사 기록이다.

운영 적용은 AI balance 복합 unique를 먼저 보장한 다음 일회성 주문 정본을 만들고 Worker를 배포한다.
`PRAGMA table_info` 결과가 비어 있으면 최신 base migration만 적용하고, 기존 주문 테이블은 있지만
`record_scope`가 없을 때만 금융 보존 보강 migration을 정확히 한 번 적용한다. 두 migration을 같은 DB에
연속 실행하거나 보강 migration을 재실행하지 않는다. 가격을 아직 승인하지 않은 팩의 환경값은 만들지 않는다.
명령은 값을 인자로 남기지 않고 대화형 입력으로만 받는다.

```bash
cd worker
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ai_credit_balances_family_child_unique'" -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT COUNT(*) AS duplicate_groups FROM (SELECT 1 FROM ai_credit_balances GROUP BY family_id,child_user_id HAVING COUNT(*)>1)" -y
npx wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_info(web_ai_credit_orders)" -y
# 위 결과가 비어 있을 때만 실행
npx wrangler d1 execute hyeni-calendar --remote --file=db/web-ai-credit-billing.sql -y
# 기존 테이블은 있고 record_scope가 없을 때는 위 base 대신 정확히 한 번 실행
npx wrangler d1 execute hyeni-calendar --remote --file=db/web-ai-credit-financial-retention.sql -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name IN ('web_ai_credit_orders','web_ai_credit_detached_balances','idx_web_ai_credit_payment_hash','idx_web_ai_credit_family_parent','idx_web_ai_credit_reconcile','idx_web_ai_credit_detached_reconcile','idx_web_ai_credit_detached_balance_retention') ORDER BY name" -y
# 신규 적용 금지: Toss 가격 환경값이나 secret을 추가하지 않는다.
```

신규 앱은 `GET /api/billing/web/ai-credits/catalog`이나 checkout을 호출하지 않는다. 레거시 checkout 응답 금액은 주문 생성 시 스냅샷되므로 이후 환경 가격이 바뀌어도 기존 주문에는
최초 금액이 유지된다. 클라이언트가 보낸 금액·통화는 정본으로 사용하지 않는다.

Toss 개발자센터에는 `PAYMENT_STATUS_CHANGED` 웹훅 URL로
`https://hyeni-calendar-api.tkisdroid.workers.dev/api/billing/web/ai-credits/webhook`을 등록한다. 일반 결제 웹훅
본문은 서명 정본으로 신뢰하지 않으며 64KiB streaming 상한 뒤 알려진 난수 orderId만 꺼내 Toss 주문 조회 API로
주문번호·원금·KRW·타입·상태를 다시 확인한다. Toss 일반결제 Payment 응답에는 customerKey가 없으므로
요청에만 사용한 customerKey를 응답 필드처럼 가정하지 않는다. 승인·웹훅·cron 재시도는 결정적 주문·원장 id와 claim으로
중복 지급을 막고 paymentKey 원문은 저장하지 않으며 SHA-256 도메인 분리 해시만 저장한다.
구독 endpoint의 주문이나 알 수 없는 이벤트는 200으로 ACK하고, 이 endpoint가 소유한 주문의 결제사 조회가 일시 실패한
경우만 429/503으로 재시도를 요청한다. 부분 환불을 `refund_unknown`으로 안전 격리한 응답은 처리 완료이므로 200으로 ACK한다.

전액 환불(`CANCELED`, `balanceAmount=0`)이 결제사 조회로 확인되면 `-30/-80/-200` 환불 원장을 정확히 한 번
기록한다. 이미 사용한 크레딧도 0으로 자르지 않고 음수 구매 잔액으로 회수해 다음 충전분이 먼저 상계한다.
부분 환불은 임의 비례 차감하지 않고 `refund_unknown`으로 격리해 주문번호로 실제 내역을 확인한다. 30분·50분 슬롯은
각각 승인 미확정·환불 대기·완료 후 90일 이내 fallback 후보를 한 건씩 대사한다. 완료 주문은 첫 7일에는 매일,
이후 90일까지 7일 간격으로만 보조 조회하고 그 뒤에는 웹훅을 정본으로 사용해 5년 보관 행이 backlog를 만들지 않게 한다.
미승인·실패 주문은 30일 뒤, 승인·전액 환불 주문 정본은 고정 1825일이 아니라 UTC 달력 기준 정확히 5년 뒤 삭제한다.
`unknown`·`refund_unknown` 금융 상태는 자동 삭제하지 않는다.
계정·가족·자녀 관계 삭제 시 결제 원문 대신 주문의 최소 금융 스냅샷과 signed 구매 잔액만 운영 데이터에서
분리한다. 분리 잔액은 새 계정이나 재페어링 대상에 자동 합치지 않으며, 환불 대사가 끝날 때까지 같은
가족·자녀 범위의 신규 웹 크레딧 결제를 fail-closed한다.

운영 readback은 원문 키 없이 집계만 확인한다.

```bash
cd worker
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT status,COUNT(*) AS n,COALESCE(SUM(credits),0) AS credits FROM web_ai_credit_orders GROUP BY status ORDER BY status" -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT COUNT(*) AS raw_key_columns FROM pragma_table_info('web_ai_credit_orders') WHERE name IN ('payment_key','paymentKey')" -y
```

### 친구 초대 AI 크레딧 보상 migration-first 배포

추천 보상은 Free/Premium 구독권이 아니라 초대한 가족과 초대받은 신규 가족에 각각 AI 대화 50회를 한 번 지급한다.
초대 가족 수 상한은 없다. 본인·공동 보호자·기존 가족·중복 귀속과 그 밖의 부정 이용은 서버에서 차단한다.
신규 가족 생성 후 72시간이 지나고 첫 실제 위치가 저장된 뒤 48시간 유지된 경우만 서버 cron이 두 가족의
account mutation lease를 정렬 획득해 원장·잔액·완료 상태를 한 batch로 확정한다. 클라이언트 지급 endpoint는 없다.

```bash
cd worker
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ai_credit_balances_family_child_unique'" -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT COUNT(*) AS duplicate_groups FROM (SELECT 1 FROM ai_credit_balances GROUP BY family_id,child_user_id HAVING COUNT(*)>1)" -y
npx wrangler d1 execute hyeni-calendar --remote --file=db/referral-rewards-v2.sql -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT type,name FROM sqlite_master WHERE name IN ('referral_codes_v2','referral_completions_v2','idx_referral_completions_v2_pending','idx_referral_completions_v2_ready','trg_referral_location_evidence_snapshot') ORDER BY type,name" -y
# 통합 출시에서는 여기서 배포하지 않는다. 7단계 전체 readback 뒤 Worker를 한 번만 배포한다.
```

추천 코드는 주 보호자만 발급하고, `HYENI-` 뒤 80비트 난수 Crockford 문자열을 사용한다. `/api/family/setup`은
정확한 코드 키만 받으며 가족 생성 batch 안에서 귀속을 고정한다. 실제 위치 수집 trigger는 추천 완료 행에 첫 실측과
48시간 충족 경계만 요약하고 중간 fix는 쓰지 않는다. 시간당 유지보수의 40분 슬롯은 원본 확인자료를 다시 훑지 않고
요약 후보 1건을 최대 28 D1 statements로 처리하며, 위치 좌표·주소·자녀 이름은 추천 테이블이나 응답에 저장하지 않는다.

### Google Play RTDN migration-first 배포

RTDN Worker는 `google_play_rtdn_events.claim_token`, owner binding, 일회성 상품 환불용
`google_play_voided_purchase_events`가 이미 존재한다고 가정한다. voided AI 크레딧은 purchase-token hash로만
멱등 처리하고 이미 사용한 크레딧도 음수 구매 잔액으로 회수해 다음 구매 전에 먼저 상환한다. 새 구매 이벤트의
`debt_applied`는 상계 횟수와 실제 사용 가능 증가량을 결제 완료 화면에 정확히 표시하기 위한 정본이다.
또한 Google/Toss 교차 결제 방지를 위해 `billing_provider_reservations`가 필수다. 통합 출시에서는 위 웹 결제
base를 다시 실행하지 않고 출시 체크리스트 manifest 4단계의 신규/기존 분기와 전체 readback이 완료됐는지 확인한다.
실제 secret 값은 저장소 파일이나 명령 기록에 남기지 않는다.

```bash
cd worker
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='billing_provider_reservations'" -y
npx wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_info(web_billing_trial_claims)" -y
npx wrangler d1 execute hyeni-calendar --remote --file=db/google-play-rtdn-schema.sql -y
# 아래 readback에 debt_applied가 없을 때만 정확히 한 번 실행
npx wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_info(google_play_purchase_events)" -y
npx wrangler d1 execute hyeni-calendar --remote --file=db/google-play-credit-debt-disclosure.sql -y
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT type,name FROM sqlite_master WHERE name IN ('google_play_rtdn_events','google_play_billing_owners','google_play_voided_purchase_events','idx_google_play_voided_purchase_hash') ORDER BY type,name" -y
npx wrangler secret put GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
npx wrangler secret put GOOGLE_PLAY_RTDN_AUDIENCE
npx wrangler secret put GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL
# 선택 설정. 미설정 기본값은 com.hyeni.calendar
npx wrangler secret put GOOGLE_PLAY_PACKAGE_NAME
# 통합 출시에서는 여기서 배포하지 않는다. 7단계 전체 readback 뒤 Worker를 한 번만 배포한다.
```

Pub/Sub push endpoint는 `/api/billing/google-play-rtdn`이며 OIDC audience는 실제 HTTPS endpoint와 완전히
일치해야 한다. migration 또는 필수 secret이 없으면 fail-closed 503이 정상이다.

```bash
# 1) 의존성 (이미 설치됨: hono jose bcryptjs wrangler typescript @cloudflare/workers-types)
npm install

# 2) JWT 키 생성 → worker/.dev.vars  (gitignore됨, 세션마다 재생성 필요)
cd worker
node --input-type=module -e "import {generateKeyPair,exportJWK} from 'jose'; const {publicKey,privateKey}=await generateKeyPair('ES256',{extractable:true}); const fs=await import('fs'); fs.writeFileSync('.dev.vars','JWT_PRIVATE_KEY='+JSON.stringify(await exportJWK(privateKey))+'\nJWT_PUBLIC_KEY='+JSON.stringify(await exportJWK(publicKey))+'\n');"

# 3) 로컬 D1에 데이터 적재 (.wrangler/state는 gitignore → 재적재 필요)
npx wrangler d1 execute hyeni-calendar --local --file=../backups/20260624_232621/d1/d1_import_no_location.sql -y
npx wrangler d1 execute hyeni-calendar --local --file=../backups/20260624_232621/d1/auth_import.sql -y
# 3b) P3 전화 OTP 브리지 테이블 (이관 데이터에 없는 신규 테이블 → 별도 생성)
npx wrangler d1 execute hyeni-calendar --local --file=db/phone-otp-schema.sql -y

# 4) (검증용) 테스트 계정 비번 설정 — 로컬 D1만
HASH=$(node --input-type=module -e "import bcrypt from 'bcryptjs'; process.stdout.write(bcrypt.hashSync('test1234',10));")
npx wrangler d1 execute hyeni-calendar --local --command "UPDATE users SET encrypted_password='$HASH' WHERE id IN (SELECT u.id FROM user_profiles up JOIN users u ON u.phone=REPLACE(up.phone,'+','') WHERE up.login_id='tkisdroid')"

# 5) dev 구동 (로컬 D1, --remote는 토큰에 Workers 권한 없어 불가)
npx wrangler dev --local --port 8787
```

> `backups/`는 PII로 gitignore됨. 백업 원본(`data.sql`)이 있어야 D1/auth import SQL을 재생성할 수 있다(`cloudflare/make_d1_sql.py`, `cloudflare/migrate_auth.py`).

## 검증 (M1+M2)

```bash
BASE=http://127.0.0.1:8787
curl -s $BASE/api/health                                    # {"ok":true,"events":194}
LOGIN=$(curl -s -X POST $BASE/auth/login-password -H "Content-Type: application/json" -d '{"loginId":"tkisdroid","password":"test1234"}')
TOKEN=$(echo "$LOGIN" | python -c "import sys,json;print(json.load(sys.stdin)['session']['access_token'])")
FAMILY=$(echo "$LOGIN" | python -c "import sys,json;print(json.load(sys.stdin)['user']['family_id'])")
H="Authorization: Bearer $TOKEN"
curl -s "$BASE/api/events?family_id=$FAMILY&limit=5" -H "$H"                 # 일정 배열
# M2 read API (전부 200, 본인 가족만 — 타 family_id 는 403)
curl -s "$BASE/api/academies?family_id=$FAMILY" -H "$H"                      # 학원(location/schedule 객체화)
curl -s "$BASE/api/saved-places?family_id=$FAMILY" -H "$H"                   # 장소(is_home boolean)
curl -s "$BASE/api/stickers/summary?family_id=$FAMILY" -H "$H"               # user별 집계
curl -s "$BASE/api/parent-alerts?family_id=$FAMILY&limit=5" -H "$H"          # read 사용자별 계산
curl -s "$BASE/api/location/children?family_id=$FAMILY" -H "$H"              # 자녀 최신 위치
curl -s "$BASE/api/teacher/me" -H "$H"                                       # 선생님이면 uuid, 아니면 null
```

> M2 클라 시임: `src/lib/sync.js` fetch\* 15종 + `src/lib/teacherApi.js` read 10종이 `VITE_API_BASE` 설정 시 Worker 경유. 미설정 시 Supabase 유지(시그니처 불변).

## 클라 연동

`src/lib/api/client.js` — `VITE_API_BASE` 환경변수 설정 시 Worker 경유, 미설정 시 기존 Supabase 경로 유지.
현재 시임 적용: `sync.js fetchEvents`, `accountAuth.js signInWithLoginId`. 시그니처는 불변이라 컴포넌트 무수정.

## 컷오버 원칙

Supabase가 권위 백엔드. Worker는 M0~M5 점진 구축·검증(로컬 D1). M6에서 force-upgrade + freeze 후 플립. 병행 기간 split-brain 회피를 위해 원격 D1·실데이터는 컷오버 전까지 쓰기 권위를 갖지 않는다.

## M4 진행 현황 (2026-06-28 세션)

**완료·커밋·로컬 검증됨**:
- ✅ **로컬 D1 full 적재**: `location_history` 95,071행 포함(`node:sqlite` 직접 적재 — `wrangler d1 execute --file` 은 95k INSERT 에 10분+ 0행이라 폐기). 적재 스크립트 패턴: `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite` 에 `DatabaseSync` + 단일 트랜잭션(268ms).
- ✅ **timestamp 비교 버그 수정**: D1 timestamp 는 `'YYYY-MM-DD HH:MM:SS.ffffff+00'`(공백·+00), 클라는 ISO(`T..Z`) → raw 비교 시 `' '(0x20)` vs `'T'(0x54)` 로 정렬이 깨져 **incidents 가 항상 0건** 반환하던 버그. `substr(col,1,19)` + (KST 경계는) `datetime(?)` 정규화로 해결. 영향: `location.ts` incidents/history, `ai.ts` day-summary 신호수집.
- ✅ **M4-C**: kakao-proxy → `/api/kakao/walking-directions`, feedback-email → `/api/feedback`, delete-account → `/api/account/delete`(introspection 멱등 batch — 격리 가족 PASS, 실데이터 무영향 검증).
- ✅ **location/history 실구현**(stub→실쿼리, 307 points 검증).
- ✅ **M4-A 3/5**: ai-voice-parse·ai-day-summary(캐시·premium·KST·upsert 검증)·ai-child-monitor(멤버십·validation 검증) → `/api/ai/*`. `worker/shared/`(=`_shared` plain JS 정책) + `tsconfig allowJs`. `worker/lib/time.ts` pgNow/tsNorm.

**✅ 추가 완료 (이어서, 커밋 ~5af4388)**:
- ✅ **M4-A 5/5**: +ai-proactive-generate·ai-child-chat (크레딧 멱등성 = consumeAiCredit balancePatch/ledgerEntry 그대로 + ai_credit_ledger transaction_id select-then-insert. ai_parent_settings 0/1→toBool 함정).
- ✅ **M4-B cron 5종**: `worker/cron/*.ts` + `index.ts scheduled()` event.cron 분기 + `wrangler.toml [triggers] crons`. `_deliver.ts`=push-notify 핸들러 직접 재사용. `lib/time.ts pgToIso/pgToMs`. --test-scheduled 5 cron 200.
- ✅ **M5 push-notify**: FCM v1(jose RS256+OAuth2캐시 `lib/fcm.ts`)+VAPID(`lib/webpush.ts` 미검증)+action전부+멱등. **실기기(A17) 푸시 검증**: hyeni-calendar 서비스계정(496213은 권한없음 403 자율확정) → fcmSent1 + 알림트레이. `scripts/fcm-test.mjs`.
- ✅ **M5 나머지 6종**: merge-oauth·subscription-reconcile·qonversion-webhook·google-play-verify·send-sms·naver-auth → `/api/account·subscription·billing·sms·auth/*`. 인증게이트+키없음 graceful. **naver-auth 세션모델 magiclink→ES256**(isApiEnabled 분기·Naver콘솔 콜백URL 운영 미수행).
- ✅ **P0-b OAuth(kakao/google)**: `routes/oauth.ts` — naver-auth 패턴 직역. 3 엔드포인트 `/api/auth/oauth/:provider/{start,callback}`+`POST`. 원본 supabase 빌트인 signInWithOAuth(Supabase `/auth/v1/callback`이 code교환+user생성 대행)을 Worker 가 직접 수행: code→token→userinfo→D1 `auth_identities`(provider,provider_id) 매칭(merge-oauth 이전 identity 우선)·생성→ES256 세션. **client_id 시크릿 은닉**=클라가 authorize URL 안 만들고 Worker `/start`가 302(kakao REST key 번들 비노출 정책). 응답 user 에 app_metadata.provider/phone/user_metadata 실어 `getOAuthUserNeedsBridge` 동작. 클라 `kakaoLogin`/`googleLogin` isApiEnabled 분기(else=supabase 보존)+`finishOAuthLogin`(applyApiSession+setApiUser)+App.jsx 콜백 분기(native handleNativeAuthCallback·web effect, `handleAuthUserRef`로 즉시 handleAuthUser). **시크릿**: kakao=`KAKAO_REST_API_KEY`(기존, kakao-proxy 재사용)+선택 `KAKAO_CLIENT_SECRET`. **google=미설정→503 graceful**(`GOOGLE_OAUTH_CLIENT_ID/SECRET` 추가 필요). **콘솔 redirect_uri 등록=사용자 후속**(`{WORKER}/api/auth/oauth/{kakao|google}/callback`). 실 로그인은 컷오버 후 실기기.
- ✅ **실기기 종단**: 앱 WebView(`https://localhost`)→Worker login→events/children/places 200 (CORS+cleartext+adb reverse). `scripts/cdp-worker-verify.mjs`. **함정: `.env.local VITE_API_BASE`가 vitest 오염→`.env.test.local`로 빈값 override**.

**🔜 남은 작업 (다음 진입점)**:
- 🔄 **네이티브 Android shim**(위임중): Worker PostgREST 호환 — `/rest/v1/rpc/:fn`(RPC9: upsert_child_location·record_location_history_rows·get_pending_notifications_for_device·mark_notifications_delivered·get_today_events·upsert_fcm_token·record_child_shutdown·force_ring_acknowledge·insert_parent_alert_v2)·`/rest/v1/:table`(family_members·force_ring_events·family_subscription·families·saved_places·academies·fcm_tokens·locations)·`/functions/v1/`별칭·`/realtime/v1/api/broadcast`→DO. 네이티브 Java(`android/.../LocationService.java` 등)는 base URL 교체만. 호출 전수=grep `/rest/v1|/functions/v1|/realtime` in `android/app/src/main/java`.
- ⬜ **M6 컷오버**: force-upgrade(클라 미구현→신규 게이트)·freeze+최종 재동기·`VITE_API_BASE` prod 플립·Worker prod 배포(Cloudflare, `SUPABASE_ACCESS_TOKEN` 패턴과 별개로 Cloudflare 토큰 필요, **🔴 cfat 평문노출 revoke**). **prod 영향 신중·split-brain 회피·사용자 결정**.
- ⬜ **task #35**: write `new Date().toISOString()`→`pgNow()` 통일(컷오버 전, 병행기 무해. optimistic lock=read-then-compare라 형식 무관 확인됨, 정렬 일관성만).

**로컬 셋업(세션마다)**: `.dev.vars` JWT 키 + node:sqlite 로 full d1_import + auth_import 적재 + 테스트계정 비번(login_id='tkisdroid' → bcrypt 'test1234', family `f9a75cb4`/premium active, 자녀 `1183d463`). 상세는 아래 "로컬 개발 셋업".

---

## M4 원래 범위 메모

**범위**: Edge Functions 포팅 + pg_cron 11잡 → Cron Triggers. `push-notify`·결제·SMS·OAuth 는 M5 보류.

- **cron 함수군** (서버 스케줄, 클라 호출 없음 → `scheduled()` + `wrangler.toml [triggers] crons`):
  `registered-place-geofence-check`·`danger-zone-geofence-check`·`unregistered-stay-check`·`location-staleness-check`·`teacher-notification-batch`.
  재사용: `supabase/functions/_shared/{registeredPlaceGeofence,dangerZoneGeofence,unregisteredStay,locationStaleness,dwellCluster,staleReason}.js` (plain JS).
  단, 이 함수들은 `location_history`/`child_locations` 를 읽는데 **location_history 는 D1 미이관**(M5) — geofence/staleness 는 M5 위치 데이터 복원과 의존성 확인 필요.
- **AI 함수군** (클라 직접 호출): `ai-child-chat`(1556)·`ai-proactive-generate`(737)·`ai-child-monitor`·`ai-day-summary`·`ai-voice-parse`.
  재사용: `_shared/ai*.js` 정책(크레딧·안전·도구). 생성 모델은 OpenAI `gpt-5.6-luna`이고 키는 Workers Secret이다. 크레딧 차감 `ai_chat_settings`/`ai_credits` 멱등성 주의.
- **기타**: `delete-account`(purge_family_data RPC)·`feedback-email`·`kakao-proxy`(reverse geocode).

**M5 보류(제외)**: push-notify(2392)·google-play-purchase-verify·qonversion-webhook·subscription-reconcile·send-sms·naver-auth·merge-oauth-into-phone.

cron 정의 원본: `supabase/migrations/*cron*.sql` (force_ring·friend_playdate·push_notify·ai_proactive·location_staleness 등). 클라 시임: Edge Function 호출부(`supabase.functions.invoke`/fetch) → `apiClient`.

전체 로드맵·M4 상세: `~/.claude/plans/cheerful-bouncing-hopper.md`. 진행: M0~M3 ✅ (이 README 상단 진행 상황 참조).

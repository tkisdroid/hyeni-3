# 기능별 운영 계약

이 문서는 2026-09-12에 자동 지침에서 분리한 작업별 참고 자료입니다. 관련 항목만 찾아 읽으세요.
날짜가 붙은 배포·기기·자격 상태는 당시 관측이며, 현재 상태는 해당 작업에서 확인합니다.
작업 범위와 승인·완료 기준은 루트 `AGENTS.md`와 현재 사용자 요청을 따릅니다.

## 아키텍처 핵심 (어기면 다자녀에서 데이터가 섞인다)

- **해외 가족 시간대 정본(2026-09-14)**: `families.time_zone`은 주 보호자가 국가와 함께 확정한 IANA 시간대다.
  접속 국가·브라우저 언어·여행 위치로 자동 변경하지 않는다. 기존 가족은 `Asia/Seoul`을 보존한다.
  일정·도착 판정·오전 8시 무료 위치 경계·retention·업로드 날짜 quota는 가족 시간대로 계산하고 저장 timestamp는 UTC다.
  `shared/timeZone.ts`는 DST 누락 시각을 전환 간격 뒤로, 중복 시각을 첫 발생으로 결정한다.
  `notification_settings.time_zone`은 별개 수신자 설정이며 NULL이면 가족 시간대를 상속한다. SOS/긴급 bypass는 유지한다.
  Android는 인증된 동일 사용자/가족의 정본을 캐시하며 조회 실패를 서울 시간대로 추정하지 않는다.
  운영 migration은 `global-family-time-zone.sql` → `global-location-ingest-time-zone.sql` → Worker 순서다.
  두 migration의 적용 여부를 PRAGMA/trigger로 먼저 확인하고 중복 실행하지 않는다.
  `ingest_date_key`는 서버가 확정하며 구버전 INSERT는 nullable 컬럼+기존 한국 날짜 trigger 폴백으로 호환한다.
  248개국 지도 활성과 해외 전체 출시는 별개다. [현재 출시 게이트](../operations/google-maps-release-readiness.md)를 확인한다.
- **Worker 운영 보존·출시 게이트(2026-08-31, 구현·로컬 검증 완료/운영 미적용)**:
  만료 `pending_notifications`는 `expires_at` 뒤 24시간 grace를 둔 뒤 hourly 40분 slot에서 한 번에 최대 5,000행만
  멱등 삭제한다. 혼재 timestamp(`T`/공백)를 같은 기준으로 비교하는 expression index 정본은
  `worker/db/pending-notification-retention.sql`이며 **Worker 배포 전에 운영 D1에 적용·readback**해야 한다.
  계정 삭제 cleanup은 24시간 지난 completed tombstone과 함께, owner `users` 행이 이미 없어진 24시간 초과
  `claimed` job·scope만 회수하고 살아 있는 owner의 claim은 보존한다. SOS 감사의 `receiver_user_ids`는 요청 body를
  신뢰하지 않고 서버가 해당 가족의 활성 부모와 가족 주보호자 목록으로 정본화한다. 출시 전
  `npm run verify:production:worker-secrets`가 Wrangler inventory의 필수 Secret 이름 10개를 값 없이 검사하며 누락은
  Worker 배포 `HOLD`다. 값 입력은 운영자가 `wrangler secret put` 대화형 입력으로만 수행한다. 피드백
  `status='queued'`는 D1 내구 접수일 뿐 자동 이메일 재시도 약속이 아니므로 운영자가 직접 처리한다.
  회귀=`worker/tests/pendingNotificationRetention.test.mjs`·`worker/tests/accountDeletionCompleteness.test.mjs`·
  `worker/tests/operationalRouteCoverage.test.mjs`·`tests/productionWorkerSecretGate.test.mjs`.
- **아이 정보 저장 계약(2026-08-31)**: `ProfileEdit`는 전화번호가 비면 공개 API에 `phone:null`을 보내
  "지움"을 표현하지만, D1 `family_members.phone`은 `TEXT NOT NULL DEFAULT ''`이다. Worker
  `POST /api/family/member/profile`는 이 `null`을 빈 문자열로 변환해 저장해야 하며 D1에 그대로 bind하면 이름·생일을
  포함한 UPDATE 전체가 제약조건 오류로 롤백되어 500이 난다. 프로필과 사진 mutation의 오류 안내는 화면이
  `localizeApiError`로 직접 책임지므로 두 hook 모두 `meta:{silentError:true}`를 유지해 전역 MutationCache의
  "방금 작업이 저장되지 않았어요"와 중복시키지 않는다. 전화번호 아래 기기 유무 설명 문구는 표시하지 않는다.
  회귀=`worker/tests/familyMemberProfile.test.mjs`·`tests/profileEditFailureUx.test.mjs`.
- **등록장소 알림 사건 시각·TTL 계약(2026-08-31)**: 부모가 알림을 받은 시각을 새 geofence 전이 시각으로 단정하지 않는다.
  `parent_alerts.created_at`(사건 생성)과 대상별 `pending_notifications.created_at`·`delivered_at`(기기 표시 ACK),
  `child_place_presence` phase/이탈 시각을 함께 대조한다. 과거 `place_arrived|place_left` pending TTL이 2시간이라
  FCM 표시 ACK가 없으면 잠금 해제·foreground 복구가 오래된 도착을 현재 알림처럼 다시 표시할 수 있었다. 2026-08-31
  실측은 학교 진입 08:39·알림 생성 08:40, phase=`in`·추가 전이 0건인데 pending이 10:25에 ACK된 지연 전달이었다.
  이제 네이티브는 geofence `episodeMs`를 `occurred_at`으로 보내고 cron은 `step.episodeMs`를 전달한다. Worker는
  `오전 8:39에 아이가 학교에 도착했어요.`처럼 실제 사건 시각을 문구에 넣고, pending `expires_at`과 FCM/Web Push
  payload `expiresAt`을 그 사건부터 30분으로 맞춘다(FCM transport 120초는 유지). 30분 지난 재시도는 이력만 남기고 새 표시 단위를 만들지 않는다. 사건 시각이 없는
  구버전 앱은 서버 접수 시각으로 보완한다. 이 계약은 `place_arrived|place_left`만 대상이며 일정 도착·위험구역·
  미도착·SOS·긴급·리마인더 TTL은 유지한다. 회귀=`worker/tests/registeredPlaceAlertOccurrence.test.mjs`·
  `worker/tests/notificationQuietHoursWiring.test.mjs`·Android `RegisteredPlaceAlertPayloadTest`.
- **인증 진입점 정본(2026-08-21)**: 첫 부모 화면은 로그인/회원가입 탭을 명시 분리하며 전화 가입과 소셜 가입을
  같은 "로그인" 버튼으로 섞지 않는다. ID 확인 네트워크/응답 오류를 `중복 아이디`로 표시하지 않고, 잘못된 비밀번호는
  세션을 만들지 않은 채 ID·비밀번호를 유지하고 비밀번호 필드로 포커스를 돌려 즉시 재시도시킨다. ID는 Worker와 D1
  UNIQUE 모두 `LOWER(TRIM(login_id))` 기준이고 인증 응답은 `no-store`다. 가입은 입력·device id·전화/ID 중복 확인 뒤
  OTP를 검증하고 user/identity/profile/OTP 소비를 한 batch로 확정한다. 운영은 익명 중복 그룹 4종=0 확인 →
  `worker/db/auth-entry-uniqueness.sql` → Worker 순서다. Pages OAuth 복귀는 `_redirects` rewrite가 아니라 build의
  `scripts/write-oauth-callback-entry.mjs`가 생성하는 물리 `/oauth/callback.html`이 정본이다. 중첩 경로에서 자원과
  Service Worker가 `/oauth/*`로 잘못 해석되지 않도록 루트 asset URL과 `<base href="/">`를 유지한다. 웹 OAuth 시작은
  반드시 절대 Worker API의 `POST /api/auth/oauth/{provider}/start`와 서버 생성 state/transaction을 사용하며, 같은 origin
  GET을 만들지 않는다. `hyenicalendar.com` apex의 배포 정본은 Vercel이 아니라 Proxied CNAME으로 연결된
  `hyeni-calendar.pages.dev` Pages custom domain이다. Worker CORS/OAuth origin은 정확한 apex·`www`·Pages origin만
  허용하고 경로/접미사 lookalike는 거부하며, Android OAuth callback은 계속 Pages App Link를 사용한다. 웹 PWA 문서
  탐색은 `src/sw.ts`에서 **network-first(`cache:no-store`) → 실패 시 precache `index.html`** 순서다. 이를 cache-first로
  되돌리면 브랜드 도메인의 구형 SW/문서가 로그인 뒤 정적 "가족 일정을 불러오는 중" 셸에 다시 가둘 수 있다.
  구형 SW가 이미 제어해 새 entry 자체를 못 받는 브라우저의 1회 복구 주소는
  `https://hyenicalendar.com/?hy-recover=20260821`이며, 현재 문서가 열린 같은 탭에서 로그인을 완료해 새 SW 활성화까지
  이어간다. 회귀=`tests/pwaNavigationFreshness.test.ts` + `npm run qa:pwa-runtime`의
  `onlineNavigationFreshness`·`offlineReload` + `npm run qa:browser`의 `focused.successfulLogin`이다.
- **접속 국가·온보딩 UI 정본(2026-08-22)**: 저장된 언어가 없는 첫 접속만 Worker 공개
  `GET /api/access-region`의 Cloudflare edge country를 기본 언어와 소셜 제공자에 반영한다. 이 route는 인증·GPS·D1 없이
  `request.cf.country`의 2글자 값만 `private, no-store`로 반환하고 IP·세부 위치를 저장/로그하지 않는다. 국가 응답보다
  브라우저 힌트를 먼저 쓸 수 있지만, 사용자가 직접 고른 언어는 비동기 국가 응답으로 절대 덮지 않는다. 첫 역할 화면은
  하단에서 현재 언어 1개만 표시하고 나머지 9개를 펼친다. 한국(`KR`)·판별 불가(`ZZ`)는 Kakao+Google(+설정 시 Naver),
  다른 국가는 Google만 표시한다. 첫 화면 좌우 24px, 이후 온보딩은 좌우 16px·safe-area 뒤 상단 16px이며 수평 overflow와
  좌우 slide 전환을 금지한다. QR 스캔은 엔진 지원 확인 뒤 권한을 요청하고, 임시 거부=재요청·Android 영구 거부=설정 이동
  후 복귀 자동 재확인·모든 오류=수동 코드 입력으로 복구한다. `아이로 시작`은 기존 인증 세션 보호 가드를 먼저 통과한 뒤
  기기 컨텍스트·네이티브 세션 복구·익명 로그인을 기다리지 않고 아이 연결 화면을 즉시 열며, 준비 중에는 코드 제출만 막는다.
  준비 중 뒤로가기는 잠그고 준비 실패는 역할 화면으로 돌아가 재시도시킨다. 회귀=`tests/onboardingChildStartResponsiveness.test.mjs`.
- **부모 iPhone·아이 Android 정본 토폴로지(2026-07-31)**: 최종 기능 검증의 기본 조합은
  **부모=iPhone 홈 화면 PWA, 아이=Android 네이티브 앱**이다. 위치 즉시 요청·기기 상태·소리 울리기·주변 소리·
  메시지·장소/알림 설정은 부모 기기의 Capacitor 여부로 막지 않고 Worker API→FCM→아이 Android 경로를 사용한다.
  주변 소리는 아이 캡처만 Android 네이티브이며 부모 제어·WebSocket 수신·재생은 PWA 공용이다. iPhone 오디오는
  사용자 탭 안에서 AudioContext를 먼저 연다. iPhone 웹 푸시 권한도 첫 비동기 작업보다 먼저 사용자 탭에서 요청하고
  active Service Worker가 확인된 뒤에만 구독하며, 미지원 Safari 탭에는 홈 화면 추가 방법을 안내한다.
  PWA Service Worker는 `includeAssets`·manifest 아이콘과 Workbox glob URL이 겹치지 않아야 하며,
  `scripts/verify-route-bundle.mjs`가 precache URL 중복을 빌드 실패로 차단한다.
  위치 설정은 부모 iPhone 권한을 요청하지 않고 활성 아이의 `device_health`를 표시한다. Android OS 권한·배터리
  예외는 원격 부여할 수 없으므로 아이 기기에서 1회 허용해야 한다는 한계를 숨기지 않는다. Google Play 결제·
  소셜 계정 연결처럼 실제 네이티브 부모 앱이 필요한 항목은 자녀 원격제어 성공으로 위장하지 않고 별도 한계로 보고한다.
- **전역 활성 아이 스위치**: `src/app/activeChild.tsx` `useActiveChild()`. 아이 전환 UI 는 **부모 홈에만**.
  다른 화면 우선순위 = 딥링크(`?child=<user_id>`·`state.childUserId/childId`) > `activeChild` >
  **첫째(children[0]) 폴백 금지**. 명시적 수신자 선택 화면(EventForm 배정·StickerSend·RemoteRing)만
  자체 선택 허용하되 기본값=활성 아이.
- **식별자 2축**: events/supplies/memo 귀속 = `family_members.id`(member id) /
  location/device/parent_alerts/remote-listen = auth `user_id`. `DailySupply.child_user_id` 는
  이름과 달리 member id — 이름만 보고 판단 금지, 저장값 기준.
  준비물 저장 대상은 `src/transform/dailySupplyScope.ts`의 `resolveDailySupplyChildMemberId`가 검증하며,
  부모 세션에서 명시 대상이 없으면 첫 아이로 폴백하지 않고 실패시킨다.
  아이 설정 화면도 본인 `user_id`가 매칭된 child member만 사용하고 첫 아이로 대체하지 않는다.
  일정 등록 준비물(2026-07-16): EventForm 준비물 칩은 저장 시 배정 아이들의 occurrence 날짜별
  daily_supplies(prep)에 병합된다(`useAddEventSupplies`+`transform/eventSupplies`, 라벨 정규화 중복 제거로
  재저장 멱등, 하루 8개 초과는 dropped 집계 후 정직 안내). (아이,날짜) 쌍은 서로 다른 행이라 병렬 안전.
  부모 홈·아이 홈 반영은 기존 daily_supplies WS 브릿지. 회귀=`tests/eventSupplies.test.ts`.
- **date_key 함정**: 월이 **0-indexed 비패딩**("2026-6-5" = 7월 5일). 반드시 `src/transform/dateKey.ts` 경유.
- **메모 = 아이별 1:1 스레드**: fetch/send 에 childId(member id) 필수, `qk.memoReplies` 키에 childId 포함.
  리치 메시지 = content 마커 `[[img:R2key]]` / `[[loc:lat,lng|주소]]` (`src/transform/memoView.ts`).
- **대화 전송 즉시 표시(2026-07-13 실사고)**: `POST /api/memos/replies`가 성공해 D1·FCM 전달까지 끝났어도,
  클라이언트가 후속 GET/WS에만 의존하면 재조회 지연 동안 과거 대화(실제 제보: 토요일)가 마지막으로 남는다.
  서버가 반환한 저장 행은 `commitSentMemoReply`로 family/date_key/child_id가 맞는 `qk.memoReplies` 캐시에 즉시 합치고,
  정본 `invalidateQueries`는 백그라운드로 실행해 전송 완료를 막지 않는다. 검증은 D1 저장·pending/FCM ACK·양방향 WS·
  상대 열람 후 `read_by`와 발신 화면 `읽음` 갱신까지 교차 확인한다.
- **알림**: 일정 리마인더는 전부 서버 cron(사용자별 `notification_settings.minutes_before` 정확 매칭,
  클라 로컬 스케줄러 없음) · 긴급(sos/emergency)은 `POST /api/parent-alerts` insert 시 서버가 FCM
  전체화면 연쇄 · 기기 상태(device_health)는 **on-demand**(부모가 `request_device_status` 푸시를 보내야 옴) ·
  미등록 장소 도착 = `worker/lib/arrivalDetect.ts`(150m·5분 체류·2h 쿨다운).
- **notification quiet hours 정본(2026-07-19)**: 부모 본인 `user_id` 계정과 활성 아이 `user_id` 계정만
  부모가 각각 설정하며, 공동 부모 계정에는 적용하지 않는다. 계정별 매일 반복 구간은 1개이고 기본값은
  비활성 `22:00→07:00`, 시간대는 `Asia/Seoul`, 판정 범위는 `[start,end)`이며 시작=끝 저장은 거부한다.
  부모 설정은 대상 칩으로 명시 선택하고 아이 설정은 자기 계정 값을 읽기 전용으로 보여준다. Worker는 일반 알림을
  `pending_notifications` 생성 이전에 수신자별로 걸러 억제 시 행·푸시를 만들지 않고 재생하지 않으며, 도착·출발
  상태머신은 계속 진행한다. 이 억제는 `suppressed_quiet_hours` 의미의 성공 완료이고 Android 실제 receipt는
  `QUIET_HOURS_SUPPRESSED(acknowledge=true, posted=false)`다. SOS·emergency·미도착(not_arrived/missed_arrival)·위험구역은
  항상 전달하고 force ring·remote listen·위치/기기 상태 요청 명령도 통과시킨다. `kkuk`은 일반 알림이라 억제 대상이다.
  Android는 `NotificationQuietHoursStore`의 session-bound 캐시와 FCM `notification_quiet_hours_updated` 갱신을 사용하며,
  `NotificationHelper`가 채널·권한·중복·화면 깨우기·게시보다 먼저 모든 8개 표시 경로에 동일 정책을 적용한다.
  운영 배포는 D1 `worker/db/notification-quiet-hours.sql`을 Worker 배포 이전에 정확히 1회 적용하고 컬럼 기본값을 읽어 확인한다.
  부모 홈 안전 지표의 알림·위치 건강 상태는 컴팩트 칩(`shortLabel`, `.ph-safety__signals`) 한 줄로 표시하고,
  긴 `label`/`detail` 안내 박스는 `attention`(조치 필요) 상태에만 렌더한다(2026-07-14 TK 제보 "과도한 텍스트" 수정).
  안심리포트(`DailySafetyReport`)는 상세 화면이므로 label/detail 전체 표시를 유지한다.
  회귀=`tests/deviceNotificationHealth.test.ts`.
  안전지표의 `잠금해제`는 Android `UsageEvents.Event.KEYGUARD_HIDDEN`의 오늘 누적값만 표시한다.
  `SCREEN_INTERACTIVE`(알림 등으로 화면만 켜짐)는 절대 포함하지 않으며, Usage Access 없음·API 28 미만·미보고는 `0회`로 표시한다.
  안전지표의 `많이 쓴 앱`은 특정 제조사 패키지 예외 목록으로 처리하지 않는다. Android는 `LAUNCHER`·`HOME`·
  `SECONDARY_HOME` 가시성, 정확한 OS 표면 패키지 세그먼트, `ApplicationInfo`의 system/updated-system 및 실행 가능성,
  실제 앱 라벨 해석 성공을 함께 판정한다. 런처·설정·System UI·키보드·설치/권한/잠금/AOD 같은 OS 표면과
  원시 패키지 문자열은 수집·표시에서 제외하되, 카메라·브라우저·메시지·전화처럼 실행 가능한 실제 앱은 제조사
  기본 탑재 여부와 무관하게 유지한다. `QUERY_ALL_PACKAGES`는 추가하지 않으며 네이티브와 구버전 payload 표시 필터의
  회귀는 `DeviceStatusReporterTest`·`tests/deviceAppUsageView.test.ts`에서 함께 보호한다.
  등록장소 도착/출발(saved_places+academies)은 네이티브 `LocationService`와 Worker
  `registered-place-geofence-check`가 같은 상태머신으로 처리한다. 20m 이내 중복 장소는 `saved_place` 우선으로
  1개만 평가하고, 진입은 3분 이상 체류해야 도착으로 승격한다(학원가 통과/중복 알림 방지).
  ★이동 알림 현실화(2026-07-16): 서버 cron 은 자녀 단위로 전이를 수집해 episode 시간순으로 전달하고, 같은 배치의
  출발은 다른 장소 도착에 병합한다("○○에서 출발해서 △△에 도착했어요"). 조용한 재진입(SILENT_RE_ENTER) 에피소드의
  재이탈은 `SILENT_LEAVE`(무알림, JS·Java 3중 parity — `phase=in && lastDepartedAtMs != null` 불변식으로 판별)이며,
  최근 15분 내 다른 장소 도착을 이미 전달했으면 늦게 흘러온 출발은 조용히 상태만 진행한다(같은 장소 재출발은 억제 금지).
  ★장소 출입 중복·지연 근절(2026-07-24): 도착/출발 dedup 을 episode 10분 버킷 멱등키에 의존하지 않는다.
  네이티브와 서버 cron 은 서로 다른 fix 스트림을 보므로 episode 시각이 다르고, 버킷 경계를 사이에 두면 키가 갈려
  같은 방문이 두 번 알려졌다(실사고: 집 도착 07:24+07:26, 집 출발 08:30+08:32). 두 경로의 공통 합류점
  `insertParentAlertV2` 앞단에서 `(family, child, placeKey, kind)` 10분 쿨다운으로 판정한다
  (`lib/registeredPlacePresenceDedupe.ts`). placeKey 는 요청 `place_key` 우선, 없으면 event_id 를 후보
  (placeKey, bucket) 집합과 대조해 역산하므로 **앱 재배포 없이 서버 배포만으로 중복이 멎는다**. 신규 알림은
  `metadata.{placeKey,presenceKind}` 를 남긴다. 장소 미상은 fail-open(안전 알림 우선).
  실시간성은 ①정확도를 뺀 거리가 이탈반경×2 를 넘으면 180초 타이머 없이 즉시 LEAVE(`farExitRatio`)
  ②`evaluateRegisteredPlaceTimer` 로 dwell·이탈 타이머를 wall-clock 진행(마지막 fix 5분 이내일 때만 —
  좌표 frozen 가짜 전이 금지, episode 시각은 실측 fix 시각 보존) ③네이티브는 새 fix 채택 시 60초 tick 을
  기다리지 않고 즉시 재평가하되 `placeAlertInFlight` 로 발사 중 재평가를 잠근다.
  회귀=`worker/tests/registeredPlacePresenceDedupe.test.mjs`(프로덕션 실제 멱등키 재생)·
  `registeredPlaceLatency.test.mjs`(오늘 아침 실측 fix 재생)·Android `GeofenceStateMachineTest`.
  부모→아이 메모 FCM(`type: "new_memo"`)은 일정 채널이 아니라 아이 메시지 채널(`hyeni_child_message_v1`)로
  heads-up 표시하고, 탭/폴링 라우트는 `#/child/memo`로 유지한다.
- **리포트/전환 기능(2026-07-07)**: 오늘의 안심 리포트=`/daily-report`, 주간 가족 리포트=`/weekly-report`,
  원격청취 감사 로그=`/remote-audio-audit`. 주간 리포트는 `FEATURES.WEEKLY_REPORT` 프리미엄 전용이며 기존
  events/daily_supplies/memo/parent_alerts만 집계한다. 전용 서버 endpoint가 없으면 가짜 수치 금지.
  원격청취 감사 로그는 `GET /api/remote-listen/sessions`의 실제 세션 메타데이터만 표시하고 오디오 내용은 저장·표시하지 않는다.
  조회 실패를 빈 기록으로 위장하지 말고 오류/재시도 상태를 보여준다. Google Play 실제 가격은 basePlanId가 아니라
  Play Console/결제 확인 화면 기준으로 판단한다.
- **안심리포트·스티커 진입점(2026-07-09)**: 부모 홈에서 `/daily-report`는 바로가기의 "안심리포트"로만 진입한다.
  기존 상단 하트/`꾹` 스티커 UI는 재도입하지 말고, 상단 액션은 명확한 "스티커" 전송 버튼으로 유지한다.
  이 규칙은 부모 홈 스티커 접근성 정리이며, 아이 모드 긴급 SOS 안전 동선과 혼동하지 않는다.
- **스토어 방문 혜택 grandfather(2026-08-01)**: 신규 지급은 종료했다. `/api/review-rewards` GET은 부모 세션에서
  기존 `family_review_rewards` 행만 읽고, POST claim은 부모 본인 가족을 확인한 뒤
  `410 review_reward_program_ended`로 닫으며 INSERT·UPDATE·DELETE하지 않는다. 이번 정책 전환에서 기존 행을 삭제하지
  않고, `reviewed`는 이미 받은 장소 한도를 유지하기 위한 숨은 내부 호환 상태일 뿐 사용자 노출 상품 티어가 아니다.
  클라이언트 `useReviewReward`도 조회 전용이며 아이/선생님 세션은 호출하지 않고 reviewed=false로 확정한다. 부모 설정은
  신규 지급 CTA를 노출하지 않고 무료 가족에는 종료 안내, 기존 혜택 가족에는 유지 안내만 표시한다.
- **위치 티어(2026-08-01)**: 위치 조회는 서버가 `locked|standard|realtime`으로 판정한다. Free와 기존
  reviewed 부모는 10분 버킷 이전의 아이별 최신 실측 위치를 측정시각·정확도와 함께 받고, 부모가 누른 즉시 위치 요청은
  rolling 24시간 5회까지 실제 새 fix를 5분 확인 창에서 바로 표시한다. Premium 부모는 현재 위치와 즉시 요청 무제한을 받는다.
  Free/reviewed 이력은 Asia/Seoul 오전 8시 기준 오늘 범위, Premium은 서버 현재시각 이전 최근 30일로 clamp하며 범위 밖 요청은
  빈 결과로 닫는다. 아이 세션은 활성 상태인 본인 최신 위치만 조회하고, 위치 인시던트는 티어와 무관하게 부모만 조회한다.
  엔타이틀먼트 DB 판정 실패는 최신 위치를 열지 않고 `503 location_entitlement_unavailable`로 닫는다.
- **구독 결제 정본(2026-07-13)**: 7일 무료 체험은 Google Play가 현재 계정에 eligible 하다고 반환한 offer 중
  무료 pricing phase가 정확히 7일인 경우에만 표시·구매한다. 결제 직전에 상품을 다시 조회하고 그 `offerToken`·`offerId`를
  네이티브 결제와 Worker 검증까지 그대로 전달하며, 가격은 Play `formattedPrice`만 표시한다. `trial`은 미래
  `trial_ends_at`, `active/grace/cancelled`는 미래 `current_period_end`가 있을 때만 프리미엄이다(해지는 결제 종료일까지 유지).
  신규 Google 결제는 월 4,900원·연 39,000원만 서버가 승인한다. 가격 전환일인 2026-08-01 00:00 KST 이전에 시작된
  월 2,900원·연 27,840원 기존 구독은 복원·RTDN 재검증에서만 grandfather하며, 신규 verify와 전환 시각 이후 시작 구독은
  과거 가격을 거부한다. base plan ID의 숫자는 가격 정본이 아니다.
  BillingFlow에는 가족·부모 식별자의 SHA-256 값을 obfuscated account/profile id로 넣고 Worker가 Play 응답과 대조한다.
  부모 앱 시작·foreground에서는 6시간 제한으로 기존 `PURCHASED` 구독을 서버 재검증해 자동갱신 종료일을 동기화한다.
  AI 크레딧은 purchase event claim·잔액·원장을 한 D1 batch로 확정하고 consume 실패 재시도에서 중복 가산하지 않는다.
  Google Play 직접 검증이 결제 정본이며 RTDN도 notification type만 믿지 않고 `purchases.subscriptionsv2.get`으로 재검증한다.
  RTDN은 Google OIDC·audience·push service-account email을 모두 검증하고, additive D1 schema를 먼저 적용해야 한다. 설정 누락은
  `503` fail-closed가 정상이다. Qonversion은 비활성·비정본 보조 route이며 health는 secret이 없으면
  `configured:false, accepting:false, primaryProvider:false`를 반환한다. Billing 상품 조회 진단은 response code/debug message와
  미조회 product id/type/status만 다루고 purchase/order token을 로그나 응답 진단에 포함하지 않는다.
- **프리미엄 퍼널 최소수집 계약(2026-08-01)**: 클라이언트는 고정 allowlist 이벤트에 UUID `event_id`·앱 버전·발생 시각만
  붙여 최대 20건씩 전송하고, 실패한 요청은 브라우저 저장소 없이 메모리 100건 큐에서 다음 기록 때만 재시도한다. 분석 실패가
  안전 기능·업셀·결제를 실패시키거나 세션 refresh를 일으키면 안 된다. Worker `/api/premium-funnel/events`는 현재 active parent의
  정본 가족을 서버에서 결정하고 `PREMIUM_FUNNEL_HASH_SECRET` HMAC-SHA256 가족 가명키만 D1에 저장한다. 원시 user/family,
  위치·이름·주소·메모/AI 원문·email/phone·가격·auth/purchase/order token·자유 JSON은 컬럼 자체가 없다.
  첫 실측 위치·같은 세션 신규 도착의 가치 순간을 `first_location|first_arrival` source 문자열로만 구분하며 좌표·주소·alert id를
  싣지 않는다. Google Play는 재검증 전후 정본 상태가 확정한 신규 체험·최초 활성·실제 기간 연장·revoke만 각각
  `trial_start|entitlement_activated|renewal|refund`로 기록하고, SHA-256 purchase token hash로 만든 결정적 HMAC UUID만 사용한다.
  클라이언트 이벤트는 행동 관측만 허용하고 `entitlement_activated|trial_start|renewal|refund`는 검증된 결제 서버 경로의
  fail-soft helper에서만 기록한다.
  `event_id`는 멱등이고 가족별 시간당 600건, payload 16KiB·batch 20건, 발생 시각 -7일/+10분을 제한하며 서버 `received_at`을
  별도 저장한다. `0 * * * *` cron은 180일 지난 이벤트를 멱등 삭제한다. 운영에는 `worker/db/premium-funnel.sql` 적용과
  secret 설정을 Worker 배포 전에 완료하며, 미설정 `503 configured:false`는 분석만 닫고 제품 흐름은 계속한다.
- **출시 AAB 신선도(2026-07-13)**: 체크리스트의 서명 AAB는 최신 앱 커밋 이후 다시 빌드하고 서명·해시·mtime을 확인한
  경우에만 준비 완료로 표시한다. 과거 AAB가 디스크에 존재한다는 이유만으로 업로드하지 않는다. 서명 비밀번호는 사용자만
  입력하며 에이전트가 자격 파일을 읽어 자동 서명하지 않는다.
  릴리즈 스크립트는 worktree의 `android/local.properties`를 전제로 하지 않고 Android SDK를 먼저 탐색해
  `ANDROID_SDK_ROOT`·`ANDROID_HOME`을 설정한 뒤 build·Capacitor sync·Gradle release를 실행한다.
- **Android 15 부팅 FGS 정본(2026-08-27)**: `BootReceiver`는 위치 공유 복구를 위해 `LocationService`만 시작하며,
  부팅으로 복구된 코드 경로에서 `foregroundServiceType="microphone"`인 `AmbientListenService`를 시작하면 안 된다.
  특히 pending `remote_listen_stop`처럼 중지 목적이라도 `startService(Intent(AmbientListenService))`를 호출하면 Play가
  `BOOT_COMPLETED → AmbientListenService.onStartCommand` 제한 경로로 판정한다. pending·FCM·plugin·세션 종료의 중지는
  `RemoteListenActiveSession`에서 정확한 request/target/session으로 현재 실행 중인 인스턴스만 claim해 main handler로
  직접 전달하고, 캡처가 없으면 새 서비스를 만들지 않는다. microphone FGS 시작은 서버 승인 증표를 소비한
  `RemoteListenActivity`의 사용자 가시 경로로만 유지한다. 위치 부팅 복구 자체를 제거하지 않는다.
  회귀=`tests/remoteListenConsentSafety.test.mjs`·Android `RemoteListenActiveSessionTest`.
- **현재 Play 출시 후보(2026-08-15)**: 실제 제출 후보는 v1.3.0/**versionCode 6**이다. 위치 권한 안내가 인증 전환에
  가려지지 않도록 gate를 유지하고, 권한이 없는 아이의 위치 화면에서도 같은 prominent disclosure를 거쳐 Android 전경→
  백그라운드 권한을 요청한다. 위치 FGS 지속 알림은 장식 문구 대신 `위치 공유 중`과 실제 공유 대상을 표시한다.
  오래된 `device_label`보다 최신 네이티브 `manufacturer`·`model`을 우선해 A17 부모에서 razr가
  `motorola razr 40 ultra`로 표시됨을 확인했다. 앱 1,298/1,298, Worker 1,161/1,161, Android unit 175/175·lint·
  assembleDebug가 통과했고, Worker version ID `c4c769c3-b4d5-4ba1-8c68-ef2ba22c742c`가 production에 배포됐다.
  사용자가 A17·razr의 정책 영상 촬영을 허용했으며, 계정·역할·페어링을 바꾸지 않고 촬영한 개인정보 비식별·무음 최종본만
  사용한다. YouTube 초안은 백그라운드 위치 `https://youtu.be/yTfCI3RsVE8`, FGS 위치·마이크·특수 용도
  `https://youtu.be/cb_BFyed6uE`다. 제목·설명·일부 공개 저장, Play 선언 저장, 로그인 세부정보, 서명 AAB 업로드와
  최종 심사 전송은 실제 완료 증거 전까지 미완료로 둔다.
- **출시 전 신뢰 UX 문구 가드(2026-07-07)**: 안전은 무료, 상세 안심은 프리미엄이라는 경계가 흔들리면 안 된다.
  구독·원격청취·AI 일정 문구는 `tests/subscriptionTrustCopy.test.mjs`, `tests/remoteAudioTrustCopy.test.mjs`,
  `tests/aiScheduleUxCopy.test.mjs`로 회귀 보호한다. SOS·긴급 알림을 프리미엄 혜택처럼 쓰지 말고,
  원격청취는 아이 알림·1분 자동 종료·기록 안내를 함께 보여준다. 아이 동의 탭이 없어졌으므로 부모 문구는
  "아이가 허용해야 시작"이 아니라 "아이가 누르지 않아도 연결되고 듣는 동안 아이 화면에 계속 표시된다"로 쓴다.
- **위급 주변소리(2026-07-29, 보호자 결정)**: 위급 상황 확인용 경로라 아이 동의 탭을 받지 않는다. 대신 숨기지 않는다.
  `RemoteListenActivity`는 pending 상태가 `READY`면 곧바로 `acceptRequest()`로 연결하고, 허용/거절 버튼 대신 무슨 일이
  일어나는지 문장으로 알린다. 알림은 "요청"이 아니라 "지금 듣고 있다"를 알리며 잠금·꺼짐 화면에서도 보이도록
  `setFullScreenIntent` + Activity `showWhenLocked`/`turnScreenOn`을 쓴다. 기기 잠금 해제는 요청하지 않는다.
  통화 위장(`CATEGORY_CALL`)·무음(`setSilent`)·`VISIBILITY_SECRET`·DND 우회는 금지다. 서버 승인 증표 1회 소비,
  세션 nonce·가족·대상 일치 검사, 마이크 권한, 1분 상한, 캡처 중 포그라운드 알림, 감사 기록은 그대로 유지한다.
  회귀=`tests/remoteListenConsentSafety.test.mjs`.
- **알림 전달·원격청취 보안 계약(2026-07-14)**: 모든 즉시 알림은 네트워크 발송 전에 수신자별
  `pending_notifications`를 만들고, 실제 네이티브 표시/Web Push 표시 ACK 전에는 delivered로 완료하지 않는다.
  targetless 레거시 행은 일반 사용자가 조회·ACK할 수 없으며, 일정·도착·위험·메모 알림은 활성 가족 구성원과 정확한
  `targetUserId`/role/아이 식별자를 서버가 검증한다. 원격청취는 부모 버튼 → 감사 세션 생성(세션 id=requestId) →
  아이에게 알림 → 아이 기기가 그 세션의 서버 승인 증표를 1회 받음 → access JWT로 WAV 전송 → 요청한 부모 소켓에만 전달 →
  **서버가 기록한 승인 시각부터** 최대 60초 후 종료 순서다. 요청 시각부터 60초를 계산해 늦게 연결된 아이 기기의 청취
  시간을 줄이지 않는다. FCM·pending 수신만으로 마이크를 시작하지 않는다(반드시 `RemoteListenActivity` 경유). 익명 realtime
  broadcast와 클라이언트 WebSocket relay는 금지하며, stop은 같은 requestId·아이·session nonce를 확인하고 감사 행을
  닫기 전에 전송한다. 감사 종료 시각·길이·종료 사유는 서버가 확정한다.
- ★원격 제어 수신·네이티브 가로 화면(2026-08-02 TK 실기기 제보): Android `NotificationTargetPolicy`는 모든 FCM에
  `familyId`·`targetUserId`를 필수로 검사하고 `targetRole`이 있으면 역할까지 일치시킨다. 따라서 공용 fanout을 우회하는
  force-ring 시작·정지·5분 경과 직접 payload에도 세 필드를 각각 child/child/parent 대상으로 넣어야 한다. FCM API 200과
  `delivered_at`은 기기 처리 증거가 아니며 `acknowledged_at`까지 교차 확인한다. 주변소리는 full-screen Activity가 알림 게시와
  경합하지 않도록 `RemoteListenRequestStore.markNotificationShown`을 `notify()`보다 먼저 commit하고, 게시 실패 때 pending 예약만
  되돌린다. 앱이 foreground면 안내 알림 게시 뒤 `RemoteListenActivity`를 직접 열되 마이크는 기존 서버 승인 증표 뒤에만 켠다.
  targetSdk 35+에서는 full-screen `PendingIntent` 생성자가 background Activity start 권한을 명시해야 하므로 주변소리·SOS/
  emergency·force-ring 전체화면 경로는 `UrgentActivityPendingIntent`를 공용 사용한다(SDK 34/35=`ALLOWED`, SDK 36+=
  `ALLOW_ALWAYS`). Android 13+에서 잠금 해제된 background 앱의 full-screen intent는 heads-up으로 강등될 수 있어 무조건 자동
  실행으로 단정하지 않는다. SOS 3초 홀드는 pointer capture로 미세 이동·눌림 scale에 의한 `pointerleave` 취소를 막고,
  부모 긴급 알림은 같은 `requestHash`를 `event_id`로 보내 각 8초 상한·최대 2회로 일시적 네트워크/408/425/429/5xx만 재시도한다.
  Capacitor 진입점은
  `<html data-hy-native>`를 표시하고 native에서는 `.hy-app`·고정 오버레이의 448px 폰 프레임, 바깥 배경, radius/shadow를 해제해
  가로 화면을 전폭으로 쓴다. 회귀=`tests/forceRingTargetPayload.test.mjs`(Worker)·`tests/remoteListenConsentSafety.test.mjs`·
  `tests/childSosCopy.test.mjs`·`tests/mobileViewportCss.test.mjs`와 Android `UrgentActivityPendingIntentTest`. 로컬 앱 전체 1231개,
  production build/PWA 검증, Android unit+assemble+lint, Worker 대상 payload 3개+typecheck는 통과했다. Worker/Pages 배포 및
  A17·razr E2E는 두 기기 미연결로 미완료다.
- ★주변소리 세션 조기 종료(2026-07-22 실사고): 부모 화면이 시작 ~4.5초 만에 "1분이 지나 듣기를 종료했어요"로
  닫혔다. 근본 원인은 클라 파싱 버그 — `src/lib/api/endpoints/remoteAudit.ts`의 `finiteMs`가 `Number(null)===0`을
  유한값으로 통과시켜 미동의 세션의 `ended_at_ms`(서버 JSON null)를 0으로 만들었고, 타이밍 resolver의
  `finite(endedAtMs)`가 즉시 phase="ended"로 조기 종료했다(D1 확진: consented=NULL·duration=0·~4.5s). 서버 계약과
  resolver는 정상. 수정=null/비숫자를 null로 남기는 순수 파서 `src/transform/remoteListenStatusMs.ts`
  (`parseRemoteListenMs`, typeof-number 가드). 서버 `number|null` 시간 필드는 `Number()`로 null을 강제하지 말 것.
  회귀=`tests/remoteListenStatusParse.test.ts`.
- **AI·가족 메모 콘텐츠 안전 계약(2026-07-14)**: 서버에 저장돼 id가 확정된 AI assistant 답변만 아이가 신고할 수 있다.
  신고자는 자기 AI 스레드만 신고하고, 중복 신고는 같은 id로 멱등 처리하며 신고 레코드에는 원문을 복제하지 않는다.
  가족 메모는 정확한 가족·아이 스레드의 상대 메시지만 신고할 수 있다. 사용자 차단은 메모 조회·새 메모 pending/푸시에만
  적용하고 가족 연결·위치·도착·위험·SOS 안전 알림은 절대 막지 않는다. 신고 사유는 서버 allowlist, 상세는 500자로 제한하며,
  개인정보처리방침과 이용약관에 AI/UGC 신고·차단·운영자 검토·이의 제기 절차를 함께 명시한다.
- **메모 전달·차단 선형화(2026-07-14)**: 메모 저장과 `memo_notification_outbox` 생성을 한 D1 batch로 확정하고,
  즉시 전달 실패는 같은 `memo:<replyId>`로 1→5→15→30→60분 재시도한다. 모든 `new_memo` 진입점과 차단·해제는
  `memo_interaction_leases`의 정렬된 무방향 사용자 pair를 공유한다. 전달은 pair lease 획득 뒤 membership·차단을 다시 읽고
  수신자별 pending을 먼저 저장한 뒤 Web Push/FCM까지 최대 90초 안에 끝내며, lease TTL은 120초다. 다중 수신자는
  전부 획득하지 못하면 이미 얻은 lease를 되돌리고 fail-closed한다. 차단·해제는 caller/target account mutation lease 뒤
  같은 pair lease를 잡아 완료 뒤 과거 메모 pending이 다시 표시되지 않게 한다. 운영에는
  `db/memo-notification-outbox.sql`과 `db/memo-interaction-leases.sql`을 Worker보다 먼저 적용한다.
  외부 Push 서비스에 이미 들어간 알림도 차단 뒤 보이지 않도록 FCM·Web Push·pending에는 수신자별 HMAC
  `memoDisplayPermit`을 넣는다. Web Push·pending 보관은 120초, permit은 발송 상한과 표시 승인 왕복을 포함해 5분만
  유효하다. Android와 Service Worker는 기존 대상·role·만료 검사 뒤 공개
  `POST /api/push-notify/memo-display-authorize`로 현재 membership·대상 아이·양방향 차단을 다시 확인하며, 응답이 정확히
  `{allowed:true}`일 때만 표시·ACK한다. permit 누락·변조·만료·HTTP/JSON/네트워크/timeout·DB 오류는 모두 미표시·미ACK로
  닫고 permit·세션 토큰을 로그에 남기지 않는다.
- **피드백 내구 접수 계약(2026-07-14)**: `/api/feedback`은 인증 세션만 허용하고 이름·이메일·role·user/family 식별자는
  요청 본문을 신뢰하지 않고 서버 정본으로 계산한다. 사용자별 UUID requestId로 멱등 처리하고 시간당 5건으로 제한하며,
  Cloudflare Email Service 호출 전에 `user_feedback(type='feature_feedback', status='queued')`를 저장한다. Worker의
  `FEEDBACK_EMAIL` 바인딩은 `feedback@hyenicalendar.com`에서 인증된 `tkisdroid@gmail.com` 한 곳으로만 보낸다. 실제 성공만
  `sent`, 바인딩 미설정·실패는 `queued` 202다. `queued`는 D1 운영 대기열에 안전하게 접수됐다는 뜻이지 이메일 자동 재전송을
  약속하지 않는다. 운영자는 대기열을 모니터링·처리하고 앱도 두 상태를 다른 문구로 표시한다. 운영에는
  `db/feedback-delivery-safety.sql`을 Worker보다 먼저 적용한다.
  2026-07-31부터 모든 역할의 설정과 크래시 화면에서 문제 신고·사용 문의·기능 제안을 바로 접수한다. 진단 첨부는
  사용자가 끌 수 있고, 앱 버전·실행 환경·현재 화면·최근 24시간 정규화 오류 최대 12건만 기존
  `device_info/error_logs/current_screen`에 저장한다. 대화·위치 좌표·사진·비밀번호·로그인/구매 토큰·원문 오류는
  진단에 포함하지 않으며 Worker도 허용 필드만 재조립한다. 구조화 Worker 로그는 requestId만 상관키로 사용한다.
  운영 정본=`docs/feedback-operations.md`, 회귀=`tests/feedbackDeliverySafety.test.mjs`·`tests/feedbackDiagnostics.test.ts`.
- **선생님 모드 출시 차단(2026-07-14, v1.3.0 유지)**: v1.3.0 프로덕션은 미완성 선생님 가입·반 연동을 심사 화면에 노출하지 않는다.
  `TEACHER_MODE_ENABLED`는 `import.meta.env.DEV`만 정본으로 사용하고 환경변수 우회를 두지 않는다. 프로덕션 온보딩은
  선생님 역할 카드를 숨기며 `/teacher/*`는 준비 안내 gate로 닫는다. 기존 teacher 세션도 gate에서 로그아웃·회원 탈퇴·
  이용약관·개인정보처리방침에 접근할 수 있어야 한다. 부모·아이 공용 준비물은 `RequireAnyRole(parent|child)` 아래에 두어
  공개 URL과 teacher 세션의 직접 접근을 막는다.
- **공개 법적 페이지 브라우저 품질(2026-07-14)**: Worker `/privacy`·`/terms`·`/data-deletion`은 서비스명 뒤 조사가
  자연스러워야 하며 데스크톱·모바일에서 가로 오버플로와 콘솔 오류가 없어야 한다. 기본 브라우저 아이콘 요청도
  `/favicon.ico`의 캐시 가능한 SVG 200 응답으로 닫아 새 세션에서 404를 남기지 않는다.
- **출시 가이드 산출물 검증(2026-07-14)**: Markdown→DOCX 생성기는 표지 다음 도입 문단과 인용문의 인라인 강조를
  보존하고 짝수·홀수 페이지 머리글/바닥글을 모두 명시한다. 최종 DOCX는 PDF·페이지 PNG로 다시 렌더해 전 페이지를
  육안 검사하며, 새 회귀 테스트를 추가한 뒤에는 전체 테스트 수를 재실행 결과로 갱신한다. 운영 명령에는 `...` 같은
  placeholder를 남기지 않고 Families의 아동 전용 위치 제한도 위치 권한 자체와 정밀 위치 처리 금지를 모두 적는다.
- **활성 가족 권한·알림 endpoint 소유권(2026-07-14)**: 일반 API·로그인 역할·AI·준비물·위치 설정·스티커·친구놀이·
  결제는 `family_members.is_active=1`인 `parent|child` 또는 검증된 주보호자 소유 가족만 권한으로 인정한다. 연결 해제된
  옛 아이는 다른 데이터에는 접근할 수 없고 기존 안전 동선을 끊지 않기 위해 `sos` 발사만 예외로 허용한다. FCM token과
  Web Push endpoint는 활성 행 1개만 허용하며 `registration_instance_id`가 같은 세션만 갱신·해제한다. 타 사용자·지연된
  옛 세션은 409로 닫고, 로그아웃/만료/무효 행은 삭제하지 않고 `disabled_at/disabled_reason`으로 비활성화한다.
- **부모의 직접 자녀 프로필 생성(2026-08-24 TK 승인)**: `POST /api/family/member/child`는 활성 대표 보호자만 자기 가족에
  로그인 계정 없는 자녀 행을 만들 수 있다. 이름을 `아이`로 보정하지 말고 비어 있지 않은 정규화 이름과 실제 과거
  `YYYY-MM-DD` 생년월일을 요구한다. Free 1명·Premium 2명 상한, 활성 대표 보호자 membership, 계정 삭제 scope 부재를
  조건부 `INSERT ... SELECT` 한 문장에서 다시 검사한다. 회귀=`worker/tests/familyAddChild.test.mjs`·
  `worker/tests/activeMembershipRouteAudit.test.mjs`.
- **D1 정본 스키마·알림 migration(2026-07-14)**: `cloudflare/schema_d1.sql`은 auth·위치 정확도·일정 series·RTDN·OTP·
  콘텐츠 안전·원격청취 동의·endpoint ownership을 포함한 fresh bootstrap 정본이며
  `worker/tests/canonicalSchemaBootstrap.test.mjs`로 빈 SQLite 실행과 필수 컬럼·인덱스를 검증한다. 운영 endpoint ownership은
  `db/notification-endpoint-ownership.sql`을 1회 적용한 뒤 즉시 해당 Worker를 배포하고 active-only readback을 확인한다.
  이 migration은 과거 행을 삭제하지 않으며 재실행 금지다.
- **Realtime 수신자 격리(2026-07-14)**: 모든 family realtime publish는 현재 활성 membership에서 계산한 명시적
  `audienceUserIds`가 필수다. 부모 경보=현재 부모만, 아이 위치=현재 부모+해당 아이, 메모=현재 부모+해당 스레드 아이만
  받으며 payload에는 필요한 식별자만 싣는다. Durable Object는 audience 없는 notify를 거부하고 user-tagged socket만
  전송한다. 연결 중에도 토큰 만료와 membership 해제를 확인해 소켓을 닫는다.
- **계정 삭제·첨부 저장소 완결성(2026-07-14)**: 신규 아이 사진은 서버가
  `{familyId}/uploads/{uploaderUserId}/{uuid}.{ext}` 불변 키를 만들며, 요청 본문은 Content-Length를 믿지 않고 8MiB+1에서
  중단하는 bounded stream으로 읽는다. MIME·magic byte 일치, HTML/SVG·위장 파일 거부 뒤에만 UTC 일일 quota
  (업로더 계정과 대상 가족 각각 200개·256MiB)를 함께 원자 claim한다. 운영에는 `db/storage-upload-daily-usage.sql`과
  `db/storage-upload-family-daily-usage.sql`을 Worker보다 먼저 적용한다.
  razr 구버전의 3개 legacy 키(memo/profile/placeholder)는 active 가족 권한을 먼저 확인하고 기존 객체를 절대 덮어쓰지 않는
  create-only 호환만 유지하며 `Deprecation`을 응답한다. `/uploads/` 조회는 R2 owner·purpose·target metadata가 없으면 fail-closed하고,
  실제 스레드 수신자와 양방향 메시지 차단 상태를 확인한다. 계정 삭제는 user/member/teacher 관계와 알림 endpoint·세션·감사 데이터를
  서버에서 열거해 지우고 R2 사용자 prefix를 pagination으로 회수하되, inactive 과거 아이나 다른 가족·교사·독립 로그인 관계가 있는
  아이 계정은 전역 users/auth 데이터에서 삭제하지 않는다. 과거 hard-unpair 계정은 본인 refresh 행의 family snapshot으로 본인 prefix와
  owner metadata만 회수한다. 아이 연결 해제는 inactive tombstone과 `family_unpair_cleanup_jobs`를 한 D1 batch로 먼저 확정해 권한을
  즉시 닫고, R2·member/user 가족범위 참조를 멱등 정리한다. 중간 실패는 `cleanup_pending=true`와 job을 남겨 매분 cron이 재시도하며,
  job 중 재페어링은 409다. 운영에는 `db/family-unpair-cleanup-jobs.sql`을 Worker보다 먼저 적용한다.
- **삭제·연결해제·백그라운드 쓰기 선형화(2026-07-14)**: 인증 mutation, 수동 JWT push, 네이티브 rest-shim,
  일정·도착·위험장소·위치 끊김·선생님·AI·force-ring·친구놀이 cron과 `waitUntil` 알림은 실제 사용자·가족·대상 자녀의
  `account_mutation_leases`를 확보한 뒤에만 DB 쓰기와 push를 수행한다. 계정 삭제 claim이 먼저면 새 쓰기는 409/503으로
  fail-closed하고, lease가 먼저면 삭제가 재시도된다. 완료된 삭제 scope는 stale access JWT보다 긴 24시간 tombstone으로
  유지하고 비정상 종료 lease는 1시간 뒤 cron이 회수한다. unpair job과 대상 자녀 lease는 양방향 원자 조건으로 서로를 막고,
  lease 뒤 활성 membership을 다시 확인해 캐시된 옛 자녀에게 상태·알림을 만들지 않는다. refresh 발급·회전과 기존 사용자
  OAuth identity 연결도 `users` 생존+삭제 scope 부재를 같은 D1 문장/batch에서 확인한다. R2 PUT은 quota claim 뒤
  `object_key+upload_nonce` cleanup journal을 먼저 확정하고 nonce가 일치하는 객체만 삭제한다. active PUT 보호 grace는 1시간이며,
  journal commit 실패는 성공으로 응답하지 않는다. 운영에는 `db/account-storage-mutation-safety.sql`을 Worker보다 먼저 적용한다.
- **익명 가입 남용·고아 세션 정리(2026-07-14)**: 익명 가입은 원문 IP·기기 id를 저장하지 않고 HMAC bucket만 저장하며
  IP 30회/시간, 기기 5회/시간으로 제한한다. IPv6는 /64, IPv4와 IPv4-mapped IPv6는 같은 /32로 정규화하고 파싱 실패는
  보수적인 unknown bucket으로 제한한다. 가족에 연결되지 않은 48시간 이상 익명 계정은 활성 mutation lease·삭제/unpair 상태를
  재검증한 뒤 시간당 최대 40개만 멱등 정리한다. 운영에는 `db/anonymous-signup-protection.sql`을 Worker보다 먼저 적용한다.
- **네이티브·DOM 경계 보안(2026-07-14)**: Android WebView 권한(origin)은 정확한 `https://localhost`에서만 허용하고
  `allowNavigation` wildcard를 두지 않는다. 서버·사용자 문자열은 `innerHTML`로 렌더하지 않고 DOM `textContent`/React escape를
  사용한다. FCM 등록 충돌은 소유권 검증 뒤 1회 새 installation id로 회복하되 토큰 원문·부분값을 로그에 남기지 않는다.
  배터리 최적화는 설명 뒤 사용자 버튼에서 일반 설정 목록(`ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`)만 열고,
  앱별 직접 예외 권한·요청(`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`)은 사용하지 않는다. 앱 시작·서비스가 설정을 자동으로 띄우지 않는다.
- **Android lint·백업 안전 게이트(2026-07-14)**: `lintDebug` 오류는 blanket baseline/suppress로 숨기지 않는다. 권한 lint의
  API 버전 false-positive는 실제 runtime guard+`SecurityException` 방어가 있는 최소 wrapper에만 local suppress를 허용한다. 활동 인식은 Android 10+
  런타임 권한을 실제 확인하고 권한 회수 `SecurityException`을 닫으며, 동적 내부 receiver는 `RECEIVER_NOT_EXPORTED`, 사용자 뒤로가기는
  `OnBackPressedDispatcher`를 사용한다. 전화망 세대 조회를 위해 `READ_PHONE_STATE`를 추가하지 않고 telephony 하드웨어는 optional이다.
  따라서 세대를 확인할 수 없는 셀룰러 연결은 4G/5G를 지어내지 않고 일반 `cellular`로 보고해 UI에서 `연결됨`으로 표시한다.
  `allowBackup=false`와 함께 Android 12+ `dataExtractionRules`, 이전 버전 `fullBackupContent`에서 세션·아동 위치를 포함한 모든 앱
  저장소를 cloud backup과 device transfer 모두에서 제외한다.
- **OAuth 서버 트랜잭션·배포 순서(2026-07-14)**: OAuth 시작은 서버가 10분짜리 무작위 state와 별도 transaction secret을
  발급하고 해시만 D1에 저장한다. callback target은 고정 앱 딥링크 또는 정확한 allowlist origin이며 클라이언트 target/base64
  state와 Naver URL 직접 조립을 금지한다. callback code를 state에 결합한 뒤 provider·flow·사용자·secret과 원자적으로 1회
  소비하며 raw code는 영속 저장·로그하지 않는다. 취소도 서버가 transaction을 소비한 `oauth_cancelled`만 앱이 context와 대조한다.
  운영에는 `db/oauth-state-transactions.sql`을 먼저 적용하고 PRAGMA로 컬럼을 확인한 뒤 Worker를 배포한다. 네이티브 callback은
  custom scheme·loopback 없이 정확한 `https://hyeni-calendar.pages.dev/oauth/callback` App Link만 허용한다. 현재
  `/.well-known/assetlinks.json`의 debug 인증서 지문은 A17 개발 빌드 검증용일 뿐이다. Play 공개 전에는 debug 지문을 제거하고
  **Play App Signing key certificate SHA-256**으로 교체한 뒤 내부 테스트 설치본의 App Link가 `verified`인지 확인해야 하며,
  해당 인증서가 아직 없으면 출시 차단이다.
- **권한·위치 캐시 fail-closed(2026-07-14)**: 배경 위치 권한은 아이에게 기능 설명 후 foreground 권한을 먼저 받고,
  별도 설명·버튼으로 background 권한을 요청한다. 서비스가 임의로 권한 창을 띄우지 않는다. 위치 엔타이틀먼트가
  미확정이거나 조회 오류이면 이전 캐시 좌표·경로·리포트를 표시하지 않고 명시적 확인/오류 상태로 닫는다. 방문 확인 쿼리도
  같은 gate가 열리기 전에는 캐시된 위치 이력을 읽거나 `다녀옴`으로 표시하지 않는다.
  ★사용 정보 접근(PACKAGE_USAGE_STATS)은 아이 기기가 스스로 받는다(2026-08-18 TK 지시): 위치 권한 마법사에
  `usageAccess` 단계를 이어 붙이고, 설정에서 돌아오면 `getDeliveryHealth().usageAccessGranted` 로 실제 상태를 다시
  확인한다. 꺼져 있으면 아이 홈이 7일에 한 번 다시 묻는다(`transform/usageAccessPrompt`, 가족+아이 키).
  부모 화면에는 설정 경로를 시키지 않고 "아이 기기에서 사용 정보 접근을 켜면 보여요" 한 줄만 남긴다.
  ★"다녀옴"은 위치로 확인됐을 때만이다(2026-08-18 TK 제보): 방문 검증을 하는 화면에서 `visited` 판정이 없으면
  장소 미지정 일정이라도 `확인 필요`로 남긴다. 시간이 지났다는 이유로 다녀온 것처럼 단정하지 않는다.
  회귀=`tests/visitVerifyTag.test.ts`.
- **역할 라우트·알림 표시 경계(2026-07-14)**: 부모·아이뿐 아니라 선생님 탭과 알림장 상세도 `RequireRole`로 막아
  URL 직접 입력이 역할 경계를 우회하지 못하게 한다. Android pending 복구는 표시용 알림인지 먼저 판정한 뒤에만
  system/local ACK를 확인하며 `request_location`·`request_device_status`·원격청취 같은 네이티브 명령을 알림 표시 완료로
  잘못 ACK하지 않는다. 메시지·일정·안전 채널은 민감한 본문이 잠금화면에 노출되지 않는 private 채널을 사용하고,
  전체화면 인텐트는 `sos|emergency`와 위급 주변소리처럼 실제 위급 경로에서만 사용한다.
- **알림 큰 아이콘(2026-07-29)**: 혜니 캐릭터 원본은 세로가 더 긴 비율이라 시스템 정사각 슬롯에 채우기로 들어가면
  머리 위와 옷 아래가 잘렸다. `NotificationHelper.largeIcon`은 원본을 자르지 않고(contain) 원형 크롭 여유를 남긴
  정사각 비트맵으로 정규화해 크기별로 캐시한다. 기하는 프레임워크에 의존하지 않는 `NotificationLargeIconLayout`에 두고
  JVM 단위 테스트로 고정한다. 회귀=`tests/notificationLargeIcon.test.mjs`·`NotificationLargeIconLayoutTest`.
- **오늘 경로 시각 포커스(2026-07-29)**: 이동선 실선화 계약은 위치 신뢰 항목에 있다. 여기에 더해 지도 중심과 아이 마커
  좌표는 독립이다 — 머문 곳을 선택하면 지도만 옮기고 아바타는 실제 이력 좌표에 남는다. 기본은 최신 따라가기
  (슬라이더 값 `null`)이고 조회창은 하루 시작+24h로 고정해, 30초 위치 폴링이 부모가 고른 시각과 접어 둔 머문 곳 상세를
  되돌리지 않는다. 신선도는 배경 폴링으로만 유지한다. 명시적 과거 시각은 현재 위치로 대체하지 않고 실제 이력점만
  마커로 표시한다. 회귀=`tests/parentLocationScrubFocus.test.mjs`.
- **눌림 피드백(2026-07-29)**: 실제 버튼은 `hy-press`(전체 축소) 또는 자기 클래스의 `:active` 반응 중 하나를 반드시
  갖는다. 토글 스위치는 트랙이 흔들려 보이지 않게 노브만 `scale(0.9)`로 누르고, 문장 안 글자 버튼은 크기를 바꾸지 않고
  opacity로만 알린다. 보이지 않는 닫기용 스크림은 의도적으로 제외한다. 회귀=`tests/pressFeedbackCoverage.test.mjs`.
- **세션 복구(2026-07-07)**: 역할 선택 화면이 다시 보이면 먼저 WebView `hyeni-api-session-v1`과
  네이티브 `BackgroundLocation.getPushContext()`를 읽기 전용으로 확인한다. WebView 세션만 비고 네이티브
  push context에 userId/familyId/role+refresh가 남은 경우 앱이 1회 `/auth/refresh`로 복구하되,
  응답 userId/familyId/role이 context와 일치할 때만 저장한다. 실기기 검증 스크립트에서 refresh 토큰 값을 출력하거나
  임의 회전시키지 않는다.
- **장기 refresh 체인·resume 무손실 복구(2026-07-12 실사고)**: razr 한 기기에서 2.5일 동안 device-bound
  refresh 행이 88개 누적됐는데 Worker가 폐기 토큰을 20-hop만 추적해, 오래된 holder는 유효한 live 토큰이 남아 있어도
  401을 받았다. 동시에 앱 resume/push/startService가 WebView 토큰을 최신성 비교 없이 네이티브 prefs에 써서 복구본까지
  오래된 값으로 되돌릴 수 있었다. 모든 Web→native write는 반드시 `adoptNativeLocationSessionTokens()`를 먼저 거치고,
  복구는 single-flight로 실행한다. Android `SessionTokenFreshness`도 같은 사용자의 더 오래된 `iat` write를 거부하고,
  동일 초의 서로 다른 토큰은 서버 refresh 응답임이 명시된 경로에서만 수용한다. 동일 사용자 native 토큰 직접 채택 시
  `setApiTokens`만 사용해 `/api/family/mine`으로 보정된 WebView user의 familyId/role 정본을 보존한다.
  Android의 access/refresh 비교·저장은 반드시 `SessionTokenStore`의 synchronized reconcile을 거치며,
  `LocationService.onStartCommand`도 지연 도착한 Intent를 저장 직전에 다시 검증한다(비교-저장 TOCTOU 금지).
  명시적 로그아웃은 store generation을 올려 진행 중이던 native refresh 응답의 세션 부활을 막는다. Worker 체인 복구도
  제시한 refresh 토큰 자체의 30일 만료를 먼저 검사하며, 만료 토큰을 후속 live 체인으로 되살리지 않는다.
  로그인 1회마다 WebView `session_instance_id`를 유지하고 Android는 최근 로그아웃 `sessionNonce` 16개를 bounded tombstone으로 저장한다.
  따라서 로그아웃 전에 시작돼 늦게 도착한 startService/setPushContext/updateToken은 거부되고, 새 로그인 nonce만 다시 활성화된다.
  Web `/auth/refresh`도 요청 전후 nonce가 달라지면 응답을 폐기한다.
  Worker는 보안상 "같은 기기의 최신 live 행"으로 점프하지 않고 `rotated_to` 인과 체인을 재귀 CTE로 최대 2048-hop 추적한다.
  refresh 성공 뒤 개별 API 401은 전체 세션을 삭제하지 않으며, 네이티브 device id 일시 조회 실패도 rejected가 아니라
  재시도 가능한 error로 남긴다. 실패 뒤 생성된 **가족 미연결 anonymous QR 세션만** 기존 native child context의 서버 검증
  복구로 교체할 수 있고, 정상 가족 세션은 절대 덮지 않는다. 회귀 테스트=`tests/nativeSessionResumeSafety.test.mjs`·
  `tests/nativeTokenSync.test.ts`·Android `SessionTokenFreshnessTest`·Worker `refreshChainResync.test.mjs`.
- **세션 family id 정본(2026-07-08)**: access token claim의 `family_id`가 과거 가족 값으로 남을 수 있다.
  `/api/family/mine` 응답이 현재 가족 정본이므로, 가족 조회 성공 시 `hyeni-api-session-v1.user.family_id`와
  role을 `/mine` 기준으로 보정해야 한다. 실기기 검증도 token payload만 보지 말고 localStorage user와 `/mine`
  familyId가 일치하는지 함께 확인한다.
- **위치 끊김 진단(2026-07-09)**: Google Family Link가 같은 시간 정확한 위치를 잡는데 혜니앱 위치만 끊기면
  GPS·네트워크·단말 전원 문제가 아니라 앱 인증/네이티브 업로드 경로를 먼저 본다. razr 로그에서
  `Location upload auth failed (401)`, `missing_refresh_token`, `refresh_http_401`가 보이면 WebView
  `hyeni-api-session-v1`의 access/refresh와 네이티브 `hyeni_location_prefs`의 accessToken/refreshToken
  동기화 상태, D1 `refresh_tokens` 회전 상태를 토큰 원문 없이 확인한다. 라이브 refresh 토큰 원문을 DB에서 읽어
  주입하지 말고, 정상 로그인/페어링 경로로 복구한다. 부모의 `request_location` push 성공은 서버 위치 갱신 성공이
  아니므로, 새로고침 안내는 `/api/location/children`의 해당 아이 `updated_at`이 실제로 증가했을 때만 성공으로 본다.
  부모 위치 화면은 요청 후 새 `updated_at`이 올 때까지 진행 애니메이션과 "마지막 확인 위치" 상태를 보여주며,
  오래된 좌표의 저장장소명을 현재 위치처럼 단정하지 않는다.
  네이티브 위치 서비스는 인증 실패를 이유로 access/refresh token을 삭제하면 안 된다. 세션 삭제는 로그아웃/계정삭제만
  수행하고, 위치 서비스는 `serviceEnabled=false`로 멈춘 뒤 앱 foreground의 정상 세션 재주입을 기다린다.
  `startService`/`requestCurrentLocation`/FCM `request_location` Intent에는 accessToken과 refreshToken을 모두 싣는다.
  WebView 세션이 빈 상태에서는 네이티브 access token을 직접 채택하지 말고, refresh token을 `/auth/refresh`로
  서버 검증해 새 세션을 받은 경우에만 복구한다(만료 access 재채택 루프 방지).
- **위치 시각·동기화·배터리 안정화(2026-07-12 실사고)**: 부모가 22:45에 요청한 위치는 razr가 FCM 수신 뒤
  약 1.1초 만에 GPS fix를 얻었지만 장기 refresh 체인 401로 서버 current가 갱신되지 않았고, 로컬에 남은 66점이
  인증 복구 뒤 한꺼번에 올라오며 신사동 출발을 실제 이탈(16:30경)이 아닌 23:20 알림 시각의 출발처럼 보이게 했다.
  current 정본 시각은 서버 수신 시각이 아니라 Android provider fix 시각이며, D1 단조 upsert로 더 오래된 지연 업로드가
  최신 좌표를 덮지 못하게 한다. `location_history.id`는 `INTEGER PRIMARY KEY` 자동 할당을 쓰고 `MAX(id)+1` 계산을
  금지한다. 같은 `requestId`의 FCM·pending fallback·콜드스타트는 네이티브에서 1개 측위 체인으로 병합하되,
  서버 반영 전에는 완료 ack하지 않아 실패 시 pending 재시도를 보존한다. 부모는 FCM TTL과 네이티브 fallback을 포함해
  `updated_at` 증가를 최대 215초(FCM TTL 120초+네이티브 상한 85초+여유) 확인한 뒤에만 성공을 표시하며,
  화면 이탈·조회 무응답도 deadline 안에서 취소한다.
  즉시 요청과 상시 추적 콜백이 같은 provider fix를 함께 받으면 elapsedRealtime 기준 1회만 업로드하고,
  history insert도 `user_id+recorded_at` 조건부 insert로 중복을 막는다.
  마지막 GPS `accuracy_m`을 부모에게 표시하고 150m 초과는 정확도 낮음으로 강등하며 도착 상태머신 근거에서 제외한다.
  추정 보간점(`is_estimated`)은 머문 곳·일정 방문·출발 시각의 실측 증거로 쓰지 않는다.
  ★부모 오늘경로 이동선은 전 구간 실선 하나다(2026-07-29 TK 제보 — 4시 출발~과천 도착 구간만 점선으로 끊겨 보였다).
  원인은 GPS·서버가 아니라 네이티브가 갭(>150m)을 12m 간격으로 메운 직선 채움점이었다(D1 확진: 같은 날 15:50~16:40
  1184점 중 1014점이 `is_estimated=1`·`accuracy_m` NULL). 채움점은 두 실측점 사이 직선 위의 합성점이라
  `transform/locationHistoryScrub.buildTrailPoints`가 경로에서 제외하고, 남은 실측점을 `strokeStyle:"solid"` 폴리라인
  1개로 잇는다(기하 동일·점 수 1/3). 저정확도 실측점은 숨기지 않으며 `shortdash`·"추정 구간" 범례는 재도입 금지.
  경로가 있으면 머문 곳 순서 연결선은 그리지 않는다(선 두 겹 방지). 회귀=`tests/locationRouteAccuracy.test.ts`·
  `tests/locationHistoryScrub.test.ts`.
  미등록 장소 지연 출발은 첫 실측 이탈 `event_at`과 서버 확인 `detected_at`을 함께 저장하고 지연 기록임을 제목·문구에
  밝힌다. 임의 장소 도착 알림은 anchor episode lease+eventId로 DB 중복을 막고, FCM 0건은 같은 pushId로 재시도해
  단말 중복 표시 없이 at-least-once 전달한다. 자동 stale wake는
  5→15→30→60분으로 백오프하되 부모 수동 요청은 즉시 유지한다. balanced 기본 주기
  (이동 15초·정지 120초)는 정확도/배터리 기준값이므로 근거 없이 더 짧게 만들지 않는다.
- **Android 포그라운드 조회 복구(2026-07-13 실사고)**: Capacitor Android의 `appStateChange`는 브라우저
  `visibilitychange`와 같지 않아, 백그라운드 WebView 조회가 S25에서 멈춘 뒤 서버 위치가 정상이어도 빈 위치처럼 보였다.
  네이티브 `inactive -> active` 전환에서는 `adoptNativeLocationSessionTokens()`를 먼저 완료하고 현재 관찰 중인
  TanStack Query만 `refetchQueries({ type: "active" }, { cancelRefetch: true })`로 갱신한다. `focusManager` 직접 연결은
  `resumePausedMutations()`를 호출할 수 있으므로 금지하며, 위치 요청·결제·AI·원격제어 mutation을 자동 실행하지 않는다.
  네이티브 `QueryProvider`는 브라우저 `visibilitychange`와 이 경로가 겹치지 않도록 `refetchOnWindowFocus=false`, 웹·PWA는
  기존대로 `true`를 사용한다. 중복 active 이벤트는 무시하고 복구 중 새 전환은 한 번만 직렬 처리한다. 완료 판정은 S25 일반
  복귀 동선에서 동일 API 묶음이 1회만 시작되는지와 CDP/API 갱신, razr 세션·위치 서비스 유지를 함께 확인한다. 격리 worktree에
  ignored `.env`가 없으면 **주 체크아웃 `.env`의 `VITE_*`만 빌드 프로세스 환경에 일시 주입**하고, `CLOUDFLARE_*`는 읽거나
  복사하지 않는다. Android 동기화 전에는 `VITE_KAKAO_APP_KEY`가 최종 번들에 실제 포함됐는지를 값 노출 없이 확인한다.
  키 없는 APK의 "지도를 불러오지 못했어요"는 위치 API 장애와 구분하며, 최종 실기기 지도 캔버스 검증 전에는 설치 완료로 보지 않는다.
- **일정·도착 알림 신뢰성 계약(2026-07-13)**: 반복 일정은 고정 UUID+`series_id`를 가진
  `POST /api/events/batch` 한 트랜잭션으로 event·자녀 링크·기존 알림 claim까지 함께 저장한다. `notif_override=null`은
  사용자 기본 설정, 명시적 빈 배열은 사전 알림 없음이므로 기본 15·5분으로 되살리지 않는다. 서버 cron은 목표 분보다 일찍
  보내지 않고 정각~2분 지연만 복구하며, 수신자별 `pending_notifications`를 FCM보다 먼저 저장한다. HTTP 200이나
  FCM 토큰 0건만으로 delivered 처리하지 말고 실제 네이티브 표시 또는 FCM ACK만 완료로 인정한다.
  batch 서버는 0-index `date_key`의 실제 날짜, 비어 있지 않은 제목, `HH:MM` 시간, 유효 좌표쌍 또는 주소 전용 장소,
  `null` 또는 1~1440분 정수 배열 알림 override를 저장 전에 검증해 화면에서 사라지는 무효 일정을 차단한다.
  일정 도착·미도착은 80m, 신선도·정확도·오차반경을 함께 검사하고 150m 초과/오래된 좌표는 미도착으로 단정하지 않는다.
  일정 도착 확정 창은 시작 15분 전~60분 후이며, 같은 장소에 너무 일찍 도착하면 일정명으로 단정하지 않고 장소 도착으로
  알리되 occurrence를 연결해 뒤 알림과 중복되지 않게 한다. 등록장소·일정·미도착의 DB/push/pending 키는 native·서버가
  동일하게 만들고, 공동부모 설정 차이를 보존하도록 delivery claim은 수신자별로 잡는다. 실제 Web/FCM 채널이 있는데
  전송 전 claim은 `first_sent_at=NULL`+60초 lease로 두고 성공 뒤에만 완료한다. 전송이 실패한 수신자 claim은 풀고
  같은 push id로 재시도하며, 채널이 없으면 durable pending으로 foreground 복구한다.
  Android는 실제 provider 시각과 `accuracy_m`만 이력에 올리고, 근접 일정 증거용 고정밀 fix는 3분 간격으로 제한해 배터리를 보호한다.
  일반 위치·이력 업로드는 인증 caller 본인+현재 가족의 활성 child만 허용하고, 머문 곳/경로 방문 증거는 추정점·정확도 미보고·75m 초과점을 제외한다.
  스키마 의존성=`events.series_id`, `location_history.accuracy_m`, `idx_push_sent_event_notif`.
- **Capacitor SystemBars 패치(2026-07-09)**: Android WebView 시작 직후 `document.documentElement`가 아직
  없을 때 기본 `SystemBars` safe-area CSS 주입이 콘솔 오류를 낸다. `postinstall`의
  `scripts/patch-capacitor-systembars.mjs`가 DOM 준비 전 주입을 건너뛰게 패치하므로, 의존성 재설치 후에는
  반드시 `npm install` 또는 해당 스크립트를 실행한 뒤 Android 빌드를 검증한다.
- **설정/가입/오늘경로 안정화(2026-07-08, 이동기록 UI 2026-08-07 갱신)**: 부모 `/friend-play`는 아이 요청 UI가 아니라 가족 친구놀이 허용 설정을
  보여준다. 장소 관리는 서버/AI 생성 없이 `resolvePlaceVisual`의 정적 asset 매핑으로 장소명에 맞는 이미지를 고른다.
  가입 전 설문은 진행률 20%에서 시작하고 복수 선택만 수집한다. 부모 오늘경로는 오전 8시를 하루 시작으로 보며,
  00~07시는 전날 경로에 포함한다. 최신 따라가기의 경로 로딩 중에는 서울 기본점보다 현재 위치를 우선 표시할 수 있지만,
  부모가 과거 시각을 고른 뒤에는 실측 이력점이 없으면 현재 위치로 대체하지 않는다. 이동기록 카드는 드래그하지 않고
  명시적 버튼으로 머문 곳 상세만 펼치고 접으며 시간 막대는 항상 남긴다. 오늘경로에서는 상단 아이 배지를 숨기고
  시간대별 경로 UI만 남긴다.
  로컬 mock 검증 시 현재 시각이 08시 전이면 mock 이력도 `/api/location/history`의 `start` 파라미터 기준으로 만든다.
- ★**시간대별 경로 조작 정본(2026-08-07 TK 제보)**: 슬라이더로 시각을 옮기면 ①시각·장소·시간 막대가 있는 탐색 카드와
  사용자가 정한 머문 곳 펼침 상태를 그대로 유지하며 ②그 시각의 마지막 확인 위치를 지도 중심(`center`)으로 잡고
  해당 머문 곳을 자동 강조하고 ③하루 전체 축척으로
  멀어져 있으면 `centerLevel=4`까지만 당긴다(이미 더 확대한 화면은 유지 — 확대 방향 보정만). `KakaoMap`은 명시적
  `center`가 있으면 `setBounds`로 덮지 않는다. toolbar/panel의 실제 DOM rect를 `ResizeObserver`로 재서
  `viewportPadding`을 만들고 `setCenter` 뒤 `panBy`해 아이 마커를 두 오버레이 사이의 가시 지도 중앙에 둔다.
  자녀 아바타는 `center`가 아니라 자기 실측 좌표에 그리고, 과거 탐색 중에는 선택 시각 배지를 붙여 머문 곳 마커보다 위에 둔다.
  연속 드래그의 시각·경로·아바타·배지는 입력마다 즉시 갱신하되 지도 중심 좌표와 실제 DOM 여백은 160ms 동안 함께 고정하고,
  입력이 멈춘 뒤 같은 렌더에서 한 번만 확정한다. 슬라이더 입력마다 `recenterKey`나 `setCenter→panBy`를 실행하거나 드래그 시작에
  머문 곳을 자동으로 접어 패널 높이를 바꾸면 지도가 떨리므로 금지한다.
  슬라이더 상태는 `null`=최신 따라가기이고 30초 위치 폴링(`now` 갱신)으로 부모가 고른 시각·접어 둔 상세를 되돌리지 않는다.
  `/api/location/history` 쿼리 키의 끝시각은 하루 창 끝(시작+24h)으로 고정하고 신선도는 화면이 열려 있는 동안의
  60초 배경 폴링으로 유지한다(끝시각에 `now`를 넣으면 키가 매번 바뀌어 하루치를 다시 받고 슬라이더가 최신으로 튄다).
  탐색 카드는 선택 시각과 위치(머문 곳 이름/이동 중/기록 없음), "최신 위치" 버튼을 보여주고 판정 시각은 마지막 기록
  시각으로 clamp 해 기록이 끊긴 뒤를 "이동 중"으로 단정하지 않는다. 선택 시각 이전에 실측점이 없으면 현재 위치를 대신
  그리지 않으며 "기록 없음"으로 닫는다. 최신 위치로 돌아가면 시각 배지를 제거하고 하루 경로 전체 bounds를 복원한다.
  회귀=`tests/parentLocationScrubFocus.test.mjs`·`tests/locationHistoryScrub.test.ts`·
  `tests/mapViewportPadding.test.ts`·`tests/locationJourneyPanelContract.test.mjs`.
  로컬 검증 팁: Kakao JS 키는 도메인 제한이 있어 로컬 하니스에서 실 SDK가 로드되지 않으므로, `window.kakao.maps`
  계측 스텁(Polyline/Map 호출 기록)을 주입해 선 스타일·`setCenter/setLevel/setBounds` 결정을 확인한다. 5173 포트는
  다른 프로젝트가 쓸 수 있으니 preview 포트를 따로 잡고, mock 이력은 08시 하루 창(자정 이후=전날 08시) 기준으로 만든다.
- **메뉴·페어링 안정화(2026-08-07)**: 부모 홈 바로가기는 `AI 일정 → 위치추적 → 친구놀이 → 장소관리 → 주변소리 →
  안심리포트 → 아이 기기 찾기 → 알림` 순서와 실제 라우트를 회귀 테스트로 고정한다. `아이 기기 찾기`는 활성 아이
  `user_id`를 `/remote-ring`에 명시한다. 구독은 그리드 아래 가로 카드로 분리하고 Free·reviewed는 `구독 시 혜택`,
  Premium은 `구독 관리`, 미확정·오류는 `구독 정보`로 표시해 Free로 추정하지 않는다. 부모 설정 메뉴는 emoji 칩 대신
  lucide/image 아이콘 + `data-tone` 토큰 색상만 사용한다. 페어링 위저드는 `/api/family/mine`과 엔타이틀먼트가
  모두 확정되기 전 2명 선택과 코드 생성을 막고, 코드 생성 직전에도 현재 티어의 아이 수 상한을 다시 검사한다.
- ★**부모 홈 히어로 캐러셀(2026-08-26)**: 판정 정본은 `src/transform/parentHomeHeroCarousel.ts` 하나이고 서버
  (`worker/lib/parentHomeHeroControls.ts`)는 같은 범위를 재검사만 한다. **첫 장은 항상 `today`**, **`ad` 종류만
  구독 가족에게서 숨기고** `promo`(자사 소식)는 티어 무관, **엔타이틀먼트 미확정은 무료로 강등하지 않는다(R9 —
  today 한 장)**. 표시 개수·자동 전환은 `app_global_settings.parent_home_hero_carousel_v1` 한 행이라 스키마 변경이
  없고, API 는 관리자 `GET|PUT /api/admin/hero-carousel`(비운영자 404·`no-store`)과 소비자
  `GET /api/family/hero-carousel`(활성 부모만·실패는 기본값)이다. ⚠️ `ad` 를 켜려면 Play 「광고 포함」 선언과
  스토어 설명 문구를 함께 고쳐야 한다. ⚠️ 스크롤 지시는 클릭 핸들러가 아니라 **커밋 뒤 rAF effect 한 곳**에서만
  한다(같은 프레임 재스냅이 smooth 스크롤을 되돌려 A17 에서 화살표가 먹지 않았다). 가로 스크롤은 트랙 안에서만
  일어나야 한다(문서 가로 스크롤은 CDP 스모크 실패). 자세한 계약은 CLAUDE.md 의 같은 항목이 정본이다.
- ★**부모 홈 글래스모피즘(2026-08-19, wiki)**: 색은 페이지 배경(`.ph-page::before`)에만 두고
  카드(`.ph-glass`)는 반투명 `--bg-card` + `backdrop-filter` + 밝은 흰 획이다.
  섹션 안 그라데이션·어두운 안쪽 선(뉴모피즘)은 쓰지 않는다. AI·구독·친구 초대가 같은 면이다.
  2열 4버튼 라우트(`voice`/`text`/`image`/`mode=academy`)는 유지한다. 장식 배지·흰 글자 파스텔 CTA는
  쓰지 않고, `prefers-reduced-transparency` 에서는 워시를 숨기고 솔리드 `--bg-card` 로 폴백한다.
- **OAuth 딥링크 1회 소비(2026-07-10)**: 인가코드는 1회용인데 Capacitor `App.getLaunchUrl()` 이 실행 인텐트를
  계속 반환하고 `appUrlOpen` 도 같은 인텐트를 줘, 콜드 스타트에서 code 가 2~3회 교환됐다. 구글은 코드 재사용 시
  발급 토큰을 전부 무효화해 로그인이 실패하고(카카오는 먼저 도착한 요청만 성공해 은폐), D1 에는 세션 행이
  1건만 남아 정상처럼 보인다. `transform/oauthCodeOnce.ts` 로 `provider:code` 당 1회만 교환(실행 직전 영속화),
  딥링크 리스너는 참조 카운트로 1개만 유지. nonce 는 localStorage 에도 저장해 프로세스 재생성 시 CSRF 검사가
  조용히 skip 되지 않게 한다.
  검증 함정: `wrangler tail --format json` 은 pretty-print 라 JSONL 파싱하면 0건으로 보인다(`raw_decode` 스트림 파싱).
  CDP `consoleAPICalled` 의 Error 인자는 `description` 에 담긴다.
- 소셜 로그인 계정 연결(2026-07-10): 전화(ID/PW) 가입 계정은 `users.email` 이 NULL 이라, 같은 사람이 소셜로
  로그인해도 서버가 identity 를 못 찾아 "신규"로 보고 `409 email_conflict_other_account` 로 영구 차단했다.
  실제 TK 계정(a41278ce)은 email NULL 이고 `tkisdroid@gmail.com` 은 미사용 잔재 계정(dc82b21f)이 갖고 있었다.
  ①`lib/oauthLink.ts decideOAuthLink`: 소유자 없으면 create, provider 가 **검증한** 이메일이면 link,
  폴백 이메일·익명 소유자·미검증은 거부(탈취 방지). ②`POST /api/auth/oauth/:provider/link`(requireAuth)로
  로그인 상태에서 소셜을 추가 연결한다(같은 provider 의 다른 계정도 추가 가능, 남의 identity 는 `identity_taken` 409).
  ③`POST /api/auth/oauth/:provider/unlink`(requireAuth, body `provider_id`)로 연결을 끊는다.
  **마지막 로그인 수단은 해제 불가**(`decideOAuthUnlink`: 비밀번호 로그인 없고 남는 소셜 0개면 409 `last_login_method`).
  앱은 부모 설정 → 계정 → "소셜 로그인 연결"(네이티브 전용, 웹은 안내만). 목록은 provider 가 아니라 **계정 단위**로
  보여준다(같은 provider 에 계정 2개 가능). 계정 교체 = 새 계정 연결 → 옛 계정 해제 순서.
- 미도착 알림은 SOS 전면화면 전환 대상이 아니다: `transform/urgentAlert.ts` 가 단일 출처이며 `sos`/`emergency` 만
  부모 화면을 가로챈다. `not_arrived` 는 FCM 전체화면과 알림 목록으로 전달한다(오래된 위치면 severity=warning 로 강등됨).

- ★아이모드 AI 친구 = 살아 있는 3D 캐릭터 + 도구 에이전트(2026-08-24 TK 지시):
  AI 진입점은 네모난 로봇 버튼이 아니라 TK 원본 1024px 투명 PNG 18종을 변환한
  `public/assets/ai-buddy/poses/*.webp`다. `scripts/import-ai-buddy-chat-emotions.mjs`가 여백을 trim한 뒤
  288px contain+16px 투명 여백의 320px WebP로 만들며, 배경·둥근 사각형을 다시 씌우지 않고
  `object-fit:contain`+알파 `drop-shadow`로 휴대폰 위에 선 전신 실루엣을 살린다. 20개 의미 face→18개 실제 pose
  매핑과 판정 정본은 `src/transform/aiBuddyEmotion.ts` 하나다. 입력 타입이 chat face임을 아는 소비자는
  `aiBuddyChatFaceAsset`을 써야 한다(`excited`가 emotion/face 양쪽에 있어 범용 함수는 emotion을 우선한다).
  플로팅 버튼·아이 홈 타일·대화 헤더·타이핑·음성 화면이 같은 캐릭터를 쓴다. 아이가 속상하면 같이 슬퍼하지 않고 다독이며
  (caring), 확인 대기 중에는 해낸 표정(excited)을 짓지 않는다. 플로팅 버튼(`src/app/AiBuddyFab.tsx`)은
  ChildShell·PushShell 에서 아이 세션에만 뜨고, 위치를 px 가 아니라 이동 가능 영역 비율로 가족+아이 키에 저장한다
  (`src/transform/aiBuddyFabPosition.ts`). **아이 홈만 88px 활동형**으로 배회·말풍선·커짐/전체화면 부르기를 허용하고,
  나머지 아이 화면은 **68px 조용한 친구**로 제자리에 숨쉬기만 하며 배회·선제 말풍선·부르기를 금지한다.
  작은 모드는 하단 입력/빠른 문구를 가리지 않도록 기존 shell inset에 96px를 더 비운다. 진입 번들 예산 때문에
  lazy+Suspense 로 붙여야 build 가 통과한다.
  표정 상태는 라우터 위 `AiBuddyMoodProvider` 한 곳에서 들고 있어야 화면을 옮겨도 기분이 이어진다.
  서버 도구에 아이 본인 설정 3종(`updateNotificationSettings`·`updateAiFriendName`·`changeAppTheme`)을 더했고
  셋 다 LLM 없이 답해 하루 대화 횟수를 깎지 않는다. **일정 삭제는 보호자 전용**이라 planner 는
  `schedule_delete_parent_only` 로 닫고 route 는 확인 토큰이 와도 403 이다. 부모 소관 알림 설정도 정직하게 거절한다.
  **아이 AI 일정 생성 정본(2026-08-24)**: 날짜 표현이 없으면 KST 오늘로 등록하되, 해석하지 못한 날짜 지시어가 있으면
  오늘로 추정하지 않고 되묻는다. 후속 정보는 exact 되묻기와 DB `created_at` 기준 10분 TTL 안에서만 합치고,
  동률 행은 `rowid DESC` 조회 후 reverse해 실제 user→assistant 순서를 보존한다. 취소·새 도구 intent·인사/주제 전환은
  제목보다 우선한다. `events`+`events_children`은 `persistAiChildSchedule` D1 batch로 원자 저장하며 생성·확인 수정 뒤
  `notifyPg(..., "events", "INSERT|UPDATE", ...)`로 활성 가족 기기의 일정 query를 갱신한다. 회귀는
  `worker/tests/aiChildSettingsAgent.test.mjs`·`aiChildChatContext.test.mjs`·`aiChildSchedulePersistence.test.mjs`·
  `realtimeAudienceIsolation.test.mjs`가 보호한다.
  한 얼굴 원칙: 대화 말풍선 옆·타이핑·설정 미리보기까지 같은 이모티콘을 쓰고 동물은 얼굴이 아니라 성격 카드다.
  헤더 상태 문구는 짧은 반말 + nowrap 말줄임(전엔 "이야기 할 준비됐/어"로 끊겼다).
  일정 성격별 제안은 `src/transform/eventCompanionPrompt.ts` 와 `worker/shared/aiEventContext.js` 가 같은 키워드
  표를 쓰며 테스트가 동기화를 강제한다(생일에 준비물을 묻지 않는다).
  아이를 알아 가는 부분: 맥락 14턴·요약 5건·장기기억 30건(확신도 우선), 열린 어휘 기억 추출,
  반복 시 confidence +0.05(상한 0.95), 아이 대화만 reasoningEffort low + 예산 900.
  ⚠️ 조사 처리에서 `이` 는 떼지 않는다(고양이·떡볶이가 망가진다).
  기기 동작은 열어 주기만 한다(2026-08-18 TK 지시): 소리·진동·무음, 전화, 문자, 와이파이 같은 부탁을 앱이
  대신 실행하지 않는다. 도구는 openDeviceAction 하나이고 target 화이트리스트 7개(sound|wifi|battery|
  notifications|location|dial|sms)만 연다. 서버는 화면만 정하고 대화 아래 버튼을 아이가 눌러야 열린다.
  전화는 ACTION_DIAL, 문자는 ACTION_SENDTO 라 발신·전송은 사람이 누른다. 무음을 앱이 바꾸려면 방해금지 접근이
  필요하고 부모의 SOS·소리 울리기가 조용해질 수 있어 넣지 않았다(새 권한 0개). 전화·문자는 부모 연락 허용을 따른다.
  대기 중 배회·말 걸기(2026-08-18 TK 지시): 경로 정본은 `src/transform/aiBuddyWander.ts`(순수·시드 결정적)로
  9초마다 한 걸음, 좌우 가장자리에만 서고 세로 8~92% 띠 안에서 최대 0.34비율, 세 걸음마다 반대쪽으로 건너간다.
  이동 얼굴은 `excited`→`rush`(달리기 pose), 도착 얼굴은 이동 얼굴을 뺀 대기 동작에서 뽑고 세 걸음마다
  반말 한 마디를 2.6초 띄운다(`pointer-events:none`·`aria-hidden`·바깥쪽 가장자리 정렬). 배회 자리는 저장하지
  않으며 드래그 직후 20초·드래그 중·실제 대화 감정·`document.hidden`·움직임 줄이기에서 멈춘다.
  ⚠️ 배회 interval effect 의 의존성에 `emotion` 을 넣으면 도착 표정·말풍선 타이머가 취소된다(`emotionRef` 사용).
  자산·모드 회귀=`tests/aiBuddyCharacterAssets.test.mjs`·`tests/aiBuddyCharacterBehavior.test.ts`·
  `tests/aiBuddyFab.test.ts`; 일정/Worker 회귀=`tests/eventCompanionPrompt.test.ts`·Worker
  `tests/aiChildSettingsAgent.test.mjs`·`tests/aiChildMemoryDepth.test.mjs`.
- ★**AI 친구 음성 turn 자동 답변(2026-08-18 TK 승인)**: 마이크가 만든 `source="voice"`의 정상 reply는 가족+아이 읽어주기 설정이 꺼져 있어도 그 turn만 자동 TTS한다. `composer`·`suggestion:*`·`confirm`은 기존 영구 설정을 따르고, 빈·오류·한도 응답은 읽지 않는다. 새 마이크 시작·토글 off·화면 이탈은 STT/TTS를 즉시 중단하며 초기화 중이던 오래된 native callback도 재생을 되살리지 않는다. 사용자 음성 원본은 Worker·OpenAI에 보내지 않고 인식 텍스트만 기존 안전·크레딧·저장 경로로 보낸다. 단 OS·브라우저·선택된 STT/TTS 제공자는 음성 또는 합성할 답변 텍스트를 외부 처리할 수 있으므로 “항상 기기 안에서만 처리”라고 고지하지 않는다. TTS는 추가 API·크레딧·권한 없이 fail-soft이며 10개 locale 태그를 전달한다. 회귀=`tests/childVoiceChat.test.ts`·`tests/nativeTtsCdpProbeSafety.test.mjs`·Android `SpeechLocalePolicyTest`/`SpeechPlaybackGenerationTest`·`worker/tests/legalCopy.test.mjs`·`tests/playReleaseDocumentation.test.mjs`.
- ★**꾹 누르면 바로 말하기 + 버튼이 그걸 알려 준다(2026-08-19 TK 지시)**: 플로팅 AI 친구 버튼을
  `AI_BUDDY_VOICE_LONG_PRESS_MS`(550ms) 이상 누르면 전환 연출을 거쳐
  `navigate("/child/ai-friend", { state:{ startVoice:true, buddyLaunch:true } })` 로 대화창이 열리고 마이크가 바로 켜진다. 길게 누른 것 자체가 아이의 조작이라 "자동 실행"이 아니다.
  대화 화면은 state 를 즉시 `replace` 로 지워 뒤로가기 재진입에 다시 켜지지 않게 한다.
  드래그로 옮기는 중이면 타이머를 취소하고, 발동한 뒤에는 손을 떼도 대화창을 또 열지 않는다.
  안내 말풍선은 `src/transform/aiBuddyVoiceHint.ts` 판정 — **한 번 써 본 아이에게는 다시 띄우지 않고**
  안 써 본 아이에게도 하루 한 번·최대 3회다. 회귀=`tests/aiBuddyFab.test.ts`.
- ★**AI 친구가 스스로 아이를 부른다 · 부모가 끌 수 있다(2026-08-19 TK 지시)**: 아이는 구석의 작은 버튼을
  그냥 지나친다. ①**부르기** — 정본은 `src/transform/aiBuddyAttention.ts` 하나다. 화면에 들어온 지 20초 뒤부터
  15초마다 판정해 **커졌다 작아지거나**(`grow`) **화면을 채우고 말을 건 뒤 스스로 물러난다**(`full`).
  첫 번째는 `full`, 그 뒤로는 세 번에 한 번만 `full` 이고 하루 8회·최소 간격 5분이며 날짜는 KST 로 센다.
  드래그 직후 20초·대화 감정 표시 중·`document.hidden`·움직임 줄이기에서는 부르지 않는다(배회와 같은 게이트).
  ⚠️ 화면을 채운 오버레이는 **modal dialog 가 아니다** — 스스로 물러나므로 focus 를 가두면 대화 중이던 아이를
  막는다. `role="dialog"` 를 붙이지 말고 scrim 은 `tabIndex={-1}` 로 Tab 순서에서 뺀다.
  ②**부모 스위치** — `ai_parent_settings.buddy_attention_enabled`(D1 컬럼, 기본 1=켜짐). 부모 설정 > AI 친구의
  「AI 친구가 먼저 말 걸기」 토글이며, **아이 기기가 그 값을 알아야 하므로 `FRIEND_PUBLIC_COLS` 에도 넣는다**
  (부모 전용 `FRIEND_SELECT_COLS` 에만 넣으면 부모가 꺼도 아이 화면은 계속 부른다). 운영 순서 =
  `worker/db/ai-buddy-attention.sql` 적용 → Worker 배포 → Pages/Android. 설정을 아직 못 읽었으면 조용히 있는다
  (`ai_enabled === true` 이고 `buddy_attention_enabled !== false` 일 때만 부른다).
  ③**먼저 알려 주는 말** — 정본은 `src/transform/aiBuddyNudge.ts` 다. 안 읽은 부모님 메시지 > 다음 일정 >
  아직 못 챙긴 준비물 > 그냥 부르기 순이고, **부모 메시지는 무조건 1순위**, 나머지는 돌아가며 말해 같은 말만
  반복하지 않는다. 재료는 `src/queries/useAiBuddyNudge.ts` 가 아이 홈·대화 화면과 **같은 query key** 로 받아
  캐시를 공유한다(AI 친구가 꺼진 가족은 조회 자체를 하지 않는다). 일정 한 마디는 `eventCompanionAsk` 한 곳에서
  고른다 — nudge 가 자기 규칙을 갖고 있으면 "축구 시합"에 축구화를 묻는다(시합·발표는 응원이 먼저다).
  ⚠️ 이 **알려 주는 동작은 부모 스위치와 무관하게 유지된다** — 스위치는 "커지는 연출"만 끈다.
  회귀=`tests/aiBuddyFab.test.ts`·`worker/tests/aiBuddyAttentionSetting.test.mjs`.
- ★**꾹 누른 뒤 대화창까지 한 동작으로 잇는다(2026-08-19 TK 제보 "흐름이 끊어져 보여요")**: 정본은
  `src/transform/aiBuddyLaunch.ts` 하나다(크기·시간을 화면마다 따로 두면 중간에 툭 튄다).
  ①버튼이 `AI_BUDDY_HANDOFF_FACE_PX`(168px)로 커지며 화면 가운데로 가고(`AI_BUDDY_LAUNCH_MS` 300ms)
  ②대화 화면이 **같은 크기·같은 자리**에서 받아 제자리로 줄이며 내용을 올린다(`AI_BUDDY_ENTER_MS` 460ms).
  넘길 때 `state:{ buddyLaunch:true }` 를 함께 보내고 대화 화면은 첫 렌더에서만 붙잡은 뒤 히스토리에서 지운다
  (안 지우면 뒤로 갔다 올 때마다 연출이 반복된다). `startVoice` 는 꾹 누른 경우에만 실려 그냥 탭으로 들어오면
  마이크가 켜지지 않는다. ⚠️ 전환 중에는 `useLayoutEffect` 의 위치 복원과 `ResizeObserver` 재배치를 멈춰야
  한다 — 안 그러면 가운데로 가던 버튼이 제자리로 튕겨 전환이 깨진다. 움직임 줄이기에서는 지연 0 으로 바로 연다.
- ★**말할 때는 글 대신 파형이 움직인다(2026-08-19 TK 지시)**: 음성으로 대화하는 동안 대화 화면 위에
  얼굴+파형(`.afc-voice`)을 덮어 아이가 글을 읽지 않아도 되게 한다. 듣는 중 얼굴=`AI_BUDDY_LISTENING_FACE`,
  말하는 중=`AI_BUDDY_SPEAKING_FACE`(얼굴은 여전히 한 세트다). ①**파형은 실제 목소리다** — Android
  `SpeechPlugin.onRmsChanged` 가 `speechRms` 이벤트로 dB 만 보내고(음성 자체는 보내지 않는다)
  `normalizeSpeechRms`(`src/transform/childVoiceWave.ts`)가 0~1 로 좁힌다. 값은 state 가 아니라 **CSS 변수**
  `--voice-level` 로 흘린다(초당 10회 리렌더 방지). 값이 한 번도 오지 않는 기기(웹)는 `data-level="live"` 가
  붙지 않아 기본 파형 애니메이션으로 정직하게 강등한다. ②**말하는 중 판정** — `onSpeechPlaybackState` 가
  네이티브 `ttsState`(started/done/error/stopped)와 웹 `SpeechSynthesisUtterance` 이벤트를 함께 전한다.
  종료 신호를 못 주는 기기가 있어 `estimateSpeechDurationMs` 상한 타이머를 함께 건다 — 파형이 영영 안 멈추면
  "아직 말하는 중"이라는 거짓말이 된다. ③아이가 글을 보고 싶으면 「글로 볼래」로 접고 마이크를 다시 켜면
  돌아온다. 접었을 때만 기존 `.afc-listening` 한 줄 표시가 나온다(움직이는 표시자는 화면에 하나).
  회귀=`tests/childVoiceChat.test.ts`.
- ★**AI 친구는 아이를 알아 가는 친구다(2026-08-19 TK 지시)**: ①**습관 기억** — 아이가 지나가듯 말한 습관을
  `worker/shared/aiChildHabits.js` 가 뽑아 기존 장기기억(`ai_long_term_memories`)에 `type:"habit"` 으로 저장한다
  (스키마 무변경). "집에 오면 내일 일정 정리해" → 집 도착 geofence 때 `buildHabitHomeArrivalMessage` 가
  "늘 하던 대로 일정 정리 같이 할까?"로 먼저 제안한다. ②**활동별 챙길 물건** — `ACTIVITY_BELONGINGS`(태권도→도복·띠)
  로 "준비물 챙겼어?" 대신 물건 이름으로 묻는다. 클라 표는 `src/transform/childBelongings.ts` 이고 두 표의 동기화는
  `tests/childRelationshipContext.test.ts` 가 강제한다. ⚠️ 성격 게이트(`BELONGINGS_EVENT_KINDS`) 없이 표만 쓰면
  "학교 생일 파티"에 알림장을 묻는다. 인사말 교체는 `lesson` 에만 적용한다 — 시합·발표는 물건보다 응원이 먼저다.
  ③**물건을 자주 두고 오는 아이** — 등록 장소를 **떠날 때**(`trigger:"place_departure"`) 한 번만 확인해 준다.
  할 말이 없으면 빈 문자열을 돌려 `no_useful_context` 로 조용히 끝나고 크레딧도 쓰지 않는다.
  회귀=`tests/childRelationshipContext.test.ts`·`tests/eventCompanionPrompt.test.ts`.
- ★**아이 하루 대시보드 = 프리미엄 1회성 알림(2026-08-19 TK 지시)**: KST 20~23시에 `*/10` cron 이
  `worker/cron/child-daily-digest.ts` 로 프리미엄 가족 아이의 하루를 정리해 **하루·아이당 한 번** 부모에게 보낸다.
  1회성 보증은 `child_daily_digests` PK(family, child, date) + `INSERT OR IGNORE` 이고, 행을 실제로 만든 실행만
  알림을 보낸다. 알림은 `/child-digest?alert=&child=` 로 대시보드 화면을 연다.
  ⚠️ **대화 원문은 payload 에 넣지 않는다** — 주제(`CHILD_CHAT_TOPICS`)·집계·부모 공개 장기기억만 담는다.
  기록이 0이면 아예 만들지 않는다(`shouldSendChildDailyDigest`). 엔타이틀먼트 조회 실패는 프리미엄으로 추정하지
  않는다(fail-closed). 운영 순서 = `worker/db/child-daily-digest.sql` 적용 → Worker 배포 → Pages/Android.
  회귀=`worker/tests/childDailyDigest.test.mjs`.
- ★AI 실패 안내는 하나로·정직하게(2026-08-17 실사고): 전역 MutationCache 폴백은 `mutation.options.onError`
  만 보므로 콜사이트 `mutate(vars,{onError})` 로는 막히지 않는다. 화면이 자기 문구를 책임지면 훅 정의에
  `meta:{silentError:true}` 를 단다. 그리고 429 는 네트워크가 아니라 공급자 한도·잔액이므로
  `ai_provider_busy`(503)로 분리해 "연결이 안 됐어"라고 거짓 안내하지 않는다. 상태 코드만으로 원인을 단정하지
  말고 `providerErrorCode`(짧은 enum 만) 로그를 먼저 남긴다. 회귀=`tests/aiChatFailureUx.test.ts`.
- 아이모드 리디자인(2026-07-10, 시안 `아이모드 리디자인.dc.html` 2a 확정): 홈이 "오늘 모험 지도"로 바뀌었다.
  ①지도 노드는 **오늘 일정에서 파생**(`transform/adventureMap.ts`) — 실제 지리 좌표가 아니라 하루의 흐름을 그린
  여정 그림이라 고정 슬롯 4개에 시간순 배치하고, 일정이 5개 이상이면 다음 일정을 포함하는 창을 고른다.
  지도는 화면 최상단부터 그려지므로 `--kd-safe: env(safe-area-inset-top)` 로 상태바 겹침을 막는다
  (absolute 자식은 padding 을 무시하므로 장식은 `.kd-map__stage`, 노드·혜니는 `margin-top` 으로 함께 내린다).
  ②시안의 목업은 반입 금지: 부모 1초 자동응답·AI 고정응답 배열·하드코딩 친구(도윤/걸어서 4분)·가짜 알림장
  ("줄넘기 검사")·인앱 통화중 오버레이(다이얼러가 화면을 덮어 실제로 안 보인다). 회귀 테스트=`tests/childRedesignWiring.test.ts`.
  ③준비물 rename 은 `finishEdit` 에서 **하나씩 await**. daily_supplies 는 항목 API 가 없어 "그 날 행 전체 재작성"이라
  병렬 저장하면 뒤 요청이 앞 요청을 덮는다. 편집 버튼은 항목 0개일 때도 눌려야 첫 항목을 넣을 수 있다(실기기 회귀).
  준비물 아이콘은 `resolveEventVisualAsset(label)` 재사용 — 장소관리·일정등록과 같은 출처("태권도복"→도복).
  ④스티커북은 12칸 도감. `stickers` 테이블에 보낸 사람·메시지 컬럼이 없으므로 상세 모달은 아는 사실만 말한다
  (받은 날짜 + `sticker_type`: praise=부모 칭찬 / early·on_time=일찍 도착). NEW=최근 7일 + 미열람(기기 로컬 저장).
  ⑤내 색깔(accent)은 서버 스키마에 컬럼이 없어 `localStorage` 가족+아이 키에만 저장한다. 부모·선생님 세션은 rose 고정.
  ⑥아이 AI 남은 횟수는 `/api/ai/usage/today`(parent-or-self) + `daily_limit` 으로 계산한다.
  `/api/ai/credits/balance` 는 부모 전용이라 아이 화면에서 호출하면 403.
  ⑦하단 독(`app/ChildDock.tsx`)의 SOS 는 화면 이동만 하고, 실제 발사는 SOS 화면에서 3초 홀드해야 한다(오발사 방지).
  ⑧Jua 폰트는 Google 서브셋 87개를 `public/fonts/jua/` 에 번들(OFL). 오프라인·네이티브에서 원격 폰트를 못 받기 때문이며,
  PWA precache 에서는 제외한다(`globIgnores`). 지도 배경 4종은 `assets/06-backgrounds/` 원본을 webp 로 변환해 `public/assets/bg/`.

- 지도 로딩 성능(2026-07-10): 부모가 아이 위치·경로를 볼 때 느린 원인은 **지도가 아니라 앞단**이다.
  실측(A17): Kakao SDK 21ms · 첫 타일 121ms 인데 `POST /api/kakao/walking-directions` 가 2184ms 였다.
  ①서버는 카카오 도보(제휴 전용·상시 403)를 기다린 뒤 OSRM 을 불렀다 → `Promise.all` 로 동시 호출
  (제휴 승인되면 카카오가 이김). ②도보 경로 7일·역지오코딩 30일 캐시. **`caches.default` 는 workers.dev 에서
  no-op** 이라 `worker/lib/edgeCache.ts`(D1 `edge_cache` + 아이솔레이트 메모리 2단)를 쓴다. 키는 좌표 5자리 반올림,
  사용자 무관. ③상류 타임아웃(카카오 2.5s·OSRM 4s) — 공개 OSRM 이 6.8초 걸린 관측이 있다. ④매시 크론이 만료 정리.
  ⑤클라: `index.html` preconnect(dapi.kakao.com·t1/mts.daumcdn.net), 셸에서 `warmKakaoMaps()` 로 SDK 예열,
  `KakaoMap` 로딩 자리표시자(.km-skeleton). ⑥★RouteView 가 **경로 API 응답을 기다린 뒤에야 지도를 마운트**했다
  → 출발·도착만 알면 지도를 먼저 그리고 폴리라인은 도착하면 얹는다(첫 타일 3214ms → 190ms, 화면 표시 39~51ms).
  회귀 테스트=`tests/mapPerf.test.ts`, `worker/tests/kakaoRouteCache.test.mjs`.

- **도보 길찾기**: Kakao affiliate 403 → 서버(`worker/routes/kakao.ts`)가 OSRM foot 으로 폴백해
  Kakao 응답 형태로 합성(클라 무변경). 트래픽 증가 시 제휴/자체 호스팅 필요.

## 신규 결제 채널 정본(2026-09-01)

신규 구독·AI 크레딧 구매는 Android 네이티브 Google Play에서만 시작한다. iPhone·웹은 신규 결제 CTA·Toss 카탈로그를 열지 않고 무료 기능과 무료 AI 제공량을 안내한다. 같은 계정으로 Android에서 획득한 프리미엄은 iPhone·웹에서도 사용하며 관리는 Android Google Play에서 한다.

운영 `commerce_runtime_controls_v1`의 두 웹 checkout 값은 false를 유지하고 Toss client/secret·가격 환경값은 신규 설정하지 않는다. 기존 웹 주문 완료·대사·해지·환불과 `WEB_BILLING_KEY_ENCRYPTION_SECRET`은 레거시 안전 경로로 보존한다.

## 영단어와 부모 풀이 조회

영어는 5단계 4,067개(352/352/813/1,322/1,228)이며 수학 학년과 별개다. 위키낱말사전 뜻과 CEFR-J 수준 자료의 출처·이용 조건을 앱에서 제공한다. 공식 학년별 필수 범위로 표시하지 않는다.

`알겠어/다시 볼래`는 자가평가다. Study의 `vocabulary_reviews`와 `vocabulary_progress`를 아이별 DO와 한 D1 batch로 저장하며 실패 재시도는 같은 request ID를 유지한다. 평가로 목록이 줄어도 원본 카탈로그 위치 cursor를 사용한다. 부모 수학 원문은 `session_problems.release_id`로 조회하고 답안 11종·건너뜀·미채점·원문 누락을 구분한다. 해설 `alternative`는 문자열 배열이다.

Calendar 인증·활성 가족/아이 검사 후 기존 Study RPC만 사용한다. 영어용 로그인·refresh·공개 Study HTTP를 추가하지 않는다. 운영 순서는 Study D1 `0010_vocabulary_learning.sql` → Study Worker → Calendar Worker → 앱이다. schema 9 Worker는 migration 10 직후 준비 상태가 닫히므로 후속 배포까지 이어야 하며 schema 9 바이너리만 되돌리는 롤백은 사용하지 않는다.

회귀는 앱 `studyLearningApi`·`vocabularyLearning`, Calendar `studyGateway`, Study `calendarLearningExtras`·`problemHistoryService`·`vocabularyService`·`vocabularyCatalog`다. `scripts/qa-study-learning.mjs`의 브라우저 fixture 결과는 운영 API·실기기 확인과 구분한다.

# CLAUDE.md — 혜니캘린더 리디자인 (hyeni-3)

이 파일은 매 세션 자동 로드됩니다. **새 세션은 이 문서로 현재 상태·다음 할 일을 파악하고 이어서 작업하세요.**
모든 응답·주석은 한국어. 기술 용어·코드 식별자는 원문 유지.

---

## 0. 한 줄 요약

혜니캘린더(가족 일정 공유 + 부모·자녀 위치/안전)를 **리디자인 시안 기준으로 새로 구축**하는 프로젝트.
**1~10단계 전부 완료**(전 화면 실데이터·다자녀·AI 친구·알림 3종·릴리즈 게이트) — 실기기 3대 운용 중.
**현 국면 = 실사용 안정화**: TK 가 실기기로 쓰며 제보하는 버그·개선을 즉시 수정·검증·배포.

---

## 0.5 작업 원칙 — 어떤 모델이든 이 방식으로 (이 프로젝트에서 실증된 사고방식)

> 아래는 지금까지의 세션들에서 **실제로 결과를 낸 방식**을 명문화한 것. Opus/Sonnet 등
> 어떤 모델이 이어받아도 이 원칙대로 일하면 동일한 품질이 나온다. 원칙마다 실례를 괄호로 남긴다.

### A. 증거 없으면 완료가 아니다
- 완료 선언 전에 **실기기 E2E(adb+CDP) + 서버(D1) 크로스체크**가 기본. "코드가 맞으니 될 것"은 금지.
- 검증 못 한 항목은 보고에서 **"미검증"으로 분리해 정직 고지**(예: S25 분리로 미설치 → 명시).
- 에이전트/워크플로우가 보고한 이슈도 **내가 코드를 다시 열어 확인한 뒤에만** 수정한다.

### B. 사용자 제보 = 추측 말고 재현부터
- 코드부터 고치지 말고 **실기기·실데이터로 증상을 재현**해 진짜 원인을 특정한다.
  (예: "장소설정 안 됨" → 재현하니 저장·표시는 정상, 진짜 문제는 픽커 부재 /
   "코드로 연결하기 안 됨" → 버튼은 정상, 배경 높이 붕괴로 토스트가 화면 밖이었음 /
   "울린 시간 이상" → 12일 된 zombie 행이 원인)

### C. 증상이 아니라 근본 원인을 고친다 — 그리고 다중 방어
- 레이스·유실 계열은 **서버+클라 양쪽에 방어를 겹친다**.
  (예: 아이 세션 풀림 = refresh 회전 레이스 → 서버 60s 재사용 유예 + 클라 single-flight + 즉시 persist 3중 /
   SOS 유실 = parent-alerts 가 FCM 미발송 → 서버 insert 지점에서 무조건 연쇄)

### D. 정직한 강등 — 가짜 데이터 금지
- 외부 의존이 죽으면 숨기거나 지어내지 말고 **명시적 폴백**으로 강등한다.
  (예: Kakao 도보 API 403 → "직선 553m · 걸어서 11분쯤"(직선임을 명시)+카카오맵 버튼,
   이후 서버에서 OSRM 합성으로 인앱 복원 — 클라 계약 보존 / 기기 미리포트 → "—"와 대기 문구, 가짜 숫자 금지)

### E. 실사용 보호가 기능보다 우선
- **2026-07-19 최신 사용자 지시 기준 이번 최종 실기기 검증은 A17(RFKL40DP73J) 한 대에서만 수행한다.**
  A17의 현재 부모모드 세션을 유지하고 `adb install -r`로 앱 데이터·계정·페어링·세션을 그대로 보존한다.
  아이 역할 전용 동작은 A17 계측 테스트와 브라우저 역할 검증으로 확인하며 실제 계정의 로그아웃·역할 전환·
  재페어링은 하지 않는다. razr는 연결 해제·미조작, S25는 검증 제외 상태이며 다시 명시적으로 허용받기 전에는
  설치·실행·로그·세션 조회를 포함한 어떤 adb 접근도 하지 않는다. refresh 토큰은 출력·복사·회전하지 않는다.
- 파괴적 작업 전 **안전 불변식부터 확인**(예: 아이 페어링 전 프리미엄 캡=2 확인으로 razr 밀림 0 보장).
- 테스트로 만든 데이터·바꾼 설정은 **반드시 원복/삭제**(이벤트·메모·SOS·notification_settings…).
- 라이브 앱 refresh 토큰은 절대 조작하지 않는다(access 만 읽기 — 회전시키면 세션 파괴).
- **notification quiet hours 운영 계약(2026-07-19)**: 부모 본인 `user_id` 계정과 활성 아이 `user_id` 계정만
  부모가 설정하고 공동 부모 계정은 제외한다. 각 계정은 매일 같은 한 구간만 반복하며 기본값은 비활성
  `22:00→07:00`, `Asia/Seoul`, `[start,end)`이고 시작=끝은 400으로 거부한다. Worker의
  `lib/notificationQuietHours.ts`가 일반 알림을 `pending_notifications` 생성 이전에 수신자별로 억제하므로 알림은
  저장·표시·재생하지 않지만 지오펜스와 상태 전이는 계속 진행한다. 정상 억제는 `suppressed_quiet_hours` 의미로
  완료하며 Android `QUIET_HOURS_SUPPRESSED` receipt는 ACK 성공·미게시다. SOS·emergency·미도착·위험구역은 항상 전달하고,
  force ring·remote listen·request_location·request_device_status는 표시 대상이 아닌 명령으로 항상 통과한다.
  `kkuk`은 일반 알림이므로 억제한다. Android는 사용자와 업데이트 시각을 묶은 session-bound
  `NotificationQuietHoursStore`를 쓰고 Web 시작 동기화·FCM 갱신·LocationService 401 재시도 뒤에만 값을 채택하며,
  `NotificationHelper` 진입점이 8개 표시 경로를 채널/권한/중복 판정보다 먼저 차단한다. 운영 순서는 D1
  `worker/db/notification-quiet-hours.sql` 적용·PRAGMA 확인 → Worker 배포 → Pages/Android 배포다.

### F. 재사용 우선 · 서버 무변경 해법 선호
- hyeni-1 서버·인프라를 먼저 뒤진다(재구축 금지). 스키마를 늘리기 전에 기존 계약으로 풀 수 있는지 본다.
  (예: 채팅 사진 = child-photos R2 재사용 + content 마커 `[[img:key]]`/`[[loc:lat,lng|주소]]` — 서버 무변경 /
   AI 친구 = 서버 완비 확인 후 클라 배선만)
- 식별자 오귀속 방지: 준비물 `DailySupply.child_user_id`는 이름과 달리 member id다. 부모 세션에서 대상 아이가
  명시되지 않으면 첫 아이로 폴백하지 않고 저장을 실패시킨다(`resolveDailySupplyChildMemberId`).
  아이 설정 화면도 본인 `user_id`가 매칭된 child member만 사용하고 첫 아이로 대체하지 않는다.
- ★refresh 체인 갈라짐 → 위치 중단(2026-07-10 실사고): 같은 기기에서 WebView 와 네이티브
  `LocationService` 가 각자 refresh 를 회전하면 체인이 갈라진다(실측 0.7초 간격 2회전, 03:36엔 3회전).
  낙오한 홀더가 폐기 토큰을 들고 남아 401 → `stopForInvalidSession` → **아이 위치가 조용히 멈춘다**
  (혜니 89분 중단). 서버 수정: 기기 바인딩(device_id) 게이트를 통과한 뒤라면 같은 기기의 폐기 토큰은
  도난이 아니라 "뒤처진 홀더"이므로 `rotated_to` 체인을 따라가 live 토큰으로 재동기화한다
  (`findLiveTokenInChain`, 현재 재귀 CTE MAX_CHAIN_HOPS=2048, depth 순환 방어). 레거시(device_id NULL)는
  60초 유예+1단계 유지.
  **앱 재빌드 없이 서버만으로 복구**되므로 미연결 기기도 다음 회전 때 자동 정상화된다.
  진단: refresh 원문·접두·해시는 읽거나 출력하지 말고, 기기 JWT의 `sub/iat/exp`와 D1의 user/device별
  `issued_at/revoked/rotated_at/has_successor` 메타만 대조한다. logcat 태그 `LocationService` 의
  `Token network-refresh failed: HTTP 401` / `invalid session`도 함께 본다.
- ★장기 refresh 체인 + resume downgrade → 아이 QR 재인증(2026-07-12 실사고): razr device-bound refresh가
  2.5일에 88행 누적됐지만 Worker `MAX_CHAIN_HOPS=20`이라, live 토큰이 남아도 오래된 holder는 401이 됐다.
  앱 resume의 `setPushContext`, 부팅 `syncNativeLocationToken`, 60초 `startService`가 native-first 조정 없이 WebView
  access/refresh를 prefs에 써 더 최신 native holder도 되돌릴 수 있었고, client가 refresh 401을 `clearApiSession()`으로
  확대해 WebView는 anonymous(16:18:46)·QR pairing, native는 기존 child지만 expired access 상태로 갈라졌다.
  다중 방어: ①모든 Web→native write 전에 `adoptNativeLocationSessionTokens()` + 복구 single-flight ②Android
  `SessionTokenFreshness`가 같은 sub의 더 낮은 `iat` write를 거부하고, 동일 초 예외는 방금 검증한 서버 refresh 응답에만
  허용. native direct adoption은 `setApiTokens`만 써 `/family/mine`으로 보정된 user family/role을 보존 ③Android 토큰
  비교·pair 저장을 `SessionTokenStore` synchronized reconcile로 원자화하고 `LocationService`의 지연 Intent도
  실제 반영 시 재검증. clear generation이 바뀌면 진행 중 refresh 응답도 저장 거부 ④Worker는 같은-device 최신 행 점프(별도 로그인
  체인 부활 위험) 대신 `rotated_to` 인과 체인을 재귀 CTE 2048-hop으로 추적 ⑤refresh 성공 뒤 endpoint 401은 세션 clear
  금지·native device id 일시 누락은 retryable error ⑥복구 실패 뒤 생긴 **가족 미연결 anonymous**만 기존 native child
  context의 `/auth/refresh` 검증으로 교체(정상 가족 세션은 불가). 온보딩도 복구 await 뒤 `deriveAuthState()`를 재확인해야
  anonymousLogin TOCTOU가 없다. 가드=`nativeSessionResumeSafety`·`nativeTokenSync`·Android
  `SessionTokenFreshnessTest`·Worker `refreshChainResync`.
  Worker 체인 추적 전에 제시 토큰의 `expires_at`을 먼저 검사해, 만료 토큰+device id가 후속 live 체인으로 복귀하지 못하게 한다.
  명시적 로그아웃은 Web 로그인 단위 `session_instance_id`를 Android 최근 16개 bounded nonce tombstone으로 넘긴다. 로그아웃 전
  시작된 지연 start/push/update writer는 같은 nonce라 거부되고 새 로그인 nonce만 tombstone을 해제한다. Web refresh 응답도
  요청 전후 nonce 불일치 시 적용하지 않는다(로그아웃·계정전환 뒤 세션 부활 방지).
- ★온보딩 세션 파괴 금지(2026-07-10 실사고): `/onboarding`은 세션을 새로 만드는 화면이라
  인증된 사용자가 도달하면 딥링크 한 번으로 로그아웃된다. 실제로 `#/onboarding?pair=CODE` 재진입 시
  `resolveAuthenticatedOnboardingRedirect`가 `hasPairParam`이면 리다이렉트를 포기했고, 그 자리에서
  딥링크 핸들러의 `anonymousLogin()`이 child 세션을 익명으로 덮어썼다(부모가 아이 초대 QR을 자기 폰으로
  스캔해도 동일). 3중 방어: ①라우트 `RequireGuest`(인증+familyId면 마운트 전에 홈으로) ②딥링크 effect·
  `startChildMode`가 `deriveAuthState()`로 조기 이탈 ③`syncNativeLocationToken`이 익명 토큰을 네이티브에
  쓰지 않음(`shouldWriteNativeSessionToken`). ③이 없으면 네이티브 refresh까지 익명으로 덮여
  `restoreNativeRefreshOnlySession` 복구 경로가 영구히 막힌다(재페어링 외 복구 불가). 회귀 테스트=
  `tests/onboardingRedirect.test.ts`·`onboardingSessionGuard.test.mjs`·`nativeTokenWrite.test.ts`.
  검증 스크립트가 로그인된 앱을 온보딩으로 강제 이동시키지 않도록 주의한다(이 사고의 직접 방아쇠).
- 아이 페어링 placeholder 규칙(2026-07-10): 서버 `/api/family/join` Path B는 `user_id IS NULL` 중
  **`is_active=1`인 placeholder만** 채운다. 비활성 placeholder에 붙이면 부모 화면(활성 아이만 표시)에서
  보이지 않는 유령 페어링이 된다. 채울 때 `is_active=1`을 명시한다.
- 세션 family id 정본: access token claim의 `family_id`가 과거 가족 값으로 남을 수 있다.
  현재 가족은 `/api/family/mine` 응답이 정본이며, 클라이언트는 가족 조회 성공 시
  `hyeni-api-session-v1.user.family_id`와 role을 `/mine` 기준으로 보정해야 한다. 실기기 검증도
  token payload만 보지 말고 localStorage user와 `/mine` familyId 일치를 함께 확인한다.
- 위치 끊김 진단(2026-07-09): Google Family Link가 같은 시간 정확한 위치를 잡는데 혜니앱 위치만 끊기면
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
- 등록장소 도착/출발(2026-07-09): 피아노/태권도처럼 `saved_places`와 `academies`에 같은 물리 장소가 중복 등록되면
  20m 이내 후보를 `saved_place` 우선으로 병합해 1개만 평가한다. 진입은 3분 이상 같은 장소에 머문 뒤 도착으로
  승격한다. 옆 건물 통과나 학원가 이동 중 1분 남짓 머무른 좌표를 도착 알림으로 만들지 않기 위한 규칙이며,
  네이티브 `LocationService`와 Worker `registered-place-geofence-check`가 같은 상태머신 값을 써야 한다.
- ★이동 알림 현실화(2026-07-16, TK 제보 "학교 출발 직후 집 도착" 실사고 — D1 재현: 10초 간격 연발·순서 역전·
  같은 장소 출발 2연발): 원인 3중 = ①서버 cron 이 장소별 독립 평가라 위치 미보고 뒤 몰아친 재생에서 출발·도착이
  장소 배열 순서로 같은 tick 에 연달아 발사 ②`SILENT_RE_ENTER`(쿨다운 내 재진입, 무알림)로 들어간 에피소드의
  재이탈이 또 `LEAVE` 알림(GPS 지터 → "집 출발"/"피아노 출발" 중복) ③이탈 확정(armed+180s)이 다음 장소 도착보다
  늦게 흘러오는 순서 역전. 수정: ①cron 을 수집→계획→전달 2단계로 — 자녀 단위로 전이를 모아 `episodeMs` 시간순
  정렬, 같은 배치에 다른 장소 도착이 있으면 출발을 그 도착에 병합("○○에서 출발해서 △△에 도착했어요",
  `planRegisteredPlacePresenceDelivery`) ②상태머신에 `SILENT_LEAVE` 액션 — `phase=in && lastDepartedAtMs != null`
  ⇔ 조용한 재진입 에피소드(정상 ENTER 는 null 로 지움)라는 기존 불변식으로 스키마 무변경 판별, JS(shared)·클라
  JS·Java 3중 parity ③이전 tick 에서 이미 다른 장소 도착을 전달했으면 15분 창 내 늦은 출발은 조용히 상태만 진행
  (`isStaleRegisteredPlaceLeave`, 같은 장소 재출발은 억제 금지). 전달 실패 시 장소별 체인 블록으로 상태 미진행
  유지(다음 tick 재시도). 콜사이트는 전부 `ENTER`/`LEAVE` 명시 분기라 `SILENT_LEAVE` 는 자동으로 조용한 영속.
  회귀=Worker `tests/registeredPlaceGeofence.test.mjs`(병합·정렬·억제·SILENT_LEAVE), Android
  `GeofenceStateMachineTest`. cron 반환 메트릭에 `mergedLeft`/`staleLeftSuppressed`/`silentLeft` 추가.
- ★장소 도착·출발 중복 알림 근절 + 실시간화(2026-07-24, TK 제보 "집 도착 7:24·7:26, 집 출발 8:30·8:32 두 번씩,
  8:20까지 집에 있었음" — D1 확진): 원인은 **dedup 설계가 운에 맡겨져 있던 것**. 네이티브 `LocationService` 와 서버
  cron 이 같은 방문을 각자 평가하는데 dedup 은 `placePresenceIdempotencyKey(kind, child, placeKey, floor(episodeMs/10분))`
  의 10분 버킷이 **우연히 일치할 때만** 걸렸다. 두 평가자는 서로 다른 fix 스트림(네이티브=기기 GPS 콜백,
  서버=`location_history` 8분 재생)을 보므로 episode 시각이 다르고, 그날은 경계(07:20:00·08:30:00)를 45초~1분
  차이로 갈라 키가 달라졌다. 프로덕션 멱등키 5개를 버킷 역산해 전부 매칭시켜 확진했다(도착#2 의 episode 가
  도착#1 보다 **이르다** = 서버 재생본). 오후에 중복이 없던 건 우연히 같은 버킷에 들어갔을 뿐이다.
  수정 ①**단일 합류점 쿨다운 dedup** — 두 경로가 모두 지나는 `insertParentAlertV2` 앞단에서
  `(family, child, placeKey, kind)` 10분(상태머신 cooldownMs 동일) 창으로 판정하고, 중복이면 기존 alert id 를
  성공 반환해 호출자가 상태를 진행시킨다(재시도 루프 없음). placeKey 는 요청 `place_key` 우선 · 없으면 event_id 를
  가족 장소 × 최근 버킷 후보와 대조해 **역산** → 구버전 앱도 커버되어 **앱 재배포 없이 서버 배포만으로 복구**된다.
  스키마 무변경(`parent_alerts.metadata` 에 `{placeKey,presenceKind}` 기록). 장소 미상은 fail-open.
  ②**출발 조기 확정** — 정확도를 뺀 거리가 이탈반경×`farExitRatio`(2) 를 넘으면 180초 타이머를 기다리지 않는다.
  타이머는 경계 지터용이고 그 거리는 지터로 설명되지 않는다. 실측 재생 −124초.
  ③**wall-clock 타이머** — `evaluateRegisteredPlaceTimer`(JS·Java parity)로 fix 공백 중에도 dwell·이탈을 진행.
  정지 중 업로드가 120초 간격이라 그날 3분 46초 공백이 있었다. 마지막 fix 5분 이내일 때만 진행(좌표 frozen 가짜
  전이 금지)하고 **episode 시각은 실측 fix 시각을 보존**한다. 실측 재생 도착 −3분 31초.
  ④네이티브는 새 fix 채택 시 60초 tick 을 기다리지 않고 즉시 재평가 — 단 상태는 알림 성공 뒤에 저장되므로
  `placeAlertInFlight` 로 발사 중 재평가를 잠근다(이 가드 없이 즉시 평가만 넣으면 오히려 중복이 는다).
  회귀=`worker/tests/registeredPlacePresenceDedupe.test.mjs`(프로덕션 실제 멱등키로 red-green 확인 — 장소 단위
  판정을 끄면 4건 실패)·`registeredPlaceLatency.test.mjs`(그날 실측 fix 시퀀스 재생)·Android
  `GeofenceStateMachineTest`. ⚠️ 상태머신 테스트의 "밖" 좌표를 200m 등으로 잡으면 이제 조기 확정에 걸린다 —
  타이머 경로를 검증하려면 70m 처럼 이탈반경×2 **안쪽**을 써야 한다.
- 등록장소 알림 지연 개선(2026-07-10, TK 제보 "도착 알림 5분+ 지연" 실사고 — 실제 6.5분): 원인 3중 =
  ①반경 30m 가 학교 부지에 너무 타이트(교문→핀까지 5분) ②일괄 180s dwell ③서버 크론이 최신 fix 1점만 평가
  (tick 격자+정지 시 업로드 간격 합산). 수정: ①장소별 알림 반경 — location JSON `alertRadiusM`(30~300 클램프,
  스키마 무변경), 명시 없으면 이름 기본(학교|초등|중학교|고등학교|유치원|어린이집 → 100m). PlaceForm 에 반경 칩.
  ②심부 진입(entry 반경의 60% 이내) fix 는 dwell 90s 단축 — 경계 fix 는 180s 유지(오탐 방지 설계 보존).
  ③서버 크론은 `location_history` 최근 8분을 시간순 재생(직전 영속 시각 이후 fix 만, 전이 시에만 영속=멱등).
  ④네이티브 TTL 삼킴 버그 — 상태 6h 만료 후 "밖"이 지속되면 sameState 로 저장 스킵 → 신선도 영영 미회복 →
  첫 도착이 bootstrap 에 무알림 삼켜짐. 부트스트랩 평가 시 값이 같아도 반드시 저장(TTL 갱신). 아침 실데이터
  재생 검증: 학교 도착 08:47→08:41(-6분). 상태머신 값은 JS(shared)·Java 3중 parity — 한쪽만 바꾸면 안 된다.
- 일정·도착 알림 신뢰성 계약(2026-07-13): 반복 일정은 고정 UUID+`series_id`를 가진
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
- **알림 전달·원격청취 보안 계약(2026-07-14)**: 즉시 알림은 네트워크 발송 전에 수신자별
  `pending_notifications`를 만들고 실제 네이티브 표시/Web Push 표시 ACK 전에는 delivered로 완료하지 않는다.
  targetless 레거시 행은 일반 사용자가 조회·ACK하지 못한다. 일정·도착·위험·메모는 활성 가족 구성원과 정확한
  `targetUserId`/role/아이 식별자를 Worker가 검증한다. 원격청취는 부모 버튼 → 감사 세션 생성(id=requestId) →
  아이 알림 → 아이 기기가 그 세션의 서버 승인 증표를 1회 받음 → access JWT WAV 업로드 → 요청한 부모의 user-tagged 소켓만 수신 →
  **서버 승인 시각부터** 최대 60초 종료 순서다(요청 시각 기준 조기 종료 금지). FCM·pending 수신만으로 마이크를 시작하지
  않는다(반드시 `RemoteListenActivity` 경유). 익명 realtime broadcast와
  클라이언트 WS relay 금지. stop은 같은 requestId·아이·session nonce를 검증해 감사 PATCH보다 먼저 보내고,
  감사 종료 시각·길이·사유는 서버가 확정한다. 회귀=`tests/remoteListenConsentSafety.test.mjs`,
  Worker `tests/realtimeBroadcastSecurity.test.mjs`·`tests/remoteListenCommandSecurity.test.mjs`.
- **위급 주변소리(2026-07-29, 보호자 결정)**: 위급 확인 경로라 아이 동의 탭을 받지 않는다. 대신 숨기지 않는다.
  `RemoteListenActivity`는 pending 이 `READY`면 곧바로 `acceptRequest()`로 연결하고 허용/거절 버튼 없이 무슨 일이
  일어나는지 문장으로 알린다. 알림은 "요청" 대신 "지금 듣고 있다"를 알리고 잠금·꺼짐 화면에서도 보이도록
  `setFullScreenIntent` + Activity `showWhenLocked`/`turnScreenOn`을 쓴다. 기기 잠금 해제(`requestDismissKeyguard`)는
  하지 않는다. `CATEGORY_CALL`·`setSilent`·`VISIBILITY_SECRET`·DND 우회는 금지. 서버 승인 증표 1회 소비, 세션 nonce·
  가족·대상 일치 검사, 마이크 권한, 1분 상한, 캡처 중 포그라운드 알림, 감사 기록은 유지한다. 부모 문구도 "아이가 허용해야
  시작"이 아니라 "아이가 누르지 않아도 연결되고 듣는 동안 아이 화면에 계속 표시된다"로 맞춘다.
- ★주변소리 세션 조기 종료(2026-07-22 TK 제보 "1분 안 됐는데 1분 지나 종료" 실사고): 부모 화면이 시작
  ~4.5초 만에 "1분이 지나 듣기를 종료했어요"로 닫혔다. 원인은 서버가 아니라 **클라 파싱 버그** —
  `src/lib/api/endpoints/remoteAudit.ts`의 `finiteMs`가 `Number(null)===0`을 유한값으로 통과시켜, 미동의·미종료
  세션의 `consented_at_ms`/`capture_expires_at_ms`/`ended_at_ms`(서버 JSON null)를 **0**으로 둔갑시켰다.
  타이밍 resolver의 첫 검사 `finite(endedAtMs)`가 0을 finite로 보아 즉시 phase="ended" → 클라가 PATCH로
  `end_reason=timeout` 종료(프로덕션 D1 확진: consented=NULL·duration_ms=0·종료 ~4.5s). 서버 계약(동의 시각+60초·
  미동의 65초 request_timeout)과 resolver 자체는 정상이었다. 수정: null/비숫자를 반드시 null로 남기는 순수 파서
  `src/transform/remoteListenStatusMs.ts`(`parseRemoteListenMs`, typeof-number 가드)로 교체. 서버 시간 필드를
  `number|null`로 받는 다른 경계 파서도 `parsePushExpiry`식 typeof 가드를 쓰고 `Number()`로 null을 강제하지 않는다.
  회귀=`tests/remoteListenStatusParse.test.ts`(red-green: 버그 강제 시 ended, 수정 시 waiting_for_consent). 웹 배포
  완료·A17 미연결로 APK 재설치는 보류(재연결 시 `npm run build && npx cap sync android && gradlew assembleDebug` → `adb install -r`).
- **AI·가족 메모 콘텐츠 안전 계약(2026-07-14)**: id가 서버에 저장된 자기 AI assistant 답변만 아이가 신고한다.
  중복 신고는 같은 id로 멱등 처리하고 신고 레코드에 원문을 복제하지 않는다. 메모는 정확한 가족·아이 스레드의 상대 메시지만
  신고할 수 있다. 사용자 차단은 메모 조회·`new_memo` pending/푸시에만 적용하고 가족 연결·위치·도착·위험·SOS 알림은
  계속 전달한다. 사유는 서버 allowlist, 상세는 500자 제한이며 약관·개인정보처리방침에 AI/UGC 신고·차단·운영자 검토·
  이의 제기를 명시한다. 회귀=`tests/contentSafetyUx.test.mjs`, Worker `tests/contentSafety.test.mjs`·
  `tests/contentSafetyRoutes.test.mjs`.
- **메모 전달·차단 선형화(2026-07-14)**: 메모 행과 `memo_notification_outbox`는 한 D1 batch로 저장하며 즉시 발송 실패는
  `memo:<replyId>`로 1→5→15→30→60분 재시도한다. 모든 `new_memo` 경로와 차단·해제는
  `memo_interaction_leases`의 정렬된 무방향 pair를 공유한다. 전달은 lease 뒤 membership·차단 재조회 → 수신자별 pending →
  Web Push/FCM 순서이고 네트워크 90초/lease 120초 상한이다. 다중 수신자 lease는 all-or-none이며 부분 획득을 되돌린다.
  차단·해제는 caller/target account mutation lease 뒤 같은 pair lease에서 처리해 완료 뒤 메모가 새로 도착하지 않게 한다.
  운영에는 `db/memo-notification-outbox.sql`과 `db/memo-interaction-leases.sql`을 Worker보다 먼저 적용한다. 회귀=Worker
  `tests/memoNotificationOutbox.test.mjs`·`tests/memoInteractionLease.test.mjs`·`tests/contentSafetyRoutes.test.mjs`.
  외부 플랫폼에서 지연된 알림은 수신자별 HMAC `memoDisplayPermit`으로 표시 시점에 다시 승인한다. Web Push·pending TTL은
  120초, permit은 5분이며 Android·Service Worker는 대상/role/만료 검사 뒤 공개
  `POST /api/push-notify/memo-display-authorize`의 정확한 `{allowed:true}`만 표시·ACK한다. 누락·변조·만료·시크릿/DB·
  HTTP/JSON/네트워크/timeout 오류는 fail-closed하고 permit·토큰은 로그에 남기지 않는다. 회귀=앱
  `tests/memoDisplayAuthorization.test.ts`·`tests/webPushWiring.test.mjs`, Android `MemoDisplayAuthorizationClientTest`·
  `MemoDisplayAuthorizationWiringTest`, Worker `tests/memoDisplayPermit.test.mjs`·`tests/webPushExpiry.test.mjs`.
- **피드백 내구 접수 계약(2026-07-14)**: `/api/feedback`은 인증 필수이며 sender/family 정본을 서버에서 결정한다.
  UUID requestId 멱등키와 사용자별 시간당 5건 제한을 적용하고, Resend보다 먼저
  `user_feedback(type='feature_feedback', status='queued')`를 저장한다. Resend는 8초 상한이고 실제 성공만 `sent`, 미설정·실패는
  `queued` 202다. `queued`는 D1 운영 대기열 접수이며 이메일 자동 재전송 약속이 아니므로 운영 모니터링·수동 처리 절차와
  앱 문구를 이에 맞춘다. 운영에는 `db/feedback-delivery-safety.sql`을 Worker보다 먼저 적용한다. 회귀=앱/Worker
  `tests/feedbackDeliverySafety.test.mjs`.
- **선생님 모드 출시 차단(2026-07-14)**: v1.2.0 프로덕션은 `TEACHER_MODE_ENABLED=import.meta.env.DEV`로만 열림을
  결정한다. 온보딩 역할 카드에서 선생님을 숨기고 `/teacher/*`는 준비 안내 gate로 닫으며, 기존 teacher 세션에는 gate 안에서
  로그아웃·회원 탈퇴·약관·개인정보처리방침 동선을 유지한다. 준비물은 부모·아이 역할만 허용한다. 환경변수로 production을
  우회하지 않는다. 회귀=`tests/teacherProductionGate.test.mjs`.
- **공개 법적 페이지 브라우저 품질(2026-07-14)**: Worker `/privacy`·`/terms`·`/data-deletion`은 서비스명 뒤 조사가
  자연스러워야 하며 데스크톱·모바일에서 가로 오버플로와 콘솔 오류가 없어야 한다. 기본 브라우저 아이콘 요청도
  `/favicon.ico`의 캐시 가능한 SVG 200 응답으로 닫아 새 세션에서 404를 남기지 않는다.
- **출시 가이드 산출물 검증(2026-07-14)**: Markdown→DOCX 생성기는 표지 다음 도입 문단과 인용문의 인라인 강조를
  보존하고 짝수·홀수 페이지 머리글/바닥글을 모두 명시한다. 최종 DOCX는 PDF·페이지 PNG로 다시 렌더해 전 페이지를
  육안 검사하며, 새 회귀 테스트를 추가한 뒤에는 전체 테스트 수를 재실행 결과로 갱신한다. 운영 명령에는 `...` 같은
  placeholder를 남기지 않고 Families의 아동 전용 위치 제한도 위치 권한 자체와 정밀 위치 처리 금지를 모두 적는다.
- **활성 가족 권한·알림 endpoint 소유권(2026-07-14)**: 일반 API·로그인 역할·AI·준비물·위치 설정·스티커·친구놀이·
  결제는 활성 `parent|child` membership 또는 검증된 주보호자 소유 가족만 허용한다. 비활성 옛 child는 일반 데이터 접근이
  없고 SOS 발사만 안전 예외다. FCM/Web Push는 endpoint당 활성 행 1개와 exact `registration_instance_id`를 정본으로 삼아
  지연된 옛 등록·로그아웃이 현재 계정을 덮거나 해제하지 못하게 한다. 무효/중복/로그아웃 행은 삭제 대신
  `disabled_at/disabled_reason`으로 남기며 타 사용자 소유권 충돌은 409 fail-closed다. 회귀=Worker
  `tests/activeMembershipRouteAudit.test.mjs`·`tests/notificationEndpointOwnership.test.mjs`.
- **D1 정본 스키마·알림 migration(2026-07-14)**: `cloudflare/schema_d1.sql`은 auth부터 RTDN·OTP·위치 정확도·event series·
  콘텐츠 안전·원격청취 동의·endpoint ownership까지 fresh bootstrap에 필요한 현재 스키마를 포함한다. 빈 SQLite 실행과
  필수 컬럼·인덱스는 `worker/tests/canonicalSchemaBootstrap.test.mjs`로 고정한다. 운영 endpoint ownership migration은
  `db/notification-endpoint-ownership.sql`을 1회 적용한 뒤 즉시 Worker를 배포하고 active/disabled 집계를 readback한다.
  과거 행은 파괴적으로 삭제하지 않으며 migration 재실행 금지다.
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
- **권한·위치 캐시 fail-closed(2026-07-14)**: 배경 위치는 아이에게 기능 설명 후 foreground 권한을 먼저 받고,
  별도 설명·사용자 버튼에서 background 권한을 요청한다. 서비스가 권한 창을 자동 호출하지 않는다. 위치 엔타이틀먼트가
  미확정·오류이면 캐시된 현재 위치·경로·리포트를 숨기고 명시적 확인/오류 상태로 닫는다. 방문 확인도 같은 gate가 열리기
  전에는 캐시된 위치 이력으로 `다녀옴`을 만들지 않는다.
- **역할 라우트·알림 표시 경계(2026-07-14)**: 선생님 탭·알림장 상세도 `RequireRole role="teacher"` 아래에 둔다.
  Android pending 복구는 표시용 유형을 먼저 검사한 뒤 system/local ACK를 확인해 위치·기기상태·원격청취 명령을 표시 완료로
  잘못 처리하지 않는다. 메시지·일정·안전 알림은 private 채널과 일반적인 잠금화면 publicVersion을 사용하고, 전체화면은
  `sos|emergency`와 위급 주변소리처럼 실제 위급 경로에서만 사용한다. 회귀=`tests/notificationUiReliability.test.ts`·
  `tests/androidNotificationSafetyWiring.test.mjs`·Android `PendingNotificationTypePolicyTest`·`NotificationChannelPolicyTest`.
- **알림 큰 아이콘 정사각 정규화(2026-07-29 TK 제보 "알림 아이콘 위아래가 잘린다")**: 혜니 캐릭터 원본은 세로가 더 긴
  비율이라 시스템 정사각 슬롯의 채우기(center-crop)에 들어가면 머리 위와 옷 아래가 잘렸다. `NotificationHelper.largeIcon`이
  자르지 않고(contain) 원형 크롭 여유(`SAFE_RATIO` 0.82)를 남긴 정사각 비트맵을 만들어 크기별로 캐시한다. 경계만 먼저 읽고
  2의 거듭제곱으로 축소 디코딩해 알림마다 큰 비트맵을 다시 올리지 않는다. 기하는 프레임워크 비의존
  `NotificationLargeIconLayout`에 두고 JVM 단위 테스트로 고정한다.
  회귀=`tests/notificationLargeIcon.test.mjs`·Android `NotificationLargeIconLayoutTest`.
- **오늘 경로 시각 포커스(2026-07-29)**: 이동선 실선화 계약은 위치 신뢰 항목의 ★부모 오늘경로 줄에 있다. 여기에 더해
  지도 중심과 아이 마커 좌표는 독립이다(머문 곳 선택은 지도만 옮기고 아바타는 실제 이력 좌표에 남는다). 기본은 최신
  따라가기(`scrubOffsetMinute === null`)이고 조회창은 하루 시작+24h 고정이라 30초 위치 폴링이 부모가 고른 시각과 접어 둔
  시트를 되돌리지 않는다. 신선도는 `useLocationHistory(..., 60_000)` 배경 폴링으로만 유지한다.
  회귀=`tests/parentLocationScrubFocus.test.mjs`.
- **눌림 피드백 계약(2026-07-29)**: 실제 버튼은 `hy-press`(전체 축소) 또는 자기 클래스의 `:active` 반응 중 하나를 반드시
  갖는다. 토글 스위치는 트랙이 흔들려 보이지 않게 노브만 `scale(0.9)`로 누르고, 문장 안 글자 버튼은 크기를 바꾸지 않고
  opacity로만 알린다. 보이지 않는 닫기용 스크림은 의도적으로 제외한다(무엇이 눌렸는지 오해를 준다).
  전역 `prefers-reduced-motion` 규칙이 새 전환 시간도 함께 줄인다. 회귀=`tests/pressFeedbackCoverage.test.mjs`.
- ★**색상 대비 계약(2026-07-30 디자인 검수)**: 파스텔 팔레트 위 **흰 글자는 어떤 테마색에서도 AA 를 만족할 수 없다**
  (`--hy-accent` 1.4~2.8:1, `--hy-accent-deep` 3.34:1). WCAG 큰 글씨 완화(3:1)는 굵은 글씨라도 **18.66px 이상**에만
  적용되므로 18px/700 버튼에는 4.5:1 이 그대로 걸린다. 그래서 3단 체계를 쓴다:
  ①**주요 CTA** = `--hy-accent-cta`(테마별 딥 톤, 흰 글자 4.5:1↑) · 그라디언트는 `--cta-grad-accent/-danger/-lavender`
  (두 stop 모두 통과 — 이전엔 밝은 stop 이 2.0:1 이라 저장·전송 버튼이 안 읽혔다) ②**보조 버튼·선택 칩** =
  `--hy-accent-soft` 채움 + `--hy-accent-text` 라벨 + 1.5px accent 테두리 ③**미선택 칩** = `--bg-chip-idle` +
  `--fg-tertiary`(하드코딩 `#F3EEF1`/`#8B7E84` 조합은 3.38:1 이라 고를 수 있는 칩이 비활성처럼 보였다).
  장식·아바타·진행바·마커 같은 **비텍스트 면은 계속 `--hy-accent`** 를 쓴다. 문구 토큰(`--fg-muted`·`--fg-placeholder`·
  `--rose-text`·`--gold-text`·테마별 `--hy-accent-text`)은 card·app·page·body **네 표면 모두**에서 4.5:1 이상이어야 한다
  (이전 값은 card·app 만 기준이라 page 4.41·body 3.98 에서 미달했다). 일정 카테고리·태그 색은 `--cat-*-text/-soft` 와
  `--mint-text`/`--gold-text`/`--fg-tertiary` 토큰이 정본이고 중간 톤을 soft 위 글자색으로 쓰지 않는다.
  ⚠️ 런타임 대비 계측은 **그라디언트 채움을 못 본다**(배경 이미지라 배경색이 없음) — 정적 검사가 이 맹점을 잡았다.
  회귀=`tests/colorContrastAndRadius.test.mjs`(토큰 대비 계산 + 흰글자/파스텔 조합 스캔).
- ★**모서리 반경 정규화(2026-07-30)**: 8/12/16/20/24px·pill 만 쓴다. 10·11·13·14·15·17·18·19px 등 161건을
  가장 가까운 단계의 `var(--radius-*)` 로 정규화했다. 제외 대상은 **UI 표면이 아닌 것**뿐이다 —
  장식(색종이·유기적 블롭·히어로 orb), 폰 베젤 프레임(`.hy-app` 44px), 인라인 링크 `:focus-visible` 링(2px).
  회귀=`tests/colorContrastAndRadius.test.mjs`.
- ★**진행 표시자 계약(2026-07-30 지시)**: ①약 1초 이상 걸릴 수 있는 작업에는 진행 표시자를 둔다 ②진행률을 모르는
  작업은 loop(무한 회전) ③percent-done 은 10초 이상 작업에만 ④**정적 표시자 금지** — 문구만 "저장 중…"으로
  바꾸는 처리는 안 된다. 구현은 화면마다 만들지 않고 **`aria-busy` 한 곳에 걸어** 둔다:
  `components.css` 의 `button[aria-busy="true"]:not(.hy-busy-quiet)::before` 가 `currentColor` 회전 링을 자동으로
  붙이고 `--press:1` 로 진행 중 눌림 축소를 멈춘다. 그래서 **새 화면은 `aria-busy={<진행 식>}` 만 정확히 켜면 된다**.
  `disabled` 식에서 진행 항만 골라 써야 한다(유효성 항까지 넣으면 그냥 못 누르는 버튼이 '작업 중'으로 잘못 알려진다).
  자기 스피너를 그리는 버튼(`sqs-retry`·`cls-cta`·`ls-retry`·`ais-mic`)은 `hy-busy-quiet` 로 제외해 표시자가 겹치지 않게 한다.
  화면 단위 로딩은 애니메이션이 있는 `<Loading/>`·`ScreenQueryState`·`hy-skel` 만 쓰고 맨 문구를 쓰지 않는다.
  `useActiveChild().familyLoading` 은 **조회 중과 "아이 없음"을 구분**하기 위한 값이다 — 이게 없으면 주간리포트·
  하루요약·AI크레딧·길찾기가 가족 조회 중에 "아이가 없어요"를 미리 단정해 표시자도 못 띄웠다.
  회귀=`tests/progressIndicatorContract.test.mjs`.
- Capacitor SystemBars 패치(2026-07-09): Android WebView 시작 직후 `document.documentElement`가 아직 없으면
  기본 `SystemBars` safe-area CSS 주입이 콘솔 오류를 낸다. `postinstall`의
  `scripts/patch-capacitor-systembars.mjs`가 DOM 준비 전 주입을 건너뛰게 패치하므로, 의존성 재설치 후에는
  `npm install` 또는 해당 스크립트 실행 뒤 Android 빌드를 검증한다.
- 부모→아이 메모 알림: 서버는 `type: "new_memo"`와 `targetChildUserId`로 FCM을 보낸다. Android 네이티브는
  이 알림을 일정 채널이 아니라 아이 메시지 채널(`hyeni_child_message_v1`)로 heads-up 표시하고,
  탭/폴링 라우트는 `child-memo` → `#/child/memo`로 유지한다.
- **대화 전송 즉시 표시(2026-07-13 실사고)**: `POST /api/memos/replies`가 성공해 D1·FCM 전달까지 끝났어도,
  클라이언트가 후속 GET/WS에만 의존하면 재조회 지연 동안 과거 대화(실제 제보: 토요일)가 마지막으로 남는다.
  서버가 반환한 저장 행은 `commitSentMemoReply`로 family/date_key/child_id가 맞는 `qk.memoReplies` 캐시에 즉시 합치고,
  정본 `invalidateQueries`는 백그라운드로 실행해 전송 완료를 막지 않는다. 검증은 D1 저장·pending/FCM ACK·양방향 WS·
  상대 열람 후 `read_by`와 발신 화면 `읽음` 갱신까지 교차 확인한다.
- 리뷰 보상 티어: `/api/review-rewards`는 부모 전용 계약이다. 아이/선생님 세션에서 엔타이틀먼트가 필요해도
  서버 호출을 하지 말고 reviewed=false로 확정한다. 아이 화면 CDP 로그에 403이 남으면 실패로 보고
  `resolveReviewRewardQueryScope` 규칙을 먼저 확인한다.
- 스토어 방문 혜택·위치 티어(2026-07-13): 부모 무료 화면의 CTA는 "스토어 방문 혜택 받기"이며 평점·리뷰 작성의
  대가처럼 안내하지 않는다. 지급은 서버 `store_visit` 계약과 부모 본인 가족 검증을 통과한 경우에만 확정한다. 위치 조회는
  서버가 `locked|delayed|realtime`으로 판정한다. 무료 부모는 빈 위치, reviewed 부모는 서버 현재 시각 기준 정확히 15분 이전의
  `location_history` 실측점 중 최신값, 프리미엄 부모는 현재 위치를 받는다. cutoff 이전 점이 없으면 현재점을 대신 노출하지 않는다.
  아이 세션은 본인 위치만 조회하고, 경로 이력은 프리미엄 부모만, 위치 인시던트는 티어와 무관하게 부모만 조회한다.
  엔타이틀먼트 DB 판정 실패는 최신 위치를 열지 않고 `503 location_entitlement_unavailable`로 닫는다.
- 구독 결제 정본(2026-07-13): Google Play가 현재 계정에 eligible 하다고 반환한 정확한 7일 무료 offer만 표시·구매하고,
  결제 직전 재조회한 `offerToken`·`offerId`를 네이티브와 Worker까지 그대로 전달한다. 가격은 Play `formattedPrice` 정본만
  표시한다. `trial`은 미래 `trial_ends_at`, `active/grace/cancelled`는 미래 `current_period_end`가 있을 때만 프리미엄이며,
  해지는 이미 결제한 종료일까지 유지한다. Google Play 직접 검증이 결제 정본이며 RTDN도 notification type만 믿지 않고
  `purchases.subscriptionsv2.get`으로 재검증한다. RTDN은 Google OIDC·audience·push service-account email을 모두 검증하고,
  additive D1 schema를 먼저 적용해야 한다. 설정 누락은 `503` fail-closed가 정상이다. Qonversion은 비활성·비정본 보조
  route이며 health는 secret이 없으면 `configured:false, accepting:false, primaryProvider:false`를 반환한다. Billing 상품 조회
  진단은 response code/debug message와 미조회 product id/type/status만 다루고 purchase/order token을 로그나 응답 진단에
  포함하지 않는다. Play 구매는 SHA-256 obfuscated family/parent id를 서버에서 대조하고, 부모 foreground에서 6시간 제한으로
  기존 구독을 재검증해 자동갱신 종료일을 갱신한다. AI 크레딧은 event claim·잔액·원장을 D1 batch로 원자 확정한다.
- 출시 AAB 신선도(2026-07-13): 체크리스트의 서명 AAB는 최신 앱 커밋 이후 다시 빌드하고 서명·해시·mtime을 확인한
  경우에만 준비 완료로 표시한다. 과거 AAB가 디스크에 존재한다는 이유만으로 업로드하지 않는다. 서명 비밀번호는 사용자만
  입력하며 에이전트가 자격 파일을 읽어 자동 서명하지 않는다.
- 설정/가입/오늘경로 안정화(2026-07-08): 부모 `/friend-play`는 아이 요청 UI가 아니라 가족 친구놀이 허용 설정이다.
  장소 관리는 서버/AI 생성 없이 `resolvePlaceVisual` 정적 asset 매핑으로 장소명에 맞는 이미지를 고른다.
  가입 전 설문은 progress 20%에서 시작하고 복수 선택만 수집한다. 부모 오늘경로는 오전 8시를 하루 시작으로,
  00~07시는 전날 경로로 본다. 이력 로딩 중 지도 중심은 서울 기본점보다 현재 위치가 우선이며,
  "오늘 머문 곳"은 손잡이뿐 아니라 목록 영역 드래그 다운으로도 완전히 접히고 다시 열기 버튼으로 복귀하는지
  검증한다. 로컬 mock 검증 시 현재 시각이 08시 전이면 mock 이력도 `/api/location/history`의 `start`
  파라미터 기준으로 만든다.
- ★시간대별 경로 조작 정본(2026-07-29 TK 제보): 슬라이더로 시각을 옮기면 ①하단 "오늘 머문 곳" 시트를 자동으로
  접어 지도를 열고(다시 열기 pill 유지) ②그 시각의 마지막 확인 위치를 지도 중심(`center`)으로 잡고 ③하루 전체 축척으로
  멀어져 있으면 `centerLevel=4`까지만 당긴다(이미 더 확대한 화면은 유지 — 확대 방향 보정만). `KakaoMap`은 명시적
  `center`가 있으면 `setBounds`로 덮지 않으며, 자녀 아바타는 `center`가 아니라 자기 좌표에 그린다.
  슬라이더 상태는 `null`=최신 따라가기이고 30초 위치 폴링(`now` 갱신)으로 부모가 고른 시각·접어 둔 시트를 되돌리지 않는다.
  `/api/location/history` 쿼리 키의 끝시각은 하루 창 끝(시작+24h)으로 고정하고 신선도는 60초 배경 폴링으로 유지한다
  (끝시각에 `now`를 넣으면 키가 매번 바뀌어 하루치를 다시 받고 슬라이더가 최신으로 튀었다). 헤더는 `시각 · 위치`
  (머문 곳 이름/이동 중/기록 없음)와 "최신으로" 버튼을 보여주고, 판정 시각은 마지막 기록 시각으로 clamp 한다.
  머문 곳 시트 여백은 `12/16/20px`(손잡이 4/8, 헤더 하단 12, 목록 gap 12).
  회귀=`tests/parentLocationScrubFocus.test.mjs`·`tests/locationHistoryScrub.test.ts`.
  로컬 검증 팁: Kakao JS 키 도메인 제한 때문에 로컬 하니스에서는 실 SDK가 로드되지 않으므로 `window.kakao.maps`
  계측 스텁(Polyline/Map 호출 기록)으로 선 스타일과 `setCenter/setLevel/setBounds` 결정을 확인한다.
- 메뉴·페어링 안정화(2026-07-09): 부모 홈 바로가기는 `AI 일정 → 위치추적 → 친구놀이 → 장소관리 → 주변소리 →
  안심리포트 → 구독 → 알림` 순서와 실제 라우트를 회귀 테스트로 고정한다. 부모 설정 메뉴는 emoji 칩 대신
  lucide/image 아이콘 + `data-tone` 토큰 색상만 사용한다. 페어링 위저드는 `/api/family/mine`과 엔타이틀먼트가
  모두 확정되기 전 2명 선택과 코드 생성을 막고, 코드 생성 직전에도 현재 티어의 아이 수 상한을 다시 검사한다.
- OAuth 딥링크 인가코드는 1회용(2026-07-10 실기기 규명): Capacitor `App.getLaunchUrl()`은 실행 인텐트를 계속
  반환하고(휘발되지 않음) `appUrlOpen`도 같은 인텐트를 전달해, 콜드 스타트에서 같은 code 가 2~3회 교환됐다.
  구글은 코드 재사용을 감지하면 그 코드로 발급한 토큰을 전부 무효화하므로 로그인이 통째로 실패하고,
  카카오는 먼저 도착한 요청만 성공해 증상이 가려진다(=D1 에 OAuth 세션 행이 1건만 남아 정상처럼 보임).
  `transform/oauthCodeOnce.ts` 가드로 `provider:code` 당 1회만 교환하고(실행 직전 localStorage 영속화 →
  프로세스 재시작 후 stale launch URL 재교환 차단), 딥링크 리스너는 참조 카운트로 단 1개만 유지한다.
  OAuth nonce 는 sessionStorage 뿐 아니라 localStorage 에도 저장한다 — 네이티브는 OAuth 왕복 중 프로세스가
  재생성되어 sessionStorage 가 비고, 그러면 CSRF 대조가 조용히 건너뛰어진다.

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

### G. 오케스트레이션 사용 기준
- **넓은 탐색·감사** = 병렬 에이전트 + 적대 검증(REFUTED 걸러내고 **CONFIRMED 만** 수정).
  (예: 다자녀 6도메인 감사, 활성아이 sweep 11건, AI 기능 3영역 매핑)
- **정밀 수정·아키텍처 변경** = 인라인(계약을 한 컨텍스트가 쥐고). 에이전트 결과 맹신 금지(A 원칙).

### H. 보고 스타일
- **결론 먼저 한 줄**, 검증 결과는 표, 리스크·미해결·사용자 몫(카카오 콘솔 등록, 스토어 업로드 등)을 끝에 정직하게.
- 완료 근거는 "○○ 실기기 확인"처럼 **관측된 사실**로 쓴다("될 것입니다" 금지).

### I. 학습 문서 동기화 · 완료 루틴
- 코드 수정 또는 지침 반영이 있으면 이번 작업에서 새로 확인한 운영 규칙·검증 함정·반복 절차를
  `AGENTS.md`와 `CLAUDE.md`에 함께 반영한다. 두 문서의 안전 규칙·기기 구성·완료 루틴이 서로 어긋나면 안 된다.
- 코드 수정 또는 지침 반영 후에는 기본적으로 관련 검증을 끝내고, 변경분을 커밋·푸시한 뒤,
  연결된 Android 기기에 최신 빌드를 설치한다. 문서만 바뀐 경우에도 커밋·푸시는 수행하며, 설치가 불필요하거나 불가능하면
  그 사유를 최종 보고에 명확히 남긴다.
- UI 움직임/색상 가드: 아이 홈 같은 화면은 `prefers-reduced-motion`에서 티커·스파클·SOS hold 전환을 멈추고,
  주요 JSX 색상은 직접 hex 대신 `tokens.css` 변수를 사용한다. `tests/mobileViewportCss.test.mjs`에 회귀 검사를 둔다.
- ★공용 컴포넌트에 인라인 `style` 로 배치(position/inset/size)를 주지 않는다(2026-07-10 실사고):
  `KakaoMap` 래퍼에 인라인 `position:relative` 를 넣자, `.pl-map{position:absolute;inset:0}` 인 부모 위치 화면에서
  인라인이 그것을 덮어써 컨테이너 크기가 0 → **지도가 통째로 사라졌다**. 배치는 소비 화면 클래스의 몫이고,
  컴포넌트는 `.km-host`/`.km-canvas` 처럼 **클래스**로만 내부 구조를 잡는다(components.css 가 먼저 로드돼
  화면 CSS 가 항상 이긴다). 가드=`tests/mapPerf.test.ts`.
- 장식 요소(구름·블롭)는 텍스트/노드 밴드를 침범시키지 않는다: 아이 홈 구름이 제목 뒤에 깔려 흰 알약처럼 보였다.
  반투명은 `background: rgba(...)` 가 아니라 `background:#fff` + `opacity` 로 줘야 겹친 덩이의 이음선이 안 생긴다.
- 원시 유니코드 이모지를 버튼 아이콘으로 쓰지 않는다(시스템 폰트라 옆 아이콘과 크기·베이스라인이 어긋난다).
  lucide 아이콘 또는 3D webp 에셋 중 하나로 통일한다. 가드=`tests/menuNavigationConsistency.test.mjs`.
- ★아이콘 언어 통일(2026-07-14 TK 제보 "안전지표·위치 아이콘이 다른 아이콘과 다름" 수정): **기능 타일·색 칩·히어로·
  안전지표 = 소프트 3D webp**(바로가기 menu-*.webp·장소 place-*.webp 가 기준), **텍스트 행 인라인(14~19px)·유틸리티 =
  lucide**(주변 텍스트/형제 lucide와 색·크기 정합). 진한 선(line) 스타일 플랫 SVG(`ui/icon-*.svg`)는 재유입 금지 —
  실제로 이전 작업이 lucide를 플랫 SVG `<img>`로 일괄 교체해 파스텔 3D 앱에서 이질감을 만든 실사고. 안전지표 4칸은
  battery.webp 와 같은 3D 언어(`clock-3d`/`lock-open-3d`/`wifi-3d.webp`), 프리미엄 잠금=`lock-3d.webp`,
  주간리포트 히어로=`chart-3d.webp`. 시계·와이파이는 원본 팩 `assets/05-icons/system/*`에서 변환했고 자물쇠·차트는
  클레이 스타일 SVG→sharp 렌더로 생성(둘 다 알파 투명 256px 필수). `ai-robot`·`mic-lavender`는 투명 webp만 남김
  (png 삭제 — 기존 mic-lavender.webp 는 흰 배경 불투명이었는데 투명본으로 교체돼 색 칩 위 사용 가능해짐).
  화면 내 형제 요소와의 일관성이 앱 전체 방향보다 우선한다(설정/알림 색 칩은 lucide+data-tone 유지 — 가드 테스트가 강제).
  가드=`tests/iconConsistency.test.mjs`.
- ★조용한 에러 금지 안전망 3겹(2026-07-11 도입, 가드=`tests/globalErrorSafety.test.mjs`):
  ①렌더 크래시 → `app/ErrorBoundary.tsx`(전 라우트 errorElement + RootErrorBoundary, `.hy-crash` 복구 화면.
  DEV 전용 `#/crash-test`로 검증) ②uncaught/rejection → `app/GlobalErrorListeners.tsx` 폴백 토스트
  ③onError 없는 mutation → QueryProvider MutationCache 폴백. **새 mutation 에 onError 를 안 달아도 최소
  토스트는 뜨지만, 화면 맥락에 맞는 문구는 화면 몫**이다. 폴백이 겹치면 안 되는 백그라운드 작업은
  `meta: { silentError: true }`. 전역 폴백은 `announceFallbackToast`(450ms 지연-양보 — ToastProvider.show 가
  `markToastShown()`을 찍으면 물러남)라 화면 토스트와 이중으로 뜨지 않는다.
- 부모 홈 안전 지표의 알림·위치 건강 상태는 컴팩트 칩(`shortLabel`, `.ph-safety__signals`) 한 줄로 표시하고,
  긴 `label`/`detail` 안내 박스는 `attention`(조치 필요) 상태에만 렌더한다(2026-07-14 TK 제보 "과도한 텍스트가
  디자인을 해침" 수정). 안심리포트(`DailySafetyReport`)는 상세 화면이라 label/detail 전체 표시를 유지한다.
  회귀=`tests/deviceNotificationHealth.test.ts`.
- ★채팅 화면 UI 계약(2026-07-24 TK 제보 "입력할 때 파란 네모·문장마다 신고 버튼·사진 확대 저장"):
  ①**포커스 링은 없앨 수 없다** — `tests/designSystemUsage`의 "출시 화면은 브라우저 focus outline을
  제거하지 않는다"가 `outline:none`을 예외 없이 금지한다(접근성). 파란 네모의 실체는 전역
  `--focus-ring-color: var(--blue-500)` 3px + offset 3px 이 **radius 없는 input** 에 각지게 그려진 것이므로,
  제거 대신 `outline-color`(accent/lavender)·`outline-width:2px`·`outline-offset:0`·`border-radius` 로
  모양과 색만 바꾼다. 전역 규칙은 `body :where(...):focus-visible`(특이도 0,1,1)이라 `.mc-input`(0,1,0)으로는
  못 이긴다 — 반드시 `.mc-input:focus,.mc-input:focus-visible`(0,2,0)로 쓴다. 실측 검증은 프로그래매틱
  `el.focus()` 로는 `:focus-visible` 이 안 켜지므로 CDP `Input.dispatchKeyEvent`(Tab)·`dispatchMouseEvent`
  로 실제 입력을 보내고 computed `outlineStyle/Color/Width` 를 읽는다.
  ②**신고 버튼은 메시지마다 띄우지 않는다** — 상대 메시지(MemoChat)·AI 답변(AiFriendChat)을 **길게 눌러**
  연다(`src/lib/useLongPress.ts`). 시각적으로만 감추는 sr-only 버튼은 "상호작용 요소 최소 44px" 가드에
  1px 로 걸리므로 쓸 수 없다 → 버튼을 제거하고 대화 맨 위 한 줄 안내(`.mc-safety-hint`/`.afc-safety-hint`)로
  발견성과 `contentSafetyUx` 문자열 계약("신고·차단"·"이 답변 신고")을 함께 만족시킨다. UGC 신고 수단
  자체는 스토어 정책상 없애면 안 된다. 길게 누른 뒤 따라오는 click 은 1회 삼켜 사진 프리뷰가 함께 열리지 않게 한다.
  ③★**JSX attribute spread 금지** — `designSystemUsage` 가 `{...handlers}` 를 만나면
  "scenario 해석을 지원하지 않습니다"로 **파일 전체 분석이 죽는다**(다른 위반이 가려져 뒤늦게 드러난다).
  훅이 핸들러 묶음을 주더라도 `onPointerDown={press.onPointerDown}` 처럼 prop 을 하나씩 연결한다.
  ④사진은 프리뷰에서 핀치·더블탭 확대와 팬(`src/lib/usePinchZoom.ts`, 컨테이너 `touch-action:none` 필수),
  저장은 `src/lib/native/mediaSave.ts` → Android `MediaSavePlugin`(MediaStore `Pictures/혜니캘린더`).
  WebView 가 인증된 상태로 받은 이미지를 base64 로 넘겨 R2 토큰이 네이티브 경계를 넘지 않는다.
  `WRITE_EXTERNAL_STORAGE` 는 `maxSdkVersion="28"` 로 제한(API 29+ 는 scoped storage 라 권한 불필요).
  새 CSS 클래스는 `designSystemUsage` 의 surface/non-surface manifest 에 등록하고 여백은 4px 리듬을 지킨다.
- 모든 인터랙티브 요소는 프레스 피드백이 있어야 한다: 버튼/카드=`hy-press`(+CSS `--press`), 목록 행/라벨=
  `:active { background: var(--bg-press) }`. CSS 에 `--press` 를 선언했는데 JSX 에 `hy-press` 를 빼먹는 실수가
  실제로 있었다(부모 홈 아이 카드). 스크림/딤 배경은 예외(정적이 맞다).
- ★column flex 컨테이너 안의 고정 높이 버튼은 `flex: none` 필수(2026-07-11 실사고): `.sr-content`(column flex)가
  넘칠 때 `.sr-confirm`(height 56px)이 18px 리본으로 찌그러져 "버튼이 이상하다" 제보의 실체였다.
  스타일 문제로 오판하기 쉽다 — 높이가 CSS 와 다르게 렌더되면 flex 압축부터 의심.
- 준비물 토글은 낙관적 업데이트(useUpsertDailySupply onMutate) — rebuildChildDay 가 GET→PUT→GET 이라
  서버 바인딩만으로는 체크가 1~3초 얼었다. 롤백은 훅, 실패 문구는 콜사이트(없으면 announceFallbackToast 450ms 양보).
- 일정 등록 준비물 연동(2026-07-16 TK 요청): EventForm 준비물 칩 입력 → 저장 시 배정 아이들의 occurrence
  날짜별 daily_supplies(prep)에 병합(`useAddEventSupplies` + `transform/eventSupplies`). (아이,날짜) 쌍은 서로
  다른 서버 행이라 병렬 안전 — 같은 행 병렬 재작성 금지 규칙과 충돌하지 않는다. 병합은 라벨 정규화(공백·대소문자
  무시) 중복 제거로 재저장 멱등, 하루 8개 상한 초과는 dropped 로 집계해 토스트로 정직 안내("하루 8개까지만
  담았어요"). 준비물 저장 실패는 일정 저장을 되돌리지 않고 "준비물 일부는 저장하지 못했어요"로 안내. 상한 상수
  단일 출처=`transform/eventSupplies.ts`(endpoints/schedule 이 역 import — node 테스트가 endpoints 체인 없이
  import 하기 위함). 부모 홈 준비물·아이 홈 가방 챙기기는 기존 `daily_supplies` WS 브릿지로 실시간 반영.
  회귀=`tests/eventSupplies.test.ts`.
- 안전지표 앱 사용(2026-07-11 아침 실발사 검증): razr 에 Usage Access(appops GET_USAGE_STATS)를 adb 로 allow 함
  (제품 기능 활성화 — 이전엔 미부여라 타 앱 데이터가 아예 없었다). `isSystemSurfacePackage` 필터 양성 대조 실증:
  원시 이벤트에 launcher3·카카오톡 존재 + 마지막 전경=런처 상태에서 리포트 recentApp=혜니캘린더,
  appUsage 에 카카오톡 포함·런처 제외. recentApp 빈 값일 때 "권한 필요" 문구는 granted 면 "최근 사용한 앱 없음"으로 구분.
- 알림 실발사 검증 절차(아침): 테스트 이벤트는 time=+17분으로 만들면 15분 전(+2분)·5분 전(+12분) 두 윈도를
  한 번에 본다. 수신 확인은 `dumpsys notification --noredact | grep android.text`. razr 는 FCM 이 30~60초
  늦을 수 있다(도즈) — 없다고 단정 전에 재확인. force-ring 은 15초 + 확인 시트 2단계("지금 울리기" 버튼이 2개가 됨).
  정리: 이벤트 DELETE API + force_ring_events/memo_replies 는 D1 직접 삭제, 기기 알림은 남는다(무해).

- ★미등록 체류 출발 중복 근절(2026-07-30): `child_stay_presence.grid_key` 가 소수 4자리(≈11m)라 한 체류가 grid
  2~4개로 갈려 각각 출발 알림을 발사했다(실사고 4중복, D1 확인 37.2146/37.2147,127.1007).
  `lib/unregisteredStayPresenceDedupe.ts` 의 거친 지역키(소수 3자리 ≈110m)+10분 쿨다운으로 `cron/_deliver.ts`
  합류점에서 걸러내고 metadata `{stayAreaKey,stayKind}` 를 남긴다. 구버전 행은 제목으로 역산 → 서버 배포만으로 멎는다.
  cron 은 같은 패스의 같은 지역 출발을 1회만 발사한다. 회귀=`worker/tests/unregisteredStayPresenceDedupe.test.mjs`.
- ★알림 표시 문구(2026-07-30): 서버 카피의 선행 이모지는 `cleanAlertTitle` 로 표시 단계에서 제거한다(3D 아이콘과 중복).
  위치 끊김 본문은 2문장 이내로 줄이고 절전 추측 대신 "마지막 확인"/"새로고침하면 지금 위치를 확인해요"만 남긴다.
- ★네이티브 채움점 생성 중단(2026-07-30): `interpolateLinearPath` 를 삭제하고 `is_estimated` 를 더 쓰지 않는다.
  소비자가 없는데 업로드·D1 행만 3배로 불렸다. 과거 행 때문에 클라 필터(`isInterpolatedFillPoint`)는 유지한다.
  회귀=`tests/nativeLocationTrailRows.test.mjs`.

- ★표기·기본값 단일 출처(2026-07-30): 전화번호는 `transform/phoneFormat`, 지도 선택 화면 기본 중심은
  `transform/mapCenter`(현재 위치 > 집 > 아이 마지막 위치 > 서울)만 쓴다. 화면별 로컬 포맷터·서울 고정 기본값 금지.
  좌표는 `Number(null)===0` 함정을 typeof 가드로 막는다. 회귀=`tests/formattingAndMapCenter.test.ts`.
- ★정직한 빈 응답(2026-07-30): 아이 AI 대화의 빈 `reply` 는 고정 응답으로 채우지 않고 "지금은 대답을 못 받았어…"로
  강등하며 신고 대상에서 뺀다. 주변 소리 기록의 0초 세션은 "청취 없이 종료", 그 외는 "N초 청취".
- ★출발 알림 톤(2026-07-30): 도착=민트, 출발=라벤더, 앰버(확인 필요)는 미도착·지연만. `arrivalAlertTone` 단일 출처.

### J. 실기기 검증 치트시트 (함정 포함)
- ★**CDP 스크린샷은 디자인 판정용이 아니다(2026-07-30)**: WebView 가 `backdrop-filter`·`filter` 레이어를
  합성하지 못해 히어로 카드가 흐릿하게/겹쳐 보이는 캡처 아티팩트가 난다. 실제 화면 판정은
  `adb -s <serial> exec-out screencap -p` 프레임버퍼로 하고 CDP 는 DOM·상태·클릭에만 쓴다(리뷰는 width 420 축소본).
- ★**모의 API 브라우저 스윕(2026-07-30)**: ms-playwright chromium + `Fetch.enable` 로 외부 요청을 전부 mock 으로
  닫으면 실계정·실서버 무영향으로 부모/아이 전 화면의 모든 버튼을 눌러볼 수 있다. `window.kakao.maps` 계측 스텁 주입,
  서버 계약과 정확히 같은 fixture(`events_children`, `notif-settings.quiet_hours`), 외부 링크 이탈 후 절대 URL 복구,
  5173 포트 충돌 회피가 함정이다.
- ★**디자인 계측 스윕의 함정 6가지(2026-07-30 — 전부 실제로 오판했던 것)**: 같은 하니스에 계측(대비·반경·폰트·
  터치타깃·오버플로)을 얹으면 눈으로 못 잡는 결함이 잡히지만, **다음을 안 걸러내면 숫자가 거짓말을 한다.**
  ①**비활성 컨트롤은 WCAG 대비 면제** — `:disabled` 버튼(`#b3aaae` on `#e5e0e3` 1.74:1)을 섞으면 "저장 버튼이
  최악"이라는 오진이 난다. `[disabled],[aria-disabled],.sb-slot--locked` 를 제외한다. ②**가로 스크롤 행의 자식과
  `overflow:hidden` 장식은 오버플로가 아니다** — 조상의 `overflowX` 를 확인해야 칩 행·해 장식 오탐 7건이 사라진다.
  ③**런타임 대비 계측은 그라디언트 채움을 못 본다**(배경 이미지라 배경색이 없어 계산 자체를 건너뜀) → 정적 CSS 스캔을
  **반드시 병행**한다. 이 맹점 때문에 앱 전역 저장·전송 버튼 18곳(밝은 stop 2.0:1)이 런타임에선 0건으로 보였다.
  ④**SVG 의 `className` 은 문자열이 아니다**(`SVGAnimatedString`) — `getAttribute("class")` 로 읽어야 lucide 스피너를
  놓치지 않는다. 이걸 놓쳐 이미 스피너가 있는 화면을 "표시자 없음"으로 오판했다. ⑤**로딩 상태를 보려면 라우트마다 새
  문서를 띄운다** — hash 만 바꾸면 TanStack Query 캐시가 남아 조회가 이미 끝난 상태로 측정된다(첫 측정 전체 무효).
  `Page.navigate` + `Page.reload` 후 **BootSplash 1.6초 게이트를 지나고** API 응답(mock 지연 3초) 전 창(≈2.4초)에서 읽는다.
  ⑥**"움직이는 요소가 있다"로 진행 표시자를 판정하면 안 된다** — 화면 진입 페이드(`hy-rise-in`)·마스코트 부유가
  전부 걸려 42/42 통과처럼 보인다. 진행 맥락(`[aria-busy]`·`[role=status]`·skel/loading/spin 클래스) 안의 애니메이션만 센다.
- ★**Worker 배포 자격(2026-07-30)**: `hyeni-3/.env` 토큰은 D1 전용이라 배포가 `Authentication error 10000` 이다.
  `hyeni-1/.env.local` 의 `CLOUDFLARE_API_TOKEN` + `hyeni-3/.env` 의 `CLOUDFLARE_ACCOUNT_ID` 를 따옴표를 벗겨
  프로세스 env 로 주입해 배포한다.
- **현재 기기 역할(2026-07-19 최신 사용자 지시)**: A17(RFKL40DP73J)만 실기기 검증기다.
  현재 부모모드 세션을 유지한 채 `adb install -r`로 세션을 보존한다. 아이 역할 전용 동작은 A17 계측 테스트와
  브라우저 역할 검증으로 확인하고 실제 계정의 로그아웃·역할 전환·재페어링은 하지 않는다. razr는 연결 해제·
  미조작, S25는 검증 제외 상태이며 다시 명시적으로 허용받기 전에는 설치·실행·로그·세션 조회를 포함한 어떤
  adb 접근도 하지 않는다.
- **기기 역할 확인**: 역할은 세션별로 바뀐 이력이 있으므로, 과거 단계 기록보다 최신 사용자 지시/goal을 우선한다.
  완료 선언 전에는 CDP로 WebView 세션(`hyeni-api-session-v1`)의 role/familyId와 실제 화면을 함께 확인하고,
  지시한 역할과 다르면 해당 실기기 검증은 미검증/차단으로 분리 보고한다.
- **Windows cmd 함정**: 실행 환경에 `NoDefaultCurrentDirectoryInExePath=1`이 있으면 cmd가 현재 디렉터리의
  `gradlew.bat`를 경로 접두어 없이 찾지 못한다("내부 또는 외부 명령이 아닙니다"). gradle 호출은 항상
  `.\gradlew.bat`처럼 경로를 명시한다(`tests/androidMergedManifestSecurity.test.mjs` 동일 적용).
- **adb**: Git Bash 는 `MSYS_NO_PATHCONV=1` 필요(/sdcard 변환 방지) · razr 스크린샷은 `-d 4630947043778501762` ·
  `keyevent 26` 은 토글(끄기 전 상태 확인) · 기기 offline/unauthorized 는 `adb kill-server && start-server`.
- **CDP(WebView)**: `adb forward tcp:922x localabstract:webview_devtools_remote_<pid>` · websocket 은
  `suppress_origin=True` 필수 · **awaitPromise 긴 evaluate 는 hang** — 클릭/조회를 짧은 동기 evaluate 로 쪼개고
  결과는 별도 폴링 · `canvas.toBlob` 콜백이 안 옴 → `toDataURL`(동기) 사용 · React 제어 input 은
  native setter+`input` 이벤트 · 페이지 fetch 로 `/rest/v1` 은 CORS 차단 → 토큰만 CDP 로 읽고 **호스트 curl**.
  최종 화면 판정은 `main` 같은 시맨틱 태그가 아니라 라우트별 실제 루트 선택자의 가시성으로 확인한다. `Log.enable`은
  이전 WebView 로그를 다시 전달할 수 있으므로 `Log.clear`와 수집 배열 초기화 후 새로고침한 응답만 현재 오류로 판정한다.
- **토스트 검증 타이밍**: `.hy-toast` 수명은 2.4초 — 발사 후 1.2초 안에 읽거나, 같은 evaluate 에서
  `setTimeout(()=>{window.__t=(document.querySelector('.hy-toast')||{}).textContent},400)` 로 캡처해 두고 읽는다.
  늦게 읽고 "(없음)"이라 오판한 실측 실수가 있었다(2026-07-11).
- **헤드리스 Chrome 렌더 검증**: `--headless=new --screenshot --window-size` 는 **레이아웃 폭에 적용되지 않을 수
  있다**(512px 레이아웃을 390px 로 크롭해 "오른쪽 잘림"처럼 보이는 아티팩트 — 실제 오버플로로 오판 금지).
  정확한 모바일 렌더는 `--remote-debugging-port` + CDP `Emulation.setDeviceMetricsOverride(390x844)` +
  `Page.captureScreenshot` 로. 임시 `--user-data-dir` 필수(기본 프로필 오염 방지). ⚠️ localhost:5173 은
  다른 프로젝트 dev 서버가 살아 있을 수 있다 — hyeni-3 는 `--port 5199 --strictPort` 처럼 명시 포트로 띄울 것.
- **D1/Worker**: 시간 검증은 백데이트 트리거(예: `anchor_since` 6분 전 + upsert 1회, cron 은 이벤트를 target 분에 생성) ·
  `wrangler tail --format json` 을 파일로 받아 파이썬 파싱 · 컬럼명 추측 금지 — `pragma_table_info` 먼저.
  Worker 전체 Node 테스트는 Worker 하위가 아니라 부모 저장소 `C:\Users\TK\Desktop\hyeni-1`에서
  `node --test worker/tests/*.test.mjs`로 실행한다(Vite root 오인식 방지).
  ★ `wrangler tail --format json` 출력은 **pretty-print** 라 줄 단위(JSONL) 파싱하면 0건으로 보인다 —
  `json.JSONDecoder().raw_decode` 로 스트림 파싱할 것. CDP `Runtime.consoleAPICalled` 의 Error 인자는
  `value` 가 아니라 `description` 에 들어온다(둘 다 읽지 않으면 오류를 못 세고 "0회"로 오판).
  Git Bash 에서 `MSYS_NO_PATHCONV=1` 과 Windows python 을 함께 쓰면 `/tmp/x` 를 python 이 `C:\tmp\x` 로 읽는다 —
  python 에는 Windows 경로를 넘길 것.
  `/api/events`처럼 `events_children`를 다건 조회할 때는 D1 변수 제한을 넘지 않도록 `IN (...)` 바인딩을 청크 처리한다.
- **검증용 발사 자제**: 밤에 force_ring/SOS 실발사는 실기기 벨 울림 — 시간대 고려, 발동 후 정리.

---

## 1. 확정 아키텍처 (사용자 승인)

**웹앱(PWA) 단일 코드베이스 + 안드로이드만 Capacitor로 네이티브 래핑.**

- 하나의 최신 React 웹앱. 시안(`혜니캘린더 리디자인.dc.html`)이 전부 웹 CSS라 웹으로 1:1 재현.
- **Android**: Capacitor 래핑 = 네이티브 APK. 무거운 네이티브 기능(백그라운드 위치·지오펜스·주변소리·SOS·푸시)은 여기서. 아이 기기 + 부모 기기 모두.
- **iPhone**: 같은 앱을 Safari "홈 화면에 추가"(PWA). **부모 전용, 조회·관리만**. iOS 네이티브 기능 불필요.
- **아이(child) 기기 = 안드로이드 전용** 전제. 부모는 안드로이드 또는 아이폰(웹).
- **2026-07-31 정본 검증 조합 = 부모 iPhone 홈 화면 PWA + 아이 Android 네이티브 앱.**
  위치 즉시 요청·기기 상태·소리 울리기·주변 소리·메시지·장소/알림 설정은 부모의 Capacitor 여부로 막지 않고
  Worker API→FCM→아이 Android로 전달한다. 주변 소리는 아이 캡처만 Android 네이티브이고, 부모 제어·WebSocket
  수신·재생은 PWA 공용이다. iPhone 오디오는 사용자 탭 안에서 AudioContext를 먼저 열며, 웹 푸시가 없는 일반
  Safari 탭에는 홈 화면 추가 방법을 안내한다. PWA Service Worker의 `includeAssets`·manifest 아이콘은 Workbox
  glob과 중복하지 않으며 `scripts/verify-route-bundle.mjs`가 precache URL 중복을 빌드 실패로 차단한다.
  위치 설정은 부모 iPhone 권한이 아니라 활성 아이 `device_health`를
  보여준다. Android OS 권한·배터리 예외는 원격 부여할 수 없어 아이 기기에서 1회 허용해야 하고, Google Play
  결제·소셜 계정 연결처럼 부모 네이티브 앱이 필요한 항목은 자녀 원격제어 성공과 분리해 정직하게 보고한다.
- 이유: React Native는 사파리 웹앱을 못 만들어 "아이폰=사파리 바로가기" 요구와 충돌. 웹앱+Capacitor가 디자인 1:1·코드베이스 1개·유지보수/속도 최상.
- **iOS 기능 한계**: 주변소리 몰래듣기·타 앱 사용시간 모니터링은 iOS 정책상 불가 → 아이=안드로이드이므로 해당 없음.

## 2. 스택

Vite 7 · React 19 · TypeScript(strict) · 플레인 CSS(디자인 토큰) · React Router v7(**HashRouter**, Capacitor 호환) · lucide-react · vite-plugin-pwa. CSS-in-JS·UI 라이브러리 없음(속도·심플).

## 3. 실행

```bash
npm install
npm run dev        # http://localhost:5173  (LAN: http://<IP>:5173 로 폰에서 테스트)
npm run build      # tsc -b && vite build  → dist/ (PWA 포함). 완료 기준 = exit 0
npm run typecheck  # tsc -b
```

## 4. 프로젝트 구조

```
hyeni-3/
  index.html · vite.config.ts · tsconfig*.json · .env(.example)
  public/  fonts/PretendardVariable.woff2 · assets/(3D 캐릭터·스티커·UI webp 83개 + logo.webp)
  src/
    theme/theme.ts               디자인 토큰(JS 상수: color/accents/radius/space/modeAccent)
    styles/  tokens.css(모든 CSS 변수 + --hy-accent*) · global.css(리셋·프레임·폰트·애니메이션) · components.css(.hy-* 공통)
    app/     App.tsx(라우터) · AppShell.tsx(ParentShell/ChildShell/TeacherShell/PushShell + 탭 설정) · TabBar.tsx · accent.tsx · toast.tsx
    components/ui/  TopBar.tsx · SectionHeader.tsx
    lib/assets.ts                asset("ui/x.webp") 헬퍼 (BASE_URL 접두)
    data/mock.ts                 부모홈 목업(+ 각 화면은 자체 목업/.data.ts)
    screens/  parent/* child/* teacher/* shared/MemoChat feature/* onboarding/Onboarding · Placeholder
  scripts/  port-screens.workflow.js · wire-nav.workflow.js   (재사용 가능한 워크플로우)
  design-system/  tokens(css/ts/json) · spec(IA·COMPONENTS) · brand   ← 디자인 기준
  혜니캘린더 리디자인.dc.html      ← 시안 원본(각 화면 섹션의 인라인 style = 디자인 기준). 오프라인.html = 렌더본
  assets/(원본) · hyeni-port/(참고 컴포넌트)                ← 참고용, 앱 번들 아님
```

## 5. 진행 상황 (2026-07-04 기준)

- ✅ **1단계**: 기반 + 디자인시스템 + 4개 셸 + 부모홈(1:1). 빌드/육안 검증.
- ✅ **2단계**: 나머지 27개 화면 시안 1:1 이식(병렬 워크플로우). 통합 빌드 exit 0, 6화면 육안 검증.
- ✅ **2.5단계**: 허브 9개 네비게이션 배선(바로가기·설정행·CTA → 실제 화면). 빌드 exit 0, 앞/뒤 클릭 흐름 확인.
- 🔄 **3단계(진행 중)**: 백엔드 연동 — **상세·트래커는 `docs/PHASE3-BACKEND-PLAN.md`**(11 슬라이스, 결정 4건 잠금).
  - ✅ **Slice 0**: 인프라 — `config/env.ts`, `lib/api/{client,session,errors}.ts`, `queries/{keys,QueryProvider}.tsx`, App.tsx 래핑. TanStack Query 설치. build/typecheck exit 0.
  - ✅ **Slice 1**: 인증 코어 — `transform/{phone,pairCode}.ts`, `lib/api/endpoints/auth.ts`, `auth/{AuthContext,AuthProvider,guards,RequireAuth,RequireRole}`. build exit 0 + JWT/가드 검증.
  - ✅ **Slice 2**: 온보딩 배선 — `Onboarding.tsx`(카카오·구글 OAuth·ID/PW·전화+OTP 가입·KID 페어링), `endpoints/family.ts`, OAuth 콜백, 라우터 가드 활성화. **브라우저+라이브 Worker E2E 검증**. 앱은 이제 인증 게이트됨.
  - ✅ **Slice 3**: 가족 도메인 + 가족소켓 — `queries/{useFamily,useFamilyRealtime}`, `realtime/familySocket.ts`(WS), `transform/familyView.ts`. ParentFamily·ChildInvite·PhoneSetup 실데이터 E2E + **WS `/realtime` 연결 검증**. ProfileEdit=아이편집 엔드포인트 없어 보류.
  - ✅ **Slice 4**: 일정 — `transform/{dateKey,scheduleView}`, `endpoints/schedule`, `queries/useSchedule`. ParentCalendar+ParentHome 실 events E2E(date_key 0-index 검증). ChildHome=아이세션 필요.
  - ✅ **Slice 5**: 위치+Kakao지도 — `lib/kakaoMap`, `components/KakaoMap`, `endpoints/location`, `transform/locationView`, `queries/useLocation`. **ParentLocation 실 지도 E2E**(자녀마커·위험구역·저장장소). PlaceManager 실데이터.
  - ✅ **Slice 6~10**(병렬 워크플로우 + 통합): 메모(MemoChat+WS, 쓰기 round-trip E2E), 구독(Subscription 프리미엄·R9), 알림(Notifications), AI(AiCredit/AiFriendChat), 선생님(빌드), 실시간브릿지(useFamilyRealtime). 통합 빌드 exit 0.
  - ✅ **보조 화면**(2차 워크플로우): RouteView(실 Kakao 도보경로 E2E), PlaceForm(지도 피커), 스티커(StickerBook/Send/카운트), ChildSos·AiSchedule(배선). **아이 계정 E2E**(익명→페어링→ChildHome 실데이터).
  - **남은 후속**: 아이/선생님 세션 E2E, 쓰기 뮤테이션 실행(배선완료·미실행), ChildHome/PlaceForm/RouteView/ChildSos 등 — 상세는 `docs/PHASE3-BACKEND-PLAN.md`.
  - ⚠️ **date_key 함정**: 월이 0-indexed 비패딩("2026-7-5"=8월5일). 반드시 `transform/dateKey.ts` 경유.
  - **테스트 계정**: ID `tkisdroid`(부모, 가족 f9a75cb4·pairCode KID-D1249271·멤버 3). 비번은 사용자만 입력(안전원칙). dev 로그인 상태 유지 중.
  - 결정: WS 우선(Slice3부터) · 실제 Kakao지도 · 소셜 전체(네이버 키 대기) · 결제/원격청취/친구놀이 4단계 defer.
- 🔄 **4단계(진행 중)**: Capacitor Android 래핑 + 네이티브 플러그인.
  - ✅ **P4-A**: Capacitor 8.x 설치, `capacitor.config.json`(appId `com.hyeni.calendar`, webDir dist), **hyeni-1 `android/` 재사용**(커스텀 플러그인 10개 + FCM google-services.json). `cap sync` + **`gradlew assembleDebug` → app-debug.apk(14MB) 빌드 성공**. SDK=`~/AppData/Local/Android/Sdk`, `android/local.properties`에 sdk.dir. 재빌드: `npm run build && npx cap sync android && cd android && ./gradlew assembleDebug`.
  - ✅ **P4-B**: 네이티브 JS 브리지 — `lib/native/{plugins,phone,browser,oauthDeepLink,push,location,ambient,billing}.ts`(웹 폴백), `app/NativeBootstrap.tsx`(딥링크·푸시·백그라운드위치 앱 init). 병렬 워크플로우.
  - ✅ **실기기 2대 E2E 검증**: A17(부모, SM-A175N)+모토로라 razr40(아이) adb 설치·실행. **부모 ParentHome·아이 ChildHome 실데이터 네이티브 렌더**, **네이티브 FCM 토큰 실취득**, isNativePlatform=true, **크로스기기 실시간 WS**(아이→부모 메모 자동 수신) 확인. WebView CDP(adb forward)로 제어.
  - 🐛 실기기가 잡은 버그: `NativeBootstrap`이 ToastProvider 바깥에서 useToast → 부팅 크래시(웹도 동일). useToast 제거로 수정.
  - **재빌드**: `npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)`. 설치: `adb -s <serial> install -r android/app/build/outputs/apk/debug/app-debug.apk`.
- ✅ **5단계**: PWA 마감·아이콘·배포.
  - ✅ **P5-A**: 아이콘 세트(logo 1024→`public/pwa-{192,512,maskable-512}.png`·`apple-touch-icon.png`·`favicon-32x32.png`, sharp 생성), vite.config PWA manifest(PNG 3아이콘)·index.html apple-touch PNG. 안전영역(safe-area-inset)은 CSS에 이미 처리.
  - ✅ **P5-B**: **Cloudflare Pages 배포** → **https://hyeni-calendar.pages.dev** (wrangler, 99파일). 브라우저 검증: 렌더·manifest·SW·설치가능 PWA. **재배포**: `npm run build` 후, **`.env` 가 없는 디렉터리로 이동해** `npx wrangler pages deploy <hyeni-3>/dist --project-name=hyeni-calendar --branch=main --commit-dirty=true`. ★ `hyeni-3/.env` 의 `CLOUDFLARE_API_TOKEN` 은 Workers/D1 전용(Pages 권한 없음)인데 wrangler 4 가 이를 자동 로드해 OAuth 자격을 덮어쓴다 → `Failed to automatically retrieve account IDs`. 같은 이유로 hyeni-3 안에서는 `wrangler login` 도 거부된다(`Unset the CLOUDFLARE_API_TOKEN`). OAuth 자격(`%APPDATA%/xdg.config/.wrangler`)에는 `pages:write` 가 있다.
  - ⚠️ **배포 origin 설정 후속**(코드 아님): 소셜 OAuth redirect_uri·Kakao 지도 JS키 허용도메인에 `hyeni-calendar.pages.dev` 등록 필요(부모 ID/PW 로그인은 무관하게 동작). 지도는 도메인 등록 전까진 폴백.

**🎉 5개 단계 전부 완료** — 백엔드 연동(3) + Capacitor Android 실기기 검증(4) + PWA 배포(5).

- ✅ **6단계: 와이어프레임 전수 구현(2026-07-04)** — claude_design MCP 로 `혜니캘린더 와이어프레임.dc.html`(65화면 spec) 임포트 → 전수 감사(8에이전트) → **죽은 버튼 전부 실배선 + 누락 화면 전부 골격 구현**.
  - **QR·페어링(P-05)**: `qrcode` 라이브러리 + `components/ui/QrCode.tsx`(canvas). ChildInvite = 실 QR(딥링크 `#/onboarding?pair=CODE`)+공유(navigator.share)+만료타이머(일/시간)+연결폴링(6s)→자동전환. Onboarding `?pair=` 딥링크 아이 자동연결(`transform/pairLink.ts`). **실기기 검증**(부모기기 QR canvas 212px + 실코드 KID-…).
  - **Wave 1(6에이전트, 기존 훅 실배선)**: 일정 CRUD(EventForm P-09·상세시트 P-08·삭제 P-12) · 숙제준비물(Supplies P-13, useUpsertDailySupply) · 위험구역(DangerZoneForm P-17) · 위치상태(P-15) · 아이상세(ChildDetail P-03) · 페어링위저드(P-04) · 선생님(TeacherNotice T-03·TeacherTimetable T-02, usePublishNotice/useSetAttendance/useRequestPairing) · 알림필터/채팅읽음/스티커메시지. 캘린더 FAB·일정카드·준비물체크 등 죽은버튼 실동작.
  - **Wave 2(9에이전트, hyeni-1 엔드포인트 51개 포팅)**: unpair·member/profile·notif-settings·feedback·playdate(초대/수락/거절)·ai day-summary·ai settings·force-ring·remote-listen·account/delete·legal·danger-zone update·daily-supplies PUT/DELETE·events(다자녀/사전알림). 신규화면 FamilyConnection(P-06)·NotificationSettings(P-24)·ArrivalAlerts(P-22)·DangerAlert(P-23)·DaySummary(P-28)·ParentAccount(P-30)·LocationSettings(P-31)·DataSync(P-32)·ThemeSettings(P-33)·TrialLock(S-03)·RemoteRing(P-19)·SosReceive(P-20)·ChildLocationStatus(K-03)·AiFriendSetup(K-04)·ChildSettings(K-10).
  - **앱레벨 골격**: Splash(C-01)·OfflineBanner(C-13, App 전역)·AppUpdate(C-14)·PermDenied(C-15).
  - **검증**: 통합 빌드 exit 0(JS 725KB) · 브라우저 26라우트 렌더/크래시 0/콘솔에러 0 · **실기기 2대 재빌드·설치·네이티브 부팅**(부모 ParentHome+아이 ChildHome 실데이터, native=true) · QR/일정폼/하루요약 실기기 렌더.
  - **잔여(백엔드 스키마 한계, 정직 처리)**: parent-alerts DELETE 없음(스와이프삭제 미구현)·danger-zone 진입이탈 컬럼 없음·시간표 편집테이블 없음·비번변경 엔드포인트 없음·DND/위치prefs 서버필드 없음(로컬 "이 기기에만 저장")·다크모드 CSS 미포함·실시간오디오 디코드=네이티브전용·R2 첨부 스키마갭. 전부 disabled+사유 명시 또는 로컬 낙관 반영(공허 토스트 없음). 상세=Wave2 `stillDeferred` 30건.
  - **재빌드**: `npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)`. 설치: `adb -s <serial> install -r android/app/build/outputs/apk/debug/app-debug.apk`. 기기: RFKL40DP73J(부모)·ZY22H9VTQD(아이).
  - **후속(2026-07-05)**: ①소셜/지도 실기기 최종확인 — 지도·소셜은 hyeni-1 키·Worker OAuth 재사용으로 **등록 불필요, 이미 동작**(단 배포 웹 pages.dev 지도/소셜은 Kakao 콘솔에 pages.dev 도메인 등록 필요=사용자 몫). ②**AI 음성 스케줄 실배선** — `src/lib/native/speech.ts`(captureSpeech: 네이티브 SpeechRecognition 우선+Web Speech 폴백)로 AiSchedule 음성탭 실동작(voice-parse는 텍스트 입력이라 STT는 클라 처리). 실기기 네이티브 STT `available:true` 확인. ③프로덕션 재배포 완료.

- ✅ **7단계: 실기기 최종 E2E 검증 & 릴리즈 게이트(2026-07-05)** — `hyeni_calendar_release_gate_fable5_prompt.md` 실행. 2기기 ADB 자동 검증(A17 부모·razr 아이) + D1/Worker 서버 단언. **판정=조건부 GO(미해결 P0·P1 0건)**. 리포트=`docs/release-gate-report.html`.
  - **P0 수정①: 주변소리 실 오디오** — 네이티브 게이트가 `supabaseKey` blank를 "push context missing"으로 판정→마이크 캡처 skip이 근본. `src/lib/native/{push,location,ambient}.ts` supabaseKey `""`→`"worker"`(Worker 무시, 게이트만 통과). 부모 재생기 `src/lib/remoteAudioPlayer.ts`(Web Audio WAV 순차재생) 신규 + `RemoteAudio.tsx` broadcast(audio_chunk) 구독·재생·음소거·정리. push context: resume 재주입 + 콜드스타트 재시도(`push.ts`). **실기기 검증**: 아이 `Realtime audio chunk sent seq=1~12`, 부모 audio_chunk 13개 수신 + "듣는 중" LIVE 재생 UI.
  - **P0 수정②: 위치 서버 게이팅** — `hyeni-1/worker/db/authz.ts`에 `isLocationVisibleForFamily`(subscription·user_tier·review reward 판정, fail-open) 추가, `routes/location.ts` `/children·/history`에 free 차단. **프로덕션 배포 완료**(wrangler deploy). 프리미엄 회귀 없음 확인(200).
  - **P0 수정②-b(보안, gating-audit 제보): rest-shim 자가 프리미엄** — `rest-shim-table.ts`가 `family_subscription`·`families`를 컬럼 화이트리스트 없이 클라 쓰기로 노출 → 부모가 `PATCH /rest/v1/family_subscription {status:active}`로 무결제 프리미엄 자가 부여(모든 서버게이트 무력화, 라이브 200 확인). `forbiddenWriteColumn` 가드 추가: family_subscription=`clientWriteAllow:[remote_listen_enabled]`, families=`clientWriteDeny:[user_tier,subscription_tier]`, service_role(webhook) 우회. **프로덕션 배포**. Red→Green: status/user_tier 쓰기 403 forbidden_column, 정당한 킬스위치·설정 204 유지. (남은 게이팅갭 다자녀·AI voice-parse는 제품결정 필요→fast-follow)
  - **P0 수정②-c(TK 정책 확정 + 배포): 다자녀·AI 서버 게이팅** — TK: 무료=아이1명, AI파싱=하루5회 제한. ①다자녀: `family.ts /join`에 **이름 비의존 통합 캡 후처리**(Path A/B/C 공통) — 방금 페어링한 아이는 항상 유지, 초과분(오래된 것부터)만 supersede. **재페어링 절대 403 안 함**(안전 불변식). 무료=1·프리미엄=2. `authz.ts isFamilyPremium(failOpen)` canonical(family_subscription+legacy tier+자녀 subscriptions). ②AI: `ai.ts reserveAiParseQuota`(원자적 조건부증가 `ai-parse:`+uid 접두키, any-of 프리미엄 바이패스, 5xx 롤백)를 voice-parse + 무방비였던 `child-monitor`에 적용. ③rest-shim `family_members` `clientWriteDeny:[role,user_id,is_active]`. ④★`forbiddenWriteColumn` **소문자 정규화**(SQLite 따옴표 식별자 대소문자무시 `{User_tier}`→user_tier 우회 봉인). **적대검증 2라운드(4·2 렌즈)로 우회/오차단 재수정→프로덕션 배포**. 라이브: `{User_tier}`/`{Status}`/`{Is_active}` 전부 403·정당 소문자쓰기 204·프리미엄 위치200·voice-parse200 바이패스. ⚠️ 무료 다자녀는 "차단"이 아니라 "단일 슬롯 대체"(새 아이가 기존 아이 supersede) — 안전(재연결 무차단) 우선 선택. 프리미엄 단일자녀 기기교체 시 옛 기기 유령잔존은 알려진 경미 이슈(클라가 childMemberId 전송하면 정밀 supersede 가능, fast-follow).
  - **P1 수정③: 부모 SOS 긴급 오버레이** — `useFamilyRealtime.ts`에서 parent_alert(sos/emergency) 수신 시 부모 앱을 `#/sos-receive`로 자동 전환. 실기기: 부모 홈→아이 SOS→자동 전환 검증(sos_events +1).
  - **필수①: 캐릭터 3D 통일** — `logo.webp`(2D)가 TopBar·Splash·온보딩 로고에서 캐릭터로 노출→`mascot/wave.webp`(3D)로 교체 + 프레임 배경/contain. **필수②: 문구** — "한 가족, 두 시점"→"함께 보는 우리 가족"(TK 승인), "연구독"→"연간 구독", ChildHome 스티커 하드코딩→실데이터. **P1: Kakao 지도 키** — `.env` 빈값→hyeni-1 키, 실 지도 렌더 확인.
  - **문구 정리(copy-audit 반영)**: 내부용어 `R2` 노출 제거(TeacherNotice·MemoChat), "출시기념"→"출시 기념", "디바이스"→"기기", "위치를 지켜요"→"아이 위치를 확인해요", "허용해줘요"→"허용해 주세요", Feedback 비문 수정, "연동코드"→"연결 코드" 통일, **ChildSos 아이모드 반말 통일**(CLAUDE.md 규칙; SOS만 존댓말 원하면 되돌리기 쉬움). 실기기 SOS 반말 렌더 확인.
  - **웹 재배포 완료**: `npx wrangler pages deploy dist --project-name=hyeni-calendar --branch=main` → https://hyeni-calendar.pages.dev. 배포 번들에서 새 문구 확인(iOS Safari 부모 트랙 반영).
  - **fast-follow 처리(2026-07-05)**: ①**스테이포인트 완성** — `transform/stayPoints.ts`(Li et al. 거리150m·시간8분 임계 검출 + 인접병합 + 노이즈제거), KakaoMap 스테이 마커(순번·체류시간·연결선), ParentLocation "오늘 경로"에 지도+목록(장소·시각·체류) + 목록↔지도 연동. 단위검증(합성 하루 4곳) + **실기기 검증**(350점→집 3시간10분 검출). ②**다크모드=미진행**(TK: 불필요. 하드코딩 색상 1100+로 대규모 리팩터 필요). ③**선생님 모드 완성** — `TeacherSettings.tsx`(플레이스홀더→실화면: 프로필·반관리·알림·약관·계정·로그아웃·탈퇴), 선생님 탭바에 시간표·설정 추가(4탭). 실기기 렌더 확인.
  - **후속(파괴 위험 없음)**: Kakao 콘솔 pages.dev 도메인 등록(사용자), 스토어 업로드(TK). **잔여 fast-follow**: Android14 백그라운드 마이크 하드닝(OPS)·프리미엄 기기교체 유령잔존(childMemberId 전송으로 정밀 supersede).
  - ⚠️ **검증 함정**: 라이브 앱의 refresh 토큰을 외부 스크립트로 회전시키면 앱 세션이 clear됨(재기동 시 소실). 아이 세션 지속은 refresh 조작 없이는 정상. 검증 시 앱의 access token만 읽고 refresh는 건드리지 말 것.

- ✅ **8단계: 다자녀 확정 아키텍처(2026-07-05, TK 결정)** — **아이 스위치는 부모 홈에서만, 다른 기능은 절대 중복 없이 전역 선택을 따름. 대화도 아이별.**
  - **전역 활성 아이**: `src/app/activeChild.tsx` `ActiveChildProvider`/`useActiveChild()`(localStorage per-family, App.tsx 배선). 홈 카드 탭=스위치("보는 중" 배지), 상세=chevron. 홈 안전지표·오늘일정·준비물·히어로 전부 활성 아이 스코프.
  - **화면 규범(반드시 준수)**: 딥링크 오버라이드(`?child=<user_id>`·`state.childUserId/childId`) > `activeChild` > **첫아이(children[0]) 폴백 금지**. 명시적 수신자 선택 화면(EventForm 배정·StickerSend·RemoteRing 칩)만 자체 선택 허용하되 기본값=활성 아이. ChildDetail 진입·퀵액션은 setActiveChildId 후 이동.
  - **메모=아이별 1:1 스레드**(이전 그룹대화 결정 뒤집힘): `useMemoThread(dateKeys, childId)`+send childId(member id), `qk.memoReplies`에 childId 포함. 부모=활성 아이·아이=자기 member. 서버 `child_id=?` 정확일치 → legacy null 메시지는 어느 스레드에도 안 보임(수용). 실기기 스레드 분리 검증.
  - **sweep 수정 11건**(3영역 워크플로우+적대검증): RemoteRing 첫아이→활성/state(+ChildDetail '소리 울리기' 행 신설 — 기존 진입 배선 전무), SosReceive 주변소리/지도에 SOS 아이 전달+locations[0] 폴백 제거, DaySummary·Supplies·ProfileEdit 첫아이 폴백→활성(Supplies는 읽기·쓰기 오귀속이었음), ChildInvite 연결감지 개수→uid 집합(supersede 페어링 감지), AiSchedule 일정=활성 아이 배정(useSaveEventWithChildren), EventForm 새 일정 기본배정=활성 아이+가족공유 안내, 캘린더 리스트 아이 배지(2명 이상).
  - **장소설정**: EventForm 장소 저장·표시는 원래 정상(D1 라운드트립 실증). 실체는 픽커 부재 → 저장장소 빠른선택 칩 추가(실기기 8칩·탭=채움 검증).
  - 검증: typecheck/빌드 exit 0, 실기기(부모 A17) 홈 스위치·히어로 전환·위치 배지·메모 분리·Supplies/RemoteRing 활성 스코프 전부 확인. 웹 재배포 + 두 기기 APK 설치 완료.
  - **소리울리기 좀비 수정(TK 제보 "울린시간 이상")**: 6/23 미정지(stopped_at NULL) 행이 12일간 잔존 → /active 가 "진행 중"으로 반환해 울린 시간이 12일치로 표시 + 새 발사 423 영구 차단. **10분 zombie 컷 3중 적용**(force-ring.ts /active · push-notify.ts 발사 가드 · RemoteRing 클라 방어, quota 기존 컷과 동일 기준) + 좀비 행 stop_reason='zombie_cleanup' 정리. Worker 배포·실기기 "최근 사용 · 12일 전 · 종료" 정상 확인.
  - **⚠️ 안전지표 근본 규칙: 네이티브 device_health 리포트는 on-demand** — 아이 LocationService 는 부모가 `POST /api/push-notify {action:'request_device_status', familyId, targetRole:'child'}`(instant 는 camelCase 계약)를 보낼 때만 publish. 부모 홈이 진입 1회+'지금 갱신'에서 `requestDeviceStatus`(endpoints/remote.ts) 호출하도록 배선(미배선이면 안전지표 영영 "확인 중"). 도착 → notifyPg(family_members) → WS 브릿지 자동 반영. 실기기 E2E: S25 홈 진입→razr publish→배터리100%·화면 47분·충전·Wi-Fi 표시.
  - **홈 카드 디자인 수정(TK 제보 줄바꿈)**: "보는 중" 배지를 이름 행→카드 우상단 코너(absolute)로, 이름 행 nowrap+기기명 ellipsis. 실측 sameLine 검증.
  - **스플래시+로딩(TK 요청)**: `screens/Splash`를 hyeni-1 "포근한 로즈" 시안으로 이식(블롭·후광·플로팅 wave 혜니·점 3개 로더 "가족 일정을 불러오는 중") + App `BootSplash` 게이트(1.6s+페이드) 배선. S25 스크린샷 검증.
  - **일정 장소 지도 지정(TK 요청)**: `components/MapPickerSheet`(현재위치 geolocation→집→서울 폴백, 지도 탭 픽+역지오코딩, 저장장소 마커+칩 선택) + EventForm 「지도」 버튼·placeCoord. event.location={address,lat,lng} 저장(EventLocation 에 lat/lng 기존재). E2E: 피커→"집" 선택→저장→D1 좌표 라운드트립 확인.
  - **아이 페어링 QR 스캐너 실구현 + 온보딩 반쪽화면 수정(TK 제보)**: ①`.ob-root/.ob-step`의 `min-height:100%`가 부모(.hy-screen flex:1, height 미명시)에서 해석 불가 → 콘텐츠 높이로 붕괴(razr 1005px 중 703px, "전체화면 아님") → `100dvh`로 수정. ②장식이던 `ob-qr` 영역 → **실제 카메라 스캐너**: `components/QrScanner.tsx`(BarcodeDetector+getUserMedia, hyeni-1 QrPairScanner 이관) + `lib/native/cameraPermission.ts`(커스텀 CameraPermissionPlugin — android/에 기존재, manifest CAMERA 기존재). 탭→오버레이→스캔→자동 연결(딥링크 URL도 normalizePairCodeInput KID-매치로 추출). ③"코드로 연결하기 안 됨"의 실체=빈 입력 안내 토스트가 붕괴된 배경 밖(y804)에 떠 인지 불가 — ①로 해소. **실기기 검증**: 전체화면 1006/1005 · 스캐너 video readyState=4 재생 · BarcodeDetector function · 실코드 E2E 재연결(ChildHome 도달).

- ✅ **9단계: 아이 모드 3종(2026-07-06)** — 길찾기·최신소식·AI 친구 + **세션 풀림 근본 수정**.
  - **①길찾기(인앱 완전 동작)**: 목적지 3단 해석(일정 좌표→저장장소 이름 매칭→Kakao 키워드/주소 검색) + 아이 본인 origin + 반말. ⚠️ Kakao 도보 API는 모빌리티 제휴 전용(403 — 키 유효, 자동차 200) → **서버 폴백: `worker/routes/kakao.ts`가 카카오 실패 시 OSRM foot(routing.openstreetmap.de, 무키)을 호출해 Kakao 응답 형태로 합성**(vertexes+guides 한국어 안내문) — 클라 무변경·제휴 복구 시 카카오 자동 우선. 실기기: 지도 폴리라인+“도보 9분·672m”+**도로명 턴바이턴 8스텝**(“대지로15번길에서 왼쪽으로 꺾어 75m”…). 카카오맵 버튼 강등은 최종 실패 시에만. (트래픽 커지면 OSRM 자체 호스팅/제휴 전환 권장)
  - **②최신소식**: ChildHome 티커에 내 스레드 최신 부모 메시지 내용 표시(`💌 부모님 · …`, 34자 말줄임, WS 실시간). 실기기 검증.
  - **③AI 친구**(hyeni-1 서버 계약 그대로): 서버 완비였고 클라 UX 연결 — ChildHome CTA 분기(이름 미설정→setup, ai_enabled=false→안내), AiFriendChat에 **선제 인사(오늘 일정·준비물 기반 로컬 생성, 크레딧 0)**+컨텍스트 칩+remaining 표시("오늘 N번 더")+헤더 설정버튼, AiCredit=activeChild+**AI 켜기 토글·하루한도**(PATCH /settings/friend — 이 설정 없으면 아이 채팅 403 feature_disabled)+ParentSettings 진입행. 서버: POST /api/ai/child-chat(아이 본인·gpt-4o-mini·나이밴드·가드레일), 크레딧 무료 5/일·구매 30/80/200(google-play-verify). 실기기 E2E: setup 이름 "코코"→헤더 반영→실 LLM 응답→remaining 9.
  - **★세션 풀림 근본 수정(아이 기기 반복 로그아웃)**: 원인=refresh 회전 레이스 — 서버가 old 즉시 폐기(유예 0)+클라 refreshAccess 병행 실행 → 두 번째 회전이 rejected → clearApiSession. 수정 3중: ①서버 `lib/refresh.ts` **60초 재사용 유예**(rotated_to/rotated_at 컬럼, 유예 내 재사용=같은 새 토큰 멱등 반환; 새 토큰 발급 후 old 폐기 순서로 원자성) ②클라 client.ts **single-flight**(진행 중 Promise 공유) ③session.ts setApiTokens 즉시 persist. Worker 배포+양쪽 typecheck 0.
  - razr 아이 계정은 재연결로 uid 갱신(c62258c0), ai_parent_settings 시드(enabled·한도10). 테스트 데이터는 검증 후 전부 정리됨.

- ✅ **10단계: 알림 3종 최우선 보장(2026-07-06 새벽, 전부 실기기 2대 E2E)**
  - **①일정 알림(설정 시간)**: 서버 cron이 사용자별 `notification_settings.minutes_before` 정확 매칭(selectCronWindowRecipients). 라이브 검증 — 아이(razr, 기본 {15,5}): "가기 15분 전이야!" 수신 · 부모(A17, {10,5}로 변경): "10분 전"+"5분 전" 수신 + 아이 일정도 수신. 검증 후 부모 설정 {15,5} 원복.
  - **②긴급 SOS 전체화면**: ★치명 갭 수정 — `POST /api/parent-alerts`가 DB+WS만 하고 **FCM 미발송**(앱 꺼진 부모에게 SOS 유실!). `URGENT_PUSH_TYPES(sos/emergency/sos_followup)` insert 시 `sendFcmToFamily(type:'sos', route:/sos-receive)` waitUntil 연쇄 추가(부모만 수신). rpc 경로는 네이티브 자체발송 있어 제외(중복 방지). 실기기: **A17 화면 OFF → SOS → 자동 화면 ON + SOS 수신 전면화면**(위치·전화·주변소리·안전확인). 포그라운드 WS 오버레이(#/sos-receive 자동전환)도 별도 검증. USE_FULL_SCREEN_INTENT appop allow.
  - **③미등록 장소 도착(Family Link식)**: `lib/arrivalDetect.ts` 신규 — `upsert_child_location`(rest-shim-rpc) waitUntil 훅. 앵커 150m·**5분 체류**·등록장소 150m 내 skip(네이티브 지오펜스 담당)·동일장소 2h 쿨다운. 장소명=Kakao coord2address 역지오코딩(일반 REST 키 동작). `child_arrival_state` 테이블(ALTER 완료). 실기기: 부모 FCM "📍 혜니 도착 — '경기도 성남시 분당구 무지개로 144' 근처에 도착해 5분째 머물고 있어요". 등록 장소(집 도착)는 네이티브 지오펜스로 기동작 확인. 한글 조사(이/가) 받침 처리.
  - 검증 방법 메모: 도착 감지 트리거는 `child_arrival_state.anchor_since` 6분 백데이트+동일좌표 upsert 1회(curl, 아이 토큰·apikey:worker). CDP fetch 는 CORS 로 /rest/v1 불가 — 호스트 curl 사용.
  - **대화 위치 공유·사진 전송(TK 제보 → 실구현)**: MemoChat 컴포저 버튼 실배선 — 위치=GPS(5s)→내 서버위치 폴백→역지오코딩→`[[loc:lat,lng|주소]]`(탭=카카오맵), 사진=리사이즈→**기존 child-photos R2 재사용**(`{familyId}/memo-*.jpg`, 가족 격리·서버 무변경)→`[[img:key]]`(표시=childPhotoProxyUrl ?token=). memoView 리치 파싱(kind). 실기기 E2E: 위치 버블("동탄대로 683")·R2 업로드·이미지 로드(320x240).
  - **기기 구성(2026-07-06 오전, TK 지시)**: razr=아이 "혜니" 실사용, A17=아이 테스트 계정 "테스티"(3fd1f52c), S25=부모. razr 현역 uid=666fcc04(아침 재연결분 — uid 종속 시드는 이 값 기준, ai_parent_settings 재시드됨). ⚠️ 부모 FCM 토큰 정리로 **S25 앱 1회 실행해야 부모 푸시 재개**. ⚠️ CDP 함정: awaitPromise 긴 evaluate 가 A17 에서 hang — 클릭/조회는 짧은 동기 evaluate 로 분할, canvas.toBlob 대신 toDataURL.

- ✅ **11단계: 장소 지도 UX + 미도착 알림 실사고 수정(2026-07-06 낮)**
  - **①장소 등록(PlaceForm) 지도 3종(TK 제보)**: 진입 시 현재 위치 기본 중심(geolocation 4s, 검색/선택 우선) · 하단 핸들 드래그로 지도 확대(160~520px, KakaoMap ResizeObserver relayout+중심유지) · **우측 하단 현재 위치 버튼**(뷰 이동 전용). KakaoMap `recenterKey` prop 신설 — lastCenterRef 가 같은 좌표 재설정을 무시하므로 키 증가로 강제 재이동. S25 실기기: 서울 검색 이동→버튼 탭→실위치(동탄) 복귀 확인.
  - **★②"11시 생존수영 미도착 알림 미수신" 실사고 규명(이중 원인)**:
    - **주원인**: 이벤트가 `events_children` 링크 0건+`is_family_event=0`(6/19 구앱 등록 레거시) → cron 소유권 게이트(`eventBelongsToActiveChild`)에서 리마인더·미도착 전부 상단 skip(parent_alerts·push_sent 기록 0건으로 확진). 당시 **클라는 "배정 없음=가족 공유"로 표시**하는데 서버는 침묵해 표시 계약과 알림 계약이 불일치했다. 그래서 서버를 "링크 0건=활성 자녀 전원"으로 고쳤다(da84c74).
      ★**현행 규칙은 그 반대다(2026-07-11 재확인)**: 클라가 먼저 `transform/eventScope.ts`(f9e1aca, 7/07)로 **"배정 없음=배정 누락 → 아이 화면 비노출, 부모 캘린더에 `배정 필요` 배지"** 로 바뀌었고, 서버도 bf97531(7/10)에서 `selectEventTargetChildren` 을 `linked.size === 0 → return []`("전원 대상 폴백 금지")로 되돌려 **양쪽이 일치**한다. 오귀속 방지가 우선이라는 선택이다. 실기기 확인: `토요일 연습`(링크 0건) → 부모 캘린더 "오전 10:00 · 배정 필요", 아이 홈 노드 0건, 알림 0건. **문서만 보고 서버 폴백을 되살리지 말 것** — 아이 화면에 안 보이는 일정으로 알림이 가게 된다. 옛 자녀 링크"만" 있는 고아 이벤트 차단은 그대로 유지.
    - **부수 원인(운영 실수, 정직 고지)**: 어제 A17 아이 전환 작업 중 부모 fcm_tokens 전부 삭제→S25 재등록 11:58 KST — 미도착 판정 시각(11:00~11:05)에 부모 토큰 0개. 설령 게이트를 통과했어도 FCM 미수신이었음. 현재 복구됨. 교훈: **실사용 가족의 FCM 토큰 일괄 삭제 금지**(만료는 서버가 자체 정리).
  - 미도착 파이프: 이벤트 좌표 필수(`location.lat/lng`)·윈도우=시작~+5분(cron 매분)·반경 50m·부모에게만 FCM(severity=emergency 전체화면). `not_arrived`는 인앱 SOS 화면 전환(URGENT_ALERT_TYPES) 대상 아님 — 오전환 없음.

- ✅ **12단계: 사용자 확보/유료전환 기능(2026-07-07)** — `앱고도화.md` 실행. 부모 일상 사용 빈도·아이 참여·프리미엄 전환을 위한 화면/문구/문서 추가.
  - **오늘의 안심 리포트**: `/daily-report` 신규. 활성 아이 기준으로 오늘 일정, 준비물, 최신 위치, 기기 상태, 최신 메모, 부모 알림을 조합한다. 위치는 `isLocationVisible(tier)` 게이트를 존중하고, 기기 상태 새로고침(`request_device_status`)은 자동 실행하지 않고 버튼에서만 보낸다. 제목/부제는 `src/i18n` 씨앗 구조를 사용한다.
  - **아이 원탭 상태 공유**: ChildHome에 6개 버튼(도착/출발/늦음/픽업/전화/배터리)을 추가하고 기존 memo thread에 일반 메시지로 보낸다. `childId`는 member id, `origin="quick_status"`. SOS·force_ring과 혼동시키지 않는다.
  - **주간 가족 리포트**: `/weekly-report` 신규. `FEATURES.WEEKLY_REPORT`는 프리미엄 전용. 전용 서버 endpoint 없이 기존 events/daily_supplies/memo/parent_alerts만 집계하므로, 위치 기반 주요 머문 곳은 가짜 수치 없이 "전용 집계 연결 후 표시"로 정직하게 강등한다.
  - **AI 일정 사진 UX**: AiSchedule 사진 탭을 가정통신문/알림장 안내로 명확화. 사진 선택만으로 AI 호출하지 않고 사용자가 `일정 찾기` 버튼을 누를 때만 `voice-parse(image)` 호출. 크레딧 사용 가능성을 화면에 안내한다.
  - **구독 화면 정합성**: 비교표에 주간 리포트 추가, SOS·기본 안전은 무료 유지 문구 보강. `annual-27840`은 basePlanId일 뿐 실제 가격 근거가 아니므로 금액은 Play Console/Google Play 결제 확인 화면 기준으로 별도 확인해야 한다.
  - **원격청취 감사 로그**: `/remote-audio-audit`는 `GET /api/remote-listen/sessions`의 실제 세션 메타데이터만 표시한다.
    오디오 내용은 저장·반환하지 않고, 조회 실패를 빈 기록으로 위장하지 않는다. 시작/중지 명령은 이 화면에서 절대 실행하지 않는다.
  - **출시 전 신뢰 UX 문구 가드**: 구독·원격청취·AI 일정 문구는 `tests/subscriptionTrustCopy.test.mjs`, `tests/remoteAudioTrustCopy.test.mjs`, `tests/aiScheduleUxCopy.test.mjs`로 회귀 보호한다. 안전은 무료, 상세 안심은 프리미엄이라는 경계를 유지하고, 원격청취에는 아이 알림·1분 자동 종료·기록 안내를 함께 노출한다.
  - **세션 복구 fast-follow**: WebView `hyeni-api-session-v1`만 사라지고 네이티브 `BackgroundLocation.getPushContext()`에 userId/familyId/role+refresh가 남은 경우, 앱 부팅 중 1회 `/auth/refresh`로 세션을 복구한다. refresh 응답 userId/familyId/role이 네이티브 context와 일치할 때만 저장하며, 검증 로그에는 refresh 토큰 값을 절대 출력하지 않는다.
  - **해외 진출 씨앗**: `src/i18n/messages.ts`, `src/i18n/useMessage.ts`와 `docs/market-expansion-plan.md` 추가. 전체 앱 번역은 대규모 리팩터라 이번 범위에서 제외.
  - **검증**: node test 19개 통과, `npm run typecheck` exit 0, `npm run build` exit 0. Chrome DevTools 모바일 390x844에서 `/daily-report`, `/weekly-report`, `/remote-audio-audit`, `/ai-schedule` 사진 탭, `/subscription` 렌더·콘솔에러 0·수평 overflow 0 확인. 스크린샷=`output/screenshots/*-mobile.png`.

- ✅ **13단계: 설정·가입·오늘경로 실사용 제보 수정(2026-07-08)**
  - **부모 설정 친구놀이**: `/friend-play`가 role=parent일 때 아이 후보/요청 화면을 숨기고, `/api/playdate/family-enabled` 기반 "친구놀이 요청 허용" 설정·허용 기준·진행 중 종료 UI를 보여준다. 아이 role의 요청 UI는 그대로 유지한다.
  - **장소 이미지/구독/AI 크레딧 문구**: `resolvePlaceVisual`로 태권도·피아노·수영·축구·미술 등 장소명/카테고리별 정적 이미지를 매핑한다. 구독 소제목은 의도한 두 줄로 고정하고, AI 크레딧 안내는 "AI가 아이의 일정, 안전을 도와줘요"로 변경한다.
  - **가입 전 설문**: 부모 회원가입 진입 전에 간단한 복수선택 설문을 추가하고, 가입 진행률은 20%→40%→60%→80%→100% 단계로 표시한다. 로그인 흐름은 설문 상태를 초기화한다.
  - **오늘경로**: `getHistoryDayWindow`/`getHistoryDayKey`로 오전 8시 시작 경로를 계산한다. 00~07시는 전날 08:00부터 이어지는 경로로 보고, 이력 로딩/빈 trail에서는 현재 위치를 우선 마커로 넘긴다. "오늘 머문 곳" 시트는 헤더/목록 드래그로 완전히 접히고 reopen pill로 다시 연다. `.pl-sheet` 공통 `hy-sheetup` 애니메이션 transform이 접힘 transform을 덮지 않도록 `.pl-stays`는 animation을 끄고, S25 WebView computed transform까지 확인한다. 오늘경로에서는 상단 아이 배지를 숨기고 시간대별 경로 UI만 남긴다.
  - **안심리포트·스티커 진입점(2026-07-09)**: `/daily-report`는 부모 홈 별도 카드가 아니라 바로가기의 "안심리포트" 슬롯으로 진입한다. 기존 상단 하트/`꾹` 스티커 UI는 제거하고, 상단 액션은 명확한 "스티커" 전송 버튼(`/sticker-send`)으로 유지한다. 아이 모드 긴급 SOS 동선은 안전 기능이므로 이 부모 홈 `꾹` 제거와 별도로 취급한다.
  - **검증**: 신규 node tests 7개, 전체 `node --test tests/*.test.*` 48개, `npm run typecheck`, `npm run build` 통과. Playwright 모바일 390x844 API 모킹 검증으로 온보딩 설문/progress, 구독 줄바꿈, AI 크레딧 문구, 장소 이미지, 부모 친구놀이 설정, 오늘경로 08:00 슬라이더와 머문 곳 접힘을 콘솔 오류 0으로 확인.

- ✅ **14단계: 세션 기기 바인딩·3D 디자인 통일·스토어 준비(2026-07-10)**
  - **★세션 유실 사고 근본수정 — refresh 기기 바인딩**: 세션 사본(외부 홀더)이 체인을 회전시켜 두 기기 모두 고아가 된 사고. 서버 `rotateRefreshToken(db, old, presentedDeviceId)` — device_id 스탬핑된 체인은 같은 deviceInstallId 제시 시에만 회전(레거시 NULL 체인 허용+점진 스탬핑), 발급 지점(login/anonymous/signup/join/join-as-parent)에 플럼빙. 클라 `getAuthDeviceInstallId()`(localStorage 고정 캐시, 네이티브는 네이티브 id 채택 — 불일치 시 회전 거부되므로 웹 폴백 id를 네이티브에서 캐시 금지), 네이티브 LocationService 자체 refresh에도 동봉. 라이브 Red-Green 11케이스 검증.
  - **무손실 재페어링 실증**: `/join`의 `reuseExistingChild`(previous_user_id·deviceInstallId 힌트)가 기존 활성 멤버를 찾으면 **같은 uid로 세션 재발급** — 멤버·메모·일정·ai설정 전부 보존. 세션 유실 복구는 딥링크 `#/onboarding?pair=KID-…` → "코드로 연결하기"가 정답(D1 토큰 주입 금지).
  - **Capacitor 토큰 로그 유출 차단**: debug 빌드 브리지 로깅이 logcat에 토큰 원문 출력 → `capacitor.config.json loggingBehavior:"none"` (⚠️ "production"은 반대로 항상 로깅).
  - **AI 선제 대화(서버 ai-proactive) 프로덕션화**: 도착트리거+크론 레이스로 같은 문구 2회 삽입 → 멱등 발급 id `aiproact-{uid8}-{date}-{hash}`(pending_notifications PK 충돌 시 크레딧 미차감 skip). 혜니 설정 테스트 잔재(24시간 발송) → 08~20시·quiet 21~07·한도10 원복. 선제 메시지는 `ai_chat_messages`에 `[선제 대화]` 프리픽스로 기록된다.
  - **미도착 신선도 가드**: `partitionNotArrivedByFreshness`(notificationRouting) — 위치 30분 이상 stale/미보고면 "미도착 단정" 대신 "📍 도착 확인 필요"(warning·urgent=false·전체화면 미발동). node 테스트 5케이스(worker/tests).
  - **대화 7일 윈도우**: MemoChat이 오늘 date_key만 조회해 어제 대화가 사라져 보이던 버그 → 최근 7일 + `formatMemoDayLabel` 날짜 구분선. 실기기 15버블·구분선 3개 확인(주간 리포트 집계와 일치).
  - **3D 디자인 통일(TK 지시: "비싼 심플함"+아이 취향 캐릭터)**: 아이 홈 티커·상태버튼(3열 아이콘 칩)·다음일정·시간표 아이콘 전부 3D 에셋. `resolveEventCharacter`(일정 제목→cat/*.webp 정적 매핑) 신설. 안심/주간 리포트 lucide → 3D 타일(구독 화면과 동일 언어). ⚠️ `status/*.webp`·`mascot/teacher-glasses.webp`·`ui/mic-lavender.webp`는 흰 배경 불투명 — 색 칩 위에 쓰지 말 것(알파 검사: VP8X 헤더 0x10 비트).
  - **부모 설정 아바타 성별 매칭**(아빠 계정에 mom.webp 노출 수정), AI 탭·버튼 유니코드 이모지 → lucide, 안심 리포트에 AI 하루 요약 CTA(/day-summary).
  - **스토어 준비**: 업로드 키스토어 생성(`android/keystore/` — gitignore, 자격정보 파일은 TK가 비번관리자로 이동 후 삭제), versionCode 3/1.2, **서명 AAB 빌드·검증 완료**(`android/app/build/outputs/bundle/release/app-release.aab`). `docs/store/`(등록정보·데이터보안 답안·체크리스트), 스크린샷 초안 `output/store-screenshots/`(실사용 데이터 포함 캡처는 데모 계정 재촬영 필요). 키스토어 경로는 app/ 모듈 기준 상대라 `-PHYENI_KEYSTORE=../keystore/...`.
  - **iOS**: `npx cap add ios` + sync + Info.plist(권한 문구) + `docs/ios-build.md`. Windows에서 Xcode 컴파일 불가 — macOS 절차 문서화(iPhone=부모 전용 전제 유지).
  - **크로스 E2E**: 아이→부모 메모 WS 라운드트립(전송·수신·정리), AI 텍스트 파싱→저장→D1 확인→정리(date_key 0-index 정상), AI 친구 실 LLM 응답. 알림 실발사는 야간 자제 — 대신 서버의 위치미갱신→재연결 부모 알림이 이날 새벽 실작동(00:25/00:35)한 것을 실증.
  - **검증 함정 추가**: 재설치 후 CDP 포워딩 PID 갱신 필수 · razr 스크린샷 `-d 4630947043778501762` · cp949 콘솔은 python stdout utf-8 래핑 · Cloudflare가 기본 UA(python-urllib)를 403 차단 — 커스텀 UA 필요.
  - **안전지표 잠금해제(2026-07-11)**: 부모 홈·안심리포트의 기존 `충전` 슬롯을 오늘의 `잠금해제` 횟수로 교체한다. Android `DeviceStatusReporter`는 Usage Access가 있을 때 `UsageEvents.Event.KEYGUARD_HIDDEN`만 세므로 알림 등으로 화면만 켜진 `SCREEN_INTERACTIVE`는 집계하지 않는다. Usage Access 없음·API 28 미만·미보고는 `0회`로 표시한다.
  - **안전지표 앱 사용량의 제조사 독립 필터(2026-07-31)**: 특정 Motorola/Samsung 패키지를 계속 추가하는 방식은 금지한다. `AndroidManifest.xml`은 민감한 `QUERY_ALL_PACKAGES` 없이 `LAUNCHER`·`HOME`·`SECONDARY_HOME`만 조회 가능하게 하고, `DeviceStatusReporter`는 홈 역할 + 정확한 OS 표면 패키지 세그먼트 + system/updated-system이면서 실행 불가능한 구성요소 + 실제 앱 라벨 해석 실패를 함께 제외한다. 웹 표시 필터는 구버전 payload에도 같은 역할 규칙을 적용하고 원시 패키지 문자열을 앱 이름으로 노출하지 않는다. Pixel·Samsung·Motorola·Xiaomi·Huawei·vivo·OPPO 계열 표면 회귀와 `launcherpro`/카메라/브라우저/메시지/전화 오탐 방지는 `tests/deviceAppUsageView.test.ts`·Android `DeviceStatusReporterTest`에서 고정한다.

### 전체 라우트 맵 (전부 도달 가능)
```
부모 탭(ParentShell)   /parent/home calendar location memo settings
아이 탭(ChildShell)    /child/home sticker memo
선생님 탭(TeacherShell) /teacher/home students (+calendar/settings 플레이스홀더)
푸시(PushShell)        /onboarding subscription notifications remote-audio remote-audio-audit place-manager
                      friend-play ai-schedule ai-credit feedback phone-setup playdate-accept
                      sticker-send profile-edit place-form child-invite route
                      parent/family child/sos child/ai-friend child/ai-friend-setup daily-report weekly-report
기본 진입 = /parent/home (App.tsx index redirect)
```

## 6. 다음 할 일 — 3단계 백엔드 연동 (상세)

**백엔드는 hyeni-1의 Cloudflare Worker를 그대로 재사용** (재구축 금지).
- API base: `https://hyeni-calendar-api.tkisdroid.workers.dev` (`.env` VITE_API_BASE)
- 참고 소스: `C:\Users\TK\Desktop\hyeni-1`
  - API 클라이언트: `src/lib/api/client.js`
  - 기능 모듈 ~110개: `src/lib/*.js` (auth, childrenContext, memoRealtime, sync, entitlement, subscriptionBilling, 등)
  - env: `hyeni-1/.env.example` (Kakao 지도/REST, Naver 로그인, Qonversion+Google Play 결제)

**권장 진행 순서**:
1. `src/lib/api/client.ts` — hyeni-1의 client.js를 TS로 이관(fetch 래퍼 + 에러 처리).
2. 서버 상태 관리 도입 검토: **TanStack Query**(캐싱·리페치·오프라인) 추가 → 각 화면 목업을 쿼리로 교체.
3. 인증 계층(로그인/가입/소셜/페어링) → 온보딩 화면 연결.
4. 화면별로 목업 → 실 API: 가족·아이 → 일정(캘린더/홈) → 위치 → 메모(실시간) → 구독/크레딧.
5. 각 단계 빌드·검증(증거 기반).

## 7. 코딩 컨벤션 (반드시 준수)

- **디자인 토큰**: 컴포넌트에 hex 직접 쓰지 말고 `tokens.css` CSS 변수 사용. 아이 테마색은 `--hy-accent*`. 신호색 고정(민트=안전, 앰버=주의, 레드=SOS/긴급, 파랑=정보/토요일).
- **공통 클래스**: `.hy-card .hy-section-head/-icon/-title .hy-press(+--press) .hy-chip .hy-topbar .hy-iconbtn .hy-content .hy-tabbar .hy-toast` (components.css).
- **공통 컴포넌트**: `TopBar`, `SectionHeader`. 이미지 = `asset("경로")`. 아이콘 = lucide-react.
- **화면 패턴 정답**: `src/screens/parent/ParentHome.tsx`(+css). 새 화면은 이 스타일로.
- **셸**: 탭 화면은 Parent/Child/TeacherShell 하위, 상세/기능은 PushShell 하위(헤더에 뒤로가기 `navigate(-1)`).
- **strict TS**: `import type` 필수, 미사용 변수/import 금지, 인라인 style에 `--커스텀` 금지(press는 className), 모든 `<button type="button">`.
- **말투**: 부모·페어링·구독 = 존댓말, 아이(아이모드) = 반말.
- **불변성**: 상태 업데이트는 spread로 새 객체(뮤테이션 금지).
- **타입·여백·아이콘 정본(2026-07-19)**: `--type-*` 12/13/14/15/16/18/20/24/32px 단계는 대응
  line-height·weight와 함께 쓰고, 여백은 4px 리듬(`--spacing-*`), glyph는 `--icon-*` 16/18/20/22/24px를 쓴다.
  조작 영역은 최소 44px, 주요 CTA는 48px 이상이며 lucide 형제는 같은 크기·strokeWidth를 유지한다.
- **표면·모달 정본(2026-07-19)**: radius는 8/12/16/20/24px·pill, elevation은
  `--shadow-soft/floating/modal`만 사용한다. 모든 modal dialog는 `useDialogFocusLifecycle`, 실제 label/description id,
  열림 초점·Tab 순환·Escape·트리거 초점 복원을 갖춘다.
- **정보 밀도·이미지(2026-07-19)**: 권한/오류/설정 유도는 제목→한 문장 설명→상태/경로→주/보조 CTA로 압축한다.
  인물·캐릭터는 aspect-ratio와 `object-position`으로 상단 크롭을 방지하고, 비핵심 네트워크 이미지는
  `loading="lazy" decoding="async"` 및 예약 공간으로 CLS를 막는다. 의미 전달용 유니코드 이모지는 쓰지 않는다.
  ★역할 선택 선생님 이미지 실사고(2026-07-19): 58×58 `overflow:hidden` 슬롯에 72×72 정사각 이미지를 중앙 배치하면
  `object-position`과 무관하게 위·아래 7px가 잘린다. 상단 여백이 작은 인물 원본은 슬롯과 같은 58×58 `contain`으로
  맞추고 확대 크롭을 금지한다. 회귀=`tests/imageLoadingContract.test.mjs`.
- **화면 완결성·성능(2026-07-19, 라우트 수 2026-07-24 갱신)**: read query는 loading/error/empty/success/retry를 분리하고 현재
  family/user/source snapshot hydration 전 입력·저장을 닫는다. App 정본은 59개 라우트·58개 lazy screen이며 진입 JS는
  `tests/routeBundleBudget.test.mjs`의 500,000-byte 미만 예산을 지킨다. 라우트를 늘리면
  `tests/routeLazyLoading.test.mjs`·`tests/routeQualityMatrix.test.mjs`·`tests/helpers/routeContract.mjs`의
  개수·정본 배열을 함께 갱신해야 한다(kind는 read query가 있으면 `hybrid`, tone은 존댓말 화면이면 `parent-formal`).
- **★운영자 전역 AI 지침(2026-07-24)**: 관리자가 `#/admin/ai-prompt`(메뉴 미노출 숨은 라우트)에서 아이 AI 친구
  프롬프트를 정하면 **모든 가족의 아이**에게 적용된다. 이 앱에는 admin 역할이 없으므로 권한은 Worker secret
  `ADMIN_USER_IDS` 화이트리스트 하나로만 열리고(`worker/lib/adminAccess.ts`), **secret 미설정이면 아무도 관리자가
  아니다(fail-closed)**. 화이트리스트 밖 계정에는 관리자 API 존재를 숨기려 404를 준다. 저장은
  `app_global_settings` 키-값(additive, `writeGlobalSetting`이 CREATE TABLE IF NOT EXISTS 보장)이고 입력은 서버가
  정규화한다(개행·탭만 남기고 제어문자 제거, 4000자 상한, 원문이 2배 초과면 400). 프롬프트에서 `## 운영자 지침`은
  **안전 규칙보다 앞**에 놓아 마지막 발언권을 안전 규칙에 남기고, 정책 우선순위는 안전 > 앱 안전 > 부모 설정 >
  운영자 지침 > 아이 요청 순이다. 조회 실패는 지침 없음으로 강등해 아이 대화를 막지 않는다. 선제 대화
  (`ai-proactive`)는 LLM이 아니라 고정 문구 템플릿이라 적용 대상이 아니다. 회귀=`worker/tests/adminGlobalPrompt.test.mjs`.

## 8. 알려진 후속 정리 (TODO)

- 네비게이션 배선은 허브 9개 위주. 일부 화면의 이동 액션은 아직 토스트(전화·결제·토글 등은 의도적 유지).
- 각 화면 데이터는 자체 목업 → 3단계에서 실 API로 교체.
- 선생님 모드는 부분 구현(홈·학생만; 캘린더·설정은 플레이스홀더). IA상 "제작 예정".
- PWA 아이콘은 임시로 logo.webp 사용 → 5단계에서 정식 아이콘/스플래시.

## 9. 워크플로우 재사용

대량 화면 작업은 `scripts/*.workflow.js`를 `Workflow({scriptPath})`로 재실행/수정 가능.
새 대량 작업(예: 화면별 API 연동)도 같은 패턴(화면당 에이전트 1개 + 공통 contract)으로 오케스트레이션 권장.

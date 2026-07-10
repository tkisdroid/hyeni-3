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
- **실사용 기기(razr=혜니)는 검증에 사용할 수 있으나, 혜니 계정 데이터·페어링·세션이 유실되지 않도록 한다.**
- A17은 2026-07-09 사용자 지시 기준 부모모드 검증기로 운용한다. 아이 테스트 기기로 가정하지 않는다.
- 파괴적 작업 전 **안전 불변식부터 확인**(예: 아이 페어링 전 프리미엄 캡=2 확인으로 razr 밀림 0 보장).
- 테스트로 만든 데이터·바꾼 설정은 **반드시 원복/삭제**(이벤트·메모·SOS·notification_settings…).
- 라이브 앱 refresh 토큰은 절대 조작하지 않는다(access 만 읽기 — 회전시키면 세션 파괴).

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
  (`findLiveTokenInChain`, MAX_CHAIN_HOPS=20, 순환 방어). 레거시(device_id NULL)는 60초 유예+1단계 유지.
  **앱 재빌드 없이 서버만으로 복구**되므로 미연결 기기도 다음 회전 때 자동 정상화된다.
  진단: `prefs.refreshToken` 앞 8자를 D1 `refresh_tokens` 와 대조 → revoked=1이면 이 사고.
  logcat 태그 `LocationService` 의 `Token network-refresh failed: HTTP 401` / `invalid session`.
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
- 등록장소 도착/출발(2026-07-09): 피아노/태권도처럼 `saved_places`와 `academies`에 같은 물리 장소가 중복 등록되면
  20m 이내 후보를 `saved_place` 우선으로 병합해 1개만 평가한다. 진입은 3분 이상 같은 장소에 머문 뒤 도착으로
  승격한다. 옆 건물 통과나 학원가 이동 중 1분 남짓 머무른 좌표를 도착 알림으로 만들지 않기 위한 규칙이며,
  네이티브 `LocationService`와 Worker `registered-place-geofence-check`가 같은 상태머신 값을 써야 한다.
- 등록장소 알림 지연 개선(2026-07-10, TK 제보 "도착 알림 5분+ 지연" 실사고 — 실제 6.5분): 원인 3중 =
  ①반경 30m 가 학교 부지에 너무 타이트(교문→핀까지 5분) ②일괄 180s dwell ③서버 크론이 최신 fix 1점만 평가
  (tick 격자+정지 시 업로드 간격 합산). 수정: ①장소별 알림 반경 — location JSON `alertRadiusM`(30~300 클램프,
  스키마 무변경), 명시 없으면 이름 기본(학교|초등|중학교|고등학교|유치원|어린이집 → 100m). PlaceForm 에 반경 칩.
  ②심부 진입(entry 반경의 60% 이내) fix 는 dwell 90s 단축 — 경계 fix 는 180s 유지(오탐 방지 설계 보존).
  ③서버 크론은 `location_history` 최근 8분을 시간순 재생(직전 영속 시각 이후 fix 만, 전이 시에만 영속=멱등).
  ④네이티브 TTL 삼킴 버그 — 상태 6h 만료 후 "밖"이 지속되면 sameState 로 저장 스킵 → 신선도 영영 미회복 →
  첫 도착이 bootstrap 에 무알림 삼켜짐. 부트스트랩 평가 시 값이 같아도 반드시 저장(TTL 갱신). 아침 실데이터
  재생 검증: 학교 도착 08:47→08:41(-6분). 상태머신 값은 JS(shared)·Java 3중 parity — 한쪽만 바꾸면 안 된다.
- Capacitor SystemBars 패치(2026-07-09): Android WebView 시작 직후 `document.documentElement`가 아직 없으면
  기본 `SystemBars` safe-area CSS 주입이 콘솔 오류를 낸다. `postinstall`의
  `scripts/patch-capacitor-systembars.mjs`가 DOM 준비 전 주입을 건너뛰게 패치하므로, 의존성 재설치 후에는
  `npm install` 또는 해당 스크립트 실행 뒤 Android 빌드를 검증한다.
- 부모→아이 메모 알림: 서버는 `type: "new_memo"`와 `targetChildUserId`로 FCM을 보낸다. Android 네이티브는
  이 알림을 일정 채널이 아니라 아이 메시지 채널(`hyeni_child_message_v1`)로 heads-up 표시하고,
  탭/폴링 라우트는 `child-memo` → `#/child/memo`로 유지한다.
- 리뷰 보상 티어: `/api/review-rewards`는 부모 전용 계약이다. 아이/선생님 세션에서 엔타이틀먼트가 필요해도
  서버 호출을 하지 말고 reviewed=false로 확정한다. 아이 화면 CDP 로그에 403이 남으면 실패로 보고
  `resolveReviewRewardQueryScope` 규칙을 먼저 확인한다.
- 설정/가입/오늘경로 안정화(2026-07-08): 부모 `/friend-play`는 아이 요청 UI가 아니라 가족 친구놀이 허용 설정이다.
  장소 관리는 서버/AI 생성 없이 `resolvePlaceVisual` 정적 asset 매핑으로 장소명에 맞는 이미지를 고른다.
  가입 전 설문은 progress 20%에서 시작하고 복수 선택만 수집한다. 부모 오늘경로는 오전 8시를 하루 시작으로,
  00~07시는 전날 경로로 본다. 이력 로딩 중 지도 중심은 서울 기본점보다 현재 위치가 우선이며,
  "오늘 머문 곳"은 손잡이뿐 아니라 목록 영역 드래그 다운으로도 완전히 접히고 다시 열기 버튼으로 복귀하는지
  검증한다. 로컬 mock 검증 시 현재 시각이 08시 전이면 mock 이력도 `/api/location/history`의 `start`
  파라미터 기준으로 만든다.
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

### J. 실기기 검증 치트시트 (함정 포함)
- **현재 기기 역할(2026-07-09 사용자 지시)**: S25=부모, A17=부모모드 검증기, razr=아이 "혜니" 실사용.
- **기기 역할 확인**: A17/S25/razr 역할은 세션별로 바뀐 이력이 있으므로, 과거 단계 기록보다 최신 사용자 지시/goal을 우선한다.
  완료 선언 전에는 CDP로 WebView 세션(`hyeni-api-session-v1`)의 role/familyId와 실제 화면을 함께 확인하고,
  지시한 역할과 다르면 해당 실기기 검증은 미검증/차단으로 분리 보고한다.
- **adb**: Git Bash 는 `MSYS_NO_PATHCONV=1` 필요(/sdcard 변환 방지) · razr 스크린샷은 `-d 4630947043778501762` ·
  `keyevent 26` 은 토글(끄기 전 상태 확인) · 기기 offline/unauthorized 는 `adb kill-server && start-server`.
- **CDP(WebView)**: `adb forward tcp:922x localabstract:webview_devtools_remote_<pid>` · websocket 은
  `suppress_origin=True` 필수 · **awaitPromise 긴 evaluate 는 hang** — 클릭/조회를 짧은 동기 evaluate 로 쪼개고
  결과는 별도 폴링 · `canvas.toBlob` 콜백이 안 옴 → `toDataURL`(동기) 사용 · React 제어 input 은
  native setter+`input` 이벤트 · 페이지 fetch 로 `/rest/v1` 은 CORS 차단 → 토큰만 CDP 로 읽고 **호스트 curl**.
- **D1/Worker**: 시간 검증은 백데이트 트리거(예: `anchor_since` 6분 전 + upsert 1회, cron 은 이벤트를 target 분에 생성) ·
  `wrangler tail --format json` 을 파일로 받아 파이썬 파싱 · 컬럼명 추측 금지 — `pragma_table_info` 먼저.
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
  - ✅ **P5-B**: **Cloudflare Pages 배포** → **https://hyeni-calendar.pages.dev** (wrangler, 99파일). 브라우저 검증: 렌더·manifest·SW·설치가능 PWA. **재배포**: `npm run build && npx wrangler pages deploy dist --project-name=hyeni-calendar --branch=main --commit-dirty=true`.
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
    - **주원인**: 이벤트가 `events_children` 링크 0건+`is_family_event=0`(6/19 구앱 등록 레거시) → cron 소유권 게이트(`eventBelongsToActiveChild`)에서 리마인더·미도착 전부 상단 skip(parent_alerts·push_sent 기록 0건으로 확진). **클라(hyeni-3)는 "배정 없음=가족 공유"로 표시하는데 서버는 대상 없음으로 침묵** — 표시 계약과 알림 계약 불일치. 수정: `worker/lib/notificationRouting.ts selectEventTargetChildren` 링크 0건=활성 자녀 전원(가족 공유). 옛 자녀 링크"만" 있는 고아 이벤트 차단은 유지. **Red→Green**: 동일 조건 테스트 이벤트로 cron 발사→parent_alerts 기록+S25 FCM "🚨 미도착 긴급 알림" 실수신→테스트 데이터 4테이블 전량 정리.
    - **부수 원인(운영 실수, 정직 고지)**: 어제 A17 아이 전환 작업 중 부모 fcm_tokens 전부 삭제→S25 재등록 11:58 KST — 미도착 판정 시각(11:00~11:05)에 부모 토큰 0개. 설령 게이트를 통과했어도 FCM 미수신이었음. 현재 복구됨. 교훈: **실사용 가족의 FCM 토큰 일괄 삭제 금지**(만료는 서버가 자체 정리).
  - 미도착 파이프: 이벤트 좌표 필수(`location.lat/lng`)·윈도우=시작~+5분(cron 매분)·반경 50m·부모에게만 FCM(severity=emergency 전체화면). `not_arrived`는 인앱 SOS 화면 전환(URGENT_ALERT_TYPES) 대상 아님 — 오전환 없음.

- ✅ **12단계: 사용자 확보/유료전환 기능(2026-07-07)** — `앱고도화.md` 실행. 부모 일상 사용 빈도·아이 참여·프리미엄 전환을 위한 화면/문구/문서 추가.
  - **오늘의 안심 리포트**: `/daily-report` 신규. 활성 아이 기준으로 오늘 일정, 준비물, 최신 위치, 기기 상태, 최신 메모, 부모 알림을 조합한다. 위치는 `isLocationVisible(tier)` 게이트를 존중하고, 기기 상태 새로고침(`request_device_status`)은 자동 실행하지 않고 버튼에서만 보낸다. 제목/부제는 `src/i18n` 씨앗 구조를 사용한다.
  - **아이 원탭 상태 공유**: ChildHome에 6개 버튼(도착/출발/늦음/픽업/전화/배터리)을 추가하고 기존 memo thread에 일반 메시지로 보낸다. `childId`는 member id, `origin="quick_status"`. SOS·force_ring과 혼동시키지 않는다.
  - **주간 가족 리포트**: `/weekly-report` 신규. `FEATURES.WEEKLY_REPORT`는 프리미엄 전용. 전용 서버 endpoint 없이 기존 events/daily_supplies/memo/parent_alerts만 집계하므로, 위치 기반 주요 머문 곳은 가짜 수치 없이 "전용 집계 연결 후 표시"로 정직하게 강등한다.
  - **AI 일정 사진 UX**: AiSchedule 사진 탭을 가정통신문/알림장 안내로 명확화. 사진 선택만으로 AI 호출하지 않고 사용자가 `일정 찾기` 버튼을 누를 때만 `voice-parse(image)` 호출. 크레딧 사용 가능성을 화면에 안내한다.
  - **구독 화면 정합성**: 비교표에 주간 리포트 추가, SOS·기본 안전은 무료 유지 문구 보강. `annual-27840`은 basePlanId일 뿐 실제 가격 근거가 아니므로 금액은 Play Console/Google Play 결제 확인 화면 기준으로 별도 확인해야 한다.
  - **원격청취 감사 로그 골격**: `/remote-audio-audit` 신규. 서버 감사 로그 조회 endpoint가 없어 빈 상태와 개인정보 안내만 표시한다. 원격청취 시작/중지 명령은 이 화면에서 절대 실행하지 않는다.
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

## 8. 알려진 후속 정리 (TODO)

- 네비게이션 배선은 허브 9개 위주. 일부 화면의 이동 액션은 아직 토스트(전화·결제·토글 등은 의도적 유지).
- 각 화면 데이터는 자체 목업 → 3단계에서 실 API로 교체.
- 선생님 모드는 부분 구현(홈·학생만; 캘린더·설정은 플레이스홀더). IA상 "제작 예정".
- PWA 아이콘은 임시로 logo.webp 사용 → 5단계에서 정식 아이콘/스플래시.

## 9. 워크플로우 재사용

대량 화면 작업은 `scripts/*.workflow.js`를 `Workflow({scriptPath})`로 재실행/수정 가능.
새 대량 작업(예: 화면별 API 연동)도 같은 패턴(화면당 에이전트 1개 + 공통 contract)으로 오케스트레이션 권장.

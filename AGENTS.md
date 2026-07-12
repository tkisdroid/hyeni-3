# AGENTS.md — 혜니캘린더 리디자인 (hyeni-3)

> 모든 AI 코딩 에이전트(Claude, Codex, Cursor, Gemini 등) 공통 작업 지침.
> **상세 이력·단계별 기록의 정본은 `CLAUDE.md`** — 반드시 먼저 읽고 이어서 작업할 것.
> 이 문서는 CLAUDE.md 를 자동 로드하지 않는 도구를 위해 핵심을 자립형으로 요약한다.

## 프로젝트 한 줄

혜니캘린더 = 가족 일정 공유 + 부모·자녀 위치/안전 앱. **웹앱(PWA) 단일 코드베이스 +
Android 만 Capacitor 래핑**. 백엔드는 **hyeni-1 의 Cloudflare Worker 를 그대로 재사용(재구축 금지)**.
1~10단계 전부 완료 — 현 국면은 **실사용 안정화**(TK 가 실기기 3대로 쓰며 제보 → 즉시 수정·검증·배포).

## 언어·말투 (절대 규칙)

- 모든 응답·주석·커밋 메시지 = **한국어**. 기술 용어·코드 식별자는 원문.
- 앱 문구: **부모·페어링·구독 = 존댓말 / 아이 모드 = 반말**.

## 스택·명령

Vite 7 · React 19 · TypeScript(strict) · 플레인 CSS(디자인 토큰) · React Router v7(**HashRouter**) ·
TanStack Query · lucide-react · Capacitor 8(Android).

```bash
npm run dev        # http://localhost:5173
npm run typecheck  # tsc -b  (수정 후 필수)
npm run build      # 완료 기준 = exit 0
# Android: npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)
# 설치:    adb -s <serial> install -r android/app/build/outputs/apk/debug/app-debug.apk
# 웹 배포: ★ hyeni-3/.env 의 CLOUDFLARE_API_TOKEN(Workers/D1 전용, Pages 권한 없음)을 wrangler 가
#   자동 로드해 OAuth 를 덮어쓴다 → .env 가 없는 디렉터리에서 실행할 것.
#   (cd <임시디렉터리> && npx wrangler pages deploy C:/Users/TK/Desktop/hyeni-3/dist \n#      --project-name=hyeni-calendar --branch=main --commit-dirty=true)
# Worker(백엔드, C:\Users\TK\Desktop\hyeni-1\worker): npx tsc --noEmit && npx wrangler deploy
```

API base: `https://hyeni-calendar-api.tkisdroid.workers.dev` · 배포 웹: https://hyeni-calendar.pages.dev

## 절대 안전 규칙

1. **실사용 기기 보호**: razr(모토로라)=혜니 실사용 기기 — 검증에 사용할 수 있으나 혜니 계정 데이터·페어링·세션이 유실되지 않도록 한다.
   A17은 2026-07-09 사용자 지시 기준 부모모드 검증기로 운용하며 2026-07-13 출시 검증 중에는 계속 연결해 둔다.
   아이 테스트 기기로 가정하지 말고, razr 조작이 필요하면 영향 범위를 먼저 확인한다.
2. **라이브 refresh 토큰 조작 금지** — 회전시키면 앱 세션이 파괴된다. access 토큰만 읽기.
   2026-07-10부터 refresh 체인은 **기기 바인딩**(device_install_id 스탬핑) — 외부에서 토큰 사본으로 회전 시도하면 401이 정상이다.
   세션이 유실된 아이 기기는 딥링크 `#/onboarding?pair=KID-…` 재페어링이 정답(previous_user_id 힌트로 같은 uid 무손실 복구).
3. **파괴적 작업 전 안전 불변식 확인**(예: 아이 페어링 전 프리미엄 캡 확인 — 기존 아이가 밀리지 않는지).
4. 테스트로 만든 데이터·바꾼 설정은 **반드시 원복/삭제**. 비밀번호는 사용자만 입력.
5. 프로덕션 D1 파괴적 삭제·스토어 배포·시크릿 변경 금지.

## 아키텍처 핵심 (어기면 다자녀에서 데이터가 섞인다)

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
- **date_key 함정**: 월이 **0-indexed 비패딩**("2026-6-5" = 7월 5일). 반드시 `src/transform/dateKey.ts` 경유.
- **메모 = 아이별 1:1 스레드**: fetch/send 에 childId(member id) 필수, `qk.memoReplies` 키에 childId 포함.
  리치 메시지 = content 마커 `[[img:R2key]]` / `[[loc:lat,lng|주소]]` (`src/transform/memoView.ts`).
- **알림**: 일정 리마인더는 전부 서버 cron(사용자별 `notification_settings.minutes_before` 정확 매칭,
  클라 로컬 스케줄러 없음) · 긴급(sos/emergency)은 `POST /api/parent-alerts` insert 시 서버가 FCM
  전체화면 연쇄 · 기기 상태(device_health)는 **on-demand**(부모가 `request_device_status` 푸시를 보내야 옴) ·
  미등록 장소 도착 = `worker/lib/arrivalDetect.ts`(150m·5분 체류·2h 쿨다운).
  안전지표의 `잠금해제`는 Android `UsageEvents.Event.KEYGUARD_HIDDEN`의 오늘 누적값만 표시한다.
  `SCREEN_INTERACTIVE`(알림 등으로 화면만 켜짐)는 절대 포함하지 않으며, Usage Access 없음·API 28 미만·미보고는 `0회`로 표시한다.
  등록장소 도착/출발(saved_places+academies)은 네이티브 `LocationService`와 Worker
  `registered-place-geofence-check`가 같은 상태머신으로 처리한다. 20m 이내 중복 장소는 `saved_place` 우선으로
  1개만 평가하고, 진입은 3분 이상 체류해야 도착으로 승격한다(학원가 통과/중복 알림 방지).
  부모→아이 메모 FCM(`type: "new_memo"`)은 일정 채널이 아니라 아이 메시지 채널(`hyeni_child_message_v1`)로
  heads-up 표시하고, 탭/폴링 라우트는 `#/child/memo`로 유지한다.
- **리포트/전환 기능(2026-07-07)**: 오늘의 안심 리포트=`/daily-report`, 주간 가족 리포트=`/weekly-report`,
  원격청취 감사 로그=`/remote-audio-audit`. 주간 리포트는 `FEATURES.WEEKLY_REPORT` 프리미엄 전용이며 기존
  events/daily_supplies/memo/parent_alerts만 집계한다. 전용 서버 endpoint가 없으면 가짜 수치 금지.
  원격청취 감사 로그도 조회 endpoint가 없으므로 빈 상태 UI만 표시한다. Google Play 실제 가격은 basePlanId가 아니라
  Play Console/결제 확인 화면 기준으로 판단한다.
- **안심리포트·스티커 진입점(2026-07-09)**: 부모 홈에서 `/daily-report`는 바로가기의 "안심리포트"로만 진입한다.
  기존 상단 하트/`꾹` 스티커 UI는 재도입하지 말고, 상단 액션은 명확한 "스티커" 전송 버튼으로 유지한다.
  이 규칙은 부모 홈 스티커 접근성 정리이며, 아이 모드 긴급 SOS 안전 동선과 혼동하지 않는다.
- **리뷰 보상 티어(2026-07-08)**: `/api/review-rewards`는 부모 전용 서버 계약이다. 아이/선생님 세션에서
  엔타이틀먼트가 필요해도 이 API를 호출하지 말고 reviewed=false로 확정한다. 아이 화면 CDP 로그에 403 네트워크 오류가
  남으면 실패로 보고 `resolveReviewRewardQueryScope` 규칙을 확인한다.
- **출시 전 신뢰 UX 문구 가드(2026-07-07)**: 안전은 무료, 상세 안심은 프리미엄이라는 경계가 흔들리면 안 된다.
  구독·원격청취·AI 일정 문구는 `tests/subscriptionTrustCopy.test.mjs`, `tests/remoteAudioTrustCopy.test.mjs`,
  `tests/aiScheduleUxCopy.test.mjs`로 회귀 보호한다. SOS·긴급 알림을 프리미엄 혜택처럼 쓰지 말고,
  원격청취는 아이 알림·1분 자동 종료·기록 안내를 함께 보여준다.
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
  추정 보간점(`is_estimated`)은 경로에서 점선으로 표시하되 머문 곳·일정 방문·출발 시각의 실측 증거로 쓰지 않는다.
  미등록 장소 지연 출발은 첫 실측 이탈 `event_at`과 서버 확인 `detected_at`을 함께 저장하고 지연 기록임을 제목·문구에
  밝힌다. 임의 장소 도착 알림은 anchor episode lease+eventId로 DB 중복을 막고, FCM 0건은 같은 pushId로 재시도해
  단말 중복 표시 없이 at-least-once 전달한다. 자동 stale wake는
  5→15→30→60분으로 백오프하되 부모 수동 요청은 즉시 유지한다. balanced 기본 주기
  (이동 15초·정지 120초)는 정확도/배터리 기준값이므로 근거 없이 더 짧게 만들지 않는다.
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
- **설정/가입/오늘경로 안정화(2026-07-08)**: 부모 `/friend-play`는 아이 요청 UI가 아니라 가족 친구놀이 허용 설정을
  보여준다. 장소 관리는 서버/AI 생성 없이 `resolvePlaceVisual`의 정적 asset 매핑으로 장소명에 맞는 이미지를 고른다.
  가입 전 설문은 진행률 20%에서 시작하고 복수 선택만 수집한다. 부모 오늘경로는 오전 8시를 하루 시작으로 보며,
  00~07시는 전날 경로에 포함한다. 경로 로딩 중에는 서울 기본점보다 현재 위치를 우선 표시하고, "오늘 머문 곳"
  시트는 손잡이뿐 아니라 목록 영역 드래그 다운으로도 완전히 접히고 다시 열기 버튼으로 복귀하는지 검증한다.
  "오늘 머문 곳"은 `.pl-sheet` 공통 `hy-sheetup` 애니메이션 transform이 접힘 transform을 덮지 않도록
  `.pl-stays`에서 animation을 끄고, S25 WebView computed transform까지 확인한다. 오늘경로에서는 상단 아이 배지를
  숨기고 시간대별 경로 UI만 남긴다.
  로컬 mock 검증 시 현재 시각이 08시 전이면 mock 이력도 `/api/location/history`의 `start` 파라미터 기준으로 만든다.
- **메뉴·페어링 안정화(2026-07-09)**: 부모 홈 바로가기는 `AI 일정 → 위치추적 → 친구놀이 → 장소관리 → 주변소리 →
  안심리포트 → 구독 → 알림` 순서와 실제 라우트를 회귀 테스트로 고정한다. 부모 설정 메뉴는 emoji 칩 대신
  lucide/image 아이콘 + `data-tone` 토큰 색상만 사용한다. 페어링 위저드는 `/api/family/mine`과 엔타이틀먼트가
  모두 확정되기 전 2명 선택과 코드 생성을 막고, 코드 생성 직전에도 현재 티어의 아이 수 상한을 다시 검사한다.
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

## 코딩 컨벤션

- hex 직접 금지 → `src/styles/tokens.css` CSS 변수. 신호색 고정(민트=안전, 앰버=주의, 레드=위험/SOS, 파랑=정보).
- 공통: `.hy-card .hy-press .hy-chip .hy-topbar .hy-content` · `TopBar`/`SectionHeader` · `asset("경로")` · lucide 아이콘.
- 화면 패턴 정답 = `src/screens/parent/ParentHome.tsx`. 탭 화면=각 Shell 하위, 상세=PushShell(뒤로가기 `navigate(-1)`).
- strict TS: `import type`, 미사용 금지, `<button type="button">`, 상태는 불변 업데이트(spread).
- LLM 호출·크레딧 소모·원격 제어(force_ring 등)는 **사용자 버튼 onClick 에서만**(자동 실행 금지).
- 아이 홈처럼 티커/스파클/SOS hold 등 움직임이 있는 화면은 `prefers-reduced-motion`에서 애니메이션·전환을 멈춘다.
  ChildHome JSX의 주요 색상은 직접 hex 대신 토큰 변수를 사용하며, `tests/mobileViewportCss.test.mjs`가 회귀를 막는다.

## 작업 원칙 (실증된 사고방식 — CLAUDE.md §0.5 와 동일)

1. **증거 없으면 완료 아님**: 실기기 E2E(adb+CDP) + 서버(D1) 크로스체크 후에만 완료 선언.
   미검증 항목은 보고에서 분리해 정직 고지. 에이전트 보고도 코드 재확인 후에만 반영.
2. **제보는 재현부터**: 코드 추측 수정 금지 — 실기기/실데이터로 증상 재현해 진짜 원인 특정.
3. **근본 원인 + 다중 방어**: 레이스·유실 계열은 서버+클라 양쪽에 방어를 겹친다.
4. **정직한 강등**: 외부 의존 실패 시 가짜 데이터 금지 — 명시적 폴백("직선 553m 쯤"+외부 앱 버튼 등).
5. **재사용 우선**: hyeni-1 서버/인프라 먼저 조사, 서버 무변경 해법 선호.
6. **오케스트레이션**: 넓은 탐색·감사=병렬 에이전트+적대 검증(CONFIRMED 만 수정) /
   정밀 수정·아키텍처=단일 컨텍스트 인라인.
7. **보고**: 결론 먼저 한 줄 → 검증 표 → 리스크·미해결·사용자 몫 정직 고지. "될 것입니다" 금지,
   "○○ 실기기 확인" 같은 관측 사실만.
8. **학습 문서 동기화**: 코드 수정 또는 지침 반영이 있으면 이번 작업에서 새로 확인한 운영 규칙·검증 함정·반복 절차를
   `AGENTS.md`와 `CLAUDE.md`에 함께 반영한다. 두 문서의 안전 규칙·기기 구성·완료 루틴이 서로 어긋나면 안 된다.
9. **완료 루틴 기본값**: 코드 수정 또는 지침 반영 후에는 기본적으로 관련 검증을 끝내고, 변경분을 커밋·푸시한 뒤,
   연결된 Android 기기에 최신 빌드를 설치한다. 문서만 바뀐 경우에도 커밋·푸시는 수행하며, 설치가 불필요하거나 불가능하면
   그 사유를 최종 보고에 명확히 남긴다.

## 디자인 규칙 (2026-07-10)

- UI 요소 아이콘은 유니코드 이모지 대신 **3D 에셋(public/assets)** 또는 lucide 라인 아이콘. 색 칩 위에는 알파 채널 있는 에셋만
  (`status/*.webp`·`ui/mic-lavender.webp`는 흰 배경 불투명 — 사용 금지 목록). 일정 아이콘은 `resolveEventCharacter`(제목→cat/*.webp).
- 리포트류 화면(안심/주간)은 구독 화면과 같은 3D 타일 언어를 유지한다. `loggingBehavior:"none"` 유지(토큰 로그 차단 — "production"은 반대 의미).
- ★공용 컴포넌트에 인라인 `style` 로 배치(position/inset/size)를 주지 않는다. `KakaoMap` 래퍼의 인라인 `position:relative` 가
  `.pl-map{position:absolute;inset:0}` 을 덮어써 **부모모드 지도가 통째로 사라진 사고**(2026-07-10)가 있었다. 배치는 소비 화면
  클래스의 몫, 컴포넌트는 `.km-host`/`.km-canvas` 같은 클래스만 쓴다. 가드=`tests/mapPerf.test.ts`.
- 장식(구름·블롭)은 제목/노드 밴드를 침범하지 않는다. 반투명은 `background: rgba(...)` 대신 `background:#fff`+`opacity`
  (겹친 덩이의 이음선 방지). 가드=`tests/mobileViewportCss.test.mjs`.
- 조용한 에러 금지 안전망 3겹: ①ErrorBoundary(`app/ErrorBoundary.tsx`, 전 라우트 errorElement, DEV `#/crash-test`)
  ②전역 uncaught/rejection→폴백 토스트(`app/GlobalErrorListeners.tsx`) ③mutation 폴백(QueryProvider MutationCache,
  450ms 지연-양보, `meta:{silentError:true}` 옵트아웃). 가드=`tests/globalErrorSafety.test.mjs`.
- 모든 인터랙티브 요소에 프레스 피드백: 버튼/카드=`hy-press`, 행/라벨=`:active{background:var(--bg-press)}`.
  스크림/딤은 예외.

## 실기기 검증 치트시트

- 기기: S25(R5CY521CFNZ)=부모 · A17(RFKL40DP73J)=부모모드 검증기(2026-07-13 연결 유지) · razr(ZY22H9VTQD)=아이 "혜니" 실사용.
- 기기 역할은 세션별로 바뀐 이력이 있으므로, 문서의 과거 단계 기록보다 **최신 사용자 지시/goal**을 우선한다.
  단, 완료 선언 전에는 CDP로 WebView 세션(`hyeni-api-session-v1`)의 role/familyId와 실제 화면을 다시 확인하고,
  지시한 역할과 다르면 해당 실기기 검증은 미검증/차단으로 분리 보고한다.
- adb(Git Bash): 원격 경로엔 `MSYS_NO_PATHCONV=1` · `keyevent 26` 은 토글(끄기 전 상태 확인) ·
  offline/unauthorized → `adb kill-server && adb start-server`.
- CDP: `adb forward tcp:922x localabstract:webview_devtools_remote_<pid>` → `http://localhost:922x/json` ·
  websocket 연결에 `suppress_origin` 필수 · **awaitPromise 긴 evaluate 는 hang** → 클릭/조회를 짧은 동기
  evaluate 로 쪼개고 결과는 별도 폴링 · `canvas.toBlob` 대신 `toDataURL`(동기) · React 제어 input 은
  native value setter + `input` 이벤트 · 페이지 fetch 로 `/rest/v1` 은 CORS 차단 → 토큰만 읽고 호스트 curl.
- D1: 컬럼 추측 금지 — `pragma_table_info` 먼저 · 시간 조건 검증은 백데이트 트리거
  (상태 시각을 과거로 UPDATE 후 이벤트 1회 주입) · `wrangler tail --format json` 을 파일로 받아 파싱.
  `/api/events`처럼 `events_children`를 다건 조회할 때는 D1 변수 제한을 넘지 않도록 `IN (...)` 바인딩을 청크 처리한다.
- 밤 시간대엔 force_ring/SOS 실발사 자제(실기기 벨 울림) — 발동 시 데이터 정리까지.

## 저장소

- 앱: https://github.com/tkisdroid/hyeni-3 (main) · 백엔드/레거시: https://github.com/tkisdroid/hyeni.
- 커밋 = conventional commits(`feat:`/`fix:`/`docs:`…) 한국어. `.env`(키)·빌드 산출물·180MB+ 에셋은 커밋 금지.

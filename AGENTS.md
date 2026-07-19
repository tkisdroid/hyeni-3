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
# Worker 전체 Node 테스트는 Vite root 오인식을 피하려고 부모 저장소에서 실행:
#   (cd C:\Users\TK\Desktop\hyeni-1 && node --test worker/tests/*.test.mjs)
```

API base: `https://hyeni-calendar-api.tkisdroid.workers.dev` · 배포 웹: https://hyeni-calendar.pages.dev

## 절대 안전 규칙

1. **실사용 기기 보호**: 2026-07-19 최신 사용자 지시 기준 이번 최종 검증은 **A17(RFKL40DP73J)=부모모드**,
   **razr(ZY22H9VTQD)=아이모드**로만 수행한다. 두 기기는 `adb install -r`로 앱 데이터·계정·페어링·세션을 보존하며,
   refresh 토큰을 출력·복사·회전하지 않는다. **S25는 검증 제외**이며 다시 명시적으로 허용받기 전에는 adb로 접근하지 않는다.
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
  부모 홈 안전 지표의 알림·위치 건강 상태는 컴팩트 칩(`shortLabel`, `.ph-safety__signals`) 한 줄로 표시하고,
  긴 `label`/`detail` 안내 박스는 `attention`(조치 필요) 상태에만 렌더한다(2026-07-14 TK 제보 "과도한 텍스트" 수정).
  안심리포트(`DailySafetyReport`)는 상세 화면이므로 label/detail 전체 표시를 유지한다.
  회귀=`tests/deviceNotificationHealth.test.ts`.
  안전지표의 `잠금해제`는 Android `UsageEvents.Event.KEYGUARD_HIDDEN`의 오늘 누적값만 표시한다.
  `SCREEN_INTERACTIVE`(알림 등으로 화면만 켜짐)는 절대 포함하지 않으며, Usage Access 없음·API 28 미만·미보고는 `0회`로 표시한다.
  등록장소 도착/출발(saved_places+academies)은 네이티브 `LocationService`와 Worker
  `registered-place-geofence-check`가 같은 상태머신으로 처리한다. 20m 이내 중복 장소는 `saved_place` 우선으로
  1개만 평가하고, 진입은 3분 이상 체류해야 도착으로 승격한다(학원가 통과/중복 알림 방지).
  ★이동 알림 현실화(2026-07-16): 서버 cron 은 자녀 단위로 전이를 수집해 episode 시간순으로 전달하고, 같은 배치의
  출발은 다른 장소 도착에 병합한다("○○에서 출발해서 △△에 도착했어요"). 조용한 재진입(SILENT_RE_ENTER) 에피소드의
  재이탈은 `SILENT_LEAVE`(무알림, JS·Java 3중 parity — `phase=in && lastDepartedAtMs != null` 불변식으로 판별)이며,
  최근 15분 내 다른 장소 도착을 이미 전달했으면 늦게 흘러온 출발은 조용히 상태만 진행한다(같은 장소 재출발은 억제 금지).
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
- **리뷰 보상 티어(2026-07-08)**: `/api/review-rewards`는 부모 전용 서버 계약이다. 아이/선생님 세션에서
  엔타이틀먼트가 필요해도 이 API를 호출하지 말고 reviewed=false로 확정한다. 아이 화면 CDP 로그에 403 네트워크 오류가
  남으면 실패로 보고 `resolveReviewRewardQueryScope` 규칙을 확인한다.
- **스토어 방문 혜택·위치 티어(2026-07-13)**: 부모 무료 화면의 CTA는 "스토어 방문 혜택 받기"이며 평점·리뷰 작성의
  대가처럼 안내하지 않는다. 지급은 서버 `store_visit` 계약과 부모 본인 가족 검증을 통과한 경우에만 확정한다. 위치 조회는
  서버가 `locked|delayed|realtime`으로 판정한다. 무료 부모는 빈 위치, reviewed 부모는 서버 현재 시각 기준 정확히 15분 이전의
  `location_history` 실측점 중 최신값, 프리미엄 부모는 현재 위치를 받는다. cutoff 이전 점이 없으면 현재점을 대신 노출하지 않는다.
  아이 세션은 본인 위치만 조회하고, 경로 이력은 프리미엄 부모만, 위치 인시던트는 티어와 무관하게 부모만 조회한다.
  엔타이틀먼트 DB 판정 실패는 최신 위치를 열지 않고 `503 location_entitlement_unavailable`로 닫는다.
- **구독 결제 정본(2026-07-13)**: 7일 무료 체험은 Google Play가 현재 계정에 eligible 하다고 반환한 offer 중
  무료 pricing phase가 정확히 7일인 경우에만 표시·구매한다. 결제 직전에 상품을 다시 조회하고 그 `offerToken`·`offerId`를
  네이티브 결제와 Worker 검증까지 그대로 전달하며, 가격은 Play `formattedPrice`만 표시한다. `trial`은 미래
  `trial_ends_at`, `active/grace/cancelled`는 미래 `current_period_end`가 있을 때만 프리미엄이다(해지는 결제 종료일까지 유지).
  BillingFlow에는 가족·부모 식별자의 SHA-256 값을 obfuscated account/profile id로 넣고 Worker가 Play 응답과 대조한다.
  부모 앱 시작·foreground에서는 6시간 제한으로 기존 `PURCHASED` 구독을 서버 재검증해 자동갱신 종료일을 동기화한다.
  AI 크레딧은 purchase event claim·잔액·원장을 한 D1 batch로 확정하고 consume 실패 재시도에서 중복 가산하지 않는다.
  Google Play 직접 검증이 결제 정본이며 RTDN도 notification type만 믿지 않고 `purchases.subscriptionsv2.get`으로 재검증한다.
  RTDN은 Google OIDC·audience·push service-account email을 모두 검증하고, additive D1 schema를 먼저 적용해야 한다. 설정 누락은
  `503` fail-closed가 정상이다. Qonversion은 비활성·비정본 보조 route이며 health는 secret이 없으면
  `configured:false, accepting:false, primaryProvider:false`를 반환한다. Billing 상품 조회 진단은 response code/debug message와
  미조회 product id/type/status만 다루고 purchase/order token을 로그나 응답 진단에 포함하지 않는다.
- **출시 AAB 신선도(2026-07-13)**: 체크리스트의 서명 AAB는 최신 앱 커밋 이후 다시 빌드하고 서명·해시·mtime을 확인한
  경우에만 준비 완료로 표시한다. 과거 AAB가 디스크에 존재한다는 이유만으로 업로드하지 않는다. 서명 비밀번호는 사용자만
  입력하며 에이전트가 자격 파일을 읽어 자동 서명하지 않는다.
- **출시 전 신뢰 UX 문구 가드(2026-07-07)**: 안전은 무료, 상세 안심은 프리미엄이라는 경계가 흔들리면 안 된다.
  구독·원격청취·AI 일정 문구는 `tests/subscriptionTrustCopy.test.mjs`, `tests/remoteAudioTrustCopy.test.mjs`,
  `tests/aiScheduleUxCopy.test.mjs`로 회귀 보호한다. SOS·긴급 알림을 프리미엄 혜택처럼 쓰지 말고,
  원격청취는 아이 알림·1분 자동 종료·기록 안내를 함께 보여준다.
- **알림 전달·원격청취 보안 계약(2026-07-14)**: 모든 즉시 알림은 네트워크 발송 전에 수신자별
  `pending_notifications`를 만들고, 실제 네이티브 표시/Web Push 표시 ACK 전에는 delivered로 완료하지 않는다.
  targetless 레거시 행은 일반 사용자가 조회·ACK할 수 없으며, 일정·도착·위험·메모 알림은 활성 가족 구성원과 정확한
  `targetUserId`/role/아이 식별자를 서버가 검증한다. 원격청취는 부모 버튼 → 감사 세션 생성(세션 id=requestId) →
  아이에게 일반 알림 → 아이가 해당 세션을 직접 1회 허용 → access JWT로 WAV 전송 → 요청한 부모 소켓에만 전달 →
  **서버가 기록한 아이 동의 시각부터** 최대 60초 후 종료 순서다. 요청 시각부터 60초를 계산해 늦게 동의한 아이의 청취
  시간을 줄이지 않는다. FCM·pending만으로 마이크를 자동 시작하거나 전체화면으로 가로채지 않는다. 익명 realtime
  broadcast와 클라이언트 WebSocket relay는 금지하며, stop은 같은 requestId·아이·session nonce를 확인하고 감사 행을
  닫기 전에 전송한다. 감사 종료 시각·길이·종료 사유는 서버가 확정한다.
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
  Resend 호출 전에 `user_feedback(type='feature_feedback', status='queued')`를 저장한다. Resend는 8초 상한이며 성공한 경우만
  `sent`, 미설정·실패는 `queued` 202다. `queued`는 D1 운영 대기열에 안전하게 접수됐다는 뜻이지 이메일 자동 재전송을
  약속하지 않는다. 운영자는 대기열을 모니터링·처리하고 앱도 두 상태를 다른 문구로 표시한다. 운영에는
  `db/feedback-delivery-safety.sql`을 Worker보다 먼저 적용한다.
- **선생님 모드 출시 차단(2026-07-14)**: v1.2.0 프로덕션은 미완성 선생님 가입·반 연동을 심사 화면에 노출하지 않는다.
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
- **역할 라우트·알림 표시 경계(2026-07-14)**: 부모·아이뿐 아니라 선생님 탭과 알림장 상세도 `RequireRole`로 막아
  URL 직접 입력이 역할 경계를 우회하지 못하게 한다. Android pending 복구는 표시용 알림인지 먼저 판정한 뒤에만
  system/local ACK를 확인하며 `request_location`·`request_device_status`·원격청취 같은 네이티브 명령을 알림 표시 완료로
  잘못 ACK하지 않는다. 메시지·일정·안전 채널은 민감한 본문이 잠금화면에 노출되지 않는 private 채널을 사용하고,
  전체화면 인텐트는 `sos|emergency`와 실제 사용자 허용 상태에서만 사용한다.
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
  (`status/*.webp`는 흰 배경 불투명 — 사용 금지 목록. `ui/mic-lavender.webp`는 2026-07-14 투명본으로 교체돼 사용 가능).
  일정 아이콘은 `resolveEventCharacter`(제목→cat/*.webp).
- ★아이콘 언어 통일(2026-07-14): 기능 타일·색 칩·히어로·안전지표 = 3D webp(menu-*/place-* 기준), 텍스트 행 인라인·유틸 =
  lucide. 진한 선 스타일 플랫 SVG(`ui/icon-*.svg`) 재유입 금지. 안전지표 4칸 = battery/clock-3d/lock-open-3d/wifi-3d.webp,
  프리미엄 잠금 = lock-3d.webp, 주간리포트 히어로 = chart-3d.webp. 새 3D 아이콘은 원본 팩 `assets/05-icons/*` 변환 우선,
  없으면 클레이 스타일 SVG→sharp 렌더(알파 투명 256px). 화면 내 형제 요소와의 일관성이 우선(설정/알림 색 칩 lucide+data-tone
  유지). 가드=`tests/iconConsistency.test.mjs`.
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
- ★타입·여백·아이콘 정본(2026-07-19): 글자는 `--type-*`의 12/13/14/15/16/18/20/24/32px 의미 단계와
  대응 line-height·weight를 한 묶음으로 사용한다. 여백은 4px 리듬(`--spacing-*`), 아이콘 glyph는
  16/18/20/22/24px(`--icon-*`)로 제한하고 터치 영역과 분리한다. 모든 조작 영역은 최소 44px, 주요 저장·확인·위험 CTA는
  48px 이상을 유지한다. lucide 형제 아이콘은 같은 크기·strokeWidth를 사용하며 의미 전달용 유니코드 이모지는 금지한다.
- ★표면 정본(2026-07-19): radius는 8/12/16/20/24px·pill만, elevation은 `--shadow-soft/floating/modal`만 사용한다.
  임의 radius·shadow를 새로 만들지 않고 같은 계층의 카드·시트·모달은 같은 토큰을 쓴다.
- ★모달 접근성(2026-07-19): `role="dialog" aria-modal="true"` 화면은 `useDialogFocusLifecycle`로 열림 초점,
  Tab/Shift+Tab 순환, Escape 닫기, 닫힌 뒤 트리거 초점 복원을 보장한다. 제목은 `aria-labelledby`, 필요한 설명은
  `aria-describedby`로 실제 DOM id와 연결하고 스크림 닫기·닫기 버튼을 함께 제공한다.
- ★정보 밀도·이미지 크롭(2026-07-19): 권한·오류·설정 유도 화면은 제목, 한 문장 설명, 현재 상태/경로, 주 CTA,
  보조 CTA 순으로 한 화면에서 훑히게 만든다. 같은 내용을 장문 카드로 반복하지 않는다. 인물/캐릭터 이미지는 예약된
  aspect-ratio와 의도한 `object-position`을 명시해 머리·얼굴이 잘리지 않게 하고, 비핵심 네트워크 이미지는
  `loading="lazy" decoding="async"`로 레이아웃 이동 없이 로드한다.
- ★화면 완결성·성능(2026-07-19): 조회 화면은 loading/error/empty/success/retry를 정직하게 분리하고, 현재 family/user/source
  snapshot hydration이 끝나기 전 입력·저장을 닫는다. busy 버튼은 중복 실행을 막고 상태를 접근성 이름으로 알린다.
  App 정본은 58개 라우트·57개 lazy screen이며 진입 JS는 `tests/routeBundleBudget.test.mjs`의 500,000-byte 미만 예산을 지킨다.

## 실기기 검증 치트시트

- 기기(2026-07-19 최신 사용자 지시): **A17(RFKL40DP73J)=부모모드**, **razr(ZY22H9VTQD)=아이모드** 검증기다.
  두 기기는 `adb install -r`만 사용해 앱 데이터·계정·페어링·세션을 보존한다. **S25는 검증 제외**이며 다시
  명시적으로 허용받기 전에는 adb로 접근하지 않는다.
- 기기 역할은 세션별로 바뀐 이력이 있으므로, 문서의 과거 단계 기록보다 **최신 사용자 지시/goal**을 우선한다.
  단, 완료 선언 전에는 CDP로 WebView 세션(`hyeni-api-session-v1`)의 role/familyId와 실제 화면을 다시 확인하고,
  지시한 역할과 다르면 해당 실기기 검증은 미검증/차단으로 분리 보고한다.
- adb(Git Bash): 원격 경로엔 `MSYS_NO_PATHCONV=1` · `keyevent 26` 은 토글(끄기 전 상태 확인) ·
  offline/unauthorized → `adb kill-server && adb start-server`.
- Windows cmd 함정: 실행 환경에 `NoDefaultCurrentDirectoryInExePath=1`이 있으면 cmd가 현재 디렉터리의
  `gradlew.bat`를 경로 접두어 없이 찾지 못한다("내부 또는 외부 명령이 아닙니다"). gradle 호출은 항상
  `.\gradlew.bat`처럼 경로를 명시한다(`tests/androidMergedManifestSecurity.test.mjs`도 동일).
- CDP: `adb forward tcp:922x localabstract:webview_devtools_remote_<pid>` → `http://localhost:922x/json` ·
  websocket 연결에 `suppress_origin` 필수 · **awaitPromise 긴 evaluate 는 hang** → 클릭/조회를 짧은 동기
  evaluate 로 쪼개고 결과는 별도 폴링 · `canvas.toBlob` 대신 `toDataURL`(동기) · React 제어 input 은
  native value setter + `input` 이벤트 · 페이지 fetch 로 `/rest/v1` 은 CORS 차단 → 토큰만 읽고 호스트 curl.
  최종 화면 판정은 `main` 같은 시맨틱 태그가 아니라 라우트별 실제 루트 선택자의 가시성으로 확인한다. `Log.enable`은
  이전 WebView 로그를 다시 전달할 수 있으므로 `Log.clear`와 수집 배열 초기화 후 새로고침한 응답만 현재 오류로 판정한다.
- D1: 컬럼 추측 금지 — `pragma_table_info` 먼저 · 시간 조건 검증은 백데이트 트리거
  (상태 시각을 과거로 UPDATE 후 이벤트 1회 주입) · `wrangler tail --format json` 을 파일로 받아 파싱.
  `/api/events`처럼 `events_children`를 다건 조회할 때는 D1 변수 제한을 넘지 않도록 `IN (...)` 바인딩을 청크 처리한다.
- 밤 시간대엔 force_ring/SOS 실발사 자제(실기기 벨 울림) — 발동 시 데이터 정리까지.

## 저장소

- 앱: https://github.com/tkisdroid/hyeni-3 (main) · 백엔드/레거시: https://github.com/tkisdroid/hyeni.
- 커밋 = conventional commits(`feat:`/`fix:`/`docs:`…) 한국어. `.env`(키)·빌드 산출물·180MB+ 에셋은 커밋 금지.

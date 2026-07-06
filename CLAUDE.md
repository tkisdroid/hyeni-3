# CLAUDE.md — 혜니캘린더 리디자인 (hyeni-3)

이 파일은 매 세션 자동 로드됩니다. **새 세션은 이 문서로 현재 상태·다음 할 일을 파악하고 이어서 작업하세요.**
모든 응답·주석은 한국어. 기술 용어·코드 식별자는 원문 유지.

---

## 0. 한 줄 요약

혜니캘린더(가족 일정 공유 + 부모·자녀 위치/안전)를 **리디자인 시안 기준으로 새로 구축**하는 프로젝트.
현재 **UI/UX 프로토타입 전체가 완성**(29개 화면 + 네비게이션 배선)되어 빌드·브라우저 검증까지 끝난 상태.
**다음 할 일 = 3단계: 백엔드(Cloudflare Worker API) 연동으로 목업을 실데이터로 교체.**

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

### 전체 라우트 맵 (전부 도달 가능)
```
부모 탭(ParentShell)   /parent/home calendar location memo settings
아이 탭(ChildShell)    /child/home sticker memo
선생님 탭(TeacherShell) /teacher/home students (+calendar/settings 플레이스홀더)
푸시(PushShell)        /onboarding subscription notifications remote-audio place-manager
                      friend-play ai-schedule ai-credit feedback phone-setup playdate-accept
                      sticker-send profile-edit place-form child-invite route
                      parent/family child/sos child/ai-friend
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

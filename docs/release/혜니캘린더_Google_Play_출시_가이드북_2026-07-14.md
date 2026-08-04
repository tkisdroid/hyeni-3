# 혜니캘린더 Google Play 출시 가이드북

버전 1.3.0 · versionCode 5
작성일 2026-07-14 · 최종 정책 동기화 2026-08-02 · 패키지 `com.hyeni.calendar`

이 문서는 혜니캘린더의 현재 코드·정책 초안·검증 상태를 기준으로 Google Play Console 등록부터 출시 후 관찰까지 수행하는 운영 가이드다. 체크 표시는 관측된 증거가 있을 때만 바꾸며, Console의 최신 질문과 실제 산출물을 제출 직전에 다시 확인한다.

## 1. 현재 결론

| 구분 | 현재 판정 | 출시 전 행동 |
|---|---|---|
| 앱·Worker 코드 | 최신 전체 로컬 회귀 통과 / 외부 출시 증거 대기 | 앱 1,231/1,231, Worker 1,159/1,159, legacy app 2,208/2,208, Android 172/172와 typecheck·Worker dry-run·legacy lint/build·Android lint 오류 0·경고 13을 확인했다. clean exact app/sibling SHA의 교차 CI와 운영 배포 증거는 별도 필요 |
| A17 부모·razr 아이 | 현재 exact APK 미설치 / 실기기 재검증 대기 | 현재 adb 승인 범위는 A17 부모와 razr 아이 두 대뿐이다. `adb start-server` 뒤 두 serial의 `get-state`가 모두 `device not found`여서 SHA-256 `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873`인 현재 exact APK는 어느 기기에도 설치하지 못했다. 직전 `f0c697…` 후보의 A17 부모 UI 통과·razr secure keyguard/Dozing 차단·종료 이력은 역사 증거일 뿐 현재 후보 완료 증거가 아니다. S25는 설치·실행·로그·세션 조회를 포함해 접근하지 않았다 |
| 최종 로컬 브라우저 | 격리 production bundle QA 통과 | 414개 파일·tree SHA-256 `21fd847bd3b5e64d71beaa329155d3273ac8d5bfdaa2dc87b24d63356dd6c1e5`, index SHA-256 `c4a51f17136795d0eba64467c77d965614cf5964381b78d1796072be3d8b616a`, entry JS 479,697 bytes·CSS 30,849 bytes의 exact dist에서 부모 42/42·아이 14/14 화면이 문제 0으로 통과했다. Chromium PWA install·offline·새 controller 교체도 문제 0이며 `registerType: prompt` 중요 작업 보호형 업데이트를 사용한다. WebKit smoke도 PASS지만 offline reload는 Playwright 엔진 오류로 미검증이며 실제 iPhone 검증은 아니다 |
| OpenAI 런타임 | 로컬 Luna 전환·업데이트 키 canary 통과 / 운영 차단 | 활성 4경로를 `gpt-5.6-luna`로 단일화했다. 업데이트된 로컬 `.env` 키로 child safety text, schedule JSON, vision schedule JSON, day summary text 4종이 모두 HTTP 200과 `model=gpt-5.6-luna`를 반환했다. 이전에 노출된 OpenAI 키의 Dashboard 폐기와 production Worker secret 교체·readback, 대표 운영 품질 E2E와 Worker 배포는 미확인이다 |
| AI 생성 콘텐츠 | 코드·자동 검증 완료 / 제출 차단 | 앱 내 신고·서버 소유권 검증·D1 저장은 구현됨. 실제 아이 세션·운영 큐 처리 E2E 필요 |
| 가족 메모 UGC | 코드·자동 검증 완료 / 제출 차단 | 신고·차단·표시 직전 재인가는 구현됨. 승인된 아이 기기와 부모의 양방향 FCM·pending E2E 필요 |
| Data Safety | 제출 차단 | 전체 데이터 유형과 외부 처리업체의 서비스 제공자 예외를 계약·설정 기준으로 확정 |
| 법적 문서 | 2026-07-14 배포 확인 / 현재 갱신 필요 | Toss 자동결제·친구 초대·결제 및 위치 확인자료 보존을 반영한 최신 공개 문구와 전문 검토 필요 |
| Android AAB | local debug evidence 통과 / 업로드 금지 | `artifacts/release-evidence/android-debug-aab-evidence-20260802-143008.json` schema v4와 manifest policy v1로 source dist→post-sync public→universal APK public의 raw/투영 `matched:true`·Capacitor 생성 파일·AAPT 제외·archive·TOCTOU, 승인 권한 정확히 24개, `isMonitoringTool=child_monitoring`, legacy 저장소 권한 `maxSdkVersion=28`, 16KB ZIP·ELF를 검증했다. clean CI에서 승인 upload certificate로 release AAB를 새로 만들고 같은 evidence를 Pages artifact·release record·Play 내부 테스트와 연결해야 함 |
| 스토어 그래픽 | 실제 UI 기술 후보 6장 통과 / 승인 대기 | exact production dist와 정적 데모 세션으로 1080×1920 불투명 RGB PNG 6장을 생성했고 개인정보 메타데이터가 없음을 확인했다. `playUploadApproved=false`이므로 Play 정책·마케팅 문구·육안 승인 전 자동 업로드 금지 |
| 위치·FGS·FSI·모니터링 | Console 선언 필요 | 실제 manifest·UI·지속 알림·영상과 선언을 일치시킴 |
| 대상 연령·Families | 책임자 결정 필요 | 실제 보호자+아이 이용자를 근거로 혼합 연령 여부와 연령 구간 확정 |
| 결제·RTDN·PWA Toss | 외부 설정·E2E 필요 | Android Play와 iPhone 홈 화면 PWA Toss를 각각 검증하고 가족별 결제사 중복 활성화를 차단 |
| 브라우저 Web Push | 외부 설정·E2E 필요 | VAPID secret 설정 후 권한·구독·백그라운드 표시·ACK·해제를 실제 브라우저에서 검증 |
| 심사 접근 | 준비 필요 | 반복 사용 가능한 데모 보호자·자녀 계정과 재현 절차 제공 |

파일이 존재하거나 과거 검증 기록이 있다는 이유만으로 제출 준비 완료로 바꾸지 않는다. 특히 기존 `app-release.aab`은 최종 커밋 이후 생성됐다는 신선도 증거가 없으면 업로드하지 않는다.

> 현재 판정은 **v1.3.0 앱 1,231/1,231·Worker 1,159/1,159·legacy 2,208/2,208·Android 172/172와 Luna 4종 HTTP 200 통과 / exact 로컬 브라우저·Chromium PWA 통과·WebKit offline reload 미검증 / 현재 exact APK는 A17·razr 모두 `device not found`로 미설치 / 직전 후보의 A17 UI·razr 잠금 차단·404 관측은 역사 증거 / 운영 D1 필수 객체 25개 중 23개 누락·두 퍼널 source 허용 0 / 결제·서명 release·스토어 승인 미완료 / release record blocker 27건 / 프로덕션 제출 HOLD**다. 아래 미완료 차단 조건을 모두 해제하기 전에는 AAB를 업로드하거나 PWA 결제를 운영에 열지 않는다.

### 1.1 v1.2.0 확정 검증 증거(역사 기록)

아래 수치와 배포 ID는 당시 v1.2.0 산출물의 증거다. v1.3.0 현재 후보 코드의 테스트·빌드·배포 증거로 재사용하지 않는다.

| 증거 | 관측 결과 |
|---|---|
| 앱 기준 branch·commit | `feat/app-enhancement-reports` · `6d2aff316c1c2fd3277a7ca7915923a2628df52e` |
| Worker 기준 branch·commit | `qa/final-e2e-fixes-20260702` · `3a8d23d349ab083c53059b9b1dbefa249b3702c2` |
| 앱 자동 검증 | Node 509/509, TypeScript exit 0, production build exit 0, npm audit 0 |
| Worker 자동 검증 | Node 551/551, TypeScript exit 0, npm audit 0 |
| Android 자동 검증 | unit 126/126, `lintDebug` 오류 0·경고 65, `assembleDebug` exit 0 |
| debug APK | 15,845,964 bytes · SHA-256 `3AC287C8197F2D17324D4D69AF55B80ED4A4DF7C7FB978CDF0222B2C53D07229` · mtime 2026-07-14 07:17:07 KST |
| A17 설치·권한 | 이전 후보 증거: SM-A175N · Android 16/API 36 · versionCode 4/versionName 1.2.0 · 알림·정밀/대략 위치 권한 granted. v1.3.0 결과는 아래 표에 별도로 기록 |
| A17 세션 | 부모 role, `/api/family/mine` 200, WebView와 서버 familyId 일치 |
| A17 화면 | 부모 홈·일정·위치·오늘 경로·메시지·알림함·알림 설정·설정 모두 실제 루트 표시·가로 overflow 0 |
| A17 지도 | 현재 위치와 오늘 경로 모두 Kakao map canvas 렌더, `지도를 불러오지 못했어요` 없음 |
| A17 오류 | 콜드 재기동 뒤 runtime·console·HTTP 4xx/5xx 0, logcat crash·ANR·반복 401/403/5xx 0 |
| A17 App Link | debug 인증서 설치본에서 `hyeni-calendar.pages.dev: verified` |
| A17 page size | `getconf PAGE_SIZE=4096`; 16KB 런타임 검증 증거가 아니므로 별도 차단 유지 |
| Pages 배포 | deployment ID `ee6b104c`, production alias 공개 화면 1440×900·360×800 검증 |
| Worker 배포 | version ID `0d45492d-d406-4a6f-9815-7ec1a32b5ae0` |
| 공개 서버 | `/api/health` 200, 법적 문서 3종 200, `/favicon.ico` 200 SVG, 잘못된 memo permit은 `{allowed:false}`·`no-store` |
| D1 | 요구 additive migration 적용·PRAGMA readback, stale mutation lease 0, queued feature feedback 0 |

### 1.2 2026-08-02 v1.3.0 소스 후보의 최종 로컬 검증

| 증거 | 관측 결과 |
|---|---|
| 앱 자동 검증 | Node 1,231/1,231, TypeScript·production build·npm audit 0 |
| Worker 자동 검증 | 순차 Node 1,159/1,159, TypeScript·Wrangler dry-run·npm audit 0 |
| legacy `hyeni-1` 프런트엔드 | Node 2,208/2,208, ESLint·Vite build·npm audit 0 |
| 버전 소스 | package/app version `1.3.0`, Android `versionCode 5` 확인 |
| 가격·티어 보완 | Free 새 아이 연결 상한 1, 저장 장소 알림 첫 2, 위험구역 알림 첫 1, 초과 데이터 보존과 Premium 전체 활성 계약을 추가했다. 직접 일정 추가·기존 일정 관리는 두 플랜 모두 무제한이고, AI 일정 정리는 Free 하루 5회·Premium 무제한이다. 이 계약은 아래 최종 전체 회귀와 브라우저 QA에 포함됐다 |
| 최종 위험 보완 | AAB schema v4 raw/투영 provenance, 결제 복귀 `no-referrer`, realtime live 8/user·64/room 상한, legacy raw socket 송신의 인증 API broadcast 전환과 비정본 WebView 오디오 fallback 제거, Android 등록 장소 master 조회 실패 fail-closed, 신규 결제 kill switch, 개인정보 비저장 운영 로그, 첫 60분 5xx·큐 자동 판정, FSI 제한, 외부 승인 manifest를 반영했다. 전체 회귀는 앱 1,231/1,231·Worker 1,159/1,159·legacy 2,208/2,208·Android 172/172이다 |
| OpenAI Luna 전환 | 활성 4경로 중앙 `gpt-5.6-luna`·`reasoning_effort:none`·`max_completion_tokens`·SHA-256 `safety_identifier`를 적용했다. 업데이트된 로컬 `.env` 키의 child safety text·schedule JSON·vision schedule JSON·day summary text 4종이 모두 HTTP 200과 `model=gpt-5.6-luna`로 통과했다. 이전 노출 키의 Dashboard 폐기와 production Worker secret 교체·readback·운영 배포는 미확인 |
| 마지막 전체 검증 | 앱 1,231/1,231·Worker 1,159/1,159·legacy 2,208/2,208·Android 172/172, 앱 typecheck/build, Worker TypeScript/dry-run, legacy lint/build, Android lint 오류 0·경고 13과 assemble/bundle, npm audit 0 통과. clean commit exact SHA 교차 CI는 미완료 |
| final local production bundle | 414개 파일·tree SHA-256 `21fd847bd3b5e64d71beaa329155d3273ac8d5bfdaa2dc87b24d63356dd6c1e5`, index SHA-256 `c4a51f17136795d0eba64467c77d965614cf5964381b78d1796072be3d8b616a`, entry JS 479,697 bytes, 초기 CSS 30,849 bytes다. PWA precache 320개와 중복 0을 확인했다 |
| local Android debug 산출물 | unit 172/172·manifest policy 33/33 강제 재실행, lint 오류 0·경고 13, assemble/bundle 성공. 경고 13건은 사용되지 않는 레거시 리소스와 기존 런처·스플래시 이미지 구성 경고다. APK 13,092,876 bytes·SHA-256 `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873`, debug AAB 12,018,080 bytes·SHA-256 `eb0eb5b2288de6771c3e70cc3e5bbe7eaeb3fa62d1f85d1d2ce318748631c2c5`다. `artifacts/release-evidence/android-debug-aab-evidence-20260802-143008.json` schema v4는 source dist·embedded web `matched:true`, 권한 24개 exact, 서명, ZIP·ELF 16KB 정렬을 통과했다. evidence JSON SHA-256은 `e552dd6655d4e6a0b467cac0d0acba73f5ae9f79a410b657926e1fcd242d0c18`, verification log SHA-256은 `1bd78d88dfa4cb717bf4f73d1a8bf116cb653135d01560daa9c472816f0a483f`이며 Play 업로드용 release AAB가 아니다 |
| v1.3.0 실기기 | 현재 exact APK 설치 전 `adb start-server` 뒤 A17(`RFKL40DP73J`)과 razr(`ZY22H9VTQD`)를 serial별 `get-state`로 확인했지만 둘 다 `device not found`였다. 따라서 SHA-256 `62b66c…` 후보의 설치·role·UI·network·crash/ANR 검증은 미수행이다. 직전 SHA-256 `f0c697…` 후보에서 확인한 A17 부모 UI, razr secure keyguard·Dozing 차단, aggregate 종료 이력과 신규 endpoint 404는 역사 기록으로만 보존한다. S25는 접근하지 않았다 |
| v1.3.0 브라우저 | `artifacts/release-evidence/browser-qa/20260802T141931-final-21fd847/report.json`에서 부모 42/42·아이 14/14·문제 0, `artifacts/release-evidence/pwa-runtime-qa/20260802T141931-final-21fd847/report.json`에서 Chromium install·offline·실제 `controllerchange`·문서 reload 문제 0이다. `registerType: prompt` 중요 작업 보호형 업데이트이므로 결제·대사·주변 소리·mutation·미저장 입력 중 reload를 보류한다. WebKit smoke도 PASS지만 offline reload는 Playwright 엔진 오류로 미검증이며 실제 iPhone 증거가 아니다 |
| 외부 승인 manifest | `artifacts/release-evidence/release-record-20260802-final-local-hold-v5.json`은 `verdict=HOLD`, `humanApprovalRequired=true`, blocker 27건이다. 두 저장소 dirty, 운영 D1 23개 객체 누락, 외부 승인·서명·교차 CI·Pages 증거 누락과 평문 서명 자격정보 파일 존재 감지를 포함한다. 자격정보 파일의 내용·비밀번호·비밀값은 읽거나 기록하지 않았다 |

위 결과는 최신 전체 로컬 회귀와 focused 출시 가드를 함께 반영한 기록이다. 앱 1,231건·Worker 1,159건·legacy 2,208건·Android 172건 통과를 clean exact SHA 교차 CI, 운영 D1, Worker/Pages 배포, 실제 결제, 서명 AAB와 Play 제출 증거로 확대 해석하지 않는다.

### 1.3 이번 검증에서 의도적으로 하지 않은 것

- A17 부모와 razr 아이만 현재 실기기 승인 범위다. 현재 exact APK 설치 직전 두 serial이 모두 `device not found`여서 설치·UI·network·crash/ANR 검증을 수행하지 못했다. 직전 `f0c697…` 후보의 A17 부모 UI, razr secure keyguard·Dozing 차단, aggregate 종료 이력과 신규 endpoint 404는 역사 증거로만 보존한다. 역할 전환·로그아웃·재페어링·refresh token 접근은 하지 않았으며 S25는 설치·실행·로그·세션 조회를 포함해 접근하지 않았다.
- v1.2.0의 A17 부모·razr 아이 결과는 역사 기록으로만 보존하며 v1.3.0 완료 증거로 재사용하지 않는다.
- 네이티브 아이 FCM·pending 표시 ACK, 백그라운드 위치 업로드, 마이크 FGS, Usage Access 보고, `CALL_PHONE` 양방향 검증은 별도 게이트다.
- 실사용 데이터 보호를 위해 일정·메모·신고·차단·SOS·강제 알림·결제의 새 mutation이나 실제 발사를 만들지 않았다.
- 새 서명 AAB, Play 내부 테스트 설치본, license tester 구매, RTDN, 16KB 기기, 대화면·폴더블 검증은 외부 준비가 없어 완료하지 않았다.
- 새 브라우저에는 데모 아이 계정이 없어서 인증된 아이 AI 신고·메모 양방향 E2E와 Web Push 백그라운드 수신을 수행하지 않았다.

### 1.4 2026-08-02 가격·티어·수익화 정본

초기 출시에서 사용자가 보는 상품은 **무료와 프리미엄 두 단계뿐**이다. `reviewed`는 과거 스토어 방문 혜택을 이미 받은 가족의 기존 한도를 보존하기 위한 숨은 내부 호환 상태이며, 신규 지급·상품·가격표에 노출하지 않는다. 프리미엄 가격은 **월 4,900원, 연 39,000원**으로 고정하며 연간 결제의 월 환산액은 3,250원이다.

| 기능 | 무료 | 프리미엄 |
|---|---|---|
| 새 아이 연결 | 1명까지 | 2명까지 |
| 일정·메모·스티커(직접 일정 추가·기존 일정 관리 포함) | 무제한 | 무제한 |
| 준비물·숙제 | 아이별 하루 준비물 8개 + 숙제 8개 | 아이별 하루 준비물 8개 + 숙제 8개 |
| 위치 보기 | 측정 시각·정확도가 있는 최신 실측 위치를 약 10분 간격으로 표시 | 실시간 |
| 지금 위치 요청 | 최근 24시간 5회 | 최근 24시간 제한 없음 |
| 위치 이력 | 오늘 | 최근 30일 |
| 저장 장소·도착/출발 알림 | 신규 저장 2곳까지, 생성 시각+id 순 첫 2곳이 알림 대상 | 신규 저장·알림 대상 모두 무제한 |
| 위험구역 안전 알림 | 신규 저장 1곳까지, 생성 시각+id 순 첫 1곳이 알림 대상 | 신규 저장·알림 대상 모두 무제한 |
| 소리 울리기 | 최근 24시간 1회 | 최근 24시간 10회 |
| AI 친구 기본 제공 | 하루 5회 | 하루 20회 |
| AI 일정 정리(텍스트·사진·음성) | 하루 5회 | 무제한 |
| 주변 소리 듣기 | 제공하지 않음 | 위급 상황 확인용, 최대 1분 |
| 기본 안심 리포트 | 제공 | 제공 |
| 위치 끊김·미등록 체류 | 수동 확인 | 자동 알림 |
| AI 하루 요약 | 제공하지 않음 | 제공 |
| 주간 가족 리포트 | 실제 기록 기반 한 줄 미리보기 | 전체 리포트 |
| 학원 시간표 자동 정리 | 제공하지 않음 | 제공 |
| SOS·긴급 알림 | 항상 제공 | 항상 제공 |

아이 수는 신규 연결 상한이다. Premium에서 Free로 내려가도 이미 연결된 아이를 자동 해제하거나 숨기지 않는다. 다운그레이드 전에 저장한 초과 장소·위험구역도 삭제하지 않고 계속 조회·수정·삭제할 수 있지만, Free 한도를 넘는 동안 새 항목은 추가할 수 없다. 서버가 생성 시각을 초 단위로 정규화하고 id로 동률을 깨서 고른 저장 장소 첫 2곳·위험구역 첫 1곳만 알림 대상이며, Premium으로 복귀하면 보존 항목 전부가 다시 알림 대상이다. 기존 `reviewed` 가족은 저장 장소 첫 3곳의 알림 대상 자격만 보존한다.

“알림 대상”은 플랜이 허용하는 대상이라는 뜻이며 실제 알림 켜짐을 보장하지 않는다. 가족의 등록 장소 알림 master switch, 위험구역별 진입·이탈 설정, 기기 권한·네트워크 등 기존 전달 조건도 함께 충족해야 한다. Android는 master 조회 결과가 정확히 1행의 Boolean `true`일 때만 등록 장소 네이티브 알림을 열고 조회 시작·실패·누락·빈 응답은 즉시 `false`로 닫는다.

무료 위치도 측정 시각·정확도를 숨기지 않으며, 위치 엔타이틀먼트 판정 실패 시 최신 위치를 열지 않고 fail-closed한다. SOS와 긴급 안전 알림은 결제 상태와 무관하게 항상 열린다.

AI 친구의 플랜 기본 제공량은 Free 하루 5회, Premium 하루 20회다. 부모가 더 낮은 하루 안전 상한을 직접 정할 수 있으므로 한도 도달 안내는 **부모가 정한 낮은 상한**, **Free 기본 5회 소진**, **Premium 기본 제공량 소진**을 구분한다. Free 5회 소진 업셀은 Premium 20회의 정확한 차이와 `/ai-credit` 복귀 의도를 보존한다. 기존 Premium 가족의 낮은 상한은 자동으로 20회로 덮어쓰지 않고, 부모가 `Premium 기본 20회로 설정`을 명시적으로 선택한 경우에만 변경한다. 일반 AI 일정 정리는 Free 하루 5회, Premium 무제한이며 직접 일정 추가와 기존 일정 관리는 두 플랜 모두 무제한으로 유지된다. Free 5회 소진 시 사용량·무료 대안·Premium 차이와 원래 AI 일정 탭 복귀를 한 모달에서 안내한다. Worker의 `ai_parent_settings`는 `(family_id, child_user_id)` UNIQUE와 원자 `ON CONFLICT` upsert를 사용하며, 기존 중복 행은 fail-closed migration이 삭제·임의 병합하지 않고 운영자 정규화를 요구한다.

Android 구독은 Google Play가 정본이며 Console·결제 확인 화면에서 월 4,900원·연 39,000원인지 확인한다. iPhone 홈 화면 PWA 구독은 Toss Payments 자동결제를 사용하되, 자동결제 계약·위험 검토·필수 D1 migration·live key·환불/갱신/해지 E2E 중 하나라도 없으면 신규 결제 운영 제어를 OFF로 유지해 catalog·checkout을 503으로 닫고 프리미엄 권리를 열지 않는다. 이 운영 제어는 이미 시작된 주문의 complete·reconcile과 기존 구독의 cancel·refund를 막지 않는다. 다만 해당 처리에 필수인 schema·secret이 실제로 없으면 각 endpoint가 별도 fail-closed하는 것이 정상이다.

친구 초대는 구독권이 아니라 초대한 가족과 신규 가족에 각각 AI 대화 10회를 한 번 지급한다. 추천인 가족은 평생 최대 3가족이며, 신규 가족 생성 72시간 경과와 첫 실제 위치 저장 후 48시간 유지가 모두 확인된 뒤 서버 cron만 지급한다. 위치 좌표·주소·자녀 이름은 추천 원장에 저장하지 않는다. 승인·환불 금융 정본 보존과 위치 확인자료 보존은 공개 법적 문구·운영 migration·전문 검토가 끝나기 전 출시 완료로 처리하지 않는다.

## 2. 출시 불변식

1. 서명 AAB는 최종 앱 커밋 이후 다시 빌드한다.
2. 비밀번호, 키 파일, 구매 토큰, access/refresh token을 문서·로그·이슈·스크린샷에 넣지 않는다.
3. 자격정보 파일의 내용을 에이전트나 자동화가 읽지 않는다. 운영자가 비밀번호 관리자로 이전하고 평문 사본을 직접 삭제한다.
4. v1.3.0 실기기 읽기 검증의 승인 범위는 A17(`RFKL40DP73J`) 부모와 razr(`ZY22H9VTQD`) 아이 두 대뿐이다. 기존 세션을 보존하고 역할 전환·로그아웃·재페어링·refresh token 접근을 하지 않는다. razr의 secure keyguard·Dozing을 우회하거나 잠금 해제하지 않으며 S25는 설치·실행·로그·세션 조회를 포함해 접근하지 않는다.
5. 스토어 자산에는 실제 아이 사진·이름·위치·학교·학원·전화번호·초대 코드·QR을 넣지 않는다.
6. 위치·알림·SOS를 항상·즉시·무조건 전달되는 기능으로 보장하지 않는다.
7. SOS·기본 안전 알림을 프리미엄 혜택처럼 표현하지 않는다.
8. 주변 소리 듣기는 FCM·pending 수신만으로 마이크를 시작하지 않는다. 서버 승인 증표를 1회 소비한 `RemoteListenActivity`가 준비되면 아이 탭 없이 자동 연결하되, 아이 화면과 알림에 듣는 중임을 계속 표시하고 최대 1분·감사 기록을 지킨다.
9. AI·UGC 신고와 차단은 실제 구현·D1·실기기 증거 없이 완료 처리하지 않는다.
10. AAB는 clean Git·manifest SHA만으로 승인하지 않는다. schema v4가 source dist, post-sync Capacitor public, bundletool universal APK public의 raw hash와 정규화 투영을 검증해야 한다. 허용 예외는 루트 0바이트 `cordova.js`·`cordova_plugins.js`와 AAPT가 제외하는 이름·바이트·해시 고정 `.well-known/assetlinks.json` 하나뿐이며 release record가 같은 Pages artifact provenance를 재대조해야 한다.
11. Toss 복귀 URL의 인증·결제 query가 asset Referer로 전파되지 않도록 초기 HTML·배포 응답·SDK script 모두 `no-referrer`여야 한다.
12. 체크하지 못한 제출 차단 항목이 하나라도 있으면 프로덕션 제출·출시 확대를 진행하지 않는다.
13. `hyeni-launch-approval` schema v1 manifest와 기계 판정은 외부 증거를 한곳에 고정할 뿐 사람의 `GO`를 대신하지 않는다. 모든 필수 증거가 있어도 `READY_FOR_HUMAN_GO_REVIEW`까지만 자동 판정하고 운영·정책 책임자가 직접 승인한다.

## 3. 코드·배포 산출물 만들기

### 3.1 앱 검증

앱 저장소에서 다음을 실행한다.

```powershell
Set-Location C:\Users\TK\Desktop\hyeni-3
npm run typecheck
node --test tests/*.test.*
npm audit --audit-level=high
npm run build
npx cap sync android
Set-Location android
.\gradlew testDebugUnitTest lintDebug assembleDebug --rerun-tasks
```

각 명령의 exit code, 테스트 수, 실패·경고를 기록한다. 하나라도 실패하면 다음 단계로 넘어가지 않는다.

### 3.2 Worker·D1 검증과 배포

Worker 테스트는 부모 저장소에서 실행한다.

```powershell
Set-Location C:\Users\TK\Desktop\hyeni-3
node --test worker/tests/*.test.mjs
npm audit --audit-level=high
Set-Location C:\Users\TK\Desktop\hyeni-3\worker
npx tsc --noEmit
```

배포 코드가 요구하는 additive migration을 목록화한 뒤 각 테이블·컬럼·인덱스를 읽기 전용으로 확인한다. 이미 적용된 `ALTER TABLE`을 다시 실행하지 않는다.

```powershell
Set-Location C:\Users\TK\Desktop\hyeni-3\worker
npx wrangler d1 execute hyeni-calendar --remote --command "PRAGMA table_list;"
```

필요한 migration을 Worker보다 먼저 적용하고 스키마를 다시 읽은 뒤 배포한다. 프로덕션 D1 삭제, destructive migration, 테스트 데이터 잔류는 금지한다.

```powershell
Set-Location C:\Users\TK\Desktop\hyeni-3\worker
npx wrangler deploy
```

배포 뒤 공개 URL에서 `/api/health`, `/terms`, `/privacy`, `/data-deletion`, `/favicon.ico`를 확인한다. 법적 문서는 HTTPS 200, 한글 렌더링, 최신 갱신일, 자연스러운 조사, 공식 연락처, 데스크톱·모바일 가로 overflow 0, Console error 0을 모두 확인한다.

신규 웹 구독과 신규 웹 AI 크레딧 결제는 `global_settings.commerce_runtime_controls_v1`의 두 독립 운영 제어를 정본으로 사용한다. 행 누락·형식 오류·D1 조회 오류는 두 신규 결제 경로를 모두 OFF로 판정하는 fail-closed가 정상이다. 운영 기본은 둘 다 OFF이며 migration·schema health/readback·결제사 외부 E2E가 끝난 뒤에만 운영자가 명시적으로 연다. 이 kill switch는 신규 catalog·checkout만 막고 기존 주문 완료·대사·해지·환불과 cron·webhook 처리는 계속한다. 사고 시 두 항목을 OFF로 원자 저장하고 readback으로 확인한다.

Worker 런타임 운영 로그에는 고정 event와 allowlist된 집계 count·provider·HTTP status만 남긴다. 원본 `Error`, stack, 요청 경로, 사용자·가족·메모·주문 식별자, payload, 공급자 응답 본문, 인증·결제 token을 기록하지 않는다. 출시 첫 60분의 5xx와 큐 증거도 aggregate-only JSON으로 저장하고 raw row나 비밀값을 붙이지 않는다.

### 3.3 Pages 배포

프로젝트 `.env`의 D1 전용 토큰이 Pages OAuth를 덮지 않도록 `.env`가 없는 임시 디렉터리에서 실행한다.

```powershell
Set-Location $env:TEMP
npx wrangler pages deploy C:/Users/TK/Desktop/hyeni-3/dist `
  --project-name=hyeni-calendar --branch=main --commit-dirty=true
```

배포된 `https://hyeni-calendar.pages.dev`에서 로그인, 부모 홈, 일정, 위치, 오늘 경로, 알림, 메시지, 설정을 확인한다. Console error와 실패한 API를 기록하고, 캐시된 이전 bundle을 최신 배포로 오인하지 않는다. 문서·정적 자산 응답의 `Referrer-Policy: no-referrer`를 실제 헤더에서 확인하고 Toss 복귀 URL의 `authKey`·`paymentKey`가 asset 요청 Referer·로그에 없는지 검증한다.

realtime은 45초·1회용 ticket에 더해 Family/Teacher room 모두 live 8/user·64/room을 accept 전에 제한한다. 만료·손상 socket은 1008로 닫혀 상한 계산에서 제외되어야 한다. 서버 room은 ping 외 client WebSocket payload를 받지 않으므로 legacy `channel.send`도 raw `sock.send()`가 아니라 Bearer 인증과 family/role/audience를 재검증하는 `/realtime/v1/api/broadcast`만 사용하며 모든 호출은 Promise 실패를 처리한다. 주변 소리는 서버가 허용하는 Android native WAV+세션 검증만 사용하고 WebView MediaRecorder `audio/webm` fallback·child socket 준비 의존은 허용하지 않는다. 미지원 환경은 `remote_listen_requires_android_native`로 닫되 부모 iPhone PWA 제어+아이 Android 캡처 정본은 유지한다. Worker 배포 뒤 9번째 사용자 socket과 65번째 room socket이 `429`·`Retry-After: 30`을 받고 클라이언트가 exponential backoff하는지, 아이 Android WAV가 세션 검증 뒤 요청 부모에게만 도착하는지 실제 연결로 확인한다.

### 3.4 운영 환경 설정 readback

2026-07-14 `wrangler secret list`에서 FCM 분리 자격정보, Google OAuth, JWT, Kakao, NCP SENS, OpenAI, `PUSH_INTERNAL_SECRET`의 이름은 확인됐다. 값은 읽거나 기록하지 않았다. 다음 이름은 없으므로 관련 기능을 출시 준비 완료로 표시하지 않는다.

2026-08-02 Luna 검증에 사용한 로컬 OpenAI 키는 병렬 감사 도구의 내부 로그에 원문이 1회 노출됐다. 값은 코드·Git·이 문서에 기록하지 않지만 해당 키는 더 이상 운영에 사용할 수 없다. OpenAI에서 기존 키를 폐기하고 새 키를 발급한 뒤 Worker secret에 반영하고 `npm run verify:openai-luna`의 child safety text·schedule JSON·vision schedule JSON·day summary text 4종이 모두 HTTP 200과 `model=gpt-5.6-luna`인지 다시 확인한다. 로컬 업데이트 키 canary는 이 4종 모두 통과했지만 production secret readback과 운영 Worker 호출을 대신하지 않는다. 키 값이나 응답 원문은 승인 기록에 남기지 않는다.

| 미설정 이름 | 영향·필수 검증 |
|---|---|
| `RESEND_API_KEY` | 기능 제안은 D1 `queued`로만 접수된다. 운영자가 큐를 처리하거나 secret 설정 뒤 실제 메일 `sent` E2E 필요 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | 브라우저 Web Push 구독·백그라운드 표시·ACK 불가. 두 key 설정과 실제 브라우저 E2E 필요 |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Play 구독 검증·복원·acknowledge 정본 호출 불가 |
| `GOOGLE_PLAY_PACKAGE_NAME` | 패키지 설정을 Console의 `com.hyeni.calendar`와 일치시켜야 함 |
| `GOOGLE_PLAY_RTDN_AUDIENCE` | RTDN OIDC audience 검증 불가 |
| `GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL` | RTDN push 호출자 이메일 검증 불가 |

secret을 설정하면 이름 존재만으로 완료하지 않는다. health/fail-closed, license tester, 실제 메일, 실제 브라우저 push, RTDN 재전달을 각각 검증하고 값·토큰·자격 JSON은 기록하지 않는다.

## 4. 안전하게 서명 AAB 만들기

### 4.1 평문 자격정보 정리

- `android/keystore/hyeni-upload-credentials.txt`의 내용을 에이전트나 자동화가 읽지 않는다.
- 현재 `artifacts/release-evidence/release-record-20260802-final-local-hold-v5.json` 승인 manifest는 평문 서명 자격정보 파일의 **존재만** blocker로 감지했다. 파일 내용·비밀번호·키·secret은 읽거나 기록하지 않았으며 운영자가 직접 안전하게 이전·삭제하고 재검증하기 전에는 `HOLD`다.
- 운영자가 값을 비밀번호 관리자에 직접 옮긴 뒤 평문 파일과 별도 사본을 직접 삭제한다.
- 삭제·이전 여부는 운영자가 확인하고 출시 기록에는 값이 아닌 완료 사실만 남긴다.
- 비밀번호를 Gradle `-P` 인자, PowerShell history, CI 로그, 문서에 넣지 않는다.
- 사용자 전역·프로젝트 `gradle.properties`에 `HYENI_KEYSTORE`, `HYENI_KEYSTORE_PASSWORD`, `HYENI_KEY_ALIAS`, `HYENI_KEY_PASSWORD`가 하나라도 있으면 릴리즈 작업은 값 읽기 없이 실패한다. 운영자가 해당 평문 항목을 직접 제거하고 비밀번호 관리자로 이전한다.
- 이번 평문 노출에 따라 업로드 키스토어 비밀번호 변경이 필요한지 운영자가 검토·확정하기 전에는 새 AAB를 만들지 않는다.

### 4.2 임시 환경변수 서명

`android/app/build.gradle`은 임시 `HYENI_*` 환경변수만 서명 정본으로 사용한다. 네 값이 모두 있어야 하며 하나라도 없거나 공백이면 unsigned AAB를 만들지 않고 실패한다. 운영자가 보이지 않는 입력창에 직접 입력하고 빌드가 끝나거나 실패하면 환경변수를 제거한다.

```powershell
$storeSecret = Read-Host "업로드 키스토어 비밀번호" -AsSecureString
$keySecret = Read-Host "업로드 키 비밀번호" -AsSecureString
$storePtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($storeSecret)
$keyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($keySecret)

try {
  $env:HYENI_KEYSTORE = "../keystore/hyeni-upload.jks"
  $env:HYENI_KEYSTORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($storePtr)
  $env:HYENI_KEY_ALIAS = "hyeni-upload"
  $env:HYENI_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr)

  Set-Location C:\Users\TK\Desktop\hyeni-3\android
  .\gradlew --no-daemon bundleRelease
} finally {
  Remove-Item Env:HYENI_KEYSTORE -ErrorAction SilentlyContinue
  Remove-Item Env:HYENI_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:HYENI_KEY_ALIAS -ErrorAction SilentlyContinue
  Remove-Item Env:HYENI_KEY_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($storePtr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr)
  $storeSecret = $null
  $keySecret = $null
}
```

### 4.3 AAB 승인 증거

- 산출물: `android/app/build/outputs/bundle/release/app-release.aab`
- package: `com.hyeni.calendar`
- versionName: `1.3.0`
- versionCode: `5`
- 파일 mtime이 최종 앱 커밋 이후
- 업로드 인증서가 기존 업로드 키와 동일
- SHA-256, 파일 크기, mtime 기록
- `scripts/create-aab-evidence.mjs` schema v4가 source dist, post-sync Android public, bundletool universal APK public의 raw hash·파일 수와 정규화 투영을 비교해 일치
- 루트 0바이트 `cordova.js`·`cordova_plugins.js` 2개 외 Capacitor 추가 파일 0, AAPT 제외는 이름·338 bytes·SHA-256 `4DBCBB7FDB0CCEC050BCE5FA9FE40862285847CCA393150BC5809DA1705E2E75`가 고정된 `.well-known/assetlinks.json` 1개만 허용
- archive entry가 모두 안전하고 portable 이름 충돌·중복·feature module web asset이 없으며 AAB·dist·Android public이 검증 시작/종료 사이 바뀌지 않음
- `scripts/create-release-record.mjs`가 source dist와 embedded 투영을 current `dist` 및 같은 Pages artifact provenance와 다시 대조해 일치
- bundletool merged manifest가 manifest policy v1의 승인 권한 정확히 24개, `<meta-data android:name="isMonitoringTool" android:value="child_monitoring">`, `WRITE_EXTERNAL_STORAGE maxSdkVersion=28`을 모두 만족하며 권한 추가·누락·중복·`uses-permission-sdk-*` 우회를 fail-closed
- app-quality와 Android CI가 동일한 `VITE_KAKAO_APP_KEY`로 build·`cap sync`되며 누락·불일치에서 fail-closed
- 현재 코드의 targetSdk 36·compileSdk 36과 Play 제출 최소 기준(API 35 이상, 2026-07-14 확인) 일치
- 네이티브 라이브러리 16KB page alignment를 아래 4단계로 실제 확인
- merged manifest에 의도하지 않은 권한·컴포넌트가 없음
- 최종 코드가 바뀌면 versionCode를 올린 새 AAB를 다시 생성

clean Git SHA와 manifest SHA만 같아도 ignored `android/app/src/main/assets/public`이 현재 웹 산출물인지 증명되지 않는다. 최신 local debug의 dist·Android projection·post-sync public·embedded public 파일 수와 SHA-256, archive entry 수는 최종 시장성·출시 보고서와 해당 machine evidence를 정본으로 사용하며 이 가이드에 복제한 과거 수치를 재사용하지 않는다. raw 파일 수 차이는 검증된 루트 0바이트 cordova 파일 2개와 AAPT의 고정 `assetlinks.json` 제외 1개만 허용한다. clean CI에서 build→`cap sync`→승인 인증서 서명 release AAB→schema v4 manifest policy evidence→Pages artifact→release record 순으로 새 증거를 생성하고 한 비교라도 다르면 HOLD한다.

### 4.4 16KB page size 실행 검사

Google Play는 2025-11-01부터 Android 15(API 35) 이상을 대상으로 하는 신규 앱·업데이트에 16KB page size 지원을 요구한다. A17의 `PAGE_SIZE=4096` 성공 실행은 일반 4KB 기기 호환 증거일 뿐 이 요구사항을 대신하지 않는다.

파일이 존재하거나 AGP가 최신이라는 사실만으로 통과 처리하지 않는다. 공식 `bundletool` JAR의 실제 경로를 `BUNDLETOOL_JAR` 환경변수로 지정하고 다음 검사를 모두 실행한다.

```powershell
Set-Location C:\Users\TK\Desktop\hyeni-3
$aab = (Resolve-Path "android/app/build/outputs/bundle/release/app-release.aab").Path
if (-not $env:BUNDLETOOL_JAR -or -not (Test-Path -LiteralPath $env:BUNDLETOOL_JAR)) {
  throw "공식 bundletool JAR 경로를 BUNDLETOOL_JAR에 지정하세요."
}

$config = (& java -jar $env:BUNDLETOOL_JAR dump config --bundle="$aab" 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0 -or $config -notmatch "PAGE_ALIGNMENT_16K") {
  throw "AAB config에서 PAGE_ALIGNMENT_16K를 확인하지 못했습니다."
}

$work = Join-Path $env:TEMP ("hyeni-16kb-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work | Out-Null
$apks = Join-Path $work "hyeni.apks"
& java -jar $env:BUNDLETOOL_JAR build-apks --bundle="$aab" --output="$apks" --mode=universal
if ($LASTEXITCODE -ne 0) { throw "universal APK 생성에 실패했습니다." }
Copy-Item -LiteralPath $apks -Destination (Join-Path $work "hyeni.zip")
Expand-Archive -LiteralPath (Join-Path $work "hyeni.zip") -DestinationPath (Join-Path $work "expanded")
$apk = Join-Path $work "expanded/universal.apk"

$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA "Android/Sdk" }
$buildTools = Get-ChildItem -LiteralPath (Join-Path $sdk "build-tools") -Directory |
  Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
$zipalign = Join-Path $buildTools.FullName "zipalign.exe"
& $zipalign -c -P 16 -v 4 $apk
if ($LASTEXITCODE -ne 0) { throw "APK ZIP 16KB 정렬 검사에 실패했습니다." }

$ndk = Get-ChildItem -LiteralPath (Join-Path $sdk "ndk") -Directory |
  Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
$readelf = Join-Path $ndk.FullName "toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-readelf.exe"
$extract = Join-Path $work "apk"
Copy-Item -LiteralPath $apk -Destination (Join-Path $work "universal.zip")
Expand-Archive -LiteralPath (Join-Path $work "universal.zip") -DestinationPath $extract
$soFiles = @(Get-ChildItem -LiteralPath $extract -Recurse -Filter "*.so")
if ($soFiles.Count -eq 0) { throw "검사할 네이티브 .so를 찾지 못했습니다." }
$elfFailures = @()
foreach ($so in $soFiles) {
  $loadLines = @(& $readelf -lW $so.FullName | Where-Object { $_ -match '^\s*LOAD\s' })
  if ($LASTEXITCODE -ne 0 -or $loadLines.Count -eq 0) {
    $elfFailures += "$($so.FullName): LOAD header 없음"
    continue
  }
  foreach ($line in $loadLines) {
    $alignText = (($line.Trim() -split '\s+')[-1] -replace '^0x', '')
    if ([Convert]::ToInt64($alignText, 16) -lt 16384) {
      $elfFailures += "$($so.FullName): $line"
    }
  }
}
if ($elfFailures.Count -gt 0) {
  $elfFailures
  throw "ELF LOAD alignment가 16KB보다 작은 라이브러리가 있습니다."
}

$page16kSerial = Read-Host "승인된 Android 15+ 16KB 에뮬레이터 adb serial"
adb -s $page16kSerial install -r $apk
if ($LASTEXITCODE -ne 0) { throw "16KB 에뮬레이터 설치에 실패했습니다." }
$pageSize = (adb -s $page16kSerial shell getconf PAGE_SIZE).Trim()
if ($pageSize -ne "16384") { throw "실행 기기의 PAGE_SIZE가 16384가 아닙니다: $pageSize" }
adb -s $page16kSerial shell am start -W -n com.hyeni.calendar/.MainActivity
if ($LASTEXITCODE -ne 0) { throw "16KB 에뮬레이터 실행 확인에 실패했습니다." }
```

`dump config=PAGE_ALIGNMENT_16K`, `zipalign exit 0`, 모든 `.so`의 모든 ELF `LOAD` alignment가 `0x4000` 이상, `getconf PAGE_SIZE=16384`, 앱 시작·로그인 전 화면 crash 0건을 각각 기록한다. 하나라도 없으면 AAB 승인을 보류한다.

| 16KB 증거 | 실제 결과 |
|---|---|
| local debug bundletool dump config | `PAGE_ALIGNMENT_16K` 통과 |
| local debug universal APK zipalign `-P 16` | 통과 |
| local debug 전체 ELF LOAD 검사 | native library 4개·LOAD 9개·최소 alignment 16,384·전체 통과 |
| clean 서명 release/Play 산출물 정적 검사 | 미실행 — 최종 서명 release AAB 없음 |
| 16KB 런타임·앱 시작 | 미검증 — A17은 4096, 승인된 16384 기기 필요 |

## 5. Play Console 기본 등록

### 5.1 앱과 트랙

- 앱 이름: `혜니캘린더 - 우리 가족 일정과 아이 안전`
- 기본 언어: 한국어(대한민국)
- 앱/게임: 앱
- 무료/유료: 무료, 인앱 구독 있음
- 카테고리: 육아 또는 라이프스타일 중 실제 포지셔닝에 맞게 선택
- 지원 이메일: `mail@hyenicalendar.com` — 실제 송수신 확인
- 개인정보처리방침: `https://hyeni-calendar-api.tkisdroid.workers.dev/privacy`
- 데이터 삭제: `https://hyeni-calendar-api.tkisdroid.workers.dev/data-deletion`

Play App Signing을 사용하고 최신 AAB는 내부 테스트 트랙에 먼저 업로드한다. pre-launch report와 기기 카탈로그 경고를 확인한 뒤 비공개 테스트로 승격한다. 2023-11-13 이후 생성한 개인 개발자 계정이라면 공식 기준상 최소 12명이 14일 연속 opt-in한 비공개 테스트 뒤 프로덕션 접근을 신청한다. 기존 개인 계정·조직 계정에는 이 조건을 임의 적용하지 말고, 실제 계정의 Play Console 대시보드에 표시되는 요구사항을 정본으로 기록한다.

소셜 로그인 callback은 임의 앱이 가로챌 수 있는 custom scheme이 아니라 정확한 HTTPS App Link `https://hyeni-calendar.pages.dev/oauth/callback`만 사용한다. 로컬 debug 설치 검증용 인증서와 Play App Signing 인증서는 서로 다르므로 다음 순서를 지킨다.

1. Play Console의 앱 무결성 화면에서 **App signing key certificate SHA-256**을 복사한다. 업로드 키 인증서 지문을 대신 사용하지 않는다.
2. `public/.well-known/assetlinks.json`의 인증서 배열을 Play App Signing 지문으로 교체하고 debug 지문은 출시 파일에서 제거한다.
3. Pages에 재배포한 뒤 파일이 리디렉션 없이 HTTPS 200·`application/json`으로 응답하는지 확인한다.
4. Play 내부 테스트에서 A17에 설치한 빌드로 `adb -s RFKL40DP73J shell pm verify-app-links --re-verify com.hyeni.calendar`와 `adb -s RFKL40DP73J shell pm get-app-links com.hyeni.calendar`를 실행해 도메인이 `verified`인지 확인한다. serial 없는 `adb shell`은 사용하지 않는다.
5. 검증 전에는 소셜 로그인을 출시 준비 완료로 표시하지 않는다. custom scheme fallback이나 프로덕션 loopback callback을 다시 허용하지 않는다.

v1.2.0 A17 debug 설치본은 debug 인증서 지문으로 `hyeni-calendar.pages.dev: verified`를 확인했다. 이 결과는 역사적 링크 배선 증거일 뿐 v1.3.0이나 Play App Signing 인증서 증거가 아니다. 내부 테스트 AAB의 App signing key 지문으로 `assetlinks.json`을 교체하고 같은 명령을 다시 통과하기 전에는 출시 App Link 항목을 닫지 않는다.

v1.3.0 프로덕션 등록정보에는 아직 미완성인 선생님 모드를 기능으로 홍보하지 않는다. 실제 production bundle의 온보딩에는 부모·아이만 보이고 `/teacher/*` 직접 접근은 준비 안내 gate로 닫힌 상태를 유지한다. 정식 공개하려면 선생님 데이터·심사 계정·Data Safety·삭제 범위·역할별 E2E를 별도 승인한다.

### 5.2 앱 접근 권한

심사자가 만료되는 QR이나 1회용 OTP에 의존하지 않도록 별도 데모 가족을 준비한다.

- 반복 사용 가능한 데모 보호자 ID·비밀번호
- 데모 아이가 이미 연결된 상태의 접근 절차
- 부모 홈 → 일정 → 위치 → 오늘 경로 → 알림 → 메시지 → 설정 순서
- 위치·도착 기능의 별도 Android 데모 영상
- 주변 소리 듣기는 서버 승인 증표를 받은 `RemoteListenActivity`가 아이 탭 없이 자동 연결되며, 듣는 동안 아이 화면·알림에 계속 표시되고 1분 뒤 종료된다는 설명과 데모
- 유료 기능을 검토할 license tester 또는 테스트 구독 절차
- 실제 전화번호·아이 정보·실사용 페어링 코드·구매 토큰은 제공하지 않음

## 6. 스토어 문안·그래픽

긴 설명 정본은 `docs/store/play-listing.md`를 사용한다. 다음 표현은 금지한다.

- “항상 정확한 위치”, “즉시 전달”, “절대 놓치지 않는 알림” 같은 보장
- 기기 설정과 무관하게 “무조건 전체 화면”이라고 단정
- 오래되거나 부정확한 위치를 현재 위치·미도착으로 단정
- SOS·긴급 알림을 구독 혜택으로 표현
- 주변 소리 듣기가 아이 화면·알림 고지 없이 숨겨지거나 1분을 넘겨 계속된다고 오해할 표현
- AI가 항상 맞거나 전문가·긴급 서비스를 대신한다고 오해할 표현

| 자산 | 제출 전 요구 작업 |
|---|---|
| 앱 아이콘 | 512×512, Console 현재 PNG 규격과 파일 모드 확인 |
| 피처 그래픽 | 1024×500, JPEG 또는 24-bit 불투명 PNG |
| 휴대전화 스크린샷 | 1080×1920 권장, JPEG 또는 불투명 PNG, 4~8장 |

현재 `output/store-screenshots/` 초안은 업로드하지 않는다. 별도 데모 가족으로 부모 홈, 위치·정확도·마지막 확인 시각, 오늘 경로, 일정·준비물, 가족 메시지, 안전 알림, 아이 모드, 권한 안내를 다시 촬영한다. 확대 화면·상태바·알림창·이미지 메타데이터까지 PII가 없는지 확인한다.

## 7. Data Safety·법적 문서

### 7.1 전체 데이터 범주

상세 워크시트는 `docs/store/play-data-safety.md`를 사용한다. 최소한 다음 범주를 유형별로 검토한다.

- 이름, 이메일, 사용자 ID, 전화번호, 생년월일
- 정확한 위치, 백그라운드 위치, 저장 장소·주소
- 프로필·메시지 사진, AI 일정 분석 사진·텍스트
- 가족 메모·위치 공유·빠른 상태, 일정·준비물
- 아이가 AI 친구에 입력한 프롬프트·대화와 서버에 저장된 assistant 답변
- 주변 소리 음성, 음성 인식 입력과 인식 텍스트
- Usage Access 허용 뒤 앱이 자동 보고하는 설치된 앱 중 최근 많이 사용한 상위 5개의 packageName·사용 시간·최근 사용 시각, 잠금 해제·앱 상호작용 지표
- 배터리·네트워크·권한·알림 상태, 오류 진단
- 앱 설치 ID, FCM 토큰, 세션 ID
- 구매 내역·구독 상태

각 유형의 `수집`, `공유`, `필수/선택`, `일시 처리`, `목적`을 별도로 답한다. 위치·마이크·사용정보 권한 거부가 가능한데 앱 전체에 필수라고 표시하거나, 일시 처리 음성과 저장되는 감사 메타데이터를 같은 방식으로 답하지 않는다.

### 7.2 외부 처리와 서비스 제공자 예외

Cloudflare, Firebase/FCM, Google Play, Toss Payments, Google·Kakao·Naver OAuth, Kakao 지도·모빌리티, 공개 OSRM, OpenAI, Resend, NCP SENS, Android `SpeechRecognizer`·Web Speech 제공자가 데이터를 처리할 수 있다. Toss에는 주문번호·금액·통화·상태와 customer/billing/payment 식별자가 전달되며 카드번호·유효기간·CVC는 Worker가 받지 않는다. “판매하지 않음”과 “외부 처리가 없음”은 다르다.

각 업체의 DPA, 보관, 삭제, 국외 이전, 2차 이용, 학습 설정, 개발자 지시 범위를 확인해 Play의 서비스 제공자 예외 적용 여부를 결정한다. 예외가 확인되지 않은 데이터 유형은 “공유하지 않음”으로 확정하지 않는다. 코드에 업체명이 있다는 사실만으로 계약 증거를 대신하지 않는다.

Android `SpeechRecognizer`와 Web Speech는 OS·브라우저·제공자 설정에 따라 외부 처리 가능성이 있다. 음성이 항상 단말 안에서만 처리된다고 안내하지 않는다. 앱 서버가 인식 텍스트를 받는 처리와 단말·브라우저 음성 서비스의 처리를 개인정보처리방침에서 구분한다.

### 7.3 개인정보처리방침·연락처

공개 개인정보처리방침은 다음을 모두 포함해야 한다.

- AI 친구 대화뿐 아니라 AI 일정 사진·텍스트, AI 요약 처리
- SpeechRecognizer/Web Speech 외부 처리 가능성
- 가족 메시지·사진·일정 UGC와 신고·차단·조치 절차
- 위치·앱 사용정보 모니터링의 자녀 보호 목적, 권한 해제 방법
- 주변 소리는 서버 승인 증표를 1회 확인한 뒤 아이 탭 없이 자동 연결되고, 최대 1분 동안만 일시 처리하며 아이 화면·지속 알림·중지 동작·감사 메타데이터를 제공한다는 사실
- 아동 데이터의 가족 범위, 보관·삭제, 외부 처리업체
- 공식 문의 주소 `mail@hyenicalendar.com`

Play 지원 이메일, 개인정보 담당 연락처, 이용약관 연락처를 같은 운영 가능한 주소로 유지한다.

## 8. 위치·FGS·FSI·모니터링 선언

### 8.1 백그라운드 위치

Play Console 백그라운드 위치 선언 폼에는 **하나의 핵심 위치 기능**만 설명한다.

> 아이 기기가 앱 밖에 있어도 보호자에게 위치를 공유해 가족 안전 기능을 제공한다.

반면 앱의 prominent disclosure와 심사 영상에는 실제 위치 사용을 빠짐없이 보여 준다.

- 현재 위치와 오늘 경로
- 집·학교·학원 도착·출발
- 일정 미도착 확인
- 위험 장소 진입 알림
- 앱을 닫거나 사용하지 않을 때의 위치 수집과 보호자 공유
- 전경 권한을 먼저 받고 별도 설명·사용자 동작으로 백그라운드 권한 요청
- 거부·회수 시 앱은 열리지만 제한되는 기능 안내

선언 폼에 여러 핵심 기능을 병렬 나열하는 것과 prominent disclosure에서 실제 사용을 누락하는 것 모두 피한다.

### 8.2 Foreground Service 3종

최종 merged manifest를 기준으로 다음 세 유형을 Play Console에 각각 선언하고 실제 기능 영상을 준비한다.

| 유형 | 선언·영상에 포함할 내용 |
|---|---|
| `FOREGROUND_SERVICE_LOCATION` | 아이 위치 공유 시작 조건, 자녀 보호 핵심성, 지속 알림·고유 아이콘, 지연·중단 시 위치·도착 기능 제한 |
| `FOREGROUND_SERVICE_MICROPHONE` | 부모 요청 → 서버 승인 증표 1회 소비 → `RemoteListenActivity` 준비 시 자동 연결 → 최대 1분, 아이 화면·지속 알림·감사 기록, 권한 거부·중단 영향 |
| FGS `specialUse` | `emergency_parental_alert`의 구체적 목적, 사용자에게 보이는 알림, 지연·중단 영향 |

2026-08-26 시행 예정 정책 미리보기에는 geofencing이 승인 FGS 용도에서 제외되고 Geofence API 사용이 안내되어 있다. 제출일이 시행일 이후이거나 심사 화면이 새 기준을 적용하면, 연속 위치 공유라는 핵심 FGS 기능과 도착·출발 지오펜스 트리거를 분리해 설명하고 구현 전환 필요성을 다시 판단한다. 시행 전이라는 이유로 해당 변경을 무시하거나, 지오펜스만을 location FGS의 유일한 사용 사유로 제출하지 않는다.

| 기한 | 담당 | 완료 증거 |
|---|---|---|
| 2026-08-12 | Android 기능 담당 | 등록장소·일정 도착 감지에서 연속 위치 FGS와 지오펜스 용도를 분리한 코드·전력·정확도 영향 검토서 |
| 2026-08-19 | Play 출시 담당 | 2026-08-26 기준으로 제출할 FGS 선언 문안·시연 영상과 Geofence API 전환 여부 승인 기록 |
| targetSdk 37 전환 2주 전 | Android 기능 담당 | Android 17의 일회성 정밀 위치는 위치 버튼을 사용하고, 지속 정밀·백그라운드 위치만 별도 정당화한 권한 매트릭스 |

Android 17(API 37) 이상을 대상으로 올리는 시점에는 2026-10-28 시행 예정 위치 최소 범위 정책을 다시 적용한다. 현재 targetSdk 36 빌드의 즉시 제출 차단 조건은 아니지만, 일회성 사용자 동작에 정밀 위치가 필요한 화면은 Android 위치 버튼으로 전환하고 지속 정밀 위치가 핵심인 자녀 추적 기능은 별도 선언·심사 증거를 준비하기 전 targetSdk 37로 올리지 않는다.

HTTP 성공이나 FCM 수신만 보여 주지 말고 사용자가 실제로 보는 알림, 서비스 시작·중지, 권한 거부·중단 영향을 영상에 담는다.

### 8.3 전체 화면 인텐트

혜니캘린더는 **전화·알람 앱이 아님**을 전제로 한다. `USE_FULL_SCREEN_INTENT`를 전화·알람 앱의 자동 허용 대상처럼 선언하지 않는다.

- 사용자가 Android 특별 접근 권한을 직접 허용·회수하는 흐름 확인
- 허용 시 SOS·emergency·위험구역 진입처럼 검증된 긴급 안전 경로의 수신 보조가 동작하는지 확인
- 미허용·정책 제한 시 높은 중요도의 heads-up 알림으로 강등
- 일정·일정 리마인더·메모·미도착·missed arrival·위험구역 이탈은 payload의 urgent/severity 값과 무관하게 전체 화면으로 승격하지 않음
- 소리 울리기와 위급 주변소리처럼 사용자가 명시적으로 시작한 별도 전체 화면 경로는 유지하되 일반 알림의 긴급 분류 범위를 넓히지 않음
- 전체 화면 불가 상태를 알림 유실로 만들지 않음

### 8.4 자녀 모니터링·사용정보

- merged manifest의 `isMonitoringTool=child_monitoring`을 확인한다.
- 스토어 긴 설명과 prominent disclosure에 자녀 보호 목적의 위치 및 최근 많이 사용한 앱 상위 5개의 packageName·사용 시간·최근 사용 시각이 자동 보고됨을 공개한다. “사용자가 선택한 앱만 수집”한다고 쓰지 않는다.
- 위치·마이크 foreground service 실행 중 지속 알림과 기능별 고유 아이콘을 표시한다.
- `PACKAGE_USAGE_STATS`는 앱 안에서 목적을 설명한 뒤 사용자가 Android 설정에서 직접 허용한다.
- 주변 소리 듣기는 FCM·pending 수신만으로 시작하지 않고 서버 승인 증표·세션 nonce·가족·대상 일치를 확인한 `RemoteListenActivity`에서만 시작한다. 준비 상태에서는 허용/거절 탭을 요구하지 않고 자동 연결하되, 아이 화면과 잠금·꺼짐 화면 알림에 듣는 중임을 숨기지 않으며 1분 상한과 감사 기록을 유지한다.
- 모니터링이 숨겨져 있거나 알림을 제거할 수 없는 것처럼 보이는 문구·영상·아이콘을 사용하지 않는다.

### 8.5 일정 알림·전화 최소 권한

일정 알림의 정본은 사용자별 설정을 적용하는 서버 cron이며, JS에서 네이티브 예약 알림 API를 호출하지 않는다. 위치 서비스 재시작·heartbeat와 레거시 예약 데이터 복구는 정확한 시각을 보장할 필요가 없는 보조 경로이므로 inexact alarm과 15분 WorkManager를 사용한다. 따라서 정확한 알람 특별 권한은 manifest에서 제거했으며, 앱에서 해당 특별 접근 설정을 요구하거나 전달 준비 상태를 낮추지 않는다.

`CALL_PHONE`은 아이가 명시적으로 누른 보호자 전화 연결에만 사용한다. `ACTION_DIAL`만으로 같은 기능을 제공할 수 있는지 확인하고, 직접 발신이 꼭 필요한 경우가 아니면 권한을 제거한다. 최종 merged manifest와 기능 영상을 기준으로 최소 권한 검토 기록을 남긴다.

## 9. AI 생성 콘텐츠·UGC 출시 게이트

### 9.1 AI 답변 신고

코드와 자동 회귀 테스트에서 다음 항목을 확인했다. 체크된 항목도 실제 아이 화면과 운영 큐 E2E를 대신하지 않는다.

- [x] 모든 AI assistant 답변 버블에서 앱을 나가지 않고 `이 답변 신고` 가능
- [x] 이유 선택, 선택 상세, 전송 중, 실패·재시도, 완료 상태 제공
- [x] 새로 생성된 답변도 안정적인 서버 message ID로 신고
- [x] 서버가 인증 사용자, 가족, 아이, assistant 메시지 소유권을 직접 검증
- [x] D1에 먼저 영속 저장하고 중복 신고는 멱등 처리
- [ ] `status='new'` 운영 큐에서 담당자가 검토·조치·회신
- [x] 아이 완료 문구가 실제 동작보다 과장하지 않음
- [ ] 실제 아이 세션에서 신고하고 운영 큐 반영까지 E2E

### 9.2 가족 메모 신고·사용자 차단

- [x] 메시지·사진·위치 UGC에서 앱 내 신고 가능
- [x] 본인 메시지 신고 차단, 정확한 가족·아이 스레드 권한 검증
- [x] 차단 뒤 1:1 메시지 전송·조회·실시간·푸시가 양방향 정책대로 차단
- [x] 사용자 차단이 SOS·위험·위치 안전 알림이나 가족 연결을 끊지 않음
- [x] 차단 해제와 보호자 관리 흐름 제공
- [ ] 신고·차단·운영 조치를 D1·브라우저·Android에서 E2E 확인

### 9.3 UGC 약관·운영

UGC 전송 전에 이용약관 동의를 받고 다음을 명시한다.

- 성적·폭력적·불법·괴롭힘·따돌림·개인정보 탈취·아동 위해 콘텐츠 금지
- 메시지·사용자 신고와 차단 방법
- 신고 검토, 콘텐츠·계정 제한, 이의 제기와 연락처
- 아동이 불편한 콘텐츠를 보호자 또는 운영자에게 알리는 방법
- 신고 큐 담당자, 처리 우선순위, 증거 보존, 회신 기준

AI 답변 신고, 메모 신고, 사용자 차단, UGC 약관의 코드·자동 테스트·실제 양방향 E2E·운영 큐 중 하나라도 미확인이면 제출 차단 상태를 유지한다. A17 부모·razr 아이의 기존 세션으로 화면 경로만 읽기 검증했으며 신고·차단 mutation, API·D1 결과, 네이티브 FCM·pending 표시 ACK, 백그라운드 위치, 마이크 FGS, 앱 사용정보 보고는 실행하지 않았다. 따라서 이 E2E는 완료되지 않았다.

## 10. 대상 연령·Families·콘텐츠 등급

혜니캘린더는 보호자와 아이 모드를 함께 제공한다. 제품·정책 책임자가 실제 이용자를 근거로 **혼합 연령** 대상 여부와 구체적 연령 구간을 결정한다.

- 아이가 일정·대화·SOS·AI 기능을 직접 사용하므로 심사를 피하기 위한 성인 전용 선택을 하지 않는다.
- Families 정책상 아동만을 대상으로 하면 위치 권한 자체를 요청할 수 없고 정밀 위치를 수집·사용·전송할 수도 없다. 따라서 현재 정밀·백그라운드 위치 기능을 유지한 채 아동 전용으로 제출하지 않는다. 실제 보호자+아동 혼합 제품의 대상 연령과 데이터 흐름을 책임자가 확정한다.
- 아동 연령을 포함하면 Families 정책, SDK 적격성, 아동 데이터 공개, AI·UGC 안전조치를 함께 확인한다. 아이 또는 연령 미확정 흐름에서 Kakao 지도·경로, 공개 OSRM, OpenAI, FCM, OAuth, 음성 인식 등 승인되지 않은 API/SDK가 동작하지 않는다는 증거가 없으면 제출을 보류한다.
- 연령에 따라 SDK·데이터 처리를 달리한다면 중립적인 연령 확인 흐름과 우회 방지를 구현·검증하고, 입력된 생년월일을 광고·추적 회피 수단으로 사용하지 않는다.
- 실제 대상과 무관한 연령대를 정책 회피 목적으로 추가·제외하지 않는다.
- 결정한 연령 구간과 근거를 출시 기록에 남긴다.

IARC 등급은 미리 “3+”로 예상하거나 문서에 확정하지 않는다. AI 생성 콘텐츠, 가족 간 사용자 통신, 사진·위치 공유, UGC 관련 질문에 실제 기능대로 답하고 Console이 반환한 등급을 사용한다.

## 11. 구독·결제·RTDN·PWA Toss

### 11.1 Android Google Play 구독

상품 ID는 `hyeni_premium`이며 초기 출시 가격은 월 4,900원·연 39,000원이다. base plan ID 문자열로 가격을 추측하지 않고 Play Console과 Google Play 결제 화면을 정본으로 확인하며, 앱은 검증된 Play `formattedPrice`만 표시한다.

1. 월간·연간 base plan을 활성화한다.
2. Play가 현재 계정에 eligible로 반환한 정확한 7일 무료 pricing phase에만 체험 문구가 표시되는지 확인한다.
3. Android Publisher API를 활성화한다.
4. 서비스 계정에 필요한 최소 Play Console 구독 조회 권한을 부여한다.
5. Pub/Sub topic과 인증된 RTDN push subscription을 연결한다.
6. Worker secret 네 가지를 설정한다: 서비스 계정 JSON, 패키지명, RTDN audience, push service-account email.
7. license tester로 신규 구매, 체험, 갱신, 해지, grace, 복원, 중복 delivery를 검증한다.
8. `PENDING` 구매는 entitlement·크레딧을 열거나 acknowledge하지 않고, Google Play가 `PURCHASED`로 확정한 뒤에만 서버 검증을 진행한다.
9. Worker가 Google Play API로 상태를 재검증하고 설정 누락에서 503 fail-closed인지 확인한다. RTDN의 notification type만 믿지 않고 `purchases.subscriptionsv2.get` 결과를 정본으로 사용한다.
10. 완료된 구독이 미승인 상태면 서버가 acknowledge하고, Google Play의 3일 기한 안에 `acknowledgementState`와 D1 `acknowledged_at`이 완료되는지 확인한다. 클라이언트 acknowledge는 서버가 명시적으로 지시한 경우에만 보조로 사용한다.
11. 같은 RTDN·구매 검증을 재전달해도 entitlement·AI 크레딧·원장이 한 번만 반영되는지 확인한다.
12. 구매 토큰·order ID·서명 비밀번호가 로그·오류 응답·가이드에 포함되지 않는지 확인한다.

구독 검증·acknowledge·`PENDING` fail-closed와 RTDN 재검증 코드는 자동 테스트로 확인됐지만, 현재 Google Play/RTDN secret이 없고 license tester 실구매를 하지 않았으므로 운영 증거는 미완료다. Qonversion은 현재 결제 정본이 아니며 활성 결제 경로처럼 안내하지 않는다.

### 11.2 iPhone 홈 화면 PWA Toss 자동결제

iPhone 보호자는 홈 화면 PWA에서 월 4,900원·연 39,000원 Toss Payments 자동결제를 사용한다. 다음 항목을 순서대로 완료하기 전에는 웹 결제를 운영에 열지 않는다.

1. Toss Payments 자동결제 계약과 추가 위험 검토를 완료하고 같은 환경의 client/secret key를 발급받는다.
2. 운영 D1의 현재 스키마를 먼저 읽는다. 웹 결제 테이블이 전혀 없으면 체험 provider·키 폐기·금융 분리 정본까지 포함한 `web-billing.sql`만 적용한다. 기존 웹 결제 테이블이면 키 폐기 컬럼이 없을 때 `web-billing-key-revocation.sql`, `web_billing_trial_claims.provider`가 없을 때 `google-play-family-trial-claim.sql`, 금융 분리 테이블이 없을 때 `web-billing-financial-retention.sql`을 이 순서로 각각 한 번만 적용한다. 신규 base와 기존 DB용 additive를 같은 DB에 함께 적용하거나 additive를 재실행하지 않는다.
3. `TOSS_PAYMENTS_CLIENT_KEY`, `TOSS_PAYMENTS_SECRET_KEY`, `WEB_BILLING_KEY_ENCRYPTION_SECRET`을 저장소·명령 기록·로그에 남기지 않고 설정한다.
4. catalog가 KRW와 월 4,900원·연 39,000원만 반환하는지 확인한다. 금액·통화·주문·고객·상태가 하나라도 다르면 권리를 열지 않는다.
5. 해지 예약·기간 말 권리·자동 갱신·실패 대사·환불·계정 삭제 시 원격 billing key 폐기·중복 요청 멱등성을 sandbox와 live 전환 전 검증한다.
6. 가족별 `billing_provider_reservations`로 Google Play와 Toss의 동시 활성화를 막고, 미확정·충돌 결제는 자동 덮어쓰기나 재청구 없이 환불 필요 상태로 격리한다.
7. 최초 HTML meta, 실제 Pages 응답, 동적 Toss SDK script가 모두 `no-referrer`인지 확인하고 복귀 URL의 `authKey`·`paymentKey`가 정적 자산 요청 Referer나 외부 로그로 전파되지 않는지 브라우저 Network에서 검증한다.

Safari 또는 홈 화면 PWA가 결제사에서 복귀하는 동안 `sessionStorage`의 checkout 문맥을 잃어도 클라이언트 값으로 권리를 열지 않는다. 인증된 Worker resolver가 현재 사용자 소유권·금액·통화·주문 상태를 모두 대조한 뒤에만 구독 복귀를 복구하며, 이 경로를 sandbox의 sessionStorage-loss 시나리오로 별도 검증한다.

migration·secret·계약 중 하나라도 빠지면 신규 결제 운영 제어를 OFF로 유지해 catalog·checkout을 503으로 fail-closed하고 프리미엄 권리를 열지 않는다. 운영 제어 OFF 자체는 이미 시작된 주문의 complete·reconcile과 기존 구독의 cancel·refund를 막지 않지만, 해당 처리에 필수인 schema·secret이 실제로 없으면 각 endpoint는 별도로 fail-closed한다. 카드번호·유효기간·CVC는 Worker가 받지 않고 `authKey`는 저장하지 않으며, `billingKey`는 AES-256-GCM 암호문만, `paymentKey`·Google Play purchase token은 비가역 해시만 저장한다. Toss 후속 결제·조회가 같은 값의 재사용을 요구하므로 사용자·가족 정보 없이 서버 난수로 생성한 `customerKey`만 운영 checkout/customer/order 행에 원문 보관한다. `customerKey`를 포함한 결제 키는 로그·응답 진단·계정 삭제 후 분리 금융 정본에 남기지 않는다.

### 11.3 친구 초대·구독·AI 크레딧 금융 보존

- 친구 초대는 양쪽 가족에 AI 대화 10회씩 한 번만 지급하고, 추천인 가족 평생 최대 3가족·신규 가족 72시간·첫 실제 위치 후 48시간 유지 조건을 서버가 검증한다. 클라이언트 지급 endpoint를 만들지 않는다.
- `ai-credit-balance-uniqueness.sql`과 `referral-rewards-v2.sql` 적용·readback·cron 지급 E2E 전에는 추천 기능을 운영 완료로 표시하지 않는다.
- Toss AI 크레딧 가격은 승인한 환경값이 있는 팩만 노출하며 보고서에 없는 가격을 임의 하드코딩하지 않는다.
- AI 크레딧 결제 복귀에서도 `sessionStorage` 유실을 실패나 성공으로 추정하지 않는다. 인증된 Worker resolver가 소유권·팩 수량·금액·통화·주문 상태를 모두 대조한 뒤에만 복구하고 sandbox에서 검증한다.
- `ai_parent_settings`는 `(family_id, child_user_id)` UNIQUE와 원자 `ON CONFLICT` upsert로 한 아이의 활성값·이름·한도를 한 행에 유지한다. 중복을 발견한 fail-closed migration은 행을 삭제하거나 임의 병합하지 않고 운영자 정규화 전 배포를 중단한다.
- 신규 DB의 웹 AI 주문은 금융 분리 컬럼이 포함된 `web-ai-credit-billing.sql`만 적용한다. 기존 `web_ai_credit_orders`에 `record_scope`가 없을 때는 base 대신 `web-ai-credit-financial-retention.sql`을 정확히 한 번 적용한다. 구독 금융 정본은 신규 DB의 `web-billing.sql`, 기존 DB의 `web-billing-financial-retention.sql` 중 현재 스키마에 맞는 하나만 사용한다.
- 미승인·실패 AI 주문은 30일 뒤, 승인·전액 환불 AI 정본과 결제 완료·체험 이력의 최소 구독 정본은 5년 뒤 정리한다. `unknown`·`refund_unknown`과 결제사 대사가 끝나지 않은 구독 주문은 자동 삭제하지 않는다. 계정·가족 관계 삭제 시 원시 사용자·가족·결제 키를 제거하고 최소 금융 스냅샷과 잔액을 운영 데이터에서 분리하며 새 계정에 자동 합치지 않는다.
- 위 보존·삭제·환불 절차와 위치 확인자료 보존은 공개 개인정보처리방침·이용약관·내부 운영 절차 및 전문 법률 검토와 일치해야 한다.

## 12. 최종 실사용 검증

### 12.1 A17 부모·razr 아이 모드

- 기존 앱 데이터 삭제 없이 A17 부모에 `adb -s RFKL40DP73J install -r android/app/build/outputs/apk/debug/app-debug.apk`
- 기존 앱 데이터 삭제 없이 razr 아이에 `adb -s ZY22H9VTQD install -r android/app/build/outputs/apk/debug/app-debug.apk`
- `/api/family/mine` familyId와 WebView local session familyId 일치
- 부모 홈 활성 아이, 기기 상태, 위치 마지막 확인 시각
- 현재 위치 지도 로딩과 실패·재시도·오래된 위치 문구
- 오늘 경로 지도·경로·머문 곳 접기·펼치기
- 일정 목록·상세·등록·수정·삭제 후 테스트 데이터 정리
- 명시적 아이 스레드, 메모 전송 즉시 표시, 실패 재시도, 읽음
- 알림함의 정확한 대상 화면 이동·읽음·pending ACK
- 설정의 약관·개인정보·회원 탈퇴·권한 경로
- Android logcat과 WebView Console에 crash, uncaught error, 반복 401/403/5xx가 없는지 확인

2026-08-02 KST 현재 exact 후보 APK는 13,092,876 bytes, SHA-256 `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873`다. 설치 전 `adb start-server`를 실행한 뒤 승인된 A17과 razr를 exact serial로 확인했지만 두 기기 모두 `device not found`여서 `install -r`와 후속 검증을 수행하지 못했다. 역할 전환·로그아웃·재페어링·refresh token 접근은 없었고 S25는 설치·실행·로그·세션 조회를 포함해 접근하지 않았다. 직전 SHA-256 `f0c697…` APK의 A17 부모 UI 통과·razr secure keyguard/Dozing 차단·aggregate 종료 이력은 역사 기록으로만 보존하며 현재 exact 후보의 증거로 재사용하지 않는다.

| v1.3.0 실기기 증거 | 결과 |
|---|---|
| 현재 A17 연결 | `adb start-server` 뒤 `adb -s RFKL40DP73J get-state`가 `device not found` · 현재 exact APK 미설치 |
| 현재 razr 연결 | `adb -s ZY22H9VTQD get-state`가 `device not found` · 현재 exact APK 미설치 |
| 현재 exact 후보 검증 | 설치·version·role·session·UI·network·Java crash·native crash·ANR 모두 미검증 |
| 직전 후보 역사 기록 | SHA-256 `f0c697…` APK는 A17·razr에 `install -r`됐고 A17 부모 9개 화면 UI를 통과했다. razr 전면 아이 UI는 secure keyguard·Dozing으로 차단됐고 `artifacts/release-evidence/android-exit-summary-20260802-104300.json`의 aggregate 종료 이력은 양쪽 Java crash·native crash·ANR 각 0이었다. 이 기록은 현재 exact 후보 완료 증거가 아니다 |
| 직전 후보 네트워크 기록 | 양쪽 `/api/realtime/ticket` 404, A17 `/api/premium-funnel/events` 404의 **historical compatibility HOLD**였다. 현재 exact 후보에서 재관측하지 못했으므로 현재 network 성공·실패로 단정하지 않는다 |
| 재검증 조건 | A17·razr가 exact serial로 다시 연결되면 같은 SHA-256 `62b66c…` APK를 `install -r`한 뒤 version 1.3.0(5), 역할·세션 보존, UI·Console/Network·crash/ANR를 확인한다. 필요한 D1 migration과 신규 Worker를 선행 배포·readback한 뒤 직전 404 경로도 다시 확인한다. razr의 잠금·Dozing은 우회하지 않는다 |
| 미수행 범위 | 네이티브 푸시/pending ACK·원격제어·백그라운드 위치·마이크·Usage Access·실결제·App Link 재검증 |

### 12.2 배포 브라우저

- 배포 URL의 데스크톱과 360×800 모바일 뷰포트
- 새로고침·뒤로가기·HashRouter 경로 유지
- 지도 SDK·타일·API 실패 재시도·로딩 skeleton
- Web Push 지원·권한·서비스워커 표시 ACK·현재 계정 endpoint 상태
- 네트워크 차단·빈 데이터·오래된 데이터에서 가짜 최신 상태를 표시하지 않음
- 접근 가능한 이름, 키보드 focus, 44px 수준 터치 영역, reduced motion
- AI 신고, 메모 신고, 사용자 차단의 전송·실패·완료 상태
- 격리 브라우저의 데모 아이 세션에서 `#/child/ai-friend`, `#/child/memo`를 열고 A17 부모 화면과 양방향 Web UI·API·D1 상태 교차 확인
- Console error와 예상하지 않은 network 실패 0건

2026-07-14 프로덕션 브라우저 검증은 새 비로그인 컨텍스트에서 수행했다.

| 브라우저 실제 확인 | 결과 |
|---|---|
| Pages 온보딩 | 1440×900·360×800 모두 HTTP 200, overflow 0, Console error/warning 0 |
| 선생님 production gate | 역할 카드·선생님 문구 비노출, `#/teacher/home`은 `#/onboarding`으로 안전 전환 |
| 정적 자원 | 관측 요청 200/304, 예상하지 않은 실패 0 |
| `/privacy`·`/terms`·`/data-deletion` | 두 뷰포트 모두 200, overflow 0, Console error/warning 0, 최신 문구 확인 |
| `/favicon.ico` | cache 없는 새 컨텍스트에서 200 SVG, 240 bytes, Console error 0 |

아래 내용은 2026-08-02 현재 exact local production dist를 새 격리 컨텍스트에서 검증한 최신 로컬 증거다. 브라우저 machine evidence는 `artifacts/release-evidence/browser-qa/20260802T141931-final-21fd847/report.json`, Chromium PWA runtime evidence는 `artifacts/release-evidence/pwa-runtime-qa/20260802T141931-final-21fd847/report.json`이다. 로컬 결과는 아직 배포되지 않은 Pages나 실제 iPhone 증거를 대신하지 않는다.

| v1.3.0 현재 로컬 후보 브라우저 | 결과 |
|---|---|
| 후보 bundle | 414파일·tree SHA-256 `21fd847bd3b5e64d71beaa329155d3273ac8d5bfdaa2dc87b24d63356dd6c1e5`, index SHA-256 `c4a51f17136795d0eba64467c77d965614cf5964381b78d1796072be3d8b616a` |
| 전수 화면 | 부모 42/42·아이 14/14, 문제·crash 0 |
| Free/Premium 가격·정책 | 월 4,900원 2회·연 39,000원 1회, Free/Premium·새 아이 1↔2·SOS 무료·다운그레이드 보존 확인. fail-closed CTA disabled·추정 가격 0·무료 유지 확인 |
| 저장 장소·업셀·복귀 | 3개 중 active 2·premium-required 1·unknown 0, 업셀 3/2·무료 계속·upgrade, `saved_place`와 `saved_places`의 `/place-form` returnTo 복귀와 intent clear 확인 |
| 선생님 production gate | v1.3.0 production gate 확인 |
| overflow·깨진 이미지·44px 조작부 | 모두 0 |
| Console·Network | 모두 0 |
| bundle 예산 | entry JS 479,697/500,000 bytes, 초기 CSS 30,849/40,000 bytes, PWA precache 320개·중복 0 |
| Chromium PWA runtime | install·control, 실제 offline reload·uncached probe 차단, waiting Worker 활성화·실제 `controllerchange`·문서 reload, 문제 0. `registerType: prompt`의 중요 작업 보호형 업데이트로 결제·대사·주변 소리·mutation·미저장 입력 중 reload를 보류 |
| WebKit smoke | PASS. 실제 iPhone Safari·홈 화면 PWA 증거는 아님 |
| Lighthouse | v1.3.0 final SHA 미측정 |

브라우저 QA가 통과해도 인증된 부모·아이 운영 화면, 지도 실패 재시도, Web Push, AI·메모 신고·차단과 아이 네이티브 증거를 대신하지 않는다.

### 12.3 Android 16 대화면·회전

targetSdk 36 앱은 Android 16의 `sw600dp` 이상 대화면에서 manifest의 세로 고정이 무시될 수 있다. A17 세로 화면과 브라우저 360×800 검증은 네이티브 대화면 검증을 대신하지 않는다. 승인된 Android 16(API 36) 태블릿 또는 폴더블 에뮬레이터에서 다음을 모두 확인하고 실제 결과를 아래 표에 남긴다.

- `sw600dp` 이상에서 세로·가로 회전, 자유 크기 조절, 분할 화면, 폴더블 펼침·접힘
- 부모 홈·캘린더·지도·오늘 경로·메모·설정에서 잘림, 겹침, 빈 화면, 터치 불가 0건
- 회전·크기 전환 뒤 로그인 세션, 활성 아이, 선택 날짜, 입력 중 메시지, 지도 선택 상태가 의도대로 보존
- 지도 SDK·WebView가 재생성되어도 동일 조회·mutation이 중복 실행되지 않고 Console crash 0건

| 대화면 증거 | 실제 결과 |
|---|---|
| API 36·`sw600dp` 기기 정보 |  |
| 세로·가로·분할 화면 |  |
| 폴더블·크기 변경 상태 보존 |  |
| crash·중복 요청 |  |

### 12.4 서버·D1 교차 확인

- 알림은 수신자별 pending 생성 뒤 실제 표시 ACK 전에는 delivered로 완료되지 않음
- AI·메모 신고는 인증·가족·아이·message ID 검증 뒤 durable 저장
- 중복 신고가 중복 행이나 사용자 오류를 만들지 않음
- 사용자 차단이 메시지 채널에만 적용되고 SOS·안전 채널은 유지
- 신고 운영 큐에 `new` 상태가 보이고 담당자가 처리 상태를 변경 가능
- 테스트로 만든 일정·메모·신고·차단 설정을 승인된 절차로 정리

현재 운영 D1에는 storage 일일·가족 quota, 익명 가입 보호, unpair cleanup, 계정·스토리지 mutation, multipart journal, 메모 outbox·interaction lease, feedback delivery safety additive migration을 적용했다. 마지막 확인 bookmark는 메모 interaction lease `00000044-0000004a-000050a7-684181d54cf4a6e3f217807d2b644640`, feedback safety `00000044-00000050-000050a7-d8a71656dd2c443d70ea06946fb501e2`다. PRAGMA readback에서 요구 컬럼·인덱스를 확인했고 당시 stale lease와 `feature_feedback/queued` 행은 각각 0이었다.

위 문단은 당시 적용 이력이다. 2026-08-02 12:02 KST의 최신 v1.3.0 출시 preflight는 운영 D1을 변경하지 않는 단일 SQL로 다시 측정했다. 출시 필수 객체 25개 중 2개만 존재하고 23개가 누락됐으며, `ai_credit_balances` 중복은 1그룹·6행이라 migration 병합 시 5행 삭제가 필요하다. `ai_parent_settings` 중복은 0이지만 exact unique index가 없고, 퍼널 source readback은 `has_ai_friend_limit_source=0`, `has_ai_schedule_limit_source=0`이다. `google_play_purchase_events.debt_applied`, `web_billing_charge_attempts.refund_status`, `web_billing_charge_attempts.customer_key`, `web_ai_credit_orders.record_scope`도 모두 없었다. 응답 메타는 `changes=0`, `changed_db=false`, `rows_written=0`이며 원본 집계 증거는 `artifacts/release-evidence/d1-readonly-preflight-20260802-120214.json`이다. 기존 퍼널 테이블은 전용 forward migration을 정확히 1회 적용하고 최종 두 source readback이 모두 1인지 확인해야 하며, 그 전에는 HOLD다. 이는 쓰기 승인이나 migration 완료 증거가 아니다.

`queued=0`은 자동 재전송기가 있다는 뜻이 아니다. `RESEND_API_KEY`가 없는 현재 상태에서 새 기능 제안은 durable D1 큐로 202 접수되므로 운영 담당자·확인 주기·처리 SLA를 정하기 전에는 출시 운영 게이트를 닫는다.

## 13. 출시 당일·단계적 출시·롤백

### 출시 직전 기록

- Git 최종 commit과 원격 branch
- Worker 배포 버전과 Pages 배포 ID
- AAB SHA-256, 파일 크기, mtime, versionCode
- privacy/terms/data-deletion HTTPS 200과 갱신일
- health, RTDN 설정, license tester 결제 결과
- AI·UGC 신고 큐 담당자와 대응 연락망
- `mail@hyenicalendar.com` 송수신 결과
- PII 없는 스토어 자산 최종 육안 검토
- Play Console Data Safety·위치·FGS·FSI·모니터링·대상 연령 제출 화면 캡처
- `hyeni-launch-approval` schema v1 manifest의 exact app·Worker commit, 12시간 이내 외부 증거, 주·대체 담당자와 파일 SHA-256
- 신규 웹 구독·웹 AI 크레딧 운영 제어가 둘 다 OFF인 D1 readback과 사고 시 OFF 복구 담당자

`hyeni-launch-approval`이 모든 필드를 통과해도 결과는 `READY_FOR_HUMAN_GO_REVIEW`다. 운영·정책 책임자가 동일 SHA·외부 증거·롤백 수단을 직접 확인해 `GO`를 승인하기 전에는 배포하거나 rollout을 확대하지 않는다.

### 첫 60분 자동 판정

상세 실행 명령은 `docs/release/release-day-rollback-runbook.md`와 `C:\Users\TK\Desktop\hyeni-3\worker\ops\first-hour-observability.md`·`C:\Users\TK\Desktop\hyeni-3\worker\ops\first-hour-queue-trend.md`를 정본으로 사용한다.

- 새 Worker version의 최근 5분 5xx를 5분마다 aggregate-only로 확인한다. **5xx 5건 이상이면서 해당 구간 전체 요청의 1%를 초과할 때만** `ROLLBACK_REQUIRED`다. 전체 요청이 0건이면 `INCONCLUSIVE`이며 정상으로 간주하지 않고 출시 확대를 HOLD한다.
- 긴급 pending 2분 초과, due memo outbox, retryable RTDN, 웹 구독·환불·AI 크레딧 대사 큐를 T-10·T+30·T+45·T+60에 DB 시각과 고정 count만 있는 create-only JSON으로 저장한다. 사용자·가족·아이·메모·주문·결제 key/token·원문 행은 반환하거나 저장하지 않는다.
- 시간순 스냅샷 3개 이상에서 같은 큐가 두 관측 구간 연속 엄격히 증가할 때만 `ROLLBACK_REQUIRED`다. 단일 증가·정체·감소는 큐 추세 `HEALTHY`이고, 파일 누락·형식 오류·시각 역전·stale 증거는 `INCONCLUSIVE`로 HOLD한다.
- 5xx 또는 큐가 `ROLLBACK_REQUIRED`이면 신규 rollout을 중단한다. 결제 영향이 의심되면 신규 웹 구독과 신규 웹 AI 크레딧 운영 제어를 둘 다 OFF로 원자 저장하고 readback하되, 기존 주문 완료·대사·해지·환불은 계속 처리한다.
- `HEALTHY`는 해당 자동 판정 하나만 통과했다는 뜻이다. 세션·가족 격리·entitlement·SOS/긴급 표시 ACK·crash/ANR과 사람의 최종 `GO`를 대신하지 않는다.

### 단계적 출시

내부·비공개 테스트가 안정된 뒤 소규모 단계적 출시를 사용한다. crash, ANR, 로그인 실패, 위치 업로드 401, push delivery 실패, 결제 검증 5xx, 신고 저장 실패와 차단 우회를 우선 관찰한다.

### 확대 중단 기준

- 아이 세션 로그아웃 또는 가족 범위 혼선
- 다른 가족·다른 아이 데이터 노출
- SOS·위험 알림 유실 또는 일반 알림의 잘못된 긴급 승격
- 오래된 위치를 현재 위치처럼 표시
- 주변 소리 듣기가 서버 승인 증표·`RemoteListenActivity` 없이 시작되거나, 아이 화면·알림 고지가 누락되거나, 1분 상한·감사 기록을 지키지 않음
- AI·메모 신고 유실, 신고 큐 미운영, 차단 우회
- 결제 검증 실패가 프리미엄을 여는 fail-open
- crash·ANR·지속적인 401/403 증가 또는 동일 새 Worker version의 rolling 5분 5xx가 5건 이상이면서 요청의 1%를 초과
- 운영 큐 추세가 같은 큐의 두 구간 연속 증가를 `ROLLBACK_REQUIRED`로 판정하거나 증거 부족으로 `INCONCLUSIVE`가 됨

코드 문제는 versionCode를 올린 수정 AAB를 새로 빌드한다. 이미 배포한 versionCode를 재사용하지 않는다. 서버 문제는 이전 Worker 버전으로 롤백하되 additive D1 컬럼을 파괴적으로 제거하지 않는다.

### 13.1 현재 남은 제출 차단 항목

1. 앱 `feat/app-enhancement-reports`와 Worker `qa/final-e2e-fixes-20260702`를 코드리뷰하고 승인된 release branch/tag로 통합한다. 자동으로 `main`에 병합하지 않는다.
2. 평문 서명 자격정보 잔재를 운영자가 직접 정리·필요 시 회전하고, 최종 앱 commit 이후 새 서명 AAB를 만든다.
3. AAB의 서명·versionCode·SHA-256·mtime과 bundletool·zipalign·전체 ELF 16KB 정렬을 확인하고 schema v4 source/cap public/embedded raw·투영=Pages artifact provenance를 release record로 연결한다.
4. 승인된 16384 page size Android 15+ 기기에서 앱 시작·로그인 전 화면·핵심 기능 crash 0을 확인한다.
5. Play App Signing key 지문으로 `assetlinks.json`을 교체하고 내부 테스트 설치본 App Link `verified`를 다시 확인한다.
6. 승인된 아이 Android 기기와 데모 가족으로 FCM·pending·메모·일정/도착/위험/SOS·위치·마이크·Usage Access·`CALL_PHONE` 양방향 E2E를 수행한다.
7. Android 16 `sw600dp` 태블릿·폴더블에서 세로·가로·분할·접힘·펼침과 상태 보존을 확인한다.
8. Play Console 상품·가격·7일 체험, license tester 구매/복원/해지/grace, acknowledge, RTDN 재전달·OIDC를 실제 검증한다.
9. VAPID key를 설정하고 데스크톱·모바일 브라우저에서 권한·구독·백그라운드 표시·표시 ACK·로그아웃 해제를 검증한다.
10. Data Safety의 모든 유형과 외부 처리업체 DPA·보관·국외 이전·2차 이용·Families 적격성을 책임자가 승인한다.
11. 혼합 연령, Families, IARC, 위치·FGS·FSI·`isMonitoringTool=child_monitoring` 선언과 심사 영상을 Console에 제출한다.
12. PII 없는 아이콘·피처 그래픽·휴대전화 스크린샷과 반복 사용 가능한 보호자·아이 심사 계정을 준비한다.
13. `mail@hyenicalendar.com`의 실제 송수신, 기능 제안 D1 `queued` 운영 담당자·확인 주기·처리 SLA를 확정한다.
14. 최신 전체 로컬 회귀는 앱 1,231/1,231·Worker 1,159/1,159·legacy app 2,208/2,208·Android 172/172이고 Android lint는 오류 0·경고 13이다. 변경을 clean commit으로 고정한 뒤 같은 전체 회귀와 exact app/sibling SHA 교차 CI run을 승인 기록에 남긴다.
15. Play Console에서 월 4,900원·연 39,000원과 정확한 7일 eligible offer를 확인하고, PWA Toss 자동결제 계약·migration·secret·sandbox 결제/갱신/해지/환불 E2E를 완료한다.
16. 친구 초대와 구독·AI 크레딧 금융 보존 migration을 적용·readback하고 cron 지급·환불·보존·삭제를 운영 데이터 없이 검증한다.
17. Toss 자동결제·친구 초대·금융 정본·위치 확인자료 보존을 반영한 공개 법적 문구와 실제 사업 형태의 법률 검토를 완료한다.
18. 업데이트된 로컬 `.env` 키의 Luna live canary 4/4는 통과했다. 이전 노출 키를 OpenAI Dashboard에서 폐기했는지 확인하고 production Worker secret을 교체·readback한 뒤, 운영 Worker에서 동일 모델과 대표 한국어 알림장 이미지·연령별 아이 대화 안전 가드레일·하루 요약 사실성을 다시 확인해 기록한다.

## 14. 공식 참고 링크

- Android target API 정책: https://support.google.com/googleplay/android-developer/answer/16561298
- Android target API 일정: https://support.google.com/googleplay/android-developer/answer/11926878
- AI 생성 콘텐츠: https://support.google.com/googleplay/android-developer/answer/14094294
- 2026 Developer Program Policy(AI·UGC 포함): https://support.google.com/googleplay/android-developer/answer/17105854
- 데이터 보안: https://support.google.com/googleplay/android-developer/answer/10787469
- 계정 삭제: https://support.google.com/googleplay/android-developer/answer/13327111
- 백그라운드 위치: https://support.google.com/googleplay/android-developer/answer/9799150
- prominent disclosure: https://support.google.com/googleplay/android-developer/answer/11150561
- 전체 화면 인텐트·foreground service: https://support.google.com/googleplay/android-developer/answer/13392821
- 2026-08-26 시행 예정 FGS 정책 미리보기: https://support.google.com/googleplay/android-developer/answer/16965181
- Android 17 위치 최소 범위·위치 버튼 정책: https://support.google.com/googleplay/android-developer/answer/17033915
- 모니터링 도구 플래그: https://support.google.com/googleplay/android-developer/answer/12955211
- 스토커웨어 정책: https://support.google.com/googleplay/android-developer/answer/9888380
- 대상 연령: https://support.google.com/googleplay/android-developer/answer/9867159
- 가족 정책: https://support.google.com/googleplay/android-developer/answer/9893335
- 앱 생성·설정: https://support.google.com/googleplay/android-developer/answer/9859152
- 릴리즈 준비: https://support.google.com/googleplay/android-developer/answer/9859348
- 비공개 테스트 요구사항: https://support.google.com/googleplay/android-developer/answer/14151465
- 그래픽 자산: https://support.google.com/googleplay/android-developer/answer/9866151
- 앱 접근 권한: https://support.google.com/googleplay/android-developer/answer/15748846
- Play App Signing: https://support.google.com/googleplay/android-developer/answer/13857328
- Android App Links 검증: https://developer.android.com/training/app-links/verify-android-applinks
- 16 KB page size: https://developer.android.com/guide/practices/page-sizes
- Android 16 대화면 방향·화면비·크기 조절: https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability
- 정확한 알람: https://developer.android.com/develop/background-work/services/alarms
- Google Play 구독 lifecycle·acknowledge: https://developer.android.com/google/play/billing/lifecycle/subscriptions
- Real-time developer notifications: https://developer.android.com/google/play/billing/rtdn-reference

## 15. 최종 서명

다음 항목이 모두 확인될 때만 프로덕션 제출을 승인한다.

- [ ] 최신 최종 커밋 이후 생성한 서명 AAB
- [x] local debug schema v4 manifest policy v1 raw/투영·Capacitor/AAPT 예외·archive·TOCTOU·승인 권한 24개 exact·`isMonitoringTool=child_monitoring`·legacy storage `maxSdkVersion=28` evidence와 16KB 정적 검사
- [ ] clean CI 승인 인증서 서명 release AAB의 schema v4 evidence=동일 Pages artifact provenance release record
- [ ] bundletool·zipalign·전체 ELF·16KB 런타임 4단계 검사
- [ ] Android 16 `sw600dp` 이상 세로·가로·분할·폴더블 상태 보존 검증
- [ ] 개인정보가 없는 규격 적합 스토어 자산
- [ ] AI 답변 신고·메모 신고·사용자 차단·UGC 약관 E2E
- [ ] Data Safety 서비스 제공자 예외·전체 데이터 유형 최종 승인
- [x] 개인정보처리방침·이용약관·데이터 삭제 페이지와 favicon 배포·브라우저 확인
- [ ] 백그라운드 위치·FGS 3종·FSI·isMonitoringTool 선언과 영상
- [ ] 혼합 연령·Families·IARC 답변 책임자 승인
- [ ] 결제·RTDN·license tester 실제 E2E
- [ ] PWA Toss 자동결제 계약·migration·secret·sandbox 갱신/해지/환불 E2E와 Google Play 교차 결제 차단
- [ ] 친구 초대 migration·cron 지급 E2E와 구독·AI 크레딧 금융 정본 보존·삭제 운영 승인
- [ ] 월 4,900원·연 39,000원 가격 및 무료/프리미엄 비교표의 Play·PWA·공개 문서 일치
- [ ] 현재 exact SHA-256 `62b66c…` APK를 A17·razr에 `install -r`하고 version 1.3.0(5)·역할·세션 보존을 확인. 마지막 시도는 두 serial 모두 `device not found`
- [ ] 현재 exact 후보의 A17 부모 UI와 razr 아이 UI·Console/Network·Java crash·native crash·ANR 검증. 직전 `f0c697…` 후보의 A17 UI 통과·razr secure keyguard/Dozing 차단·aggregate 종료 이력은 역사 기록일 뿐 현재 증거가 아님
- [ ] 신규 Worker+D1 선행 배포·readback 후 현재 exact 후보에서 A17/razr `/api/realtime/ticket`과 A17 `/api/premium-funnel/events`를 재검증. 404는 직전 후보의 역사 관측임
- [ ] 최신 Pages 배포 후 desktop/mobile 공개 범위 재검증
- [ ] 실제 Pages `Referrer-Policy: no-referrer`, Toss 복귀 query 무누출, Worker live 8/user·64/room 초과 429와 client backoff, 아이 Android native WAV+세션 검증→요청 부모 전용 수신 및 비정본 WebView fallback 차단 검증
- [ ] 승인된 아이 Android 기기의 네이티브 양방향 안전·알림·위치 E2E
- [ ] VAPID 브라우저 Web Push와 feedback 운영 큐 E2E

| 승인 기록 | 기입 값 |
|---|---|
| 최종 점검일 | 2026-07-14~08-01 v1.2.0 증거 보존 · 2026-08-02 v1.3.0 exact 소스·로컬 브라우저·PWA·Android 산출물 감사. 현재 exact APK는 A17·razr 모두 `device not found`로 미설치이며, 직전 후보의 A17 UI·razr 잠금 차단·신규 Worker API 404는 역사 기록. 상용 제출 승인 미완료 |
| 제출 승인자 |  |
| 정책·개인정보 승인자 |  |
| 검증 기준 앱 코드 | 미고정 — `hyeni-launch-approval`의 exact app commit과 최종 보고서에서 기입 |
| 검증 기준 Worker 코드 | 미고정 — `hyeni-launch-approval`의 exact Worker commit과 최종 보고서에서 기입 |
| v1.3.0 local debug APK SHA-256 | `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873` · 13,092,876 bytes |
| v1.3.0 local debug AAB SHA-256 | `eb0eb5b2288de6771c3e70cc3e5bbe7eaeb3fa62d1f85d1d2ce318748631c2c5` · 12,018,080 bytes · Play 업로드 불가 |
| local debug evidence SHA-256 | `artifacts/release-evidence/android-debug-aab-evidence-20260802-143008.json` · schema v4 · evidence JSON `e552dd6655d4e6a0b467cac0d0acba73f5ae9f79a410b657926e1fcd242d0c18` · verification log `1bd78d88dfa4cb717bf4f73d1a8bf116cb653135d01560daa9c472816f0a483f` |
| 최종 AAB SHA-256 | 미생성 — 업로드 금지 |
| Worker 배포 버전 | 미고정 — 현재 후보 Worker 배포·readback 뒤 기입 |
| Pages 배포 ID | 미고정 — 현재 후보 Pages 배포·provenance 대조 뒤 기입 |
| Play Console 릴리즈 ID |  |
| 현재 승인 manifest | `artifacts/release-evidence/release-record-20260802-final-local-hold-v5.json` · `HOLD` · `humanApprovalRequired=true` · blocker 27건 |
| 현재 제출 판정 | HOLD — 13.1 차단 항목과 blocker 27건 해제 및 사람의 명시적 `GO` 필요 |

빈 칸은 업로드 직전에 운영자가 실제 산출물과 Console 화면을 보고 직접 기입한다. 비밀번호, 키 파일 경로, 구매 토큰, 사용자 개인정보는 적지 않는다.

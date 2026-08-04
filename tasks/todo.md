# 초기 출시 Free/Premium 구현 체크리스트

## Phase 1: 정책 정본

- [x] Task 1: Free/Premium 순수 정책과 비교 행을 테스트 우선으로 확정
  - Acceptance: Free 일정 무제한·신규 저장 장소2·당일이력·새 아이 연결1, Premium 장소무제한·30일·새 아이 연결2가 순수 함수로 반환됨. 기존 연결 아이는 다운그레이드로 자동 해제·숨김하지 않음
  - Verify: `node --test tests/tierPolicyMatrix.test.ts`
  - Files: `tests/tierPolicyMatrix.test.ts`, `src/transform/tierPolicy.ts`

- [x] Task 2: reviewed 신규 지급 중단과 기존 사용자 무손실 호환 계약
  - Acceptance: 신규 claim은 지급하지 않고 기존 행은 삭제하지 않으며 상업 요금제 라벨은 Free로 표시됨
  - Verify: 관련 클라이언트·Worker focused tests
  - Files: `src/queries/useReviewReward.ts`, `src/transform/tierPolicy.ts`, Worker review reward route/test

- [x] Task 3: Worker 공통 엔타이틀먼트 resolver 통합
  - Acceptance: 일반 API·위치·주변소리·cron이 동일한 구독 유효기간과 legacy 호환 결과를 사용함
  - Verify: Worker entitlement/security/location focused tests
  - Files: Worker shared resolver, `db/authz.ts`, 관련 테스트

## Checkpoint 1

- [x] 클라이언트 정책 테스트 통과
- [x] Worker 정책 테스트 통과
- [x] Free/Premium/reviewed/만료/DB 오류 행렬 검증

## Phase 2: 무료 핵심 가치

- [x] Task 4: 일정·반복 일정 제한 제거
  - Acceptance: Free도 일정과 반복 일정을 저장하며 기존 하루 준비물 8개 안전 상한은 유지됨
  - Verify: event recurrence·supply·tier tests
  - Files: 이벤트 폼, AI 일정, Worker events authz, tests

- [x] Task 5: Free 장소 2곳과 기본 도착·출발 알림
  - Acceptance: 신규 저장 2곳, 생성 시각(초)+id 안정 순 첫 2곳이 알림 대상. 다운그레이드 전 초과 데이터는 삭제하지 않고 관리 가능하되 새 저장과 초과 알림은 Premium까지 제한. reviewed는 첫 3곳, Premium은 전부 알림 대상
  - Verify: place limit·registered place tests
  - Files: place policy/UI, Worker saved-place/geofence, tests

- [x] Task 6: Free 현재 위치·10분 자동 갱신·수동 5회·당일 이력
  - Acceptance: 측정시각/정확도 표시, Premium은 실시간/30일, 무료 quota 우회 없음
  - Verify: location entitlement/history/refresh tests
  - Files: location policy/UI/API, Worker location/quota, tests

- [x] Task 7: Free 위험구역 1곳과 Premium 무제한
  - Acceptance: 신규 저장 1곳, 생성 시각(초)+id 안정 순 첫 1곳의 안전 알림은 무료. 다운그레이드 전 초과 데이터는 보존·관리하되 알림 대상에서 제외하고, Premium은 전부 알림 대상
  - Verify: danger-zone authz/UI tests
  - Files: danger-zone UI, Worker route/authz, tests

## Checkpoint 2

- [x] exact local production dist의 390×844@2x 무료 가족 핵심 UI 흐름 검증(부모 42/42·아이 14/14, 문제·Console·Network 0). 인증 운영 데이터·외부 API·실기기는 별도 출시 게이트
- [x] 클라이언트 전체 테스트·타입 검사·빌드 통과
- [x] Worker 전체 테스트 통과

## Phase 3: Premium 가치와 전환

- [x] Task 8: Premium 기능표와 신뢰 문구 재구성
  - Acceptance: 비교표는 Free/Premium 두 열, 실제 정책에서 파생, AI 일정 정리 5회/제한 없음, 직접 일정 추가·기존 일정 관리는 양쪽 무제한, SOS 무료·주변소리 고지 포함
  - Verify: subscription trust/copy/tier tests
  - Files: Subscription 화면/CSS, tier policy, tests

- [x] Task 9: 접근 가능한 상황형 Premium 업셀 컴포넌트
  - Acceptance: dialog/focus/back/ESC/44px/입력 보존/무료 계속 쓰기 충족
  - Verify: component/static contract tests + browser
  - Files: upsell component/CSS/transform/tests

- [x] Task 10: 한도·가치 순간에 업셀 연결
  - Acceptance: 둘째·장소·위험구역·위치 quota·리포트·AI 친구·AI 일정 정리 5회 소진·주변소리 소스가 정확한 문구와 return context 전달
  - Verify: source-specific tests + browser flows
  - Files: 각 수직 슬라이스별 최대 5개 파일로 분리

- [x] Task 11: AI·리포트·학원·원격 기능 Premium 게이트 정합화
  - Acceptance: AI 친구 5/20, AI 일정 정리 5/제한 없음, 직접 일정 추가·기존 일정 관리는 양쪽 무제한, 요약/주간/학원/주변소리 Premium, SOS 무료
  - Verify: client + Worker focused tests
  - Files: AI/report/academy/remote routes and tests

## Phase 4: 결제와 계측

- [x] Task 12: 가격·플랜 표시를 월 4,900/연 39,000 운영 계약과 정합화
  - Acceptance: 코드가 base plan ID를 가격으로 해석하지 않고 공급자 가격만 표시, 연간 절약 문구도 실제 응답으로 계산
  - Verify: offer/checkout/copy tests
  - Files: billing transform, Subscription UI, tests

- [x] Task 13: 구독 퍼널 이벤트 저장·API·클라이언트 연결
  - Acceptance: 민감정보 없는 allowlist, 180일 보관, 실패가 사용자 흐름을 막지 않음
  - Verify: Worker endpoint/migration tests + client transform tests
  - Files: D1 migration, Worker route/test, client API/test

- [ ] Task 14: iPhone PWA 인증 정기결제
  - Acceptance: 부모 PWA만 웹 결제, Android 앱 외부 CTA 없음, webhook 검증 뒤 같은 가족 entitlement 갱신
  - Verify: provider contract tests + browser + sandbox E2E
  - Files: provider별 5파일 이하 수직 슬라이스

## Checkpoint 3

- [x] 자동 계약: Google Play·Toss의 성공·취소·실패·복원·갱신·해지 상태를 fail-closed 상태기계와 회귀 테스트로 검증
- [ ] 공급자 E2E: Play license tester와 Toss sandbox에서 위 상태를 실제 결제·webhook/RTDN·D1까지 같은 건으로 연결
- [x] 자동 계약: 부모 PWA는 Toss, Android는 Google Play만 선택하고 Android 앱에 웹 결제 우회 CTA가 없음을 정적·브라우저 회귀로 검증
- [ ] 실제 채널 E2E: iPhone 홈 화면 PWA Toss 결제와 Android Play 결제를 각각 실행해 반대 채널 요청이 0건임을 네트워크 증거로 확인
- [x] 자동 계약: 클라이언트·Worker exact-key allowlist와 D1 최소 컬럼으로 토큰·주문번호·위치·메모 원문을 거부하고 가족 식별자는 HMAC 가명키만 저장함을 검증
- [ ] 운영 계측 E2E: funnel migration/readback 뒤 실제 표본 행에 토큰·주문번호·위치·메모 원문이 없음을 제한된 운영 증거로 확인

## Phase 5: 통합·출시

- [x] Task 15: 위치 이력과 퍼널 보관 cron
  - Acceptance: Free 당일·Premium 30일·퍼널 180일 정책이 실제 삭제/조회에 반영됨
  - Verify: 시간 경계·재실행 멱등 Worker tests

- [x] Task 16: 현재 작업 트리 전체 자동 검증
  - Acceptance: 클라이언트·Worker·Android 테스트, typecheck, build 전부 exit 0
  - Verify: 계획 문서의 전체 명령 실행
  - [x] AAB/release record schema v4가 source dist·post-sync public·universal APK public의 raw/투영, 0B cordova 2개, AAPT 제외 assetlinks 1개, archive safety·TOCTOU를 검증하고 current dist·Pages provenance와 재대조하도록 구현·release/archive 41/41 검증. `artifacts/release-evidence/release-record-20260802-final-local-hold-v5.json`은 dirty 작업 트리·외부 승인 증거를 포함한 blocker 27건을 남겨 정직하게 HOLD 유지
  - [x] Toss 복귀 URL `no-referrer`를 최초 HTML·Pages header·SDK script에 적용하고 자동 계약 회귀 통과
  - [x] realtime live 8/user·64/room, 만료·손상 socket 1008, 초과 429/Retry-After, legacy raw socket 송신 제거·인증 API broadcast와 Promise 실패 처리, 비정본 WebView `audio/webm` 제거·Android native WAV fail-closed 전환 검증
  - [x] Android 등록 장소 알림 master 조회 시작·실패·누락·빈 응답을 false+cache clear로 닫고 정확한 1행 Boolean true만 허용하도록 검증
  - [x] dist tree 414 files·SHA-256 `21FD847BD3B5E64D71BEAA329155D3273AC8D5BFDAA2DC87B24D63356DD6C1E5`, index SHA-256 `C4A51F17136795D0EBA64467C77D965614CF5964381B78D1796072BE3D8B616A`의 390×844@2x 부모 42/42·아이 14/14, 가격·정책·AI 일정 5회 업셀·복귀·선생님 gate와 문제·Console·Network 0 검증. 증거 `artifacts/release-evidence/browser-qa/20260802T141931-final-21fd847/report.json`. Chromium PWA 설치·offline reload·자동 업데이트도 문제 0이며 증거는 `artifacts/release-evidence/pwa-runtime-qa/20260802T141931-final-21fd847/report.json`. WebKit smoke PASS지만 offline reload는 Playwright 엔진 오류로 미검증이며 실제 iPhone 증거가 아님
  - [x] 동일 dist `cap sync` 뒤 Android unit 172/172 강제 재실행, lint 오류 0·경고 13, assemble/bundle `BUILD SUCCESSFUL`. debug APK 13,092,876 bytes·SHA-256 `62B66CE643E38C77074E30C7FA992C48D9EA70A56A8E720A8FFF9C94C8E05873`, debug AAB 12,018,080 bytes·SHA-256 `EB0EB5B2288DE6771C3E70CC3E5BBE7EAEB3FA62D1F85D1D2CE318748631C2C5`. debug 서명으로 Play 업로드 불가
  - [x] Gradle `release` merged manifest를 실제 생성해 승인된 권한 24개 exact allowlist, legacy 저장소 `maxSdkVersion=28`, 고위험 불필요 권한 부재, `isMonitoringTool=child_monitoring`, boot/shutdown receiver 비노출을 하나의 회귀로 고정
  - [x] 앱 1,231/1,231·Worker 1,159/1,159·legacy 2,208/2,208, 앱 typecheck/build, Worker TypeScript/dry-run, legacy lint/build, Android 172/172·lint/assemble/bundle, npm audit 0 완료
  - [ ] 변경을 clean commit으로 고정한 뒤 exact app/sibling SHA의 교차 CI run을 release record에 연결

- [ ] Task 17: A17 부모·razr 아이 실기기 조정 검증
  - [ ] current exact v1.3.0 debug APK SHA-256 `62B66CE643E38C77074E30C7FA992C48D9EA70A56A8E720A8FFF9C94C8E05873`를 A17(`RFKL40DP73J`) 부모와 razr(`ZY22H9VTQD`) 아이에 `adb install -r`로 세션 보존 설치 — 두 기기 모두 `adb start-server` 후 `device not found`여서 미설치·미검증
  - [ ] current exact 후보의 A17 local/server parent role·family와 부모 9개 경로 UI·Network 재검증 — 이전 `f0c697…` 후보의 설치·UI 통과·운영 API 404는 역사 기록으로만 보존
  - [ ] current exact 후보의 razr 아이 8개·가로 전면 UI·Network 재검증 — 이전 `f0c697…` 후보의 설치·secure keyguard/Dozing 차단·crash 0은 역사 기록으로만 보존
  - [ ] 신규 Worker와 필요한 D1 migration을 선행 배포·readback한 뒤 A17의 `/api/realtime/ticket` 404와 `/api/premium-funnel/events` 404를 해소하고, razr 잠금 해제 상태에서 양쪽 Console/Network 전체 0-error를 재검증
  - Acceptance: current exact 후보는 A17·razr 모두 `device not found`로 설치·역할 보존·화면·Network를 검증하지 못해 Task 전체가 미완료다. 역할 전환·로그아웃·재페어링·refresh token 접근은 수행하지 않았고 S25는 미조작. 이전 후보의 A17·razr 결과는 역사 기록으로만 사용
  - Verify: A17·razr WebView CDP·화면·Network 증거. 네이티브 푸시/pending ACK·원격제어·백그라운드 위치·마이크·Usage Access·실결제는 별도 출시 게이트

- [x] Task 18: 출시 준비 증거 감사
  - Acceptance: 코드·자동 테스트·A17/razr 화면 smoke와 실패한 운영 Network 게이트를 분리하고, 미확인 항목을 완료로 표시하지 않음
  - Verify: 감사표, 잔여 결함, 운영 D1·실결제·아이 Android·서명 AAB 증거

- [ ] Task 19: OpenAI Luna 운영 전환
  - [x] Worker 활성 OpenAI 4경로를 중앙 `gpt-5.6-luna`·`reasoning_effort:none`·`max_completion_tokens`·SHA-256 `safety_identifier` 계약으로 전환
  - [x] Luna focused 계약 테스트 11/11, 업데이트된 로컬 `.env` 키와 AI Gateway의 아이 안전 한국어 text·일정 JSON·실제 PNG image 일정 추출·하루 요약 live canary 4/4 통과
  - [ ] 감사 도구 로그에 노출된 기존 OpenAI 키 폐기 확인과 production Worker secret 반영·readback
  - [ ] 실제 한국어 알림장 이미지 일정 추출, 연령별 아이 대화 금지주제·도구 결과, 하루 요약 사실성 품질 E2E와 운영 Worker 모델 확인
  - Acceptance: 로컬 업데이트 키의 canary는 완료했지만 기존 노출 키 폐기 확인·production Worker secret/readback·대표 품질·운영 배포 증거가 모두 있어야 완료

## 2026-08-02 증거 상태

- 최신 가격·티어 변경분: 앱 focused 58/58, Worker focused 38/38, Android JVM 167/167, 앱 typecheck·production build, Worker TypeScript 통과
- 최종 위험 보완: schema v4 AAB/release/archive 41/41, realtime·결제 Worker 139/139, legacy realtime·native audio 계약 focused Vitest 18/18과 대상 ESLint 통과. `artifacts/release-evidence/release-record-20260802-final-local-hold-v5.json`은 `humanApprovalRequired=true`·blocker 27건으로 HOLD
- local browser QA: 390×844@2x 부모 42/42·아이 14/14, 문제·crash·overflow·깨진 이미지·44px 미만·Console·Network 모두 0. JS 479,697/500,000, CSS 30,849/40,000, PWA precache 320·중복 0. exact dist tree 414/`21FD84…6C1E5`, index `C4A51F…B616A`. 증거 `artifacts/release-evidence/browser-qa/20260802T141931-final-21fd847/report.json`, PWA `artifacts/release-evidence/pwa-runtime-qa/20260802T141931-final-21fd847/report.json`. WebKit smoke는 PASS였지만 offline reload 엔진 오류를 Cache Storage 앱 셸 검증으로 대체했고 실제 iPhone 증거가 아님
- 현재 작업 트리 최종 전체 검증: 앱 1,231/1,231·typecheck/build, Worker 1,159/1,159·TypeScript/dry-run, legacy app 2,208/2,208·lint/build, Android 172/172 강제 재실행·lint 오류 0·경고 13·assemble/bundle, npm audit 0
- OpenAI Luna: 활성 4경로 중앙 전환·focused 11/11·업데이트된 로컬 `.env` live canary 4/4 통과. 기존 노출 키 폐기 확인·production Worker secret/readback·운영 모델 확인 전까지 미완료
- 운영 D1 read-only 재실측: 2026-08-02 12:02 KST, 출시 필수 객체 25개 중 2개 존재·23개 누락, AI balance 중복 1그룹·6행·병합 시 제거 5행, `has_ai_friend_limit_source=0`·`has_ai_schedule_limit_source=0`, 필수 컬럼 4개 모두 부재. remote 실행 `changes=0`·`changed_db=false`·`rows_written=0`. 증거 `artifacts/release-evidence/d1-readonly-preflight-20260802-120214.json`; 과거 10:46 bookmark는 current final release record에 연결하지 않았으며 migration·secret·배포 실행 권한을 뜻하지 않음
- local debug schema v4 provenance GREEN: source 414/`21FD847BD3B5E64D71BEAA329155D3273AC8D5BFDAA2DC87B24D63356DD6C1E5`, Android/embedded projection 413/`4A6AF8C84EC2196557B89F23DACFD6B236910364279EDA0A7B9ECB2453D18D15`, cap public 416/`821819718FE49B1A38A6495DC76D4CB32465B0C8E56A1442DC1C9EFA90D248FA`, embedded public 415/`0F291BF20AA104405738B405D98378E793FDCDF4821A16B31A9670CBD3BB5CBC`. 0B cordova 2개·338B assetlinks AAPT 제외 1개만 허용, archive 961/2/955 safe, integrity 모두 true, 16KB 정적 검사와 AAB manifest policy v1 권한 24개·`isMonitoringTool=child_monitoring` 통과. 증거 `artifacts/release-evidence/android-debug-aab-evidence-20260802-143008.json` SHA-256 `E552DD6655D4E6A0B467CAC0D0ACBA73F5AE9F79A410B657926E1FCD242D0C18`, verification log SHA-256 `1BD78D88DFA4CB717BF4F73D1A8BF116CB653135D01560DAA9C472816F0A483F`. debug 서명으로 Play 업로드 불가
- 실기기 smoke: current exact debug APK SHA-256 `62B66CE643E38C77074E30C7FA992C48D9EA70A56A8E720A8FFF9C94C8E05873`은 A17 SM-A175N 부모와 motorola razr 40 ultra 아이 모두 `adb start-server` 후 `device not found`여서 설치·버전·UI·Network·crash/ANR를 검증하지 못했다. S25는 미조작했다
- 이전 후보 역사 증거: debug APK `F0C697…2C1452`의 A17 부모 9/9 UI 통과·운영 신규 API 404와 razr secure keyguard·Dozing 차단·양쪽 crash 0은 current exact 후보 결과로 승격하지 않는다. `artifacts/razr-readonly-state-20260802-074151.md`도 이전 후보의 보조 기록이다
- clean exact app/sibling SHA 교차 CI, 승인 인증서 서명 release AAB schema v4=Pages provenance, 신규 Worker+D1 선행 배포·readback 후 같은 기기 Network 0-error 재검증, realtime 9번째/65번째 socket·아이 Android native WAV 세션 검증과 요청 부모 전용 수신은 미완료. 네이티브 푸시·원격제어·백그라운드 위치·마이크·실결제는 실행하지 않았고 역할 전환·로그아웃·재페어링·refresh token 접근 없이 S25를 미조작 상태로 유지
- 기존 노출 OpenAI 키 폐기 확인·production Worker secret/readback·Luna 운영 모델 확인, 운영 D1 migration/secret/배포, Play·Toss 실결제, 서명 AAB, Console/Families/법적 승인도 미완료이므로 출시 판정은 HOLD

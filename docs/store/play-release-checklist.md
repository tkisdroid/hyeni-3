# Play 출시 체크리스트 — 혜니캘린더 v1.3.0(versionCode 6)

## 현재 판정 (2026-08-15)

**최종 심사 전송 직전 HOLD.** 최신 후보 v1.3.0/versionCode 6의 코드·테스트·Worker/Pages 배포, 승인 업로드 키 서명 AAB 생성·검증·업로드, 스토어 등록정보와 지정 이미지 교체, 일부 공개 정책 영상 2개, 백그라운드 위치·FGS 선언, 제한된 앱 액세스 심사 계정, 프로덕션 출시 저장을 마쳤다. Play의 일반 문제 빠른 검사도 감지된 차단 없이 끝났고 게시 개요에는 **검토를 위해 변경사항 12개 제출** 버튼이 활성화돼 있다. 이제 사용자가 최종 심사 전송 버튼만 누른다. 에이전트는 그 최종 버튼을 누르지 않는다. 서명 값과 심사 계정 자격 증명은 사용자만 입력했고 저장소·로그에 기록하지 않았다.

v1.2.0의 테스트·APK·A17 부모·razr 아이 결과는 역사 기록으로만 보존하며 v1.3.0 완료 증거로 재사용하지 않는다. 당시 precache 320개·entry 472,252 bytes와 debug APK SHA-256 `246A1513CA9D9951D7857654B538398A9D175605F097331EAADDE2DBA2D243F5`도 역사 증거이며 현재 후보 승인값이 아니다.

### 2026-08-15 versionCode 6 증분 현황

- [x] 위치 권한 prominent disclosure가 온보딩 인증 전환에 가려지지 않도록 gate를 추가하고, 아이 위치 화면의 재허용 경로도 같은 공용 dialog로 통일
- [x] 위치 FGS 지속 알림을 `위치 공유 중`과 실제 공유 대상 문구로 바꾸고 최신 네이티브 제조사·모델로 오래된 에뮬레이터 device label을 보정
- [x] 앱 1,298/1,298, Worker 1,161/1,161, Android unit 175/175·lint·assembleDebug, production build 통과
- [x] 사용자 지정 폴더 `C:\Users\TK\Downloads\Gmail (3)`의 피처 그래픽 1장, 휴대전화 8장, 7인치·10인치 태블릿 각 4장으로 Play 자산을 교체하고 API readback의 순서·SHA-256을 원본과 대조. 512×512 대체 파일이 없어 Play 아이콘만 기존 설치 아이콘을 유지
- [x] Worker version ID `c4c769c3-b4d5-4ba1-8c68-ef2ba22c742c` 배포, health 200·reverse-geocode 인증 route 401 확인
- [x] A17 부모 최신 debug 설치·세션 보존·부모 홈·razr 실제 기기명 표시 확인. S25 완전 무조작
- [x] A17·razr 정책 영상 촬영 허용 범위에서 개인정보·정밀 위치를 비식별하고 오디오를 제거한 최종본 2개를 YouTube에 업로드
- [x] YouTube 제목·설명·아동용 아님·일부 공개 저장 및 비로그인 외부 접근 확인
- [x] Play 백그라운드 위치 선언과 FGS 위치 3항목·마이크·specialUse 선언 저장
- [x] 로그인 세부정보를 제한 있음으로 변경하고 사용자가 재사용 가능한 심사 계정과 비밀번호를 Console에 직접 입력
- [x] clean app commit `40a32e2c18e929877e7c92970d6898619d7feedd`에서 승인 업로드 키로 versionCode 6 release AAB 생성·증거 검증·Play 업로드. AAB SHA-256 `6b31166c7b6e141ed451a81970ed78a4a934ea1ecd8cc31addd4024f9d0dbc45`
- [x] 최신 Pages 배포와 assetlinks·핵심 route 확인, 프로덕션 2단계 미리보기와 출시 저장
- [x] Play 일반 문제 빠른 검사 완료, 감지된 차단 0건과 `이제 검토를 위해 변경사항을 전송할 수 있습니다` 표시 확인
- [ ] 게시 개요의 **검토를 위해 변경사항 12개 제출** 버튼을 사용자가 최종 실행

- [x] 등록정보 문안 초안: `docs/store/play-listing.md`
- [x] Data Safety 워크시트 초안: `docs/store/play-data-safety.md`
- [x] 출시 운영 가이드 초안: `docs/release/혜니캘린더_Google_Play_출시_가이드북_2026-07-14.md`
- [ ] Data Safety의 전체 데이터 유형과 외부 처리업체 서비스 제공자 예외를 계약·설정 기준으로 확정
- [ ] 공개 이용약관·개인정보처리방침·데이터 삭제 문구를 Android Google Play 전용 신규 결제, iPhone·웹 무료 이용, 같은 계정의 기존 프리미엄 교차 기기 이용 정책으로 갱신했다. Worker 배포 뒤 HTTPS 200과 최종 업데이트 `2026-09-01`을 재확인
- [x] 지도 화면·장소 검색·역지오코딩·길찾기를 `FamilyMap`/`/api/maps/*` 공통 경계로 이관하고 `KR=Kakao`, `CN/ZZ=미지원`, 승인 비한국 국가만 Google인 fail-closed 정책을 자동 검증
- [x] Google 웹·Android SDK 버전 고정, CSP 최소 호스트, Android manifest key placeholder와 release key 누락 fail-closed, 검색 후보 비저장·사용자 확정 핀 저장 경계를 자동 검증
- [ ] `docs/operations/google-maps-release-readiness.md`의 키 제한·D1 readback·공식 OAuth scope·국가별 time zone/DST·부모 PWA↔아이 Android E2E를 완료하고 Google 국가 allowlist를 한 국가씩 승인. 현재 allowlist는 비어 있고 글로벌 출시는 HOLD
- [x] Play 그래픽 자산은 사용자 지정 원본으로 교체하고 중복 파일 `1000172579.png`=`1000172578.png`, `1000172581.png`=`1000172580.png`를 제외했다. 업로드 순서와 전체 SHA-256은 `docs/store/play-console-submission-v1.3.0.md` §2에 고정
- [x] final app SHA `40a32e2c18e929877e7c92970d6898619d7feedd`에서 build→`cap sync`→승인 인증서 서명 release AAB를 새로 만들고 source dist·post-sync public·universal APK public, manifest 권한 24개 exact allowlist, `isMonitoringTool=child_monitoring`, legacy 저장소 `maxSdkVersion=28`, package/versionName/versionCode, `jarsigner`·승인 upload certificate, `PAGE_ALIGNMENT_16K`·`zipalign -P 16`·전체 ELF `LOAD >= 0x4000`를 검증. 증거=`artifacts/release-evidence/android-release-aab-evidence-20260815-184739-40a32e2.json`
- [x] 최신 local debug schema v4 evidence GREEN: source 414/`21fd84…6c1e5`, Android/embedded projection 413/`4a6af8…18d15`, cap public 416/`821819…248fa`, embedded public 415/`0f291b…5cbc`; web `matched:true`, archive 961/2/955 safe, 시작/종료 integrity 모두 true, AAB manifest policy v1 권한 24개 exact allowlist·`isMonitoringTool=child_monitoring`·legacy 저장소 `maxSdkVersion=28`, ZIP·전체 ELF 16KB 정적 검사 통과. `artifacts/release-evidence/android-debug-aab-evidence-20260802-143008.json` SHA-256 `e552dd6655d4e6a0b467cac0d0acba73f5ae9f79a410b657926e1fcd242d0c18`, verification log SHA-256 `1bd78d88dfa4cb717bf4f73d1a8bf116cb653135d01560daa9c472816f0a483f`
- [x] local Android unit 172/172·manifest policy 33/33 강제 재실행, lint 오류 0·경고 13, assemble/bundle 통과. 경고 13건은 사용되지 않는 레거시 리소스와 기존 런처·스플래시 이미지 구성 경고다. debug APK 13,092,876 bytes·SHA-256 `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873`, debug AAB 12,018,080 bytes·SHA-256 `eb0eb5b2288de6771c3e70cc3e5bbe7eaeb3fa62d1f85d1d2ce318748631c2c5`. debug 서명으로 Play 업로드 불가
- [x] 활성 OpenAI 호출 4개를 중앙 `gpt-5.6-luna`·`reasoning_effort:none`·`max_completion_tokens`·SHA-256 `safety_identifier` 계약으로 전환하고 빈/비정상 응답 fail-closed를 포함한 로그 안전 계약 11/11, 업데이트된 `.env` 키의 한국어 아동 안전 text·일정 JSON·합성 한국어 알림장 PNG·하루 요약 live canary 4/4 확인. 현재 키의 비환경 파일 출현 0건
- [ ] 내부 도구 로그에 노출된 이전 OpenAI 키가 OpenAI Dashboard에서 폐기됐는지 확인하고 production에 새 Worker secret으로 교체·readback. 실제 승인 한국어 알림장 사진의 일정 추출, 연령별 아이 대화 가드레일, 하루 요약 사실성을 승인한 뒤에만 Luna Worker를 운영 배포
- [ ] 2026-08-01 후보 변경을 Worker·Pages에 배포하고 health·핵심 API·법적 문서·실제 `Referrer-Policy: no-referrer`를 재확인. 현재 Pages는 구번들 `index-CJV90BTL.js`/`index-C5WYBtNv.css`이며 CSP·HSTS 헤더가 없고 Worker의 새 퍼널 endpoint는 404
- [x] access JWT URL 노출을 제거하고 realtime은 45초·1회용 ticket과 live 8/user·64/room 상한, 만료·손상 socket 1008 종료, 초과 `429`·`Retry-After: 30`, ticket `no-store`로 닫음. legacy client payload는 raw socket send가 아니라 인증된 `/realtime/v1/api/broadcast`로 보내고 모든 호출이 Promise 실패를 처리함. 주변 소리는 비정본 WebView `audio/webm` fallback·child socket 준비 의존을 제거하고 Android native WAV+세션 검증만 허용하며 미지원은 `remote_listen_requires_android_native`로 닫음. 비공개 사진·첨부는 Authorization fetch→blob으로 전환한 코드·회귀 통과
- [x] Toss 복귀 URL query가 React effect 정리 전에 Referer로 전파되지 않도록 최초 HTML meta·Pages `_headers`·동적 SDK script를 모두 `no-referrer`로 고정하고 자동 계약 회귀 통과
- [x] 신규 웹 구독·AI 크레딧 결제는 D1 운영 제어가 명시적으로 허용할 때만 열고 행 누락·형식 오류·D1 장애는 두 판매 중지로 fail-closed한다. 기존 주문 완료·대사·해지·환불은 중지 스위치와 무관하게 계속 처리한다
- [x] 2026-09-01 정책 변경으로 신규 구독·AI 크레딧 결제는 Android Google Play에서만 시작한다. iPhone·웹은 신규 구매 CTA와 카탈로그 요청을 노출하지 않고 무료 기능·무료 AI 제공량을 안내하며, Android에서 획득한 프리미엄은 같은 계정에서 계속 사용한다. 레거시 웹 결제 운영 제어는 둘 다 OFF로 유지한다
- [x] Worker 런타임 로그는 정적 이벤트와 allowlist된 aggregate 필드만 남기고 오류 원문·ID·payload·provider body를 기록하지 않도록 AST 회귀로 고정했다. 첫 60분은 `5xx >= 5`이면서 오류율 `> 1%`일 때만 rollback 후보이며 요청 0건은 `INCONCLUSIVE`다
- [x] 첫 60분 큐 추세는 DB 시각과 고정 11개 count만 저장하고, 최소 3개 checkpoint에서 같은 큐가 두 구간 연속 증가할 때만 `ROLLBACK_REQUIRED`로 판정한다. ID·PII·token·원문 행은 반환·저장하지 않는다
- [ ] 신규 Worker+D1을 `docs/release/release-day-rollback-runbook.md`의 변경 창에서 선행 배포·readback해 A17/razr의 realtime ticket 404를 먼저 닫고, 부분 배포·단독 rollback 없이 9번째/65번째 live socket 429·client backoff, razr Android native WAV+세션 검증→요청 부모 전용 수신과 미지원 WebView fail-closed 증거 확보
- [x] local production build는 JS 480,140/500,000 bytes·초기 CSS 30,849/40,000 bytes·PWA precache 323개·중복 0으로 통과. exact dist 417파일·tree SHA-256 `aa6c305e4cf7a88e3607249ac80b242ebae479372d8ac00879abd24ae955e426`
- [x] 같은 exact dist의 격리 Chromium PWA runtime에서 Service Worker install·control, 실제 offline reload·uncached probe 차단, waiting Worker의 안전한 활성화·새 controller 교체·문서 reload, 앱·Service Worker 외부 요청 0, Console·HTTP·예상 밖 Network 문제 0과 임시 자원 정리를 확인. `registerType: prompt`의 중요 작업 보호형 업데이트로 결제·대사·주변 소리·mutation·미저장 입력 중 reload를 보류하고 안전한 시점의 실제 `controllerchange`에서 정확히 한 번 reload한다. 증거 `artifacts/release-evidence/pwa-runtime-qa/20260802T141931-final-21fd847/report.json`. WebKit smoke도 PASS지만 offline reload는 Playwright 엔진 오류로 미검증이며 실제 iPhone 증거가 아님
- [ ] 위 exact dist를 final clean CI Pages archive/provenance와 연결하고 실제 iPhone Safari 홈 화면에서 재검증
- [x] exact local dist의 격리 Free 브라우저에서 저장 장소 2/2 한도와 보존 데이터 3개 중 첫 2개 active·초과 1개 premium-required·unknown 0, 주 추가의 정확한 Free/Premium 업셀, 무료 유지·upgrade·`saved_place|saved_places` return source의 `/place-form` 복귀와 intent clear를 오류 0으로 확인
- 이전 debug APK SHA-256 `f0c697ecc44f7fbc2443631e62bea7160c6ae436072cead433fce443fb2c1452`의 A17 설치·부모 9개 경로 통과와 razr 설치·secure keyguard/Dozing 차단 결과는 역사 기록이다. 현재 exact APK SHA-256 `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873` 검증으로 승격하지 않는다.
- [x] A17 SM-A175N 부모에 직전 exact debug APK를 `adb install -r`로 세션 보존 설치하고 부모 홈과 razr 실제 기기명 표시를 확인. 이후 아이 권한 거부 문구만 정리하고 최신 production 웹 번들을 다시 동기화해 빌드한 현재 debug APK는 13,279,364 bytes·SHA-256 `74911c1ffdee285c6fc9cb95f3bed2b0ec8ff30816935cc1c45a2405b650d96e`이며, 이 문구 변경은 A17 부모 검증 범위에 영향을 주지 않음. 전체 Network E2E 증거로 확대 해석하지 않음
- [ ] 현재 exact APK를 razr motorola razr 40 ultra 아이에 `adb install -r`로 세션 보존 설치하고 versionCode 6/versionName 1.3.0/minSdk 24/targetSdk 36, 아이 핵심 화면·가로 UI·Network를 재검증
- [ ] 최신 후보의 razr 잠금 해제 상태에서 아이 8개 경로와 1005×411 가로 핵심 경로의 overflow·busy·44px 미만 활성 조작부·runtime error·예상 밖 Network 오류 0을 재확인
- [x] v1.3.0 local debug AAB의 `jarsigner`, bundle config 16KB, universal APK `zipalign -P 16`, native library 4개·LOAD 9개·최소 alignment 16,384와 artifact SHA를 schema v4 evidence에 연결. debug certificate 결과를 승인 upload certificate·서명 release AAB·실제 16KB 런타임 증거로 대체하지 않음
- [ ] current exact APK의 실기기 Network 전체 0-error — A17·razr 모두 `device not found`로 실행하지 못했다. 이전 후보의 A17 `/api/realtime/ticket`·`/api/premium-funnel/events` 404와 razr 잠금 차단은 역사 진단으로만 보존하며, 신규 Worker+D1 선행 배포·readback 뒤 current exact APK로 동일 기기 재검증
- 현재 실기기 승인 범위는 A17 부모와 razr 아이 두 대뿐이며 S25는 완전 무조작한다. 더 오래된 후보의 기기 지침은 현재 승인 근거로 사용하지 않는다.

## P0 정책·제품 제출 차단 조건

- [x] **AI 답변 신고 코드**: 앱 내 신고, 실패·재시도·중복 방지, 서버 소유권 검증, D1 영속 저장을 구현하고 자동 회귀 테스트로 보호
- [x] **메모 신고 코드**: 가족 메모·사진·위치 신고와 서버의 가족·아이 스레드·본인 메시지 검증을 구현하고 자동 회귀 테스트로 보호
- [x] **사용자 차단 코드**: 1:1 UGC 메시지의 전송·조회·실시간·푸시만 차단하고 SOS·위험·위치 안전 알림과 가족 연결은 유지하도록 구현
- [x] **UGC 약관 코드**: 금지 콘텐츠, 신고·차단·조치·이의 제기 절차, 아동 위해 콘텐츠 금지를 공개 약관과 앱 동의 흐름에 반영
- [ ] **AI 답변 신고 E2E**: 실제 아이 세션에서 신고하고 D1 운영 큐 반영·운영자 처리를 확인
- [ ] **메모 신고 E2E**: 실제 부모·아이 양방향 세션에서 메시지·사진·위치 신고를 확인
- [ ] **사용자 차단 E2E**: 양방향 메시지·실시간·푸시는 차단되고 SOS·위험·위치 안전 채널은 유지되는지 확인
- [ ] **UGC 약관 E2E**: 신규·기존 세션의 동의 게이트와 공개 약관 링크를 확인
- [ ] `user_feedback.status='new'` 신고 큐의 담당자·처리 기준·증거 보존·사용자 회신 절차를 운영 문서로 확정
- [x] 코드·자동 테스트·브라우저·실기기·운영 D1·Console·계약 증거를 서로 다른 등급으로 기록하고, 미확인 외부 E2E는 release record `HOLD` blocker로 분리
- [x] **선생님 모드 코드·웹 산출물 결정**: `TEACHER_MODE_ENABLED=import.meta.env.DEV`만 허용하고 production dist에서 온보딩 카드를 숨기며 `/teacher/*` 직접 접근을 준비 안내 gate로 닫고 탈퇴·로그아웃·법적 문서 동선을 유지함을 자동 테스트와 production browser QA로 검증
- [ ] **선생님 모드 Play 산출물 E2E**: 승인 인증서로 서명한 최종 AAB의 universal APK에서 온보딩·직접 딥링크 접근 불가를 확인. 정식 출시로 바꾸려면 등록정보·Data Safety·개인정보처리방침, 반복 사용 가능한 심사 계정과 선생님/보호자 역할별 E2E를 먼저 완료

## 초기 출시 가격·티어 정본

- [x] 사용자에게는 **무료/프리미엄 두 단계만** 표시하고 `reviewed`는 기존 스토어 방문 혜택 보존용 내부 호환 상태로만 유지
- [x] 프리미엄 가격 상수와 구독 화면을 **월 4,900원·연 39,000원**으로 고정하고, 연간 월 환산액 3,250원을 표시
- [x] 공통: 일정·메모·스티커 무제한(직접 일정 추가·기존 일정 관리 포함), 준비물·숙제는 아이별 하루 각각 8개, SOS·긴급 알림 항상 제공
- [x] 무료 차등값: **새 아이 연결 상한 1명**(기존 연결 자동 해제·숨김 없음), 위치 약 10분 간격, 지금 위치 요청 최근 24시간 5회, 오늘 이력, 신규 저장 장소 2곳·생성 시각+id 순 첫 2곳 알림 대상, 신규 위험구역 1곳·첫 1곳 알림 대상, 소리 울리기 최근 24시간 1회, AI 친구 하루 5회, AI 일정 정리 하루 5회
- [x] 프리미엄: 새 아이 연결 상한 2명, 실시간 위치·지금 위치 요청 무제한, 최근 30일 이력, 저장 장소·위험구역 신규 저장과 알림 대상 모두 무제한, 소리 울리기 최근 24시간 10회, AI 친구 하루 20회, AI 일정 정리 횟수 제한 없음, 주변 소리 최대 1분, 위치 끊김·미등록 체류 자동 알림, AI 하루 요약·주간 리포트·학원 시간표 자동 정리
- [x] AI 친구 한도 도달 문구는 부모가 직접 정한 낮은 안전 상한, Free 기본 5회 소진, Premium 기본 제공량 소진을 구분한다. Free 소진 업셀은 5회→20회 차이와 `/ai-credit` 복귀 의도를 보존하고, 기존 Premium의 낮은 상한은 자동으로 덮어쓰지 않으며 부모가 `Premium 기본 20회로 설정`을 선택한 경우에만 변경
- [x] `ai_parent_settings`는 `(family_id, child_user_id)` UNIQUE와 원자 `ON CONFLICT` upsert로 한 아이 한 행을 보장한다. 기존 중복은 삭제·임의 병합하지 않는 fail-closed migration으로 운영자 정규화를 요구
- [x] 다운그레이드 시 초과 아이·저장 장소·위험구역 데이터를 삭제하거나 숨기지 않고 계속 관리할 수 있게 보존하되, 새 연결/저장과 알림 대상만 현재 Free 한도로 제한. 기존 `reviewed` 가족은 저장 장소 첫 3곳 알림 대상만 보존
- [x] Android 등록 장소 알림 master는 서버 응답이 정확히 1행의 Boolean `true`일 때만 허용하고 조회 시작·예외·누락·빈 응답에서 즉시 false+cache clear로 fail-closed. 초과 장소 데이터는 삭제하지 않음
- [x] SOS·긴급 알림과 무료 핵심 일정·가족 소통은 결제 상태와 무관하게 유지
- [ ] Play Console과 실제 결제 확인 화면의 KRW 가격이 월 4,900원·연 39,000원인지 확인하고, 가격·무료 체험·갱신 조건을 공개 문서와 일치시킴
- [x] exact local dist의 390×844 격리 브라우저에서 월 4,900원·연 39,000원, Free/Premium, 새 아이 1↔2, SOS 무료, 다운그레이드 보존, fail-closed CTA disabled·추정 가격 없음·무료 유지와 상황형 업셀을 확인
- [ ] 미배포 퍼널·realtime ticket API 404를 Worker+D1 선행 배포·readback으로 닫고 동일 A17/razr에서 Network 0-error 재검증

## 증거 등급과 대체 금지

- **코드 증거**: 실제 소스·manifest·스키마가 요구 동작을 구현했음을 보여 준다. 배포·Console·실기기 결과를 대신하지 않는다.
- **자동 테스트 증거**: 단위·계약·회귀 테스트의 명령, 실행 시각, 통과 수를 기록한다. 실제 권한·네트워크·Play 결제를 대신하지 않는다.
- **실기기 증거**: 현재 exact v1.3.0 debug APK SHA-256 `62b66ce643e38c77074e30c7fa992c48d9ea70a56a8e720a8fff9c94c8e05873`은 A17 부모와 razr 아이 모두 `adb start-server` 후 `device not found`여서 설치·버전·역할·화면·Network·crash/ANR를 검증하지 못했다. 이전 `f0c697…` 후보의 A17 부모 UI 통과·운영 API 404와 razr secure keyguard/Dozing 차단·양쪽 crash 0 결과는 역사 기록이며 현재 후보를 대신하지 않는다. 역할 전환·로그아웃·재페어링·refresh token 접근과 네이티브 알림·백그라운드 위치·마이크·원격제어·`CALL_PHONE`·결제 E2E는 수행하지 않았고 S25는 미조작했다.
- **운영 증거**: production Worker·Pages 배포 ID, D1 readback, HTTPS 응답, 실제 운영 API 결과를 기록한다. 로컬·mock 결과로 대체하지 않는다.
- **Console 증거**: Play Console의 대상 연령, Data Safety, Families, 모니터링, FGS/FSI, 트랙, 결제·RTDN 설정 화면과 승인 상태를 기록한다.
- **계약 증거**: 외부 처리업체별 계약·DPA, 제품 설정, 보관·삭제 기간, 학습·광고 등 2차 이용 조건과 아동 대상 적격성 문서를 기록한다.
- 어느 한 등급의 증거만으로 다른 등급을 완료 처리하지 않는다. 확인하지 않은 항목은 체크하지 않고 제출 차단을 유지한다.

## 2026-08-01 Worker migration-first manifest

아래 목록은 `C:\Users\TK\Desktop\hyeni-1\worker\README.md`와 `worker/ops/web-billing-refund-runbook.md`를 합친 이번 출시의 운영 정본이다. 실행 직전에 운영 D1을 다시 읽기 전용으로 확인하고, 각 단계의 조건과 현재 스키마가 정확히 일치할 때만 적용한다. base와 기존 DB용 additive를 같은 기능군에 함께 실행하거나, `ALTER TABLE ... ADD COLUMN` one-time migration을 재실행하지 않는다. 하나라도 적용 또는 readback에 실패하면 Worker를 배포하지 않는다.

2026-08-02 12:02 KST에 검증된 단일 read-only SQL을 운영 D1에 다시 실행했다. 출시 필수 객체 25개 중 2개만 존재하고 23개가 없었으며 `has_ai_friend_limit_source=0`, `has_ai_schedule_limit_source=0`이었다. `ai_credit_balances`에는 동일 `(family_id, child_user_id)` 중복 그룹 1개·총 6행이 있어 현재 migration은 추가 5행을 삭제한다. 익명 집계상 구매 크레딧·일일 사용량 보존 합계는 모두 0이고 `ai_parent_settings` 중복·정규화 대상도 0이지만 삭제라는 사실은 바뀌지 않는다. 필수 컬럼 `google_play_purchase_events.debt_applied`, `web_billing_charge_attempts.refund_status`, `web_billing_charge_attempts.customer_key`, `web_ai_credit_orders.record_scope`는 모두 부재했다. 실행 메타는 `changes=0`, `changed_db=false`, `rows_written=0`이며 식별자·원본 행·secret 값은 저장하지 않았다. 재현 SQL은 sibling `worker/ops/release-d1-readonly-preflight.sql`, 기계 증거는 `artifacts/release-evidence/d1-readonly-preflight-20260802-120214.json`이다. 10:46 bookmark는 과거 스냅샷이어서 current final release record에 연결하지 않았고, 실제 변경 창 직전 새 preflight·bookmark를 다시 캡처해야 한다.

| 순서 | migration 정본 | 정확한 적용 조건 | 적용 후 필수 readback |
|---:|---|---|---|
| 1 | `db/ai-credit-balance-uniqueness.sql` | 현재 5행 삭제가 발생하므로 에이전트 실행 금지. Time Travel bookmark·복구 명령·restricted release record를 확보하고 익명 집계와 병합 규칙을 운영 책임자가 승인한 뒤 운영자가 정확히 1회 수동 실행. 웹 AI·추천보다 먼저 적용 | `idx_ai_credit_balances_family_child_unique` 존재, 중복 group 0, 삭제 전후 잔액·원장 불변식과 복구 bookmark 기록 |
| 2 | `db/premium-funnel.sql` → 기존 DB용 `worker/db/premium-funnel-ai-friend-limit.sql` → `worker/db/premium-funnel-ai-schedule-limit.sql` → `db/family-lifecycle-funnel.sql` → `db/revenue-cost-ledger.sql` | 신규 DB는 base만 적용한다. 기존 `premium_funnel_events`에서 `has_ai_friend_limit_source=0`이면 friend forward migration을 정확히 1회 적용하고, `has_ai_schedule_limit_source=0`이면 schedule forward migration을 정확히 1회 적용한다. 변경 전 bookmark를 먼저 보존하며 이미 `1`인 migration은 재실행하지 않는다. 세 정본과 `PREMIUM_FUNNEL_HASH_SECRET`을 Worker보다 먼저 준비 | migration 후 preflight·bookmark를 새 파일로 재캡처한다. `premium_funnel_events`, `premium_funnel_rate_limits`, `family_lifecycle_events`, `family_lifecycle_daily`, `revenue_cost_ledger`, `revenue_cost_coverage`와 각 migration의 인덱스가 존재하고 최종 read-only preflight의 `has_ai_friend_limit_source=1`·`has_ai_schedule_limit_source=1` 확인이 필수이며 아니면 `HOLD`. 변경 전 `0` bookmark는 복구 기준으로 별도 보존 |
| 3 | `db/location-confirmation-records.sql` → `db/location-history-ingest-quota.sql` → `db/location-history-retention.sql` | 확인자료 테이블·trigger를 먼저 만들고, 기존 위치 이력을 quota에 backfill한 뒤 보존 인덱스 생성. 확인자료 trigger는 같은 가족·자녀·행위·실측 시각의 reciprocal `service_code`만 중복 제거하고 `history_estimated`를 확인자료로 만들지 않음 | `location_confirmation_records`, `idx_location_confirmation_recorded`, `idx_location_confirmation_family_subject_occurred`, 확인자료 trigger 3개, `location_history_ingest_daily_usage`, quota trigger, `idx_location_history_recorded_family`, `idx_location_history_family_recorded_norm` 존재 |
| 4 | 신규 웹 구독 DB: `db/web-billing.sql`만. 기존 DB: `db/web-billing-key-revocation.sql` → `db/google-play-family-trial-claim.sql` → `db/web-billing-refunds.sql` → `db/web-billing-financial-retention.sql` 중 누락분만 | `PRAGMA table_info(web_billing_customers)`, `PRAGMA table_info(web_billing_trial_claims)`, `PRAGMA table_info(web_billing_charge_attempts)`로 신규/기존 분기. 현재 스냅샷처럼 세 결과가 모두 비어 있으면 base만 적용. `refund_status`는 있는데 `customer_key`가 없으면 중단 | checkout·customers·charge attempts·refund records·trial claims·provider reservations·financial records 7개 테이블과 migration이 정의한 인덱스 전부, 환불 핵심 컬럼과 `idx_web_billing_charge_refund_reconcile` SQL 일치 |
| 5 | 신규 웹 AI DB: `db/web-ai-credit-billing.sql`만. 기존 DB: `db/web-ai-credit-financial-retention.sql`만 | 1단계 unique 완료 후 `PRAGMA table_info(web_ai_credit_orders)`가 비면 base만, 테이블은 있고 `record_scope`가 없으면 additive만 정확히 1회 | `web_ai_credit_orders`, `web_ai_credit_detached_balances`, `web_ai_credit_lookup_windows` 3개 테이블과 migration이 정의한 인덱스 6개 존재, `payment_key`/`paymentKey` 원문 컬럼 0 |
| 6 | `db/referral-rewards-v2.sql` | 1단계 unique와 3단계 위치 확인자료 정본 완료 뒤 정확히 1회 | `referral_codes_v2`, `referral_completions_v2`, `idx_referral_completions_v2_ready`, `trg_referral_location_evidence_snapshot`과 migration이 정의한 나머지 인덱스 존재 |
| 7 | `db/google-play-rtdn-schema.sql` → `db/google-play-credit-debt-disclosure.sql` | 4단계의 `billing_provider_reservations` 준비 후 적용. 현재 운영의 RTDN/owner 컬럼·인덱스는 완전하므로 첫 파일은 없는 voided-purchase 정본만 `IF NOT EXISTS`로 추가한다. debt disclosure는 `debt_applied`가 없을 때만 정확히 1회 | `google_play_rtdn_events`, `google_play_billing_owners`, `google_play_voided_purchase_events`, migration이 정의한 인덱스 6개와 `google_play_purchase_events.debt_applied` 존재 |

- [ ] 위 7단계를 적용 전 진단·적용 결과·적용 후 readback과 시각·운영자·Worker 배포 ID로 연결
- [ ] Worker 배포 전 `worker/db/pending-notification-retention.sql`을 적용하고 `idx_pending_notifications_expiry` SQL을 readback. 적용 전에는 새 hourly retention을 배포하지 않음
- [ ] 상용 출시 전 Cloudflare 계정이 **Workers Paid**인지 Dashboard에서 확인하고, D1 Free의 DB당 500MB·일 100,000 rows_written·invocation당 50 queries 한도에 의존하는 상태에서는 배포하지 않음
- [ ] `LOCATION_AUDIT_CURSOR_SECRET`을 32바이트 이상 전용 HMAC secret으로 설정하고 값은 출력하지 않음. 누락·짧은 secret은 감사 API 503, payload·서명 변조와 scope 재사용은 400인지 확인
- [ ] migration 직후와 트래픽 확대 전 `worker/ops/location-confirmation-capacity.sql`을 읽기 전용으로 실행하고 D1 Dashboard/GraphQL의 최근 24시간 `rows_written`·실제 DB byte와 함께 기록. 전체 DB 사용률 50%는 용량 설계, 70%는 분리 리허설, 85%는 신규 확대·출시 HOLD로 처리
- [ ] 배포 후 `GET /api/location/audit`가 모든 성공 응답에서 `{ records, hasMore, nextCursor }`를 반환하고, 같은 시각 1,005건을 기본 1,000건 페이지와 cursor로 누락·중복 없이 전부 순회하는지 운영 사본으로 확인
- [ ] AI balance 중복 1그룹·삭제 대상 5행은 Time Travel 복구 증거와 운영 책임자 명시 승인 없이 실행하지 않음
- [x] 익명 운영 구조와 6행 중복 fixture를 재현한 격리 `:memory:` SQLite에서 삭제 전후 잔액·원장 불변식과 전체 7단계 SQL 순차 적용 회귀 통과. 실제 production export/Time Travel clone 증거로 대체하지 않음
- [ ] AI balance migration은 실제 production 사본/Time Travel 격리 clone에서 삭제 전후 잔액·원장 불변식과 전체 7단계 dress rehearsal을 다시 통과
- [ ] 실제 적용은 AI 크레딧 쓰기를 멈추거나 최소화한 유지보수 창에서 직전 중복 재진단 → 보호된 행 단위 복구 자료와 Time Travel bookmark 확보 → unique migration → readback → 새 Worker 연속 배포 순서로 실행하고 구 Worker가 UNIQUE 위반을 만나는 간격을 최소화
- [ ] 사용자 쓰기를 다시 연 뒤에는 Time Travel 전체 복원으로 정상 쓰기를 되감지 않음. 재오픈 전 실패일 때만 승인된 전체 복원을 사용하고, 재오픈 뒤 문제는 검토된 additive/행 단위 복구로 처리
- [ ] Android 전용 결제 정책의 필수 Worker secret 10개를 값 노출 없이 확인: `PREMIUM_FUNNEL_HASH_SECRET`, `LOCATION_AUDIT_CURSOR_SECRET`, `WEB_BILLING_KEY_ENCRYPTION_SECRET`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_RTDN_AUDIENCE`, `GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `RESEND_API_KEY`, `FEEDBACK_FROM_EMAIL`. Toss client/secret·가격 환경값은 신규로 설정하지 않는다
- [ ] secret 값은 파일·명령 인자·셸 history·로그·보고서에 남기지 않고 `wrangler secret put`의 대화형 입력만 사용
- [ ] 대화형 입력 후 저장소 루트에서 `npm run verify:production:worker-secrets`를 실행해 exit 0 확인. 이 게이트는 Wrangler inventory의 이름·설정 유형만 읽고 값은 출력하지 않으며, 하나라도 누락되면 Worker 배포 `HOLD`
- [ ] migration과 secret readback이 모두 끝난 뒤 Worker를 먼저 배포하고 새 API 404·503·health·cron·환불 모니터를 확인한 다음 Pages를 배포

## 서명 자격정보 안전 정리

- [x] 업로드 키스토어 경로는 Git에서 제외됨: `android/keystore/hyeni-upload.jks`
- [ ] `android/keystore/hyeni-upload-credentials.txt`의 값을 에이전트나 자동화가 읽지 않은 상태에서 운영자가 비밀번호 관리자로 옮김
- [ ] 운영자가 평문 자격정보 파일을 직접 삭제하고, 백업·휴지통·공유 폴더에도 사본이 없는지 확인
- [ ] 서명 비밀번호를 명령 인자, PowerShell history, CI 로그, 문서에 남기지 않음

비밀번호는 운영자가 보이지 않는 입력창에 직접 입력하고 Gradle 자식 프로세스에 임시 환경변수로만 전달한다. 빌드가 끝나거나 실패하면 반드시 환경변수를 제거한다.

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
  .\gradlew bundleRelease
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

## Data Safety·개인정보처리방침

- [ ] 이름, 이메일, 사용자 ID, 전화번호, 생년월일, 정확한 위치, 저장 장소·주소를 유형별로 신고
- [ ] 사진, 가족 메모·위치 공유, 일정·준비물, AI 입력·출력을 사용자 콘텐츠로 신고
- [ ] 설치된 앱, 앱 사용 시간, 잠금 해제, 배터리·네트워크·알림 상태, 오류 진단을 실제 처리 범위대로 신고
- [ ] 앱 설치 ID, FCM 토큰, 세션 ID, 구매 내역·구독 상태를 신고
- [ ] 주변 소리 음성 본문은 일시 처리, 감사 메타데이터는 저장된다는 차이를 표시
- [ ] Android `SpeechRecognizer`와 Web Speech의 외부 처리 가능성을 개인정보처리방침에 반영
- [ ] Cloudflare, Firebase/FCM, Google Play, Google/Kakao/Naver OAuth, OpenAI, Kakao 지도·모빌리티, Google Maps Platform, 공개 OSRM, Resend, NCP SENS, 음성 인식 제공자의 실제 전송 필드를 Data Safety에 반영. 비활성 레거시 Toss 경로를 현재 운영 처리업체로 신고하지 않는다
- [ ] Resend의 `senderName`·`senderEmail`·`senderRole`·`senderUserId`·`familyId`·`content`, NCP SENS의 전화번호·6자리 OTP, 공개 OSRM의 출발·도착 좌표 전송을 반영
- [ ] 각 외부 흐름의 계약·DPA, 실제 설정, 보관·삭제 기간, 2차 이용 증거가 모두 확보되기 전에는 서비스 제공자 예외를 적용하지 않음
- [ ] 개인정보처리방침에 AI 친구뿐 아니라 AI 일정 사진·텍스트, AI 요약, 음성 인식 처리를 모두 포함
- [ ] Play 지원 이메일과 개인정보처리방침 연락처를 `mail@hyenicalendar.com`으로 일치시키고 실제 수신 확인
- [ ] 실제 사업 형태에 대해 위치정보사업·위치기반서비스 신고/등록 유형을 담당 법률 전문가가 판정하고, 필요한 접수·등록 증빙 또는 적용 제외 의견을 보존
- [ ] 위치 동의 화면의 필수 고지 항목, 수집·이용·제공사실 확인자료 필드, 최소 6개월 보존, 사용자 열람 절차를 각각 법률 검토 결과와 운영 증거로 대조
- [ ] `location_confirmation_records` 테이블·인덱스·trigger, quota·retention readback과 열람 API 검증을 먼저 끝낸 뒤 일치하는 공개 법적 문구를 배포. 고지만 먼저 배포하거나 스키마 없이 확인자료 보존을 약속하지 않음
- [ ] 공개 삭제 안내가 주 보호자 가족 범위, 공동 보호자·아이 self 범위, 선생님 graph 범위와 독립 아이 계정 보존 조건을 구분하고, 로그인 없이 HTTPS 200으로 열리는지 확인

## Play Console 정책 선언

### 백그라운드 위치

- [ ] 선언 폼에는 **하나의 핵심 위치 기능**만 설명: “아이 기기가 앱 밖에 있어도 보호자에게 위치를 공유해 가족 안전 기능을 제공”
- [ ] 앱의 prominent disclosure에는 “location/위치”, 앱을 닫거나 사용하지 않을 때의 수집, 보호자 공유를 명시
- [ ] prominent disclosure와 심사 영상에는 현재 위치, 오늘 경로, 도착·출발, 일정 미도착, 위험 장소 등 실제 사용을 모두 보여 줌
- [ ] 전경 권한을 먼저 받고 별도 설명·사용자 동작으로 백그라운드 권한을 요청
- [ ] 거부해도 앱은 열리며 제한되는 위치 기능을 정확히 안내

### Foreground Service 3종

- [ ] `FOREGROUND_SERVICE_LOCATION`: 위치 공유의 핵심성, 시작 조건, 지속 알림·고유 아이콘, 중단 영향, 실제 영상 제출
- [ ] `FOREGROUND_SERVICE_MICROPHONE`: 서버 승인 증표를 1회 소비한 `RemoteListenActivity`가 준비되면 아이 탭 없이 자동 연결, 최대 1분, 아이 화면·지속 알림·감사 기록, 권한 거부·중단 영향, 실제 영상 제출
- [ ] FGS `specialUse`(`emergency_parental_alert`): 구체적 사용 목적, 사용자에게 보이는 알림, 지연·중단 영향, 실제 영상 제출
- [ ] 최종 AAB의 merged manifest와 Play Console FGS 선언이 정확히 일치
- [ ] 2026-08-26 시행 예정 정책에서 geofencing이 승인 FGS 용도에서 제외되는 변경을 제출일에 다시 확인하고, 연속 위치 공유 핵심 기능과 지오펜스 트리거를 선언·구현에서 구분

### 전체 화면 인텐트·알림

- [ ] 혜니캘린더는 **전화·알람 앱이 아님**을 전제로 `USE_FULL_SCREEN_INTENT` 자동 허용 대상처럼 답하지 않음
- [ ] Android 특별 접근 권한을 사용자가 직접 허용하는 흐름과 거부·회수 상태를 확인
- [ ] 전체 화면을 사용할 수 없을 때 높은 중요도의 heads-up 알림으로 강등되는지 확인
- [ ] 일반 일정·미도착·메모 알림이 SOS 전체 화면으로 잘못 승격되지 않는지 확인

### 일정 알림·전화 최소 권한

- [x] 일정 알림 정본은 서버 cron이며 JS에서 네이티브 예약 알림 API를 호출하지 않음을 코드로 확인
- [x] 정확한 알람 특별 권한을 manifest에서 제거하고 위치 재시작·heartbeat·레거시 예약 알림은 inexact alarm으로 유지
- [x] **`CALL_PHONE` 결정**: v1.3.0에서는 아이 SOS 화면의 명시적 보호자 전화 버튼을 핵심 안전 동작으로 보아 유지. 권한 허용 시 `ACTION_CALL`, 거부·실패 시 `ACTION_DIAL` 폴백이며 통화기록은 읽지 않음을 코드와 manifest에서 확인
- [ ] `CALL_PHONE` 유지 근거, 권한 직전 설명, 아이 기기 허용·거부·회수, `ACTION_CALL`·`ACTION_DIAL` 결과를 실제 아이 기기 영상·로그로 검증하고 심사 접근 안내에 포함. 이 증거가 없으면 제출 차단
- [x] Gradle `release` 변형의 merged manifest 권한 24개를 승인 allowlist와 exact match로 고정하고, legacy 저장소 권한은 `maxSdkVersion=28`, `QUERY_ALL_PACKAGES`·미디어 읽기·오버레이·정확한 알람·배터리 예외 권한은 부재함을 자동 검증
- [ ] 서명 release AAB의 bundletool manifest 권한 목록을 위 Gradle merged manifest와 대조한 최소 권한 검토 기록 보관

### 자녀 모니터링·사용정보·마이크

- [x] Gradle `release` 변형 merged manifest의 `isMonitoringTool=child_monitoring` exact value를 자동 검증
- [ ] 내부 테스트·비공개 테스트·공개 테스트·프로덕션 모든 활성 Play 트랙의 각 AAB에서 `isMonitoringTool=child_monitoring`과 모니터링 고지 문안이 동일함을 artifact manifest·트랙 목록으로 확인
- [ ] 스토어 긴 설명과 prominent disclosure에 자녀 보호 목적의 위치·앱 사용정보 모니터링을 공개
- [ ] 위치·마이크 foreground service 실행 중 지속 알림과 기능별 고유 아이콘이 표시되는지 확인
- [ ] `PACKAGE_USAGE_STATS`는 자녀 보호 목적과 Android 설정에서 사용자가 직접 허용하는 과정을 설명
- [ ] 주변 소리 듣기는 FCM·pending 수신만으로 시작되지 않고 서버 승인 증표·세션 nonce·가족·대상 일치를 확인한 `RemoteListenActivity`에서만 시작. 준비 상태에서는 아이 탭 없이 자동 연결하되 아이 화면·잠금 화면 알림에 계속 표시되고 1분 상한·감사 기록을 지키는지 확인

### 대상 연령·Families

- [ ] 실제 보호자와 아이 이용자를 근거로 **보호자+아동 혼합 연령**과 정확한 연령 구간을 제품·정책 책임자가 결정
- [ ] 아이 모드에서 아동이 직접 일정·대화·SOS·AI를 사용하므로 심사를 피하기 위한 성인 전용 선택을 금지
- [ ] 정밀·백그라운드 위치를 유지하는 현재 앱의 아동 전용 제출을 금지
- [ ] 혼합 연령이어도 아이 경로에서 접근 가능한 API/SDK의 Families 적격성 증거가 없으면 해당 기능을 아이 경로에서 코드로 차단하고 차단 E2E를 확보
- [ ] Firebase/FCM, Kakao 지도·경로, 공개 OSRM, OpenAI, Android `SpeechRecognizer`·Web Speech 등 아이 경로의 모든 외부 처리에 대해 Families·아동 데이터 적격성을 확인
- [ ] 선택한 대상 연령과 근거를 출시 기록에 남김

## Play Console 설정·결제

- [ ] 앱 생성: `com.hyeni.calendar`, 한국어(대한민국), 무료 앱·인앱 구독 있음
- [ ] Play Console의 실제 개발자 계정 유형·생성일·신원/연락처/실기기 확인 상태를 기록. 2023-11-13 이후 생성된 개인 계정이면 [Google 공식 요건](https://support.google.com/googleplay/android-developer/answer/14151465?hl=ko)에 따라 최소 12명이 연속 14일 opt-in한 비공개 테스트와 production access 승인을 완료
- [ ] Google Play Billing로 유료 구독을 판매할 merchant account·Google payments profile을 연결하고 법적·세금 정보를 확인. [공식 결제 프로필 안내](https://support.google.com/googleplay/android-developer/answer/3092739?hl=ko)에 따라 수익 수령용 지급수단·은행 계좌 검증까지 완료
- [ ] Play Console 내부·비공개·공개·프로덕션 전체 트랙의 후보 이전 최대 versionCode와 증거 reference를 `client-release-inventory.json`에 기록. 현재 6보다 크거나 같은 값이 있으면 versionCode를 증가한 뒤 전체 검증·서명 AAB를 다시 생성하며 이미 업로드한 versionCode를 재사용하지 않음
- [ ] 기존 공개 설치 inventory가 정확히 0임을 증명하거나 `compatibility_cutover_approved` 책임자·증거를 기록. 0 증거가 없으면 v1.3.0(5)이 기존 설치 대상 계정·트랙에서 실제 설치 가능해진 뒤에만 Pages `minimumSupportedVersion=1.3.0`을 배포
- [ ] Play App Signing 사용 후 최신 AAB를 내부 테스트 트랙에 먼저 업로드
- [ ] 최종 서명 AAB와 Play App Bundle Explorer에서 `targetSdkVersion=36`, Play Billing Library `9.0.0`을 다시 확인하고 로컬 debug 산출물 값으로 대체하지 않음
- [ ] 최종 서명 AAB의 `bundletool dump config`가 `PAGE_ALIGNMENT_16K`이고, Play가 생성한 APK의 `zipalign -P 16` 및 모든 포함 ELF `LOAD align >= 2**14`를 확인한 뒤 `PAGE_SIZE=16384` 기기 또는 에뮬레이터에서 설치·실행·로그인·부모/아이 핵심 네이티브 경로를 통과
- [ ] 최신 후보에서 A17 부모 세로 화면은 통과했고 두 기기 crash·native crash·ANR는 0이다. razr 아이 세로/가로 핵심 경로는 secure keyguard·Dozing 해제 뒤 재검증하며 원래 상태를 다시 복원
- [ ] 태블릿·폴더블 대표 기기에서 창 크기 변경·분할 화면을 검증하고 overflow·잘린 조작부·상태 유실·crash가 없음을 기록
- [ ] Play Console의 **App signing key certificate SHA-256** `98:09:2B:A4:B5:E1:BB:6D:97:8E:D8:75:29:4A:B3:1B:66:06:8E:8A:9F:6A:46:F9:3D:45:BD:CC:F2:8E:64:4F` 로컬 반영·debug 지문 제거 완료. Pages 재배포는 미완료
- [ ] `https://hyeni-calendar.pages.dev/.well-known/assetlinks.json`이 리디렉션 없이 HTTPS 200·`application/json`으로 응답하고, 설치된 Play 빌드의 `pm get-app-links com.hyeni.calendar`가 도메인을 `verified`로 표시
- [ ] 개인정보처리방침·데이터 삭제·앱 접근 권한 입력
- [ ] 최종 AAB와 SDK 목록에 광고 SDK·배너·네이티브 광고·자사 앱 광고가 없음을 다시 확인하고 App content에서 [광고 없음으로 선언](https://support.google.com/googleplay/android-developer/answer/9859455?hl=ko). 인앱 구독 업그레이드 안내만 있다는 이유로 광고 있음으로 오표기하지 않음
- [ ] 모든 앱에 필요한 [Health apps 선언](https://support.google.com/googleplay/android-developer/answer/14738291?hl=ko)을 완료하고, 앱 기능·데이터를 대조한 결과 건강 기능이 없다면 그 사실을 선택
- [ ] 모든 앱에 필요한 [Financial features 선언](https://support.google.com/googleplay/android-developer/answer/13849271?hl=ko)을 완료. 친구 초대 AI 크레딧·유료 크레딧이 `rewards, points, other incentives`에 해당하는지 Console 문구와 정책 책임자가 검토하고 임의로 금융 기능 없음 처리하지 않음
- [ ] Government apps 선언을 실제 소유·정부 정보 제공 여부대로 완료하고, Console이 News apps 선언을 노출하거나 스토어 분류·문구가 적용 범위에 들어가면 해당 선언도 완료
- [ ] App content 대시보드에 노출된 모든 필수·조건부 선언이 완료 상태인지 최종 AAB·SDK·상품·스토어 문구와 대조한 증거를 보존
- [ ] IARC 설문에 AI 생성 콘텐츠, 가족 간 사용자 통신, 사진·위치 공유를 사실대로 답하고 Console이 반환한 등급 사용
- [ ] Android Publisher API 활성화와 서비스 계정 최소 권한 부여
- [x] Pub/Sub topic을 Play Console RTDN에 연결하고 인증 push subscription 구성. 2026-09-01 테스트 알림이 운영 Worker→D1에서 `event_kind=test`, `status=ignored`, `attempts=1`, `last_error=null`로 처리됨을 readback
- [x] Google Play 필수 secret `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_RTDN_AUDIENCE`, `GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL` 3개를 포함한 운영 필수 secret 10개 설정을 값 노출 없이 inventory gate로 확인. `GOOGLE_PLAY_PACKAGE_NAME`은 기본값 `com.hyeni.calendar` 유지
- [ ] 상품 `hyeni_premium`의 실제 월간·연간 base plan·한국 가격이 각각 4,900원·39,000원인지 Console과 앱 결제 화면에서 확인
- [ ] Play가 현재 계정에 eligible로 반환한 정확한 7일 무료 pricing phase만 표시되는지 확인
- [x] 코드 계약: 서버 `subscriptionsv2.get` 검증 후 `active|trial|grace`인 미승인 구독만 entitlement 저장 전에 acknowledge하고, 클라이언트는 서버가 `needsClientAcknowledge`를 지시할 때만 보조 acknowledge
- [x] 코드 계약: 복원은 `queryPurchases()` 결과 중 `PURCHASED` 구독만 서버에 재검증하고 `PENDING`·`UNSPECIFIED`를 entitlement로 열지 않음
- [x] 코드 계약: RTDN 알림 종류만 신뢰하지 않고 Google OIDC·audience·service account email 검증 뒤 `subscriptionsv2.get`으로 재조회하며 purchase token hash로 소유권·멱등 처리
- [ ] license tester로 `PURCHASED`·`PENDING`·취소 흐름, acknowledge 완료, trial·active·grace·on-hold·expired·revoked 상태, 구매 복원, 앱 재시작·foreground 재검증, 갱신·해지·환불·중복 RTDN 실제 E2E
- [ ] Play Console 주문·테스트 구독·RTDN/Pub/Sub 로그와 앱·Worker·D1 상태를 같은 테스트 건별로 연결해 Console 증거와 운영 증거를 보존
- [ ] 내부 테스트 AAB의 Pre-launch report에서 crash·ANR·접근성·보안 결과를 검토하고, 로그인·페어링에 막히면 반복 가능한 테스트 계정으로 재실행. Android vitals와 지원 기기 카탈로그에서 Android 16·폴더블·저사양 대표군 및 의도하지 않은 제외가 없는지 확인해 단계적 rollout 확대 조건에 연결
- [x] Qonversion은 앱의 활성 결제 경로가 아니며, 보조 webhook health도 설정 유무와 무관하게 `primaryProvider:false`를 반환하고 Google Play 직접 검증을 결제 정본으로 유지함을 자동 검증

### 비활성 레거시: iPhone 홈 화면 PWA Toss 자동결제

> 2026-09-01 Android Google Play 전용 정책에 따라 아래 Toss 항목은 신규 출시 체크리스트가 아니라 과거 설계 기록이다.
> 신규 키·가격·checkout을 설정하거나 열지 않으며, 기존 주문이 발견될 때 승인된 복구 절차에서만 참고한다.

- [ ] 실제 iPhone Safari에서 홈 화면 PWA를 설치하고 standalone 실행·active Service Worker·오프라인 재진입을 확인
- [ ] 기존 구버전 Service Worker/cache가 있는 iPhone 홈 화면 PWA의 열린 탭을 배포 전부터 유지하고, 배포 뒤 `registration.update()` 시 `registerType: prompt`의 안전 업데이트 큐가 유휴 상태에서는 수동 새로고침 없이 자동 활성화·reload하는지 확인. 결제·AI 크레딧 대사·주변소리·미저장 편집 중에는 reload가 보류되고 종료 직후 정확히 한 번 적용되어야 한다. 새 entry URL·새 Worker controlling·구/신 chunk 혼합 404 및 Console error 0건·새 Free/Premium/결제 UI·오프라인 재실행을 통과
- [ ] `VAPID_PUBLIC_KEY`·`VAPID_PRIVATE_KEY` 설정 뒤 실제 iPhone 홈 화면 PWA에서 Web Push 권한·구독·수신·탭 라우팅을 확인하고, 일반 Safari 탭에는 홈 화면 추가 안내가 표시되는지 확인
- [ ] 사용자 탭 안에서 AudioContext가 먼저 활성화되고 부모 iPhone PWA가 razr 아이의 승인된 native WAV를 재생·1분 종료·감사 기록까지 처리하는지 확인. 이번 읽기 검증에서는 마이크·원격청취를 실행하지 않음
- [ ] 부모 iPhone PWA↔razr 아이에서 위치 즉시 요청·기기 상태·메시지·ACK·알림과 허용된 안전 제어를 검증. 실제 Android OS 권한이 아이 기기에서 1회 필요하다는 한계를 숨기지 않으며 이번 읽기 검증에서는 원격제어를 실행하지 않음
- (역사 기록) Toss Payments 자동결제 계약·추가 위험 검토·live key 발급은 완료하지 않았고 신규 진행하지 않는다.
- [ ] 운영 D1 스키마를 먼저 읽고, 웹 결제 테이블이 없으면 `web-billing.sql`만 적용. 기존 테이블이면 누락 컬럼을 확인한 뒤 `web-billing-key-revocation.sql` → `google-play-family-trial-claim.sql` → `web-billing-refunds.sql` → `web-billing-financial-retention.sql` 순서로 필요한 migration만 각각 한 번 적용하고 환불 테이블·컬럼·인덱스를 readback. 신규 base와 additive 동시 적용·one-time additive 재실행 금지. `refund_status`는 있는데 `customer_key`가 없으면 배포 중단
- [x] 신규 `TOSS_PAYMENTS_CLIENT_KEY`·`TOSS_PAYMENTS_SECRET_KEY`는 설정하지 않는다. `WEB_BILLING_KEY_ENCRYPTION_SECRET`만 과거 암호화 빌링키의 안전한 대사·해지·환불을 위해 유지한다.
- [ ] catalog·checkout·결제사 조회가 KRW와 월 4,900원·연 39,000원, order/customer/상태를 모두 대조하며 불일치·timeout·5xx에서 권리를 열지 않는지 확인
- [ ] Safari/PWA 복귀 중 `sessionStorage`가 유실된 구독 checkout을 인증된 Worker resolver가 현재 사용자 소유권·금액·통화·주문 상태까지 대조한 뒤에만 복구하는지 sandbox에서 확인
- [ ] sandbox에서 최초 결제·정확한 7일 eligible 체험·갱신·해지 예약·기간 말 종료·실패 대사·환불·중복 요청·계정 삭제 시 원격 billing key 폐기를 E2E
- [ ] `billing_provider_reservations`로 Google Play와 Toss 동시 활성화를 막고, 미확정·충돌 결제를 자동 덮어쓰기·재청구 없이 환불 필요 상태로 격리하는지 확인
- [x] 카드번호·유효기간·CVC는 Worker가 받지 않고, `authKey`는 저장하지 않으며, `billingKey`는 AES-256-GCM 암호문만, `paymentKey`·Google Play purchase token은 비가역 해시만 저장한다. Toss가 같은 고객값을 후속 결제·조회에 요구하므로 서버가 사용자·가족 정보 없이 난수로 만든 `customerKey`만 운영 checkout/customer/order 행에 원문 보관한다. 이 값은 로그·응답 진단·계정 삭제 후 분리 금융 정본에는 남기지 않는 실제 계약을 코드·스키마로 확인
- [ ] 운영 `customerKey`의 보관·삭제 기간과 Toss 국외 이전·2차 이용·DPA를 개인정보처리방침 및 실제 계약에 맞춰 정책·법무 책임자가 승인

### 친구 초대·금융 보존

- [ ] `ai-credit-balance-uniqueness.sql`과 `referral-rewards-v2.sql`을 운영 적용·readback하고 추천 cron을 검증
- [ ] 친구 초대는 양쪽 가족에 각각 AI 대화 50회를 1회 지급하고 초대 가족 수 상한은 없음, 신규 가족 72시간·첫 실제 위치 후 48시간 유지, 자기/공동 보호자/기존 가족/중복 귀속·부정 이용 차단을 E2E
- [x] 추천 지급 mutation은 서버 cron 경로에만 두고 클라이언트에는 조회·코드 발급만 노출하며, 추천 원장·응답 스키마에 위치 좌표·주소·자녀 이름이 없음을 자동 검증
- [x] 레거시 Toss AI 크레딧 코드는 승인된 30·80·200팩 중 양의 정수 KRW 환경 가격이 있는 팩만 서버 catalog에 노출하지만, 현재는 가격을 설정하지 않고 신규 catalog·checkout을 닫는다.
- [ ] Safari/PWA 복귀 중 `sessionStorage`가 유실된 AI 크레딧 주문을 인증된 Worker resolver가 소유권·팩 수량·금액·통화·주문 상태까지 대조한 뒤에만 복구하는지 sandbox에서 확인
- [ ] 신규 웹 AI DB는 `web-ai-credit-billing.sql`, 기존 `web_ai_credit_orders`에 `record_scope`가 없을 때는 base 대신 `web-ai-credit-financial-retention.sql`을 정확히 한 번 적용하고, 미승인·실패 30일, 승인·전액 환불 5년, 미확정 자동 삭제 금지 정책을 readback
- [ ] 웹 구독 금융 보존은 위 Worker migration manifest 4단계의 신규/기존 분기와 전체 순서를 그대로 따르고, 결제 완료·체험 이력의 PII 없는 최소 정본을 계정·가족 삭제 뒤 5년 분리 보존하며 결제사 대사 미완료 상태는 삭제를 fail-closed 하는지 검증
- [ ] 계정·가족 관계 삭제 뒤 최소 금융 스냅샷과 signed 잔액을 분리하고 환불 대사 완료 전 신규 결제를 fail-closed하는지 확인
- [ ] Toss 자동결제·친구 초대·금융 정본·위치 확인자료 보존을 공개 개인정보처리방침·이용약관·운영 절차에 반영하고 실제 사업 형태의 전문 법률 검토 완료

## 심사 접근·스토어 자산

- [x] 초기 등록정보 정본은 앱 유형 `앱`, 카테고리 `육아(Parenting)`, 기본 언어 `한국어(대한민국)`, 초기 배포 지역 `대한민국`, 개발자 웹사이트 `https://hyeni-calendar.pages.dev`로 단일 결정
- [ ] Play Console에서 위 유형·카테고리·언어·국가/지역·현재 제공되는 관련 태그·개발자 연락처/웹사이트를 실제 저장하고 등록정보 문서와 readback
- [ ] 반복 사용 가능한 데모 보호자·자녀 계정과 단계별 접근 안내 제공
- [ ] 1회용 OTP·만료되는 QR·실사용 가족 계정을 심사 접근 수단으로 제공하지 않음
- [x] 정적 데모 세션의 실제 production UI를 1080×1920 불투명 RGB PNG 6장으로 재촬영하고 원본 dist·각 파일 SHA-256을 manifest에 고정
- [x] 데모 문구 외 아이 사진·실명·주소·학교·학원·지도 좌표·초대 코드·QR·전화번호·이메일·실알림 내용이 없고 EXIF·IPTC·XMP가 없는지 6장 확대·기계 검토
- [x] 앱 아이콘 512×512와 피처 그래픽 1024×500의 PNG·채널·투명도·크기 상한을 검증하고 육안 확인
- [ ] 지원 이메일 `mail@hyenicalendar.com`으로 실제 문의 송수신 확인

## 최종 승인

- [x] 현재 작업 트리에서 앱 1,231/1,231·Worker 1,159/1,159·legacy 2,208/2,208, production build, PWA precache/entry budget/runtime, Android 172/172 강제 재실행·lint/assemble/bundle과 최신 debug artifact/schema v4 SHA-256을 같은 후보 증거로 기록. `release-record-20260802-final-local-hold-v5.json`은 blocker 27건으로 `HOLD`
- [ ] 변경을 clean commit으로 고정한 뒤 exact app/sibling SHA의 교차 CI와 release record에 위 전체 결과를 연결
- [x] v1.3.0 local production bundle exact dist 414파일/tree `21fd84…6c1e5`/index `c4a51f…b616a`와 390×844@2x 부모 42/42·아이 14/14, 문제·crash·overflow·깨진 이미지·44px 미만·Console·Network 0 및 Service Worker install·offline reload·`registerType: prompt` 중요 작업 보호형 controllerchange 런타임 증거 확보. browser `artifacts/release-evidence/browser-qa/20260802T141931-final-21fd847/report.json`, PWA `artifacts/release-evidence/pwa-runtime-qa/20260802T141931-final-21fd847/report.json`
- [ ] current exact debug APK SHA-256 `62b66c…05873`을 A17 부모와 razr 아이에 세션 보존 설치하고 역할·visible·필수 selector·overflow/busy/small-control/runtime·Network를 재확인 — 두 기기 모두 `device not found`로 미설치·미검증
- [ ] 신규 Worker+D1 선행 배포·readback 뒤 A17의 realtime ticket과 premium funnel 404를 해소하고, 잠금 해제 razr를 포함해 양쪽 Console/Network 전체 0-error 증거 확보
- [x] 역할 전환·로그아웃·재페어링·refresh token 접근 없이 S25 무조작 유지. 이전 후보의 기기 결과를 current exact 후보 통과로 표시하지 않음
- [ ] clean release SHA, lockfile hash, 양쪽 exact sibling SHA green CI run ID, schema v4 source/cap public/embedded raw·투영=CI Pages provenance, 앱·Worker SHA, bundletool/jarsigner/16KB machine evidence가 묶인 승인 인증서 서명 release AAB SHA-256, 기존 설치·Play 최대 versionCode inventory, Pages deployment ID·`--commit-hash`, Worker version ID·`--tag`/`--message`, D1 Time Travel bookmark를 한 release record에 연결
- [ ] 배포 전 직전 known-good Pages dist와 Worker version을 별도로 보존하고 롤백을 사전 연습. Pages는 CLI rollback 명령이 없으므로 known-good dist 재배포, Worker는 검증된 Worker rollback 절차를 사용하며 서로 독립적으로 되돌릴 수 있어야 함
- [ ] 배포 후 첫 60분 관측 책임자와 GO/HOLD/ROLLBACK 판정 시각을 정하고 exact health, 핵심 API, `5xx >= 5 && > 1%`, aggregate queue 연속 증가, 결제·환불·알림, crash/ANR를 기록. 자동 manifest 통과는 사람의 GO 승인이 아님
- [ ] production Worker·Pages 배포 ID 기록
- [ ] 최신 서명 release AAB의 SHA-256·크기·mtime과 bundletool 추출 versionName/versionCode/schema v4 raw·투영, current dist·Pages artifact 재대조, 실제 upload certificate, archive safety·TOCTOU·config·ZIP·전체 ELF 16KB machine evidence 기록
- [ ] AI·UGC·Data Safety·위치·FGS·FSI·모니터링·Families 제출 차단 조건 전부 해제
- [ ] 이전 노출 OpenAI 키의 Dashboard 폐기 확인·production Worker secret 교체/readback·대표 한국어/아동 안전 품질 E2E·운영 Worker의 Luna 모델 응답 확인. 업데이트된 로컬 `.env` 키의 live 4/4는 완료했으나 운영 증거를 대신하지 않음
- [ ] Play 월 4,900원·연 39,000원과 PWA Toss 계약·migration·secret·결제/갱신/해지/환불 E2E 확인
- [ ] 친구 초대·금융 보존·법적 문구·운영 절차 승인
- [ ] Play Console 제출 화면을 정책 책임자와 운영자가 함께 최종 검토

체크하지 못한 항목이 하나라도 있으면 프로덕션 제출이나 단계적 출시 확대를 진행하지 않는다.

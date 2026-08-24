# CLAUDE.md — 혜니캘린더 리디자인 (hyeni-3)

이 파일은 매 세션 자동 로드됩니다. **새 세션은 이 문서로 현재 상태·다음 할 일을 파악하고 이어서 작업하세요.**
모든 응답·주석은 한국어. 기술 용어·코드 식별자는 원문 유지.

**아이 홈 혜니 짧은 입체 도약·razr 보존 설치·Pages 배포(2026-08-25)**:
TK의 최종 지시대로 실시간 3D 모델·영상 파이프라인으로 확장하지 않고 기존 투명 WebP 18종 캐릭터를 그대로
발전시켰다. 아이 홈에서 혜니가 자리를 옮길 때만 기존 `excited` 포즈가 1.5초 동안 perspective 깊이, 세 번의 작은
도약, squash/stretch와 부드러운 착지를 보이고, 발밑 타원 그림자가 높이에 맞춰 작아졌다가 접지 때 퍼진다. 기존
좌표 배회·드래그·탭/길게 누르기·상황별 표정·말풍선·SOS 비겹침 계약은 유지하고 `prefers-reduced-motion`에서는
캐릭터와 그림자 애니메이션을 모두 끈다. GLB·Three.js·Blender·신규 생성 이미지는 추가하지 않았다.

소스 커밋 `48641fd`에서 앱 전체 `1,938/1,938`, typecheck, production build(2,287 modules·precache 471·중복 0),
부모 43화면·아이 14화면 브라우저 QA 문제 0건, Android `testDebugUnitTest lintDebug assembleDebug`가 통과했다.
debug APK는 15,790,700 bytes, SHA-256
`29B778AC9025EDAF51E0AFF4BD4EB4D8D9EE3308FAF4C0E3DEB951430DDBEED4`다. razr(`ZY22H9VTQD`) 기본 사용자(0)에
`npm run android:install:debug -- ZY22H9VTQD`로 보존 설치해 `Success`를 확인했다. versionName 1.4.1/versionCode 13,
`firstInstallTime=2026-08-17 01:03:15`는 유지되고 `lastUpdateTime=2026-08-25 08:08:02`만 갱신됐으며 MainActivity는
501ms warm launch했다. 로그아웃·역할 전환·재페어링·refresh token 조작은 하지 않았다.

Pages 최종 배포는 `https://33cd6834.hyeni-calendar.pages.dev`다. 배포별 주소·고정
`hyeni-calendar.pages.dev`·브랜드 `hyenicalendar.com`은 모두 entry `assets/index-BQUXfsWP.js` 348,020 bytes,
SHA-256 `6CAEE21B80F7BA291697612F0353AAE4C31FDD3DD0E832D52C265387588F7F6D`와 혜니 CSS
`assets/AiBuddyFab-DJMgTUN4.css` 7,625 bytes, SHA-256
`1D2A9863EEE10154AFD623991D0EA15113E203EEBC48041B684E7DE7B5653C75`가 로컬과 일치한다. 세 주소의 물리
`/oauth/callback`도 200·같은 entry를 반환하고 CSP가 유지된다. Pages 배포는 저장소 밖 임시 디렉터리의 OAuth 인증으로
진행해 `.env`의 Workers/D1 token을 사용하지 않았으며 Worker·D1·Play 스토어는 변경하지 않았다.

**아이 AI 음성 일정 저장·실시간 반영 안정화(2026-08-24, 운영 Worker 배포 완료)**:
실기기 제보 `오후3시 피아노 일정 추가`는 날짜가 없다는 이유로 planner가 `date=null`과 되묻기를 만들고,
그 뒤 `오늘`이라고 답해도 과거 질문을 복원하지 못해 `events`가 저장되지 않는 것이 직접 원인이었다. 이제 날짜 표현
자체가 없는 일정 등록만 KST 오늘로 확정해 위 문장을 오늘 15:00 `피아노` 일정으로 즉시 실행한다. 반대로 `다음 주`,
`한 달 반 뒤`, `8월 26일`, 반복 일정처럼 아직 해석하지 못하는 날짜는 오늘로 추정하지 않고 다시 묻는다. 여러 turn의
날짜·시각·제목은 exact 되묻기 chain에서만 합치며, DB `created_at`+`rowid`로 순서를 보존하고 10분 뒤 pending을
만료한다. 전화·일정 조회·기기 동작 같은 새 의도와 `안녕`/주제 전환은 우선하고, `취소할래`·`그냥 안 할래` 같은
취소 표현은 일정을 만들지 않으며 무과금 결정적 응답으로 닫는다.

일정 본문과 `events_children` 연결은 `persistAiChildSchedule`의 D1 batch 한 번으로 원자 확정하고, 성공 뒤
`events INSERT`를 활성 가족 전원에게 최소 payload로 발행한다. 확인된 AI 일정 수정도 실제 UPDATE 1행을 확인한 직후
`events UPDATE`를 발행하므로 아이 홈·부모 홈·캘린더가 `qk.events(familyId)`를 즉시 다시 읽는다. 실시간 발행 장애는
이미 저장한 일정을 실패로 되돌리지 않는 best-effort 계약이다. TDD RED에서 미저장·다중 turn·stale prompt·취소·
새 intent·원자성·실시간 누락을 재현했고, 최종 집중 `51/51`, Worker 전체 `1,298/1,298`, Worker typecheck와 diff check가
통과했다. 소스 커밋 `0a6e87d`를 `origin/main`에 push했고 운영 Worker version
`d4910c2c-cbac-466b-a5af-8f9991306a66`이 100% 활성임을 readback했다. `/api/health`는 200
`{"ok":true,"status":"ready"}`, `/api/ai/child-chat` 미인증 POST는 401이다. D1 migration·Pages·앱 바이너리 변경은
없어 APK 재설치는 필요하지 않으며, 운영 일정·계정·역할·페어링·세션·refresh token은 건드리지 않았다.

**역할별 복구 동선 안정화·v1.4.1/code 13 Pages 배포(2026-08-24)**:
아이 홈의 다음 일정 지도 노드·혜니 말풍선·`길찾기 출발!`은 중간 설명 시트를 없애고 명시 일정 id와 함께
`/route` 전체 지도로 바로 이동한다. RouteView는 그 일정을 다른 장소 있는 일정으로 바꾸지 않으며, 아이 기기 GPS를
먼저 기다리고 GPS 실패가 확정된 뒤에만 서버의 마지막 본인 위치로 강등한다. GPS와 가족·위치·저장 장소·일정 원본
조회 실패는 빈 데이터로 위장하지 않고 화면 안에서 다시 시도할 수 있다. 웹 구독 카탈로그 재시도와 Play 상품 불가
분류, 잘못된 아이 메모 링크의 뒤로가기, 가족 조회 성공 뒤 아이 0명인 부모 홈의 연결 행동, id 기반 부모 바로가기,
현재 언어로 만든 하단 탭 접근성 이름도 함께 보강했다. Worker·D1 계약은 변경하지 않았다.

앱 버전은 1.4.1, Android/iOS build number는 13이다. 최종 검증은 앱 `1,935/1,935`, Worker `1,274/1,274`,
앱·Worker typecheck, production build(2,287 modules·precache 471·중복 0), 부모 43화면·아이 14화면 브라우저 QA
문제 0건, PWA install·offline·안전 업데이트 문제 0건, Android `testDebugUnitTest lintDebug assembleDebug` 통과다.
debug APK는 15,918,791 bytes, SHA-256 `1DAA50F54D024AF03237199178F6F9CC9E560899EA1D17271FE5046E1799C193`다. 허용 실기기는 0대가 연결돼 설치를
생략했으며 계정·역할·세션·페어링을 건드리지 않았다.

설계 `cf34bb4`와 구현 `15bd55c`를 `origin/main`에 push했고 Pages는
`https://cedb940e.hyeni-calendar.pages.dev`에 배포했다. 배포별 주소·고정 `hyeni-calendar.pages.dev`·브랜드
`hyenicalendar.com`은 모두 `assets/index-BB1O90IU.js` 347,849 bytes와 SHA-256
`CE8E049D7B8329FF3B08E130AB1C51922A61CAD236E2E4A65D774053DB821383`으로 일치한다. Play에서 1.4.1 제공 가능
readback 전에는 없는 업데이트를 안내하지 않도록 `app-version.json`의 latest/minimum을 1.4.0으로 유지한다.
사용자가 UTF-8 PowerShell 7 창에서 서명 비밀번호를 직접 입력했고 자격 값은 저장·출력하지 않았다. clean 앱 소스
`dd73ba5a08ca4c5f82343aa8392e545bf7ed9214`에서 만든 서명 AAB는
`artifacts/release-evidence/play-upload-v1.4.1-vc13-dd73ba5/hyeni-calendar-v1.4.1-vc13-dd73ba5.aab`,
13,012,261 bytes, SHA-256 `240f1ad672a562ac9f2aa6ce603e524f0d0e481a20771e0298e2318c98ef6c78`,
mtime `2026-08-23T22:07:35.620Z`다. manifest 1.4.1/code 13·non-debuggable·내장 source commit, 승인 업로드
인증서, 정확한 권한 정책, dist/내장 web assets, bundle/universal APK와 4개 ELF의 16KB 조건이 모두 GREEN이다.
Play 제공 전 `1.4.0 ≤ 1.4.0 ≤ 1.4.1` 단계 정책을 허용하되 미래·역순·5구간 이상 버전은 거부하도록 출시 도구를
`906c401`에서 보강했다. 2026-08-24 07:51 KST Android Publisher API로 동일 AAB를 production
`혜니캘린더 1.4.1 (13)` / `completed`에 업로드하고 validate 뒤 심사 전송했다. 제출 직전 code 12는
`IN_REVIEW`, code 6은 `PUBLISHED`였으며 `CANCEL_IN_REVIEW_AND_SUBMIT`을 명시해 v1.4.0 심사를 대체했다.
07:52 KST fresh readback에서 code 13 `IN_REVIEW`, code 6 `PUBLISHED`, code 12 제거를 확인했다. 기존 `ko-KR`
앱 소개 해시 `d0c0824d...b9dc9`와 icon·feature graphic·phone screenshots 10개 해시
`651ef787...fede1`은 제출 전후 동일하고 등록정보·이미지 write API는 호출하지 않았다. 아직 code 13이
`PUBLISHED`는 아니므로 제공 가능 readback 전까지 `app-version.json`은 계속 1.4.0이다. 상세 증거는
`docs/store/play-console-submission-v1.4.1.md`가 정본이다.

**아이 AI 친구 `혜니` 통일·1/3 플로팅·한 줄 말풍선(2026-08-24, 운영 배포·razr 설치 완료)**:
아이 메인 카드, AI 채팅 헤더, 입력창 placeholder/aria-label, 플로팅 버튼과 Worker 기본 persona를 모두 `혜니`로
통일했다. 자동 기본값이었던 `통통이`·`꼬미`·`AI 친구`만 혜니로 승격하고 사용자가 직접 정한 이름(예: `별이`)은
보존한다. 멱등 migration `worker/db/ai-buddy-name-hyeni.sql`을 운영 D1에 적용해 정확히 2행을 갱신했고, 재조회에서
구 기본값 0행·혜니 7행을 확인했다. `AI친구 설정을 불러오지 못했어`의 직접 원인이던 운영 D1의
`buddy_attention_enabled` 누락도 schema 적용 및 컬럼 존재를 확인했으며, 캐시가 있는 background refetch 실패는
정상 화면을 지우지 않고 최초 설정 조회 실패 탭은 재시도 안내를 표시하도록 fail-safe 처리했다.

아이 홈 플로팅 혜니는 `clamp(112px, 33.333vw, 144px)`로 화면 폭 약 1/3을 차지하고, 실제 렌더 폭을 기준으로
드래그 경계를 계산한다. idle 호흡·깜빡임·배회와 상황별 18종 3D pose는 유지하며, 기본 안내는
`혜니를 눌러서 이야기해 봐!`다. 일반·기능 안내·화면 중앙 등장 말풍선 모두 `white-space: nowrap`과 짧은 한 문장으로
통일해 줄바꿈·말줄임 없이 한 줄로 보인다. razr 411px viewport 실측은 캐릭터 137.14px, 말풍선
136.06×31.57px·text row 1·viewport 안쪽이었다. DOM 실측에서 메인 `혜니 만나러 가기`, 채팅 제목 `혜니`,
placeholder `혜니에게 말해 봐…`, aria-label `혜니에게 메시지`, 설정/채팅 load error 없음까지 확인했고 CDP 캡처로
한 줄 말풍선과 SOS 비겹침을 시각 확인했다.

최종 검증은 집중 회귀 `56/56`, 앱 전체 `1,922/1,922`, Worker `1,274/1,274`, 앱·Worker typecheck,
production build(2,288 modules·precache 471·중복 0), Android `testDebugUnitTest lintDebug assembleDebug`가 모두
통과했다. Worker version은 `f6260e08-ebcd-4bc9-a09a-aba11610cfa7`, Pages 최종 배포는
`https://07a34436.hyeni-calendar.pages.dev`다. 배포별 주소·고정 `hyeni-calendar.pages.dev`·브랜드
`hyenicalendar.com`은 모두 `assets/index-k1Ymd8xp.js` 348,399 bytes와 SHA-256
`4AB1B86BF8DC4876ECA3B3F3977BC0198628F73F750269D9B1089645FFB3E57E`가 로컬과 일치한다. 최종 debug APK는
15,919,665 bytes·SHA-256 `4CCE68CC8A297D50CB5F1A173FA75B3DC5BDB0D865B78285A8E4848A126FC451`이며,
razr(`ZY22H9VTQD`) 기본 사용자(0)에 보존 설치했다. versionName 1.4.0/versionCode 12,
`firstInstallTime=2026-08-17 01:03:15` 유지와 아이 local/server role·family 일치를 확인했으며 로그아웃·역할 전환·
재페어링·refresh token 조작은 하지 않았다. core 화면은 runtime/console 오류 0이고 길찾기 외부 Kakao API 502 한 건만
별도로 관찰됐다.

**아이모드 살아 있는 3D AI 친구 교체(2026-08-24)**: TK가 준 1024px 투명 PNG 18종을
`scripts/import-ai-buddy-chat-emotions.mjs`로 trim→288px contain+16px 투명 여백의 320px WebP로 변환해
`public/assets/ai-buddy/poses/`에 넣고, 네모난 무지개 배경 로봇 20종을 제거했다. 20개 의미 face는
`src/transform/aiBuddyEmotion.ts`에서 18개 pose를 모두 상황별로 사용하며, 투명 전신 실루엣·알파 drop-shadow로
홈 타일·플로팅 버튼·대화 헤더/말풍선·타이핑·음성 화면의 캐릭터를 통일했다. 영상/GPT 재생성은 원본의 캐릭터
일관성과 상황 반응성을 낮추므로 쓰지 않았다.

아이 홈은 88px 활동형으로 idle 배회·표정/행동 전환·말풍선·부르기를 유지하고, 다른 아이 화면은 68px 조용한
동행 모드로 제자리 숨쉬기만 하며 배회·선제 말풍선·전체화면 부르기를 금지한다. 작은 모드는 shell 하단 inset에
96px를 더해 메모의 빠른 문구/입력창과 겹치지 않는다. 기존 탭·드래그·550ms 길게 눌러 음성·화면 전환 계약은
그대로 보존했다. 회귀는 `tests/aiBuddyCharacterAssets.test.mjs`(18개·320px·alpha·크기 예산),
`tests/aiBuddyCharacterBehavior.test.ts`(전 pose 매핑·88/68 모드·하단 여백·달리기 pose),
`tests/aiBuddyFab.test.ts`가 보호한다. 390×844 브라우저에서 홈 10초 동안 위치/표정이 실제 변경되고, 메모 화면은
10초 동안 제자리를 지키며 말풍선 0개·빠른 문구와 비겹침, 탭 후 AI 대화 진입, 콘솔 오류 0건을 확인했다.
최종 검증은 전용 회귀 `55/55`, 앱 전체 `1,914/1,914`, typecheck, production build(2,287 modules·precache
471·중복 0), Capacitor Android sync와 `assembleDebug`가 모두 통과했다. debug APK는 15,789,615 bytes,
SHA-256 `8E3535E3898941CD46E5EFB2326F3DA1FD959E83A1E417F956E78A6525E45B4E`다. razr(`ZY22H9VTQD`)에
`npm run android:install:debug -- ZY22H9VTQD`로 기본 사용자(0) 보존 설치했고 `Success`, versionName 1.4.0/
versionCode 12를 확인했다. `firstInstallTime=2026-08-17 01:03:15`는 유지되고 `lastUpdateTime`만 바뀌었으며
MainActivity warm launch 430ms·top resumed를 확인했다. 계정·역할·세션·페어링은 변경하지 않았다. Cloudflare OAuth를 복구한 뒤 Pages 배포
`https://69316cd5.hyeni-calendar.pages.dev`를 완료했다. 배포별 주소와 고정 `hyeni-calendar.pages.dev`는 모두
새 entry `assets/index-rmDFITEA.js`(SHA-256 `AB176BE5B3EF28610DB297A2A0C02AD9AC0C2AAA4B405E0AA1C17D19535DC0E5`)를
참조하고 `poses/welcome.webp` 21,620 bytes·SHA-256
`7797AD85961602E7FC87CFF2ABAD01FED9B32E522A1494CAF69602ED770A1A0E`가 로컬과 일치한다. Workers/D1 전용
`.env` token은 사용하지 않았으며 Worker·D1은 변경하지 않았다.

**Google Play v1.4.0/versionCode 12 프로덕션 제출 완료(2026-08-23)**:
앱 정식 이름을 `혜니캘린더 - 우리아이 일정&안전 한번에`로 바꾸고 Android 적응형 전경은 10%, 레거시·
Play 아이콘은 7% 확대했다. 스토어 등록정보는 아빠가 자기 아이를 위해 만들었다는 제작 배경, 가족 일정·준비물·
대화·SOS와 기본 안전 기능의 무료 범위, 실시간 위치·AI·리포트 등 서버 비용이 큰 고급 기능을 구독으로 안정적으로
운영하는 이유를 함께 명시했다. Android `versionCode 12`, iOS `CURRENT_PROJECT_VERSION 12`, PWA/Capacitor 이름을
동기화했고 `tests/playReleaseV140Metadata.test.mjs`로 버전·이름·문구·아이콘 점유율을 회귀 보호한다.

최종 검증은 앱 `1,908/1,908`, Worker `1,272/1,272`, 앱·Worker typecheck, production build, Android unit·lint·
`assembleDebug` 전부 통과다. 서명 스크립트의 Windows Terminal 모듈 자동 로드 편차를 .NET SHA-256 구현으로 제거하고
회귀 `15/15`를 추가했다. clean source commit `b6e3e84abd126670766b025730af8e5274c6679f`에서 승인 업로드 키로 만든
AAB는 `artifacts/release-evidence/play-upload-v1.4.0-vc12-b6e3e84/hyeni-calendar-v1.4.0-vc12-b6e3e84.aab`,
12,697,989 bytes, SHA-256 `60d6da74593ef7ba384e009a0bb80c55c2488db1983e80c79f35fc5d8af8dbdf`다.
manifest 1.4.0/code 12·non-debuggable·source commit 일치, jarsigner 승인 인증서 일치, web assets 일치,
bundle/universal APK/ELF 16KB 조건이 모두 GREEN이다.

Android Publisher API 실측에서 기존 최대 code는 6, 프로덕션 1.3.0(6)은 completed였다. 공식 편집 validate 뒤 AAB,
한국어 이름·짧은/자세한 설명, 확대 아이콘, 한국어 출시 노트를 프로덕션 `completed` 전체 출시로 commit했다. 새 편집
readback은 `혜니캘린더 1.4.0 (12)`·versionCode 12·AAB SHA·등록정보·아이콘 SHA
`b36b840603fa6870adbc6823d238a8513b1f3ce4e59b2c4a8f95c873d58570e8`가 모두 일치한다. Google 심사·스토어 전파
완료 시각은 Play가 결정하므로 실제 사용자 노출은 Console 상태로 후속 확인한다. Pages는
`https://ba35ac2e.hyeni-calendar.pages.dev`에 배포했고 고정 Pages URL도 새 제목·entry `assets/index-Dv5q4xDb.js`
(SHA-256 `f617fcd6607bc4ce291d93ef8de91530334ff47fd7f4a2b1e6e3a8e29c7c0911`)와 1.4.0 권장 업데이트를 반환한다.
실기기 설치·로그인·로그아웃·역할 전환·재페어링은 수행하지 않아 기존 세션을 건드리지 않았다.

**앱 소셜 로그인 브라우저 낙하 방어(2026-08-24)**: 앱에서 소셜 로그인 시 시스템 브라우저가 열리고 로그인은
끝났는데 앱이 다시 로그인 화면인 제보의 1차 원인은 App Link 검증 실패 등으로 콜백
`https://hyeni-calendar.pages.dev/oauth/callback?code…` 이 앱 대신 브라우저 SPA에 떨어지는 것이다. 그 상태로
온보딩이 `finishOAuthLogin`을 호출하면 이 저장소에 state·transactionSecret이 없어 교환이 불가능하다. 이제
`hasLocalOAuthContext()`(읽기 전용 peek)로 웹에서 낙하 콜백을 감지하면 네트워크를 때리지 않고 URL을 정리한 뒤
"브라우저에서는 로그인을 마칠 수 없어요. 혜니캘린더 앱에서 소셜 로그인을 다시 시도해 주세요." 안내로 닫는다 — 서버
트랜잭션은 소비되지 않아 앱에서 같은 코드 재사용이 가능하다. 아울러 Android 콜드 스타트에서 Capacitor 브리지가 늦게
떠서 `device_install_id` 없이 교환·refresh가 나가는 경합은 `resolveAndroidDeviceInstallId`가 0/150/400ms 재시도로
흡수하고, 실패해도 null fail-closed를 유지한다. 회귀=`tests/authEntryReliability.test.mjs`(9케이스).
⚠️ 근본 해결은 설치된 Play 빌드에서 `adb -s <serial> shell pm verify-app-links --re-verify com.hyeni.calendar` →
`pm get-app-links`가 `hyeni-calendar.pages.dev: verified`를 반환하게 하는 것(출시 체크리스트 미완료 항목)이다.
**iPhone Safari 공동 보호자 일정·주변소리 권한 정합화(2026-08-23, 운영 배포 완료)**:
활성 공동 보호자 계정으로 iPhone Safari 실사용 중 일정을 등록하면 Worker의 과거 주 보호자 전용 gate가
`403 forbidden`을 반환했고, 매핑되지 않은 4xx가 `요청을 처리하지 못했어요. 입력 내용을 확인해 주세요.`로
표시됐다. 같은 계정의 주변소리 시작은 의도된 주 보호자 전용 정책으로 `403 primary_parent_required`였지만,
클라이언트가 감사 세션 생성 오류를 모두 삼켜 `청취 기록을 안전하게 남길 수 없어`라는 일시 장애처럼 안내했다.

가족 일정 생성·수정·삭제는 이제 주 보호자와 활성 공동 보호자에게 모두 열고, 검증 전 gate뿐 아니라 검증→write 사이
권한 변경을 막는 D1 atomic guard와 충돌 원인 재판정도 같은 `assertFamilyParent` 계약을 사용한다. 비활성 보호자·아이·
타가족은 계속 거부한다. 주변소리는 민감 안전 기능이므로 주 보호자 전용 정책을 유지하며, 감사 세션의 제한된
stable code/status를 보존해 공동 보호자에게 `주 보호자만 원격 청취를 시작할 수 있어요`를 정확히 표시한다.
구독 필요·가족 설정 비활성·일시 감사 저장 실패도 각각 다른 기존 안내로 구분하고, 감사 행이 없으면 마이크 명령을
보내지 않는 fail-closed 계약은 유지한다. 운영 D1은 두 계정의 주/공동 보호자·활성 멤버십·일정/아이 개수만 읽었고
행·세션·refresh 토큰은 변경하지 않았다.

TDD RED는 공동 보호자 판정 함수 부재, event batch의 주 보호자 전용 의존성, atomic guard rollback,
청취 감사 오류 분류 부재를 각각 확인했다. 최종 검증은 집중 회귀 `21/21`, 앱 `1,904/1,904`, Worker
`1,272/1,272`, 앱·Worker typecheck, production build(2,287 modules·precache 473·중복 0)다.
Worker version은 `bb8ed080-4f9c-454c-8c62-b2b810e72941`, Pages 배포는
`https://8eede2dc.hyeni-calendar.pages.dev`이며 `/api/health` 200 `{"ok":true,"status":"ready"}`와
일정·청취 route 미인증 401을 확인했다. 배포별 주소·고정 `hyeni-calendar.pages.dev`·브랜드
`hyenicalendar.com`은 모두 새 entry `assets/index-DnfJuiTg.js`를 참조하며 entry SHA-256
`17cfe042dd029f530a0f25024b4fa07a174e93bf46f54565bcf559530f5fc4ad`, CSS
`177583e46ce74cda70b47b5f3139d3d674abd5923f433b0e610a5279a41ce6f4`, Service Worker
`ac4c26e597f62fdb0c6ab783ffab40dceb38b4e19424041eaa7c8c2c8b946b70`가 로컬과 일치하고 OAuth callback도
200·같은 entry를 참조한다. 실사용 일정 행이나 청취 세션을 테스트로 생성하지 않았으며 iPhone 실제 재시도 확인만 남았다.

**아이 AI 친구 채팅 간헐 전송 불가 안정화(2026-08-23, 운영 배포 완료)**: 아이가 AI 친구의
답변을 기다리는 동안 입력창은 계속 활성 상태였는데, Enter 경로는 `sendChat.isPending`이면 실제 요청을 보내지 않고
돌아오면서도 입력값을 무조건 비웠다. 또한 React/TanStack의 pending 렌더보다 빠른 연속 액션은 같은 tick에서 두 요청을
시작할 수 있었고, Android WebView의 fetch가 Worker에 닿지 못한 채 끝나지 않으면 화면 전체가 계속 pending으로 잠겼다.
Worker에서도 선제 AI 메시지와 아이 대화가 같은 자녀별 실행 lease를 사용해, 짧은 선제 작업과 겹친 대화가 즉시
`409 ai_request_in_progress`로 끝나는 창이 있었다.

클라이언트는 렌더와 독립적인 동기식 turn gate를 두어 한 요청만 시작하고, 답변 대기 중 Enter를 눌러도 새 입력을
지우지 않는다. 아이 대화 fetch는 45초 상한과 `AbortController`를 사용해 네트워크가 끝없이 멈춰도 다시 입력할 수 있게
복구한다. Worker의 interactive lease 획득은 150ms 간격 최대 5회(총 대기 상한 600ms)만 재시도해 짧은 선제 작업과의
경합은 흡수하되 다른 긴 대화와의 직렬화·크레딧 원자성은 유지한다. 운영 D1은 읽기 전용으로 확인했으며 활성 stale lease,
오늘 사용량, 최근 실패 시점의 신규 user 메시지 저장이 모두 없었다. 계정·세션·refresh 토큰과 D1 데이터는 변경하지 않았다.

회귀는 입력 보존·동기 gate·fetch timeout, 짧은 lease 해제 뒤 획득·지속 lease bounded busy를 추가했다. 최종 검증은
앱 `1,902/1,902`, Worker `1,270/1,270`, 앱·Worker typecheck, production build(2,286 modules·precache 473·
중복 0), Capacitor Android sync와 `assembleDebug` BUILD SUCCESSFUL이다. 최신 debug APK SHA-256은
`71359208FBE636D0D5B3AE4D03CEDEDB67A61B7330A30A9819F853833ECC41CA`다. 전수 브라우저 QA는 앱 화면 오류가 아니라
기존 온보딩 검사기의 탐색 경합(`document.body` null, 이후 `.qrs-manual` 미존재)으로 두 차례 중단돼 완료로 세지 않는다.

Worker version은 `fba66dd6-7447-4ec3-b3fe-96f9879f09f2`, Pages 배포는
`https://07994ba5.hyeni-calendar.pages.dev`다. Worker health 200 `{"ok":true,"status":"ready"}`와
아이 채팅 route 미인증 401을 확인했다. 배포별 주소·고정 `hyeni-calendar.pages.dev`·브랜드
`hyenicalendar.com`은 모두 새 entry `assets/index-k0J7hzRA.js`를 참조하며 entry SHA-256
`338959d6f132a18f71ce85889e2f16a47534d5b356f39a88c43ff2e1de808576`, CSS
`177583e46ce74cda70b47b5f3139d3d674abd5923f433b0e610a5279a41ce6f4`, Service Worker
`de63d5105ca090384a97d68995b71b70d08529f42731b9fbff9af4213d1b3728`가 로컬과 일치하고 OAuth callback도
200·같은 entry를 참조한다. razr(`ZY22H9VTQD`)는 ADB에 연결되지 않아 앱 설치·실기기 채팅은 수행하지 않았으며,
로그인·로그아웃·역할 전환·재페어링도 건드리지 않았다. Worker 완화와 웹 PWA는 즉시 적용됐고 Android 클라이언트의
입력 보존·timeout은 razr 재연결 뒤 `npm run android:install:debug -- ZY22H9VTQD` 보존 설치가 필요하다.

**휴대폰 번호 가입 CTA 텍스트 전용 디자인(2026-08-23, 운영 배포 완료)**: 가입 첫 화면의
`휴대폰 번호로 가입하기`를 소셜 버튼 변형에서 독립 `ob-phone-signup` 액션으로 분리했다. 우측 화살표 아이콘을
제거해 텍스트만 중앙 정렬하고, 보라색·라벤더 계열 대신 정본 `rose-soft` 배경·`rose-text` 문구·`rose-200`
테두리를 사용한다. 공용 primary 높이 52px, 16px radius, 16px 본문 타입과 44px 이상 조작 면을 유지하며
Safari의 기본 button 정렬에 기대지 않도록 flex 중앙 정렬을 직접 선언했다.

회귀는 정적 인증 진입 계약과 디자인 surface 분류에 추가했다. 브라우저 QA도 computed style의 자식 요소 0개,
배경 `rgb(253, 231, 241)`, 글자 `rgb(169, 68, 117)`, 높이 52px, 중앙 정렬·배경 이미지 없음·16px radius를
검사하고 `auth-signup-entry.png`를 남긴다. 앱 테스트 `1,899/1,899`, typecheck, production build
(2,285 modules·precache 473·중복 0), 실제 Chrome QA 부모 43+아이 14 화면 문제 0을 확인했다.

구현 커밋 `b2ed143`을 기능 브랜치와 `main`에 fast-forward하고 GitHub 원격까지 push했다. Pages 배포는
`https://e3dbc83c.hyeni-calendar.pages.dev`이며 Worker 변경·배포는 없다. 배포별 주소·고정
`hyeni-calendar.pages.dev`·브랜드 `hyenicalendar.com`은 모두 새 entry `assets/index-BTE06QFD.js`와
CSS `assets/index-DMuUhfUk.css`를 참조한다. 세 주소의 entry SHA-256
`903d945a285f32e9c701ef52c55fde08e781f2cf805c16cd11fd1dd386ee7874`, CSS
`177583e46ce74cda70b47b5f3139d3d674abd5923f433b0e610a5279a41ce6f4`, Service Worker
`837ff6d8b8103615343065d22c7fe2ec69adf9aa99acf9859dd860ca7f98b932`가 병합 `main` dist와 일치한다.
Pages 두 주소의 OAuth callback SHA-256도 로컬과 같은
`858df0324ba327a5a141c4e9e59eda15b2725415be9ee1adc42c833856f597d2`이고, 브랜드 callback은 Cloudflare
HTML 삽입으로 바이트가 달라도 200·`no-store`와 같은 새 entry 참조를 확인했다. 완전 신규 Playwright 세션으로
브랜드 가입 화면을 다시 열어 CTA 358×52px·자식 요소 0개·정본 로즈 색·수평 overflow 0을 재확인했다.

**가족 정합성·단일 설치·iOS 출시 준비(2026-08-23, 운영 배포 완료)**: 운영 D1을 읽기 전용으로
교차 확인한 결과, `tkisdroid` 가족의 활성 정본은 대표 보호자 `tkisdroid`·아이 `혜니`·과거에 연결된 다른
보호자 1명이었고, `mindlady`는 가입 계정은 존재하지만 활성 가족 멤버십이 없었다. 따라서 `mindlady` 연결 실패의
직접 원인은 휴면 상태인 기존 보호자 멤버십이 공동 보호자 1명 슬롯을 계속 점유한 것이며, 화면의 `아이2`는 활성
`family_members`에 존재하는 실제 아이가 아니라 과거 역할 없는 QR/온보딩이 만든 로컬 표시였다. 운영 가족·계정·세션·
refresh 토큰은 변경하지 않았으며, 실제 복구 절차는 배포 뒤 대표 보호자가 가족 연결 관리에서 과거 보호자 연결을
해제하고 `공동 보호자` 전용 QR로 `mindlady`를 초대하는 것이다.

가족 조회는 이제 활성 멤버십만 반환하고, 공동 보호자 슬롯 점유는 stable `409 coparent_slot_occupied`로 구분한다.
대표 보호자 전용 공동 보호자 해제 API는 멤버십을 비활성화하면서 해당 계정의 refresh·활성 설치 세션·FCM·Web Push·
realtime 연결을 함께 폐기해 유령 접근을 남기지 않는다. QR은 아이/보호자 역할을 발급 시점부터 분리하고 역할 없는
구형 QR은 인증·익명 아이 생성 전에 역할 선택으로 fail-closed한다. 연결 성공도 토큰 저장만으로 완료 처리하지 않고,
새 세션의 `user_id`·role·family와 `/api/family/mine`의 활성 멤버가 모두 같은지 확인한 뒤에만 홈으로 보낸다.
가족 화면과 연결 관리 화면은 로그인한 보호자 자신을 중복 표시하지 않으면서 다른 보호자 전원과 같은 활성 아이 목록을
보여 주고, 공동 보호자는 대표 보호자를 해제하거나 새 보호자를 초대할 권한을 받지 않는다.

계정별 활성 설치는 정확히 1대로 유지한다. PC에서 비밀번호/OAuth/페어링으로 다시 본인 인증하면 새 설치가 원자적으로
인계받고, 이전 iPhone의 access·refresh·WebSocket·push endpoint는 사용할 수 없게 된다. 이전 기기는 다음 API/실시간
재연결에서 세션을 자동 삭제하고 `다른 기기에서 다시 로그인했거나 가족 연결 권한이 변경됨` 안내를 한 번만 표시한다.
Chrome 격리 QA에서 가족 조회 401→refresh 401→세션 제거→역할 화면·안내 표시, 새로고침 뒤 안내 재표시 없음까지 확인했다.

iPhone 보호자 PWA/향후 Capacitor iOS 앱은 Worker API→FCM→아이 Android 경로를 사용하므로 위치·기기 상태·메시지·
장소/알림 설정·소리 울리기·주변 소리 수신 등 부모 제어를 부모 기기의 Android 여부로 막지 않는다. iOS WebView의
stable install id, 정확한 `capacitor://localhost` CORS, 공식 Capacitor Browser OAuth, iOS custom callback scheme,
플러그인 availability, 권한·미디어 fallback을 정리했다. iOS 프로젝트에는 Browser Swift Package, privacy usage copy,
브랜드 아이콘/스플래시와 1.4.0(11)을 반영했고 `npm run ios:sync` 한 번으로 build·sync·SPM 경로 정규화·패키징 검증이
끝난다. 다만 macOS Xcode signing/App Store Connect 입력, APNs entitlement·실기기 push, StoreKit 실제 결제처럼 Apple
자격과 네이티브 환경이 필요한 마지막 단계는 Windows에서 완료한 것으로 위장하지 않으며 `docs/ios-build.md`에 남겼다.

최종 검증은 앱 `1,898/1,898`, Worker `1,268/1,268`, 앱·Worker typecheck, production build(2,285 modules·
precache 473·중복 0), 실제 Chrome QA 부모 43+아이 14 화면 문제 0, 공동 보호자 양방향 명단·단일 설치 인계 집중 시나리오,
PWA install/offline/update 문제 0, 격리 mobile WebKit PASS, `npm run ios:sync` 및 iOS 패키징 1.4.0(11), Android
`testDebugUnitTest lintDebug assembleDebug` BUILD SUCCESSFUL이다. 실사용 계정 로그인·로그아웃·역할 전환·재페어링,
실기기 설치와 운영 D1 mutation은 수행하지 않았다.

구현 커밋 `2056230`을 기능 브랜치와 `main`에 fast-forward하고 GitHub 원격까지 푸시했다. Worker version은
`251a4db8-07c4-4cc0-a515-19b792cea37d`, Pages 배포는 `https://b2f75cf7.hyeni-calendar.pages.dev`다.
Worker health는 200 `{"ok":true,"status":"ready"}`, iOS WebView preflight는 204와 정확한
`Access-Control-Allow-Origin: capacitor://localhost`, 공동 보호자 해제 route 미인증 요청은 401을 확인했다.
배포별 주소·고정 `hyeni-calendar.pages.dev`·브랜드 `hyenicalendar.com`은 모두 새 entry
`assets/index-8goYseY1.js`를 참조하고 entry SHA-256
`5b88613bb8a63131f64134f188099940fab36872983c5e9f2bdb0d73c5b5b645`, CSS
`177583e46ce74cda70b47b5f3139d3d674abd5923f433b0e610a5279a41ce6f4`, Service Worker
`37054c5e04e4d9cc19b52f6c1e37c15ff4646ea5f31b5d3023f7b127257a96b7`가 병합 `main`의 dist와 일치한다.
Pages 두 주소의 OAuth callback SHA-256도 로컬과 같은
`484d3812cbf9771e0803db607f064b3a5164e50eeb5d1cdb423e918f350238b8`이며, 브랜드 callback은 Cloudflare zone의
HTML 삽입을 허용하되 200과 같은 새 entry 참조를 확인했다. 병합 커밋에서 iOS sync·verify와 Android
unit·lint·assemble을 다시 실행했으며 최신 debug APK SHA-256은
`88e2dea33d22138a020a10184d3e0e4e514e462a75776c63cbf00662642c6d7f`다. 기기에는 설치하지 않았다.

**아이관리 공용 QR의 보호자→아이 오등록 차단(2026-08-23, 운영 배포 완료)**: Safari에서 다른 보호자가
`아이관리 > 가족 연결 코드 · QR`을 읽으면 `아이2`로 보이던 근본 원인은 공용 QR이
`buildPairLink(pairCode)`의 과거 기본값을 통해 `as=child`를 붙여 발급되던 것이었다. Safari 카메라는 그 URL을
그대로 열었고 온보딩은 정상적으로 익명 아이 세션을 시작했으므로, 별도 공동 보호자 CTA가 있어도 공용 QR 사용자는
계속 아이로 들어갔다. `buildPairLink`는 이제 역할을 필수 인자로만 받고, 공용 진입점은 `as`가 없는
`buildPairRoleChoiceLink`를 사용한다. 공용 QR·확대·공유 화면은 `role=choose`로 통일하고, 스캔 뒤에는 인증이나
익명 아이 생성보다 먼저 학부모/아이 역할을 선택한다. 보호자 전용 CTA는 기존처럼 `as=parent`, 아이 전용 CTA는
`as=child`를 유지해 역할 의도를 섞지 않는다. 공용 QR의 제목·힌트·접근성 라벨·대기 문구와 역할 선택 안내는
10개 locale 및 생성 catalog에 함께 반영했다.

검증은 앱 `1,885/1,885`, Worker `1,262/1,262`, main 병합 후 가입·역할 집중 회귀 `54/54`, 앱·Worker
typecheck, i18n catalog freshness, production build(2,280 modules·precache 472·중복 0), 브라우저 QA
부모 43+아이 14 화면 문제 0, PWA install/offline/update 문제 0, Android
`testDebugUnitTest lintDebug assembleDebug` BUILD SUCCESSFUL이다. 별도 iPhone 13 WebKit 격리 검증에서 공용 QR은
학부모·아이 선택을 모두 표시하고 페어링 화면은 숨겼으며 `/auth/anonymous` 요청 0건, 처리 뒤 `pair` URL 제거,
console/page/외부 연결 문제 0건을 확인했다. 실제 계정 로그인·로그아웃·역할 전환·재페어링, refresh 토큰,
실기기 설치, Worker·D1은 건드리지 않았다.

구현 커밋 `857a7dd`를 기능 브랜치와 `main`에 push했고 Pages는
`https://45d74c61.hyeni-calendar.pages.dev`에 배포했다. 배포별 주소·고정 `hyeni-calendar.pages.dev`·브랜드
`hyenicalendar.com` 모두 index/callback 200이며 새 entry `assets/index-DC0nsuUH.js`를 참조한다. 세 주소의 entry
SHA-256 `5167e7ee5c305e24b431fa8aa07726064d84000d6374ad932a8a491493519f6e`, CSS
`177583e46ce74cda70b47b5f3139d3d674abd5923f433b0e610a5279a41ce6f4`, Service Worker
`07d84867588658b4db094bf916b7157e5e5849df03ce0f1d8bc957d4922b0814`가 로컬 dist와 일치한다.
배포 후 빈 iPhone 13 WebKit 세션으로 브랜드의 실제 `#/onboarding?pair=KID-QA123456`을 열어 학부모·아이 선택 표시,
페어링 화면 미표시, `/auth/anonymous` 요청 0건, 처리 뒤 `pair` 제거를 다시 확인했다.
로컬 index SHA-256은 `8347cf39643c707c32ae2f26e24109cf7ee31b705920ae7b11b8cf41ca6d0456`, OAuth callback은
`66b72499fe3db73ee920e5945849ee2d1aa1aa3ea27417d8404f964823d1f4fc`다. 최신 debug APK SHA-256은
`5636b67b735646a51ff47c7c4e5353b2734549204f3583b2af618a072fbed6c0`이며 기기에는 설치하지 않았다.

**가입·역할 매칭 전수 개선(2026-08-22, 운영 배포 완료)**: 가입 첫 진입을 로그인/회원가입 탭으로 명시 분리하고,
역할 화면의 언어 설정을 하단 1곳으로 통합했다. 선택한 전화·Kakao·Google·Naver 가입 방식과 가입 설문은
20분 만료·session/local 이중 draft로 새로고침/OAuth 왕복에도 이어지며, 설문은 고정 allowlist만 user metadata에
신규 가입과 같은 트랜잭션으로 저장한다. 기존 OAuth 계정은 Worker의 `account_status=existing|linked`를 근거로만
기존 회원 안내를 하고 새 계정은 `created`로 구분한다. QR은 엔진 지원을 확인한 뒤 카메라 권한을 요청하고,
언어 펼침 메뉴는 접힌 9개 항목을 키보드·스크린리더 탐색에서 제외하며 바깥 탭/Escape/선택 뒤 초점을 복원한다.

초대 링크는 `as=child|parent` 역할을 명시하고 hash 쿼리를 outer search보다 우선한다. 역할 없는 구형 링크는
아이로 자동 가입시키지 않고 역할 선택을 먼저 보여 주며, 공동 보호자 링크는 부모 인증→`join-as-parent`만 사용한다.
로그인된 부모가 아이 링크를 열거나 아이/선생님 세션이 부모 링크를 열어도 역할을 재해석하지 않고 명확히 거부한다.
Worker는 등록 부모·선생님의 `/join`, 익명·비부모의 `/join-as-parent`, 활성 아이 멤버십이 있는 stale 부모 세션의
권한 상승을 각각 stable error로 차단한다. 사전 조회뿐 아니라 child/parent membership 조건부 mutation 안에도
반대 활성 역할 `NOT EXISTS`를 넣어 stale child·parent JWT의 cross-route 동시 요청이 서로 다른 가족에 두 역할을
커밋하는 TOCTOU를 원자 차단한다. 현재 탭의 session draft는 공유 local draft보다 우선하며, 다른 탭의 draft와
다르더라도 어느 쪽도 지우지 않아 OAuth 복귀 탭의 초대·설문을 보존한다. 가족 화면은 아이 초대와 공동 보호자 초대를
분리하고, 공동 보호자 초대는 대표 부모이며 아직 공동 보호자가 없을 때만 노출한다. 검증은 앱 1,881/1,881·
Worker 1,262/1,262·가입/세션 집중 회귀 38/38·역할 경쟁 회귀 21/21,
앱/Worker typecheck, production build(2,280 modules·precache 472·중복 0), 브라우저 QA 부모 43+아이 14 화면 문제 0,
PWA install/offline/update 문제 0, Android `testDebugUnitTest lintDebug assembleDebug` BUILD SUCCESSFUL이다.
실제 계정 로그인·로그아웃·역할 전환·재페어링, refresh 토큰, 실기기 설치, D1 데이터는 건드리지 않았다.

구현 커밋 `9247e2a`·리뷰 보완 커밋 `564a9da`를 `main`에 fast-forward하고 GitHub 원격까지 푸시했다.
독립 재리뷰는 Critical/Important/Minor 0건으로 병합 가능 판정했다. Worker version은
`c362cd5d-10b1-449a-9b14-851c56e50c10`, Pages 배포는 `https://6ee00be0.hyeni-calendar.pages.dev`다.
Worker health 200 ready, `/api/access-region` 200 `{"country":"KR"}`·`Cache-Control:no-store, private`를 확인했다.
배포별 주소·고정 `hyeni-calendar.pages.dev`의 index/callback과 세 주소(브랜드 `hyenicalendar.com` 포함)의
entry `assets/index-Ck2cdZsh.js` SHA-256 `9f8f39dc6a1f643d3d562fc8ee0eb6106813568f5f9a32e72539009652f4417c`,
CSS `assets/index-DMuUhfUk.css` SHA-256 `177583e46ce74cda70b47b5f3139d3d674abd5923f433b0e610a5279a41ce6f4`,
Service Worker SHA-256 `aa9e60df57cddc5af3f993a133b2f3a26ebf1922fd6879ec34af139e84117e88`가 로컬과 일치한다.
최신 debug APK SHA-256은 `64eb568e351fc535d0d8f50845e4e5fc1b9f7a46ad174efa91762c3c2e3f40d4`이며 기기에는 설치하지 않았다.

**QA 커버리지(2026-08-22, 커밋 `3cd20dd`)**: final-browser-qa 에 가족 없는 신규 부모 시나리오(`authCase: "no-family"`)를 추가해 온보딩 connect→pairing 단계를 자동 검증한다. 로그인 mock 은 family_id 없는 세션(JWT 클레임에서도 family 제외)을 돌리고 `/api/family/mine` 은 204 null — JWT 토큰에 family_id 가 남아 있으면 세션 채택 후 redirect effect 가 곧바로 부모 홈으로 보내므로 토큰 클레임까지 제외해야 한다. PairingStep 계약: `.ob-qr` 버튼, `.ob-input--code`(인라인 스타일 없음), computed font-size 16px, placeholder `KID-XXXXXXXX`, `enterkeyhint=done`.
**최신 배포 상태(2026-08-22 오후, 커밋 `57b3794` iPhone 가입 절차 QR·코드·확대 수정)**: TK iPhone 제보 4종 중 f1def22 에서 미해결이던 QR 촬영 실패(BarcodeDetector 없는 iOS WebKit → jsQR 폴백, 스캔 시 lazy 로드), 코드 입력 KID 사라짐(`KIDXXXXXXXX` 하이픈 없는 12자도 정규화, `tests/pairCodeNormalization.test.ts`), 화면 좌우 밀림/키보드(iOS 자동확대 — `.ob-input`을 `--type-body-lg` 16px 토큰으로)를 수정했다. 페어링 코드 입력란 인라인 스타일을 `.ob-input--code`로 CSS 이관하고 Enter 제출·spellcheck off 를 보강했다. 검증: 앱 1,844/1,844, typecheck, build(진입 JS 344,145B 동일, precache 472 중복 0), qa:browser 57화면 문제 0, qa:pwa-runtime 문제 0, iPhone WebKit 스모크 PASS, Android assembleDebug+lintDebug 통과. Pages 배포 `https://cd7c4095.hyeni-calendar.pages.dev`, 고정 URL index SHA-256 로컬=prod 일치(index/sw/entry/css/callback/jsQR/QrScanner 청크), 브랜드 도메인 200. Worker는 미배포(대상 아님). 실기기 화면 관측은 A17/razr 연결 후 후속.
**최신 배포 상태(2026-08-22 오전, 커밋 `f1def22` 가입 첫 화면 프리미엄 흐름)**: 언어 선택 트리거 알약·소셜 가입 설문 경로·휴대폰 가입 버튼 계층 통일·OTP 진행 트랙 등 온보딩 UX를 다듬은 커밋 `f1def22`를 Pages에 배포했다. Worker는 이전 version(`188d1103-e9b8-4ac2-9cc0-59419b1709fd`) 그대로며 health 200 `{"ok":true,"status":"ready"}`다. 고정 주소 `hyeni-calendar.pages.dev`의 index.html SHA-256 `947092a4a60a2c044ec04ef50d355375e700a856ff77a750331b33a5f8e20f9f`, sw.js `10a2d60ec6d36489565b88c99f614423ed0579a756c1c51a6dea5260bd4acb89`, entry `assets/index-CpGLA9HA.js`, CSS `assets/index-BU7CSNBK.css`, `/oauth/callback.html`, manifest까지 로컬 dist와 바이트 일치를 재확인했다. 실기기·계정·D1은 건드리지 않았다. 남은 후속은 A17/razr/S25 실기기 화면 관측과 Play 심사 전송(HOLD)이다.
---

## 0. 한 줄 요약

혜니캘린더(가족 일정 공유 + 부모·자녀 위치/안전)를 **리디자인 시안 기준으로 새로 구축**하는 프로젝트.
**1~10단계 전부 완료**(전 화면 실데이터·다자녀·AI 친구·알림 3종·릴리즈 게이트) — 실기기 3대 운용 중.
**현 국면 = 실사용 안정화**: TK 가 실기기로 쓰며 제보하는 버그·개선을 즉시 수정·검증·배포.

**2026-08-22 온보딩·접속 국가 정본**: 첫 역할 선택 화면의 언어 설정은 역할 카드 아래·약관 위 하단에 두고,
저장된 선택이 없을 때만 공개 `GET /api/access-region`의 Cloudflare edge country를 기본값으로 사용한다. 현재 언어
1개만 먼저 표시하고 나머지 9개는 펼쳐서 선택하며, 사용자가 직접 고른 언어는 늦게 도착한 국가 응답으로 덮지 않는다.
이 공개 API는 인증·GPS·D1 없이 `request.cf.country`의 2글자 국가만 `private, no-store`로 반환하고 IP·세부 위치를
저장하거나 로그에 남기지 않는다. 소셜 진입은 한국(`KR`)과 판별 불가(`ZZ`)에서 Kakao+Google(+설정 시 Naver), 그 밖의
국가에서 Google만 표시한다. 첫 화면 좌우 여백은 24px, 이후 가입·로그인·페어링·권한 화면은 16px로 통일하고 iPhone
safe-area 뒤 상단 16px, 전역 수평 overflow 차단, 세로 fade 전환을 적용했다. QR 스캔은 브라우저 기능 유무를 권한보다
먼저 확인하고, Android 임시 거부는 재요청·영구 거부는 설정 이동 후 자동 재확인·모든 오류는 수동 코드 입력으로 복구한다.
대상 회귀 34/34와 Worker 공개 API 2/2, 앱·Worker typecheck, production build(469 precache·중복 0)는 통과했다.
사용자 요청으로 이후 브라우저 57화면 전수 검수와 전체 앱/Worker 테스트 재실행은 생략했으므로 그 범위를 완료로 간주하지 않는다.
소스 커밋 `4be6089`를 `main`에 푸시하고 Worker version `29acfe86-974e-4bbc-b69d-f3c8b885a394`와 Pages
`https://064d0ec0.hyeni-calendar.pages.dev`를 배포했다. Worker health 200 ready, 공개 지역 API 200
`{"country":"KR"}`·`Cache-Control:no-store, private`를 확인했다. 배포별 주소·고정 Pages·`hyenicalendar.com`은 모두
entry `assets/index-BLgtnG0U.js`(SHA-256 `7c6e6a89a18c0967cb0dde130e5f59bd88719281f2a06a5adeb4ad5c498af719`),
CSS `assets/index-DMuUhfUk.css`, Service Worker가 로컬 `dist`와 바이트 일치하고 브랜드 OAuth callback도 200이다.
Android는 최신 `dist`를 sync하고 `assembleDebug` 성공, APK SHA-256은
`52cdf25abdc5c5c6827d5dc5650b56e6bfd30cb92f4009a8c0ee0520f3d346da`다. 재연결한 S25에
`npm run android:install:debug -- R5CY521CFNZ`로 보존 설치했고 v1.4.0/versionCode 11·user 0 패키지 존재·
DUAL_APP user 95 패키지 없음·`lastUpdateTime=2026-08-22 01:46:16`을 확인했다. 앱 실행·로그인·역할·페어링은 건드리지 않았다.

**현재 배포 상태(2026-08-21 인증 진입점·브랜드 도메인/PWA 문서 신선도·Android 중복 아이콘 안정화)**: 브라우저 부모 모드의 로그인/회원가입을
첫 화면의 명시적 탭으로 분리하고 전화 가입·카카오/구글 가입, 지속 오류 안내, 잘못된 비밀번호 뒤 입력 유지·비밀번호
포커스·버튼 재활성화를 정리했다. ID 확인 실패를 중복으로 오인하지 않으며 `mindlady`는 production 공개 조회에서
`200 {"available":true}`다. 가입 전 입력·설치 식별자·전화·ID 중복을 먼저 확인하고, OTP 검증 뒤 user/identity/profile/
OTP 소비를 한 D1 batch로 확정한다. `worker/db/auth-entry-uniqueness.sql` 적용 전 익명 중복 그룹 4종이 모두 0임을 확인했고,
적용 후 phone·정규화 login_id·phone_otp UNIQUE 인덱스 4개를 readback했다. OTP 검증 직후 재발급 경합도 조건부
INSERT로 계정 행 0건·새 OTP 보존을 보장한다. Worker version은 `188d1103-e9b8-4ac2-9cc0-59419b1709fd`이며
health 200 ready, ID 확인 응답 `no-store`를 확인했다.

브랜드 도메인 가입 404의 근본 원인은 `hyenicalendar.com` apex가 구형 Vercel 배포를 가리켜, 당시 번들이 비어 있는
`VITE_API_BASE`로 같은 origin의 `GET /api/auth/oauth/{provider}/start`를 만든 것이었다. 구형 apex A 레코드 2개를
제거하고 Proxied CNAME `hyenicalendar.com → hyeni-calendar.pages.dev`를 연결했으며 Pages custom domain API의
`status=active`·`validation=active`를 확인했다. `www`·와일드카드·CAA 등 비대상 레코드는 보존했다. production
루트·`/oauth/callback`·과거 GET 경로는 모두 Cloudflare 200이고 `x-vercel-*`가 없으며, 현재 entry
`assets/index-JSdP-RED.js`와 Service Worker SHA-256
`639b4bf823d674c99c5ef50226b4585aff968e9106f736cee8d1ec7ffe4d1a61`가 로컬 `dist`와 일치한다.
브랜드 도메인의 HTML raw 응답에는 zone Web Analytics beacon 1줄이 Cloudflare에서 삽입되므로 raw index hash를 곧바로
비교하지 않는다. 그 삽입 줄을 제외한 HTML과 entry/CSS/Service Worker 바이트를 로컬 `dist`와 교차 확인한다.
웹 OAuth 시작은 반드시 절대 Worker API
`POST https://hyeni-calendar-api.tkisdroid.workers.dev/api/auth/oauth/{provider}/start`와 서버 생성 state/transaction을
사용한다. 같은 origin GET을 되살리지 않는다. Worker CORS/OAuth redirect origin은 정확한
`https://hyenicalendar.com`·`https://www.hyenicalendar.com`·Pages origin만 허용하고 경로/접미사 lookalike는 거부한다.
Android App Link OAuth callback 정본은 계속 `https://hyeni-calendar.pages.dev/oauth/callback`이다.

앱 계정은 살아 있는데 기존 브라우저 로그인 뒤 정적 `가족 일정을 불러오는 중`에서 멈춘 원인은 가족 조회 API가 아니라,
기존 브라우저의 구형 Service Worker가 온라인 탐색에도 설치 당시 `index.html`을 cache-first로 돌려준 것이었다. 새 Pages
배포에 더는 없는 과거 hashed entry를 그 문서가 가리키면 React가 마운트되지 않아 정적 부팅 셸만 남는다. `src/sw.ts`는
이제 모든 문서 탐색을 `fetch(request, { cache: "no-store" })`로 먼저 받고 네트워크가 실제 실패할 때만 precache
`index.html`로 강등한다(`src/transform/pwaNavigationFreshness.ts`). 구형 SW가 현재 entry조차 못 받는 브라우저는
`https://hyenicalendar.com/?hy-recover=20260821`을 같은 탭에서 1회 열고 로그인을 끝까지 완료해 새 SW 활성화까지
이어간다. 성공 로그인→가족 조회→`#/parent/home` 및 하드 reload 세션 유지가 브라우저 QA에 추가됐고, PWA runtime QA는
온라인 `/index.html` 실요청·오프라인 precache 복구·새 SW controllerchange를 함께 검증한다. 실제 계정·refresh 토큰·
실기기 역할은 건드리지 않았다. 수정 커밋=`a715467`.

Kakao/Google 복귀는 Pages 200 rewrite에 기대지 않고 build가 현재 hashed entry를 참조하는 물리
`/oauth/callback.html`을 생성한다. production `/oauth/callback`은 redirect 없이 200·`Cache-Control:no-store`, 루트
Service Worker scope(`/`)이며 콜백 SHA-256 `792475a3a22205dd6094eb40cf3de938bf6845954db84a340ed5ea79cadc6ae0`다.
Pages 최신 배포는 `https://1ef2cce3.hyeni-calendar.pages.dev`, 고정 주소 index SHA-256은 로컬과 같은
`178950a8cceaab935bf0f9ea9da136c01f334beec820ac6a3a20d9ae4abbe046`다. iPhone 13 WebKit 격리 검증은
콜백/Service Worker·390×844 레이아웃·잘못된 비밀번호·ID 확인·오프라인 Cache Storage까지 문제 0으로 통과했다.
실제 iPhone Safari 실기기와 실제 OAuth 동의·SMS 수신은 계정/외부 발송을 건드리지 않기 위해 이번 검증에서 수행하지 않았다.

Android 아이콘 2개는 Manifest 런처 중복이 아니라 S25의 Samsung `DUAL_APP` user 95에 ADB가 패키지를 함께 설치한 것이
원인이었다. 기본 user 0의 앱·데이터·세션은 유지하고 `notLaunched=true`였던 user 95 복제만 제거했으며, 현재 S25 readback은
user 0 `com.hyeni.calendar/.MainActivity` 1개·user 95 package/activity 없음이다. 이후 설치는 반드시
`npm run android:install:debug -- <serial>`(`adb install --user 0 -r`)을 쓴다. 최종 병합 Manifest와 debug APK 모두
launchable activity 1개, APK SHA-256 `ea0f94aedbc0930819f2f68a383cec170dbaaa74b404bfdbb86d932509477a4b`다.
검증은 앱 1,837/1,837, Worker 1,252/1,252, typecheck 2종, production build/PWA 중복 0, 브라우저 QA 57화면
문제 0, iPhone WebKit, Android unit+lintDebug+assembleDebug를 통과했다.
이번 웹 전용 신선도 수정은 앱 1,840/1,840·Worker 1,252/1,252·typecheck 2종·production build(469 precache,
중복 0), exact dist 브라우저 QA 부모 43+아이 14 화면 및 성공 로그인/reload, PWA install·온라인 최신 문서·오프라인·
안전 업데이트를 모두 문제 0으로 확인했다. 최종 dist tree SHA-256은
`6289028f4e5ed78bdfdaa64f40b8113f110082a47650985b36fb86d350e8b4d4`이고 운영 배포별·고정 Pages·브랜드 주소의
entry/Service Worker/브랜드 entry asset 바이트가 로컬과 일치한다. Worker·D1·Android 앱은 변경·배포하지 않았다.

**직전 배포 상태(2026-08-19 새벽 갱신)**: 아이 AI 친구 3종(꾹 눌러 말하기·습관 기억·하루 대시보드)을 배포했다.
배포 전 `worker/db/child-daily-digest.sql` 을 프로덕션 D1 에 1회 적용해 `child_daily_digests` 테이블과
`idx_child_daily_digests_created` 인덱스를 readback 으로 확인했다(적용 전 조회 0행 → 적용 후 table+index 존재).
Worker version `d4947d51-2ccf-4fb5-abae-54df0bc20df4`(health 200 `{"ok":true,"status":"ready"}`,
`GET /api/ai/daily-digest` 미인증 401, cron 트리거 5개 유지). Pages `https://c2f7d017.hyeni-calendar.pages.dev`
— 고정 URL과 `hyeni-calendar.pages.dev` 의 index SHA-256 `240aa011a0f96ae9a39a1a1a78dfb93d6693f2fe4b4cfad33fe39b20c3e5bcad`
가 로컬 dist 와 같고 entry `assets/index-bovhBdQ7.js`·`assets/index-fxI4MsT3.css`, manifest·sw·assetlinks 200,
CSP·`Referrer-Policy: no-referrer`·nosniff 3/3 을 확인했다. 로컬 검증은 앱 1,768/1,768, Worker 1,233/1,233,
`tsc -b`·`typecheck:worker`·production build(진입 JS 339,259/500,000B), Android unit+lintDebug+assembleDebug 통과다.
razr(ZY22H9VTQD)에 `adb install -r` 로 데이터 보존 설치했고 CDP 로 세션 role=`child`·family `f9a75cb4…` 유지와
활성 번들 `index-bovhBdQ7.js`(= 방금 배포본, SW 구번들 잔존 없음)를 확인했다. ⚠️ 화면 관측은 미완료다 —
새벽 3시라 razr 화면이 꺼져 있어 CLAUDE.md 안전 원칙대로 깨우지 않았다(`document.hidden` 이라 배회·안내
말풍선은 설계대로 멈춰 있다). A17 은 미연결이라 부모 대시보드 실기기 검증도 미완료다.
아래는 그 직전 배포 기록이다.

**직전 배포(2026-08-17 밤)**: 친구 초대 50회·상한 없음까지 반영해 Worker version
`c887c03f-fcb2-4c92-9fd7-467f635ace41`, Pages `https://2a822262.hyeni-calendar.pages.dev`(고정 URL·프로덕션 별칭 index
SHA-256 `1674cdac29be64517c6713ddd1fbcda0909406ab5c46449d3bdaee4b74876da8` = 로컬 dist, entry JS/CSS 바이트 일치,
보안 헤더 3/3, manifest·sw·assetlinks 200)를 배포했다. 배포 전 `worker/db/referral-rewards-v2-unlimited.sql` 을
프로덕션에 1회 적용해 초대 코드 1행을 보존하고 트리거를 복원했다. 배포 뒤 A17 부모 세션으로
`GET /api/referrals/me` 200 · `rewardCredits: 50` · 상한 필드 제거를 확인했다. 브라우저 QA 문제 0건.
아래는 그 직전 배포 기록이다.

**직전 배포(2026-08-17 저녁)**: 앱 커밋 `1a313d9` 기준으로 Worker·Pages를 함께 배포했다.
Worker version ID `59191d7e-efd5-4f4b-afb9-5d5819941668`(health 200, `/api/family/member/photo` 미인증 401),
Pages 배포 `https://0f411410.hyeni-calendar.pages.dev` — 고정 URL과 `hyeni-calendar.pages.dev`의 index SHA-256
`f1d9c7c88dcf9fb3d30f94c029a475ec047d57d5cfbdffda45225c7ea36ee382`가 로컬 dist와 같고 entry
`assets/index-m9ofkan_.js`·`assets/index-DMy0b23w.css`도 바이트 일치, CSP·`Referrer-Policy: no-referrer`·nosniff·
manifest·sw.js·assetlinks 200을 확인했다. 배포 전 migration 선행 확인 결과 `worker/db/*.sql`의 테이블 44·인덱스 96·
추가 컬럼 59가 프로덕션에 모두 존재해 추가 적용은 없었다. 배포 후 실기기(A17)에서 `parent_profile` 업로드가
남의 멤버 대상은 403 `forbidden`, 본인 멤버 대상은 본문 검증까지 진행(4바이트 더미라 415)함을 확인했고
quota·journal 행이 0건이라 아무것도 저장되지 않았다. ⚠️ Pages 배포 자격은 OAuth가 만료돼 있어
`worker/.env`의 `CLOUDFLARE_API_TOKEN`(Pages 권한 포함)을 저장소 밖 디렉터리에서 주입해 사용했다.

**★단일 저장소(2026-08-02)**: Cloudflare Worker(`worker/`)와 D1 스키마(`cloudflare/`)가 이 저장소로 이관됐다.
**hyeni-1 은 폐기 예정이며 어떤 코드·테스트·CI·런북도 그 경로에 의존하지 않는다.** 상세는 §6.

**현재 AI 런타임(2026-08-02)**: Worker의 활성 OpenAI 호출 4개(아이 채팅·일정 텍스트/사진 파싱·하루 요약·아이 모니터)는
중앙 `worker/lib/openai.ts`의 `gpt-5.6-luna`만 사용한다. 기존 Chat Completions 응답 계약을 유지하고
`reasoning_effort: "none"`·`max_completion_tokens`·사용자 원문이 아닌 SHA-256 `safety_identifier`를 적용한다.
로컬 AI Gateway text/JSON/image canary는 3/3 통과했지만 감사 과정에서 당시 API 키 원문이 내부 도구 로그에 노출됐으므로,
운영 전 기존 키 폐기·새 키 발급/secret 반영·canary 재실행이 필수다. 현재 프로덕션 Worker는 아직 구버전이므로 Luna 전환 완료로
간주하지 않는다. 기존 `docs/plans/2026-07-31-pricing-tier-benchmark.md`의 gpt-4o-mini 원가 가정은 역사 스냅샷으로만 보존한다.

**현재 Google Play 출시 상태(2026-08-15 오후)**: **최종 심사 전송 직전 HOLD**다. 최신 앱 source commit
`40a32e2c18e929877e7c92970d6898619d7feedd`에서 승인된 업로드 키로 v1.3.0/versionCode 6 release AAB를 만들었고,
SHA-256은 `6b31166c7b6e141ed451a81970ed78a4a934ea1ecd8cc31addd4024f9d0dbc45`다. 승인 인증서 일치,
release/non-debuggable manifest, `PAGE_ALIGNMENT_16K`·ZIP·전체 ELF 16KB 정렬을 증거 JSON으로 확인한 뒤 Play 프로덕션
초안 `혜니캘린더 1.3.0 (6)`에 업로드했다. 최신 production build, 앱 1,298/1,298, Worker 1,161/1,161,
Android unit 175/175·lint·assembleDebug가 통과했고 A17 부모에 `adb install -r`로 설치해 세션 보존, 부모 홈,
razr 실제 기기명 `motorola razr 40 ultra` 표시를 확인했다. S25는 완전 무조작했다. Worker는 version ID
`c4c769c3-b4d5-4ba1-8c68-ef2ba22c742c`로 배포했고 health 200과 reverse-geocode 인증 route 401을 확인했다.

사용자가 지정한 `C:\Users\TK\Downloads\Gmail (3)`의 피처 그래픽 1장, 휴대전화 스크린샷 8장,
7인치·10인치 태블릿 스크린샷 각 4장으로 Play 자산을 전부 교체했고 API readback의 순서·SHA-256을 로컬 원본과
대조했다. 폴더에 512×512 아이콘이 없어 Play 아이콘만 기존 설치 아이콘을 유지했다. A17·razr 정책 영상은 개인정보·
정밀 위치를 가린 무음 최종본으로 게시했고, 백그라운드 위치=`https://youtu.be/yTfCI3RsVE8`, FGS 위치·마이크·특수 용도=
`https://youtu.be/cb_BFyed6uE` 모두 `아동용 아님`·`일부 공개` 저장과 비로그인 외부 접근을 확인했다. Play의 백그라운드
위치·FGS 선언과 제한된 앱 액세스 심사 계정도 저장됐다. Play의 일반 문제 빠른 검사는 감지된 차단 없이 끝났고 게시 개요에는
**검토를 위해 변경사항 12개 제출** 버튼이 활성화돼 있다. 최종 심사 전송 버튼은 사용자 최종 실행을 위해 누르지 않았다. 정확한 자산 순서·
문구·영상 URL·AAB 증거는 `docs/store/play-console-submission-v1.3.0.md`가 정본이다.

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
- **2026-08-19 최신 사용자 지시 기준 실기기 검증기는 A17(RFKL40DP73J) 부모 · razr(ZY22H9VTQD) 아이 ·
  S25(R5CY521CFNZ, SM-S937N) 세 대다.** 세 기기 모두 `npm run android:install:debug -- <serial>`
  (`adb install --user 0 -r`)로 기본 사용자 데이터·계정·페어링·세션을 보존한다. `--user 0` 없는 설치는
  Samsung DUAL_APP 프로필까지 패키지를 복제해 아이콘이 두 개 생길 수 있으므로 금지한다.
  실제 계정 로그아웃·역할 전환·재페어링을 하지 않는다. refresh 토큰은 출력·복사·회전하지 않는다.
  ⚠️ S25는 2026-08-02~08-19 검증 제외였다가 TK 지시로 상시 검증기로 복귀했다(이전 문서의 "S25 접근 금지"
  문장은 그 기간의 역사 기록이다). **A17·razr 와 달리 S25 는 고정 역할이 없으므로** 검증 전에 아래
  "기기 역할 확인" 절차(CDP 로 `hyeni-api-session-v1` 의 role/familyId + 실제 화면)로 역할을 먼저 확정한다.
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
- 기존 서버·인프라(`worker/`)를 먼저 뒤진다(재구축 금지). 스키마를 늘리기 전에 기존 계약으로 풀 수 있는지 본다.
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
- ★**아이 알림은 위험·긴급만(2026-08-03 보호자 결정)**: 도착·출발 같은 **일상 이동 알림을 아이에게 보내지 않는다**.
  하루에 여러 번 울려서 아이가 오히려 휴대폰을 더 자주 보게 됐다는 실사용 제보가 근거다. 아이 수신 대상은
  위험 구역 진입(`danger_zone`·`danger_enter`·`danger_entry`, urgent)과 해제(`danger_exit`), 그리고 SOS/emergency 뿐이다.
  `worker/lib/childSafetyNotification.ts`의 `childSafetyNotificationForAlert`가 **단일 판정점**이며 여기서 `null`을
  돌려주면 `sendChildSafetyNotification`이 성공으로 끝나 **부모 발송 경로는 전혀 영향받지 않는다**(부모는 그대로 다 받는다).
  ⚠️ `arrived`·`late_arrived`·`place_arrived`·`place_left`·`unregistered_stay_*`를 이 목록에 다시 넣지 말 것.
  아이 설정 화면의 "위치·안전" 토글 3개(일반 위치·등록 장소·친구놀이)는 전부 부모 알림에만 적용되므로
  아이 role 에서는 토글을 숨기고 사실만 안내한다(빈 약속 금지). 회귀=`tests/childEverydayMovementAlerts.test.mjs`·
  Worker `tests/childSafetyNotifications.test.mjs`.
- ★**아이모드 AI 친구 = 살아 있는 3D 캐릭터 + 도구 에이전트(2026-08-24 TK 지시)**:
  **①캐릭터** — AI 진입점은 네모난 로봇 버튼이 아니라 TK 지정 1024px 투명 PNG 18종을 변환한
  `public/assets/ai-buddy/poses/*.webp`다. `scripts/import-ai-buddy-chat-emotions.mjs`의 파일명↔slug 표가 정본이며,
  원본 여백을 trim한 뒤 288px contain+16px 투명 여백의 320px WebP로 만든다. **알파 전신 실루엣**에
  `object-fit:contain`+`drop-shadow`를 써야 휴대폰 위에 실제로 선 입체감이 산다. 배경·border-radius 사각 면을
  다시 씌우거나 삭제한 `public/assets/ai-buddy/chat/*.webp` 로봇 세트를 되살리지 말 것.
  20개 의미 face→18개 실제 pose 매핑과 감정 판정 정본은 `src/transform/aiBuddyEmotion.ts` 하나다.
  `excited`는 emotion과 chat face 양쪽에 있으므로 chat face를 이미 아는 소비자는 `aiBuddyChatFaceAsset`을 사용한다.
  범용 `aiBuddyFaceAsset`은 기존 호환을 위해 emotion을 먼저 판정한다. 플로팅 버튼·아이 홈 타일·대화 헤더·
  말풍선·타이핑·음성 화면이 **같은 캐릭터 세트**를 쓴다.
  규칙: 답 대기=thinking · 안전 신호(medium/high)=caring(어떤 즐거운 단어보다 우선) · **아이가 속상하면 같이
  슬퍼하지 않고 caring** · `ok:true && !confirmationRequired` 일 때만 excited(확인 대기 중에 해낸 표정 금지) ·
  도구 실패=sad · 22~05시 대기=sleepy. 화면 문구는 `aiBuddyStatusLine`(반말 한 줄), `aiBuddyEmotionLabel`은 aria 전용.
  **②플로팅 친구** — `src/app/AiBuddyFab.tsx` 를 `ChildShell`(bottomInset 112)·`PushShell`(20)에 둬 아이 화면
  어디서나 대기한다. **정확히 `/child/home`만 88px 활동형**으로 배회·말풍선·커짐/전체화면 부르기를 허용한다.
  다른 아이 화면은 **68px 동행형**으로 제자리 숨쉬기/시선 동작만 하고 배회·선제 말풍선·부르기를 전부 금지한다.
  동행형은 화면별 하단 입력/빠른 문구를 가리지 않도록 shell bottomInset에 96px를 더한다. 위치는 px 가 아니라
  **이동 가능 영역 비율**(`src/transform/aiBuddyFabPosition.ts`)로
  가족+아이 키에 저장해 회전·기기 변경에도 화면 밖으로 나가지 않고, 손을 떼면 가까운 좌우 가장자리에 붙는다.
  `role !== "child"` 와 AI 친구/SOS/온보딩 경로에서는 렌더하지 않는다(부모·선생님 화면에 뜨면 오작동).
  ⚠️ 진입 번들 예산 500KB 를 넘겨서 **lazy + Suspense 필수**(직접 import 하면 build 가 막힌다).
  표정은 `AiBuddyMoodProvider`(App, 라우터 **위**)가 들고 있어야 대화→홈 이동에도 기분이 이어진다.
  **②-b 대기 중 배회·말 걸기(2026-08-18 TK 지시)** — 아이가 아무 것도 안 해도 친구가 살아 있어야 한다.
  경로 계산 정본은 `src/transform/aiBuddyWander.ts`(순수·시드 결정적): 홈에서 9초마다 한 걸음, 좌우 가장자리(0/1)에만
  서고 세로는 8~92% 띠 안에서 최대 0.34비율씩, 세 걸음마다 반대쪽으로 건너간다. 이동 중 face는
  `excited`→`rush`(달리기 pose), 도착 face는 **이동 face를 뺀** 대기 동작에서 뽑는다 — 같으면 9초 동안 계속 걸어가는
  것처럼 보인다(실측으로 잡은 결함). 세 걸음마다 도착 얼굴에 맞는 반말 한 마디를 2.6초 띄운다
  (`abf__bubble`, `pointer-events:none`·`aria-hidden`, 버튼 바깥쪽 가장자리 정렬로 화면 밖 이탈 방지).
  배회는 **임시 자리**라 저장하지 않고(아이가 직접 옮긴 자리가 정본), 드래그 직후 20초·드래그 중·실제 대화 감정
  표시 중·`document.hidden`·움직임 줄이기에서는 멈춘다(`canAiBuddyWander`). ⚠️ 배회 `setInterval` effect 의
  의존성에 `emotion` 을 넣지 말 것 — 감정이 바뀔 때 effect 가 재생성되며 도착 표정·말풍선 타이머가 취소된다
  (`emotionRef` 로 읽는다). 자산·표현 모드 회귀=`tests/aiBuddyCharacterAssets.test.mjs`·
  `tests/aiBuddyCharacterBehavior.test.ts`·`tests/aiBuddyFab.test.ts`.
  **②-c 기기 동작은 열어 주기만 한다(2026-08-18 TK 지시)** — 아이가 "무음으로 해줘", "전화 걸어줘",
  "문자 보내줘", "와이파이 켜줘" 라고 하면 **앱이 대신 바꾸지 않는다**. 판정은
  `worker/shared/aiDeviceActionTools.js`(순수)이고 도구는 `openDeviceAction` 하나, target 화이트리스트는
  `sound|wifi|battery|notifications|location|dial|sms` 7개다. 서버는 화면 이름만 정하고
  (`clientAction:"openDeviceAction"`), 대화 아래 **버튼 한 개**를 세워 아이가 누를 때만 네이티브
  `DeviceAction.open()` 이 해당 화면을 연다(전화=`ACTION_DIAL`, 문자=`ACTION_SENDTO` — **발신·전송은 사람이 누른다**).
  ⚠️ 무음 전환을 앱이 대신 하려면 방해금지 접근(`ACCESS_NOTIFICATION_POLICY`)이 필요하고, 그러면 부모의
  SOS·소리 울리기(알람 스트림 최대 볼륨)까지 조용해질 수 있어 **의도적으로 넣지 않았다**. 새 권한 0개다.
  전화·문자 target 은 부모의 연락 허용 스위치(`contactActionsAllowed`)를 따르고, 나머지 설정 화면은 항상 열 수 있다.
  LLM·크레딧을 쓰지 않는 결정적 응답이라 `CHILD_SETTINGS_AGENT_TOOLS` 에 넣었다.
  회귀=`worker/tests/aiChildDeviceActions.test.mjs`·`tests/childDeviceActionUi.test.ts`.
  **③도구 에이전트** — 기존 일정/부모연락 도구에 아이 본인 설정 3종을 추가했다:
  `updateNotificationSettings`(일정 알림 on/off·N분 전) · `updateAiFriendName` · `changeAppTheme`.
  셋 다 LLM 을 거치지 않는 결정적 응답이라 **하루 대화 횟수를 깎지 않는다**(`aiUsagePolicy`).
  테마는 서버 컬럼이 없어 서버가 색만 확정하고 `clientAction:"setAccent"` 로 클라가 적용한다.
  ⚠️ **일정 삭제는 보호자 전용** — planner 는 `schedule_delete_parent_only` 로 닫고 route 는 확인 토큰이 와도
  403 이다. `deleteSchedule` 실행 경로를 되살리지 말 것. 알림 쉬는 시간·위치/장소/친구놀이 알림은 부모 소관이라
  `notification_settings_parent_only` 로 정직하게 거절한다(못 하는 걸 한 척 금지).
  확인이 필요한 도구(부모 메시지·일정 변경·전화)는 클라가 **확인 카드**를 세우고 버튼에서만 `confirmedTool` 을 보낸다.
  **④한 얼굴 원칙(2026-08-17 TK 제보)** — 대화 화면 말풍선 옆·타이핑·설정 미리보기까지 **모두 같은 이모티콘 얼굴**을 쓴다.
  동물(`animal/*.webp`)을 프로필로 쓰면 "토끼와 대화하는 느낌"이라 친구가 둘로 보인다. 동물 카드는 얼굴이 아니라
  **성격 고르기**다(설정 화면 라벨도 그렇게 읽히게 두었다). 헤더 상태 문구는 `aiBuddyStatusLine`(짧은 반말) +
  `white-space:nowrap`+말줄임 — 전에는 "이야기 할 준비됐/어"로 글자가 끊겼다.
  **⑤일정 성격별 제안** — 어떤 일정이든 "준비는 다 됐어?"로 묻던 것을 고쳤다("수호 생일 챙기기"에 준비물 질문).
  `src/transform/eventCompanionPrompt.ts`(클라 인사·제안칩·아이 홈 말풍선)와 `worker/shared/aiEventContext.js`
  (LLM 프롬프트 힌트)가 **같은 키워드 표**를 쓰며 `tests/eventCompanionPrompt.test.ts` 가 두 표의 동기화를 강제한다.
  한쪽만 고치면 홈에서는 "선물 정했어?", 대화에서는 "준비물 챙겼어?"라고 하는 앞뒤 안 맞는 친구가 된다.
  **⑥아이를 알아 가는 AI(2026-08-17)** — 맥락 창 6→**14**턴, 요약 3→5건, 장기기억 20→**30건(확신도 우선)**.
  `aiMemoryPolicy` 는 고정 목록 10개 대신 **문장 구조로 열린 어휘**를 뽑는다(관심·싫음·무서움·잘하는 것·꿈·음식).
  ⚠️ 조사 처리 함정: 서술어에 따라 붙는 조사가 다르다(좋아해=을/를, 무서워=이/가). **`이` 는 절대 떼지 않는다**
  — 고양이·떡볶이·어린이가 고양·떡볶·어린으로 망가진다. 같은 말을 다시 하면 confidence 가 +0.05(상한 0.95)로
  올라가 "점점 잘 아는" 효과를 낸다. 민감·일시적 감정·대명사 필터는 그대로다.
  프롬프트는 `## 아이에 대해 알고 있는 것` 목록 + "모르면 아는 척하지 말고 물어본다" 규칙을 함께 준다.
  아이 대화만 `reasoningEffort:"low"` + `max_completion_tokens 900` 이다(`openaiLunaChatConfig` 2번째 인자).
  ⚠️ 추론을 켜면 추론 토큰이 예산을 먹어 **빈 응답 → 실패 강등**이 되므로 600 미만 예산은 함수가 막는다.
  회귀=`tests/aiBuddyFab.test.ts`·`tests/eventCompanionPrompt.test.ts`·Worker
  `tests/aiChildSettingsAgent.test.mjs`·`tests/aiChildMemoryDepth.test.mjs`·`tests/openAiLunaContract.test.mjs`.
- ★**AI 친구 음성 turn 자동 답변(2026-08-18 TK 승인)**: 마이크가 만든 `source="voice"`의 정상 reply는 가족+아이 읽어주기 설정이 꺼져 있어도 그 turn만 자동 TTS한다. `composer`·`suggestion:*`·`confirm`은 기존 영구 설정을 따르고, 빈·오류·한도 응답은 읽지 않는다. 새 마이크 시작·토글 off·화면 이탈은 STT/TTS를 즉시 중단하며 초기화 중이던 오래된 native callback도 재생을 되살리지 않는다. 사용자 음성 원본은 Worker·OpenAI에 보내지 않고 인식 텍스트만 기존 안전·크레딧·저장 경로로 보낸다. 단 OS·브라우저·선택된 STT/TTS 제공자는 음성 또는 합성할 답변 텍스트를 외부 처리할 수 있으므로 “항상 기기 안에서만 처리”라고 고지하지 않는다. TTS는 추가 API·크레딧·권한 없이 fail-soft이며 10개 locale 태그를 전달한다. 회귀=`tests/childVoiceChat.test.ts`·`tests/nativeTtsCdpProbeSafety.test.mjs`·Android `SpeechLocalePolicyTest`/`SpeechPlaybackGenerationTest`·`worker/tests/legalCopy.test.mjs`·`tests/playReleaseDocumentation.test.mjs`.
  **razr 최종 가청 검증(2026-08-19)**: `adb install -r` 전후 role=`child`·가족 scope·앱 root projection을
  보존했고, native callback 기준 짧은 발화 `started→done`과 긴 발화 `started→stopped`를 확인했다. 최초에는
  “AI”만 들리거나 다른 내용이 들렸지만 제품 결함이 아니라 BOM 없는 UTF-8 QA 스크립트를 Windows PowerShell 5.1이
  CP949로 읽어 한글 고정 문장을 깨뜨린 것이 원인이었다. 발화문 전체를 ASCII `\uXXXX`로 고정하고 단일 문장 모드로
  재검증해 TK가 “AI 친구 음성 답변 확인이야” 전체를 정확히 들었다고 확인했다. 운영 마이크→AI 왕복은 대화 행·크레딧
  보호를 위해 실행하지 않았다. 현재 앱 소스는 Play v1.3.0/versionCode 6 서명 AAB 이후이므로 기존 AAB는 stale이다.
- ★**꾹 누르면 바로 말하기 + 버튼이 그걸 알려 준다(2026-08-19 TK 지시)**: 아이는 플로팅 AI 친구 버튼에
  음성 대화가 있다는 걸 알 방법이 없었다. ①**조작** — `AI_BUDDY_VOICE_LONG_PRESS_MS`(550ms) 이상 누르면
  `navigate("/child/ai-friend", { state:{ startVoice:true, buddyLaunch:true } })` 로 대화창이 열리고
  `startVoice()` 가 바로 돈다(`buddyLaunch` 는 아래 전환 연출을 이어받게 하는 표식이다).
  길게 누른 것 자체가 아이의 조작이라 "전송은 사용자 액션에서만" 계약을 어기지 않는다. 대화 화면은
  `navigate(pathname, { replace:true, state:{...navState, startVoice:false} })` 로 히스토리 state 를 즉시 지운다 —
  안 지우면 뒤로 갔다 돌아올 때마다 마이크가 켜져 아이가 놀란다. 드래그로 옮기는 중이면 `cancelLongPress()`,
  발동한 뒤 `endDrag` 는 `longPressFiredRef` 를 보고 대화창을 **또 열지 않는다**.
  ②**안내** — `src/transform/aiBuddyVoiceHint.ts` 가 판정한다. **한 번 써 본 아이에게는 다시 띄우지 않고**
  (`used`), 안 써 본 아이에게도 하루 한 번(`AI_BUDDY_VOICE_HINT_MIN_GAP_MS`)·최대 3회다. 말풍선은 배회 한 마디
  보다 우선하며 `.abf__bubble--hint` 로 두 줄까지 펴진다(기본 말풍선은 `nowrap`+말줄임이라 잘린다).
  ⚠️ 저장값 파싱은 `typeof` 가드 필수 — `Number(null)===0` 이면 "1970년에 알림"이 되어 매번 다시 뜬다.
  회귀=`tests/aiBuddyFab.test.ts`.
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
- ★**새 문구는 세 곳을 함께 고쳐야 화면에 나온다(2026-08-19 실측)**: `locales/<locale>/*.json` 10개만 고치면
  화면에는 여전히 `child.aiChat.voice.speaking` 같은 **원시 id** 가 보인다. 런타임이 읽는 건 커밋된 생성물
  `src/i18n/generated/catalogs/**` 이고, 빌드 파이프라인이 그걸 다시 만들어 주지 않기 때문이다. 순서는
  ①10개 locale JSON ②`locales/descriptions.json` 에 같은 키 추가(namespace·audience·qualityTier·description —
  없으면 `missing_description:<id>` 로 생성이 **실패**한다) ③`node scripts/i18n/build-catalogs.mjs` ④`npm run build`.
  ⚠️ 이 함정은 테스트로 안 잡힌다 — locale JSON 만 보는 테스트는 통과하고, 화면에서만 id 가 보인다.
  브라우저 하니스로 실제 문구를 눈으로 확인하는 게 유일한 확인 방법이다.
- ★**AI 친구는 아이를 알아 가는 친구다(2026-08-19 TK 지시)**: 대화는 관계를 쌓는 데 쓰여야 한다.
  정본은 `worker/shared/aiChildHabits.js` 하나다.
  ①**습관 기억** — 아이가 지나가듯 말한 습관("집에 오면 내일 일정 정리해")을 `extractChildHabitMemory` 가 뽑아
  기존 장기기억(`ai_long_term_memories`)에 `type:"habit"` 으로 저장한다(**스키마 무변경**).
  `createLongTermMemoryPatch` 가 민감·금지 필터를 통과시킨 **뒤에** 습관을 먼저 본다(관심·싫음보다 구체적).
  집 도착 geofence 트리거에서 `buildHabitHomeArrivalMessage` 가 "늘 하던 대로 일정 정리 같이 할까?"로 제안하고,
  습관을 모르면 기존 일반 인사로 강등한다(없는 습관을 지어내지 않는다).
  ②**활동별 챙길 물건** — `ACTIVITY_BELONGINGS`(태권도→도복·띠, 수영→수영복·수경·수건 …)로 "준비물 챙겼어?"
  대신 물건 이름으로 묻는다. 클라 표는 `src/transform/childBelongings.ts`(아무것도 import 하지 않는 아래층)이고
  성격 게이트는 위층 `eventCompanionPrompt.ts` 가 씌운다 — 두 모듈이 서로 import 하면 순환이 된다.
  ⚠️ 게이트(`BELONGINGS_EVENT_KINDS`) 없이 표만 쓰면 "학교 생일 파티"에 알림장을 묻는다. 인사말 교체는
  `BELONGINGS_GREETING_KINDS`=`lesson` 에만 한다 — **시합·발표는 물건보다 응원이 먼저다**("오늘도 파이팅!").
  ③**물건을 자주 두고 오는 아이** — 등록 장소를 **떠날 때**(cron `trigger:"place_departure"`) 한 번만 확인해 준다.
  할 말이 없으면 정책이 빈 문자열을 돌려 `no_useful_context` 로 조용히 끝나고 크레딧도 쓰지 않는다.
  프롬프트에는 `## 이 아이의 습관·오늘 챙길 것` 블록으로 실린다(시키는 말투 금지, 같이 하자는 말투).
  회귀=`tests/childRelationshipContext.test.ts`·`tests/eventCompanionPrompt.test.ts`.
- ★**아이 하루 대시보드 = 프리미엄 1회성 알림(2026-08-19 TK 지시)**: KST 20~23시 창에서 기존 `*/10` cron 이
  `worker/cron/child-daily-digest.ts` 를 돌려 프리미엄 가족 아이의 하루를 정리하고 **하루·아이당 한 번**
  부모에게 알린다. 알림을 누르면 `/child-digest?alert=&child=` 대시보드가 열린다(부모 라우트 60번째).
  · **1회성 보증** = `child_daily_digests` PK(family, child, date) + `INSERT OR IGNORE`. 행을 실제로 만든 실행만
    알림을 보내므로 여러 tick 이 겹쳐도 1건이다. 후보 조회도 이미 만든 아이를 `NOT EXISTS` 로 걸러 낸다.
  · ⚠️ **아이 대화 원문은 payload 에 넣지 않는다.** 주제 분류(`CHILD_CHAT_TOPICS`)·집계·부모 공개 장기기억
    (`parent_visible=1`)·안전 신호 **개수**만 담는다. 아이가 감시당한다고 느끼면 AI 친구에게 마음을 열지 않는다.
    화면도 "대화 원문은 보여드리지 않고 주제만 정리해요"라고 분명히 쓴다.
  · 기록이 하나도 없는 날은 아예 만들지 않는다(`shouldSendChildDailyDigest`) — 빈 알림은 소음이다.
  · 엔타이틀먼트 조회 실패는 프리미엄으로 **추정하지 않는다**(fail-closed). 화면도 미확정을 Free 로 단정하지 않는다.
  · Cloudflare Free 플랜 cron trigger 5개 한도라 **새 표현식을 만들지 않고** `*/10` 에 얹었다. 창 밖이면 즉시 반환한다.
  · 운영 순서 = `worker/db/child-daily-digest.sql` 적용 → Worker 배포 → Pages/Android.
  회귀=`worker/tests/childDailyDigest.test.mjs`.
- ★**AI 실패 안내는 하나로·정직하게(2026-08-17 TK 제보 실사고)**: 아이가 채팅을 보내면 말풍선에
  "잠깐 연결이 안됐어"가 뜨고 **동시에** 하단에 "방금 한 일이 저장되지 않았어" 토스트가 겹쳤다.
  ①**중복 원인** — `QueryProvider` MutationCache 폴백은 `mutation.options.onError` 만 본다.
  콜사이트 `mutate(vars, { onError })` 는 **폴백을 막지 못한다**. 화면이 자기 문구를 책임지는 mutation 은
  훅 정의에 `meta: { silentError: true }` 를 달아야 한다(`useSendChildChat`). 말풍선은 토스트가 아니라
  `markToastShown()` 도 안 찍히므로 450ms 양보 규칙으로도 안 막힌다.
  ②**정직성 원인** — 진짜 원인은 OpenAI **크레딧 소진**(429 `credit_balance_exhausted`)인데 "연결" 탓으로
  안내했다. 429 는 `ai_provider_busy`(503)로 분리해 내려보내고 아이에게는 "지금은 내가 대답을 못 해"로 말한다.
  ⚠️ 진단 교훈: `writeOpenAiLog` 에 `providerErrorCode`(짧은 enum 만, 48자·`[a-z0-9_.-]` 검증)를 남기기 전에는
  429 가 분당 한도인지 잔액인지 알 수 없어 엉뚱한 곳(토큰 예산)을 먼저 되돌렸다. 상태 코드만으로 단정하지 말 것.
  ⚠️ 아이 대화 `reasoningEffort:"low"`·예산 900 은 이 사고 조사 중 되돌렸다(429 원인 아님). 다시 올리려면
  실제 TPM·잔액을 먼저 확인한다. 회귀=`tests/aiChatFailureUx.test.ts`.
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
- ★원격 제어 수신·네이티브 가로 화면(2026-08-02 TK 실기기 제보): Android `NotificationTargetPolicy`는 모든 FCM에
  `familyId`·`targetUserId`를 필수로 검사하고 `targetRole`이 있으면 역할까지 일치시킨다. 공용 fanout을 우회하는 force-ring
  시작·정지·5분 경과 직접 payload에도 세 필드를 각각 child/child/parent 대상으로 넣는다. FCM API 200/`delivered_at`은 기기
  처리 증거가 아니므로 `acknowledged_at`까지 본다. 주변소리는 `RemoteListenRequestStore.markNotificationShown`을 `notify()`보다
  먼저 commit하고 게시 실패 때 pending 예약만 되돌려 full-screen Activity와의 레이스를 막는다. 앱이 foreground면 안내 알림 뒤
  `RemoteListenActivity`를 직접 열되 마이크는 서버 승인 증표 뒤에만 켠다. targetSdk 35+에서는 full-screen `PendingIntent`
  생성자가 background Activity start 권한을 명시해야 하므로 주변소리·SOS/emergency·force-ring 전체화면 경로는
  `UrgentActivityPendingIntent`를 공용 사용한다(SDK 34/35=`ALLOWED`, SDK 36+=`ALLOW_ALWAYS`). Android 13+ 잠금 해제 background에서는
  full-screen intent가 heads-up으로 강등될 수 있으므로 무조건 자동 실행으로 단정하지 않는다. SOS 3초 홀드는 pointer capture로
  미세 이동과 눌림 scale의 `pointerleave` 취소를 막고, 부모 긴급 알림은 같은 `requestHash`를 `event_id`로 보내 각 8초 상한·
  최대 2회로 일시적 네트워크/408/425/429/5xx만 재시도한다. Capacitor는 `<html data-hy-native>`를 표시하고 native에서 `.hy-app`·고정 오버레이의
  448px 제한과 바깥 배경/radius/shadow를 해제해 가로 전폭을 쓴다. 회귀=Worker `tests/forceRingTargetPayload.test.mjs` + 앱
  `tests/remoteListenConsentSafety.test.mjs`·`tests/childSosCopy.test.mjs`·`tests/mobileViewportCss.test.mjs` + Android
  `UrgentActivityPendingIntentTest`. 로컬 앱 전체 1231개, production build/PWA 검증, Android unit+assemble+lint, Worker 대상 payload
  3개+typecheck는 통과했다. Worker/Pages 배포·A17/razr E2E는 두 기기 미연결로 미완료다.
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
  **문제 진단 확장(2026-07-31)**: 부모·아이·선생님 설정과 렌더 크래시 화면에서 `/feedback`으로 바로 진입한다.
  문제 신고·사용 문의·기능 제안과 선택 카테고리, 한 개 설명만 요구하며 평점 입력은 접수를 막지 않는다. 사용자가
  `진단 정보 함께 보내기`를 끌 수 있고, 포함 시 앱 버전·실행 환경·현재 화면과 최근 24시간의 정규화된 오류를 최대
  12건만 `device_info/error_logs/current_screen`에 저장한다. 대화·좌표·사진·비밀번호·로그인/구매 토큰과 원문 오류는
  진단에 넣지 않는다. Worker는 허용 필드를 재검증하고 requestId만 포함한 구조화 운영 로그를 남긴다.
  운영 조회·대응 절차 정본=`docs/feedback-operations.md`, 회귀=`tests/feedbackDiagnostics.test.ts`.
- **선생님 모드 출시 차단(2026-07-14, v1.3.0 유지)**: v1.3.0 프로덕션은 `TEACHER_MODE_ENABLED=import.meta.env.DEV`로만 열림을
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
- **부모의 직접 자녀 프로필 생성(2026-08-24 TK 승인)**: `POST /api/family/member/child`는 활성 대표 보호자만 자기 가족에
  로그인 계정 없는 자녀 행을 만든다. 이름을 `아이`로 보정하지 않고 정규화된 실제 이름과 과거의 유효한
  `YYYY-MM-DD` 생년월일을 필수로 받는다. Free 1명·Premium 2명 상한, 활성 대표 보호자 membership, 계정 삭제 scope 부재는
  조건부 `INSERT ... SELECT` 한 문장에서 재검사해 마지막 슬롯 동시 요청도 한 건만 성공시킨다. 회귀=Worker
  `tests/familyAddChild.test.mjs`·`tests/activeMembershipRouteAudit.test.mjs`.
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
- ★**사용 정보 접근은 아이 기기가 스스로 받는다(2026-08-18 TK 지시)**: 부모는 아이 폰을 만질 수 없는데
  "오늘 많이 쓴 앱"이 `아이 기기 설정 > 사용정보 접근 허용을 켜면 표시돼요`라는 **부모가 할 수 없는 안내**로 끝났다.
  이제 아이 위치 권한 마법사에 `usageAccess` 단계를 붙여 백그라운드 위치를 받은 직후 이어서 받고
  (`NativeNotification.openUsageAccessSettings` → 돌아오면 `getDeliveryHealth().usageAccessGranted` 재확인 — 말만
  듣고 닫지 않는다), 이미 켜져 있거나 확인 불가면 단계를 건너뛴다. 그 뒤에도 꺼져 있으면 **아이 홈이 7일에 한 번**
  같은 단계를 다시 연다(`transform/usageAccessPrompt`, 저장 키는 가족+아이). 온보딩·아이 홈이 같은 키를 쓰므로
  물어본 직후 다른 화면이 또 묻지 않는다. 부모 문구는 `아이 기기에서 사용 정보 접근을 켜면 보여요` 한 줄로 줄였다
  (설정 경로를 부모에게 시키지 않는다). ⚠️ 이 권한은 런타임 다이얼로그가 없는 **특별 접근**이라 코드로 켤 수 없다.
  회귀=`tests/usageAccessPrompt.test.ts`·`tests/onboardingDialogFocus.test.mjs`(단계 4개).
- **권한·위치 캐시 fail-closed(2026-07-14)**: 배경 위치는 아이에게 기능 설명 후 foreground 권한을 먼저 받고,
  별도 설명·사용자 버튼에서 background 권한을 요청한다. 서비스가 권한 창을 자동 호출하지 않는다. 위치 엔타이틀먼트가
  미확정·오류이면 캐시된 현재 위치·경로·리포트를 숨기고 명시적 확인/오류 상태로 닫는다. 방문 확인도 같은 gate가 열리기
  전에는 캐시된 위치 이력으로 `다녀옴`을 만들지 않는다.
  ★**"다녀옴"은 위치로 확인됐을 때만(2026-08-18 TK 제보)**: 장소를 지정하지 않은 일정까지 시간이 지났다는 이유로
  `다녀옴`을 붙이고 있었다. `scheduleView.computeTag` 의 `donePast()` 는 **visitMap 을 받은 화면**(부모 캘린더·홈)에서
  `visited` 판정이 있을 때만 `다녀옴`이고, 판정이 없거나(=좌표 없는 일정) `unverified` 면 `확인 필요`다.
  visitMap 을 주지 않는 화면(아이 홈·AI 친구·안심리포트)은 검증 자체를 하지 않으므로 기존 시간 기반 표시를 유지한다.
  회귀=`tests/visitVerifyTag.test.ts`.
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
  머문 곳 상세를 되돌리지 않는다. 신선도는 `useLocationHistory(..., 60_000)` 배경 폴링으로만 유지한다. 명시적 과거
  시각은 현재 위치로 대체하지 않고 실제 이력점만 마커로 표시한다.
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
- ★**부모 프로필 사진(2026-08-17 TK 요청 "부모도 프로필 사진을 등록할 수 있게")**: 진입점은 부모 설정 →
  계정(`/account`) 상단 프로필 카드의 사진 버튼이고, 고른 즉시 업로드한다. 업로드 purpose 는 `parent_profile`,
  대상은 **항상 caller 본인 멤버 행**이라 주 보호자도 다른 보호자 사진을 대신 바꾸지 못한다. 서버는 같은 소유권을
  세 곳에서 확인한다 — `worker/routes/storage.ts authorizeChildPhotoUpload`, `worker/lib/storageInvalidUploadCleanup.ts`
  journal INSERT 의 **kind 별 SQL 분기**, `/api/family/member/photo`(주 보호자가 아니면 본인 멤버 + 서버 발급
  `{familyId}/uploads/{본인}/{uuid}.{ext}` 키만 허용). ⚠️ journal 분기를 빼먹으면 인증·quota 를 다 통과한 업로드가
  `storage_journal_unavailable` 503 으로 조용히 막힌다(실제로 이 실수를 했다). 조회 판정은 `profile` 과 같아
  같은 가족 아이·공동 보호자가 아바타를 볼 수 있다. 표시는 `src/queries/memberPhotos.ts` 의
  `useResolvedMemberPhotoUrls` 한 곳에서 R2 객체 키 → 표시용 blob URL로 바꾸며 `useMyFamily`·`useAccount` 가
  이 해석기를 공유한다(키를 그대로 `<img src>` 에 넣으면 사진이 안 나온다). 성별 기본 캐릭터 폴백은
  `lib/avatar.ts parentAvatarPath` 단일 출처이고 familyView·MemoChat·FamilyConnection·ParentSettings 가 함께 쓴다
  (예전 MemoChat 은 아빠 계정에도 mom.webp 를 썼다). 사진은 프레임을 채우고(`data-photo="true"` → cover) 기본
  캐릭터는 `contain` 을 유지한다. 회귀=`tests/parentProfilePhoto.test.mjs`·
  `worker/tests/storageObjectAuthorization.test.mjs`.
- ★**라우트가 싣지 않는 namespace 문구 = 화면에 원시 id 노출(2026-08-17 실기기 확인)**: `routeElement(<X/>, GROUP)`
  의 GROUP 이 화면이 쓰는 모든 message namespace를 포함해야 한다. namespace 는 화면을 지나며 **누적**되므로
  다른 화면을 먼저 들른 세션에서는 정상처럼 보이고, 콜드 스타트로 그 화면에 바로 들어가면 문구가 id 로 보인다.
  실제로 `/subscription` 은 플랜 비교 열 제목이 `parent.tier.free`(tierPolicy 가 parent.* 사용),
  `/place-manager`·`/place-form`·`/location-status`·`/location-settings` 는 화면 전체가
  `notifications.placeManager.title` 처럼 보였고, 부모 위치 상세 카드 상태 칩은 `child.state.checking` 이었다.
  수정: BILLING 에 `parent` 추가, 위 네 화면은 `PARENT_NOTIFICATION_NAMESPACES`, 위치 탭은
  `PARENT_LOCATION_NAMESPACES`(core·parent·notifications·billing·shared), 부모 화면의 `child.*` 2건은
  `parent.location.state.*` 로 옮겼다. **부모 라우트에서 child namespace 문구를 쓰지 말 것.**
  가드=`tests/i18nUiWiring.test.mjs`("화면이 쓰는 모든 message namespace를 그 라우트가 싣는다" — 공용
  transform(`tierPolicy`·`premiumUpsell`·`PremiumUpsell`) import 도 parent 문구로 계산한다).
- ★**친구 초대 보상 정본(2026-08-17 TK 지시)**: 보상은 **양쪽 가족 각각 AI 대화 50회**(유료 팩 30/80/200 사이),
  **초대 가족 수 상한 없음**이다. 서버 정본은 `worker/lib/referralRewardsV2.ts` 의 `REFERRAL_REWARD_CREDITS` 하나이고
  `REFERRAL_SUCCESS_CAP` 은 삭제했다. 클라이언트는 숫자를 하드코딩하지 않는다 — 상태를 받은 화면은
  `status.rewardCredits`, 상태가 없는 진입점(홈 카드·설정 행)은 `src/transform/referralReward.ts` 의
  `REFERRAL_REWARD_CREDITS_DISPLAY` 를 쓰고 두 값의 일치는 `tests/referralRewardWiring.test.mjs` 가 강제한다.
  ⚠️ **정책 숫자는 DB CHECK 제약에도 박혀 있었다** — `referral_completions_v2.reward_credits = 10`,
  `referral_codes_v2.successful_referrals BETWEEN 0 AND 3`. D1 은 CHECK 를 ALTER 로 못 바꿔
  `worker/db/referral-rewards-v2-unlimited.sql` 로 테이블을 재작성했다(행 보존). 이때 트리거
  `trg_referral_location_evidence_snapshot` 이 본문에서 `referral_completions_v2` 를 참조하므로 **같은 파일에서
  먼저 DROP 하고 마지막에 다시 CREATE** 해야 한다(안 그러면 `error in trigger ...: no such table` 로 전체 롤백된다).
  지급액은 상수가 아니라 **완료 행에 기록된 `reward_credits`** 를 쓴다 — 정책이 바뀌어도 귀속 시점에 약속한 금액을
  지킨다. 진입점은 부모 홈 구독 카드 아래 한 줄 카드(주 보호자만)와 설정 행 두 곳이고, 문구는 보상 한 줄 + 조건
  한 줄만 남겼다(단계 설명·법률 문단·상한 안내는 재도입 금지).
  ★**코드는 계정이 아니라 가족의 것이다(2026-08-18)**: `readReferralStatus`·`upsertReferralCode` 를
  `owner_parent_id` 로 좁히면 주 보호자가 바뀐 가족에서 **이미 있는 코드가 안 보이고**, 발급을 눌러도
  UPDATE 가 0행이라 **조용히 아무 일도 일어나지 않는다**. 이제 둘 다 `family_id` 로 잠그고 변경 시
  `owner_parent_id` 를 현재 주 보호자로 맞추며, 0행이면 `referral_code_update_unavailable`(503)로 실패를 드러낸다.
  조회(`GET /me`)는 **활성 보호자 전원**에게 열고 응답의 `canManage`(주 보호자만 true)로 만들기·아이 변경만 막는다 —
  공동 보호자도 코드를 보고 공유할 수 있어야 한다. 홈·설정 진입점도 `myRole === "parent"` 기준이다.
  회귀=`worker/tests/referralRewardsV2.test.mjs`(가족 스코프·공동 보호자 읽기)·`tests/referralRewardWiring.test.mjs`.
  ★공유 링크는 `https://hyeni-calendar.pages.dev/?ref=HYENI-…` 다. `#/onboarding?ref=` 해시는
  카카오톡·라인에서 잘리므로 쓰지 않는다. `/invite?ref=` 도 읽지만, Pages rewrite 전에는
  루트 쿼리를 공유한다. 「친구에게 공유」는 시스템 공유 시트(`sharePlainContent` +
  Android `ShareSheet`)로 카카오톡·라인·Gmail을 고른다. 가입·가족 연결 화면에 초대 링크/코드를 붙여 넣는
  칸이 있고, 새 가족을 만들 때만 `setupFamily.referralCode` 로 귀속한다(기존 가족 합류·아이 페어링은 대상 아님).
  네이티브는 App Link `/invite` 와 Play 설치 추천을 `initReferralDeepLink` 가 localStorage에 영속한다.
  회귀=`worker/tests/referralRewardsV2.test.mjs`·`tests/referralRewardWiring.test.mjs`·`tests/referralReward.test.ts`.
- ★**언어 선택 위치(2026-08-17 TK 지시)**: 부모 설정에서 언어는 **계정 프로필 카드 바로 아래 한 줄**(`ps-language`)이고
  현재 언어를 값으로 보여 주며 그 줄을 눌러 펼쳐서 고른다(`aria-expanded`, 모달 아님). 펼침 안에서는
  `<LanguageSelector tone="formal" compact />` 가 제목·설명을 화면에서 감춰(`hy-language__text--quiet`) 같은 말을
  두 번 보여주지 않는다. 행 라벨은 `core.language.rowLabel`("언어 선택 (Language)")로 낯선 언어에서도 찾을 수 있게
  영어를 병기한다. 온보딩은 그대로 카드형 선택기를 쓴다. 회귀=`tests/languageSelector.test.mjs`.
- ★**문구는 짧게(2026-08-17 TK 지시)**: 렌더 기준 60자를 넘는 사용 문구는 남기지 않는다(측정은 ICU 분기별 최대
  렌더 길이로 한다 — 원문 길이는 select 분기 때문에 과대 계상된다). 2026-08-17에 결제 범위·권한·업셀·리포트·
  준비물 한도·추천 안내 14건을 10개 locale 모두 축약했고, 남긴 것은 **삭제 경고**(`parent.childDetail.copy022`),
  **Play 정책 고지**, **숨은 운영자 화면**뿐이다. 중복 제거가 우선이다 — 예: 웹 결제 안내는 카드 발급국 제한을
  바로 아래 `domesticCardOnly` 가 이미 말하므로 그 문장을 뺐다.
- ★**플랜 비교표 줄바꿈(2026-08-17 TK 제보)**: 항목 이름 `white-space: nowrap` 때문에 표가 화면보다 넓어지고
  값 칸이 글자 중간에서 끊겼다. `table-layout: fixed` + 44%/28%/28% 열 폭 + `word-break: keep-all` ·
  `overflow-wrap: anywhere` · `text-wrap: pretty` 로 어절 단위로만 접는다(`.sub-compare__scroll` 의 가로 스크롤은
  안전망으로 유지). 문구는 그대로 두고 레이아웃만 고쳤다. 회귀=`tests/responsiveTextWrapContract.test.mjs`.
- ★**어른 화면 강조색 = lavender(2026-08-19 TK "더 모던·심플에 가까운 색으로 해도 됨")**:
  새 색을 만들지 않고 이미 대비가 검증된 accent 6종 중 lavender 를 어른 기본값으로 지정했다
  (`transform/childAccent.ts` 의 `ADULT_ACCENT`). 히어로·배지·활성 탭·링크·CTA 가 토큰으로 함께 따라온다.
  ⚠️ **`ADULT_ACCENT` 는 `DEFAULT_ACCENT` 와 분리한다** — 아이가 색을 고르기 전 기본은 그대로 rose 다.
  ⚠️ **커스텀 속성의 `var()` 는 "선언된 요소"에서 치환된다.** `--cta-grad-accent`·`--hy-accent-on-ground` 를
    `:root` 에만 두면 rose 값으로 굳은 채 상속되고, `.hy-app` 의 `[data-accent]` override 는 이미 늦다.
    실제로 accent 를 바꿨는데 **히어로만 로즈로 남았다.** accent 파생 합성값은 `[data-accent]` 블록에서
    **다시 선언**해야 한다(tokens.css 끝의 `[data-accent] { … }`).
  ⚠️ 가드(`childRedesignWiring`)의 "부모는 아이 색을 안 읽는다" 검사를 정규식 거리로 쓰면 아래 child 분기의
    `readChildAccent` 를 잡아 오탐이 난다 — **어른 분기가 `return` 하는지**로 검사한다.
- ★★**어른 모드 디자인 언어 정본(2026-08-21 TK 확정 — 이 항목이 아래 시각 사양들을 대체한다)**:
  정본은 **`src/styles/glass.css` 한 파일**이고, AppShell 이 붙이는 **`.hy-adult`** 아래에서만 적용된다
  (부모·선생님 셸은 항상, PushShell 은 세션 role 이 child 가 아닐 때만 — 아이의 SOS·AI 친구 화면을 덮지 않기 위해서다).
  화면별 파일은 `*.redesign.css` 로 **그 화면에만 있는 요소만** 다루고 팔레트·바닥·상단바·탭바를 다시 정의하지 않는다.
  · **① 유리는 뒤에 색이 있어야 유리다** — 단색 바닥 위 반투명 판은 그냥 흰 카드다.
    `.hy-adult .hy-screen::before` 가 **뷰포트 고정 오로라**(색 오브 6 + 흰 베일)를 깔고 판이 그 위를 지나간다.
    ⚠️ **이 앱의 "일관성 없음"의 실체는 카드가 아니라 바닥이었다** — 화면 71곳이 각자 분홍·민트·보라·금색
    그라데이션을 자기 루트에 칠하고 있었다(실측). glass.css 가 그 루트 37개를 `background: transparent` 로
    돌려 오로라 하나로 통일한다. **예외는 `.sr-root`(SOS 수신) 하나** — 붉은 바닥이 "지금 긴급"이라는 신호라서 남긴다.
  · **② 한 섹션은 한 장이다** — 판 안에 판을 넣지 않고 목록은 1px 헤어라인(`--ph-hairline`)으로만 나눈다.
    이전의 shell + inner-surface + neu row 3중 겹침이 여백을 먹고 재질을 흐렸다(TK 제보 "섹션이 너무 떨어져 있다").
  · **③ 물체만 솟는다** — 버튼·아이콘 타일·체크박스만 `--ph-object-raise` 로 볼록하고 `:active` 에서 실제로 눌린다.
    목록 행·상태 표시는 판 위에 인쇄된 것이라 납작하다.
  · **④ 상태는 조용하고 동작은 색이다** — 상태(현재 위치·헤니 · 양호·예정·다녀옴)는 **점 + 회색 글자**,
    동작(전체보기·편집·지금 갱신)은 **강조색 글자**. **둘 다 박스 없음.** 채워진 알약은 화면당 한두 개만.
    ⚠️ 상태 태그에 `--ph-link` 를 쓰지 말 것 — '전체보기'와 같은 층으로 읽힌다.
  · **⑤ 조용함이 흐림이 되면 안 된다(2026-08-21 TK 제보 "너무 톤다운돼 잘 안 보인다")** —
    톤을 낮추는 건 **크기·굵기·박스**이지 **대비**가 아니다. 본문 8:1↑, 보조 5.5:1↑, 최소 글자 12px.
    유리 채움 `--ph-glass-fill` 0.62 는 "오로라가 비치면서 12px 글자도 AA"인 실측 균형점이다 —
    0.5 아래로 내리면 유리는 예뻐지지만 보조 글자가 먼저 죽는다.
  · **적용 결과**: 부모 홈 콘텐츠 높이 약 4,700px → 약 2,650px. 위치 실시간 하단 카드와 이동기록
    「다녀온 곳」은 같은 판·같은 44px 행으로 통일했고, 이동기록 좌우 화살표를 없애고 날짜 자체를 버튼으로 만들었다
    (30일 전으로 가려면 29번 눌러야 했다). 길게 눌러 옮길 때의 드래그 복제본도 섹션 유리와 같은 재질이다.
  · ⚠️ **함정(전부 실측으로 걸렸다)**: `backdrop-filter` 는 요소 상자에서 잘려 아래에 딱딱한 경계선을 남긴다
    → 상단바는 `mask-image` 로 블러까지 페이드시킨다. `.hy-press{min-height:44px}` 가 `height:24px` 를 이기므로
    작은 체크박스는 44px 투명 히트영역 + `::before` 사각형으로 만든다. 대비 검증에서 **최빈 픽셀을 배경으로 쓰면**
    굵은 제목이 1.00:1 허위 실패를 낸다(상위 버킷 중 가장 밝은 값을 쓰되 요소 자신의 불투명 배경이 있으면 그것을 우선).
    진입 CSS 예산은 minify 후 크기라 **주석은 무료**이고 바이트는 선택자에서 나온다
    (`.hy-app:not([data-role="child"])` → `.hy-adult` 로 약 1KB 절약). 진입 CSS 예산은 40,000 → **44,000** 으로 올렸다.
  · 회귀=`tests/designSystemUsage.test.mjs`(4px 리듬·surface manifest)·`tests/adultGlassDesignLanguage.test.mjs`.

  · **실기기 검증 기록(2026-08-21, S25 `R5CY521CFNZ`/SM-S937N)**:
    `adb install -r` 로 데이터 보존 설치(`firstInstallTime` 2026-08-19 08:30:39 유지)했고
    role=`parent`·family `f9a75cb4` 세션과 refresh 체인을 건드리지 않았다. 활성 진입 자산이
    APK 자산과 일치하고 `serviceWorker.getRegistrations().length === 0`(네이티브 SW 미등록 계약),
    crash·ANR 0건이다. 부모 홈·위치 실시간·이동 기록을 프레임버퍼 캡처로 확인했다
    (`artifacts/s25-parent-home-glass-2026-08-21.png` 외 2장).
    ⚠️ **커밋 `242cca0` 의 메시지 본문에는 "실시간/이동기록 전환 색상은 설치하지 못했다"고
    적혀 있으나 이는 푸시 시점 기준이고 사실과 다르다** — 푸시 직후 기기가 재연결되어
    같은 빌드를 설치하고 전환 배경이 테마 강조색 `rgb(74, 50, 172)` 로 렌더되는 것까지 확인했다.
    이미 푸시된 커밋이라 force push 대신 이 줄을 정본 기록으로 남긴다.
    A17·razr 는 미연결이라 미검증이고 Worker/Pages 는 배포하지 않았다.
  · **화면 헤더도 바닥과 같은 문제였다(2026-08-21 TK 제보 "바로가기 → 알림 상단바 깨짐")**:
    화면 33곳이 자기 sticky 헤더에 옛 크림색(`rgba(251,247,244,.94)`)을 칠하고 있어,
    오로라 바닥 위에서 딱딱한 사각 밴드로 남았다. glass.css 의 헤더 목록 하나로 모았다.
    새 화면이 자기 헤더에 배경을 칠하면 같은 증상이 재발하므로 목록에 등록하거나 칠하지 않는다.
    ⚠️ 마스크가 헤더 아래를 지우므로 공용 규칙이 `padding-bottom: 28px` 을 함께 준다 —
    헤더 안에 둘째 줄(칩·탭)을 넣으면 그 줄이 페이드에 먹힌다(형제로 빼야 한다).
    예외는 `.sr-header`(SOS 수신) 하나다.
    ⚠️ **스크림·마스크 정지점은 퍼센트가 아니라 padding-bottom 과 같은 px 로 잡는다** —
    헤더 높이가 화면마다 달라 퍼센트로 잡으면 페이드 띠가 여백을 넘어 아래 카드가
    반쯤 비친다(실측: 알림 화면에서 목록 카드가 필터 칩 옆으로 계속 비쳤다).
    정본은 `calc(100% - 28px)` 두 곳(배경 그라데이션·mask)이다.
    ⚠️ **화면 CSS 에서 `.hy-topbar` 재질을 다시 선언하지 말 것** — 같은 특이도(0,2,0)에
    화면 파일이 뒤에 로드돼 공용 규칙을 이긴다. 실제로 `.ph-page > .hy-topbar` 가 옛
    스크림으로 되돌려 놓아 부모 홈에서만 내용이 브랜드 줄 뒤로 비쳤다. 지금은 그 규칙과
    `.ph-page > *` 레이어 규칙을 함께 삭제했다(`.ph-page::before` 를 끈 뒤로 쓸모가 없다).
  · **스크롤 위치 기억(2026-08-21 TK 지시)**: 처음 들어가는 화면은 **최상단부터**,
    다시 찾은 화면은 **보던 자리로** 돌아간다. 정본은 `src/app/useScrolledShell.ts` 하나이고
    셸 3개가 같은 훅을 쓴다. 화면 구분은 history key 가 아니라 **경로(+쿼리)** 다 —
    탭으로 다시 들어가도 보던 자리를 찾아야 하기 때문이다(캐시된 데이터와 짝이 맞는다).
    ⚠️ **ParentShell→PushShell→ParentShell 복귀 때 홈 위치가 0으로 사라진 실사고(2026-08-21 TK 제보)**:
    두 셸은 서로 다른 `.hy-screen` DOM을 쓰므로 돌아온 홈의 ref가 새 노드에 연결된다. 과거 구현은
    그 연결 순간 `sync()`가 새 노드의 초기 `scrollTop=0`을 `/parent/home` 값으로 저장해, 복원할 위치를
    읽기 전에 스스로 덮어썼다. 이제 ref 연결은 `syncScrolledState()`로 헤더 상태만 맞추고 위치를 저장하지
    않는다. 위치 저장은 실제 `scroll` 이벤트와 셸 DOM 해제 시점에만 `rememberAndSync()`/`rememberPosition()`으로
    수행한다. 복원은 `useLayoutEffect`에서 첫 페인트 전에 시작한다. 이 분리를 다시 합치지 않는다.
    S25(`R5CY521CFNZ`, 부모 세션) 실측은 수정 전 `1200px→알림→뒤로가기→0px`, 수정 APK
    (`index-lmPuG48f.js`) 설치 후 같은 동선 `1200px→알림→뒤로가기→1200px`이다. `adb install -r` 뒤
    최초 설치 시각·부모 role·가족 연결이 유지됐고, 앱 전체 1,822/1,822·타입 검사·production build/PWA 검증·
    Android `assembleDebug`가 통과했다. APK SHA-256=`2b47a0f2525a4abf57759afe9f1f8e5aeb131b10c6c954b0a6c5e0ad352306ae`.
    ⚠️ **한 번에 되돌아가지지 않는다** — route 청크와 쿼리가 늦게 도착해 복원 시점엔 아직
    문서가 짧다. `requestAnimationFrame` 으로 최대 600ms 동안 다시 시도하되
    사용자가 손대면(pointerdown·wheel) 즉시 그만둔다. 복원이 조작을 이기면 안 된다.
    기억은 최근 30개까지만 들고 오래된 것부터 버린다.
  · ⚠️ **`padding` 은 `position: absolute; inset: 0` 루트에 통하지 않는다(2026-08-21 실사고)**:
    절대 배치는 containing block 의 **padding box** 를 기준으로 잡혀 패딩 안쪽까지 그대로 채운다.
    그래서 스크롤 영역에 하단 메뉴 여백을 줘도 `.rr-root`·`.ra-root`·`.sr-root`(기기 찾기·
    주변 소리·SOS 수신)는 바닥이 그대로여서 [지금 울리기] 버튼이 탭바에 가려졌다.
    그 세 화면은 `bottom: var(--hy-nav-inset)` 으로 바닥을 직접 끌어올린다.
    ⚠️ 이런 루트를 찾을 때 정규식에 `m` 플래그를 빠뜨리면 파일 첫 규칙을 놓친다 —
    실제로 그렇게 `.rr-root` 를 '없음'으로 오판했다.
  · **하단 메뉴는 어떤 화면에서도 보인다(2026-08-21 TK 지시)**: 바로가기 목적지는 전부
    `PushShell` 아래인데 그 셸에만 탭바가 없었다. 이제 세션 role 에 맞는 탭바를 함께 렌더한다.
    ⚠️ **아이 세션은 제외한다** — 아이 상세 화면은 SOS 3초 홀드처럼 화면을 통째로 쓰거나
    AI 친구 대화처럼 하단에 자기 입력줄을 두고 있어 독을 겹치면 그 화면이 무너진다.
    아이의 이동 수단은 플로팅 AI 친구와 화면 헤더의 뒤로가기다.
    ⚠️ 예외 경로는 `NAVLESS_PUSH_PATHS`(온보딩·강제 업데이트·권한 거부·crash-test) —
    누르면 갈 곳이 없거나 일부러 가둬 둔 게이트다. 특히 온보딩은 가족 미연결 상태다.
    ⚠️ 이 화면들은 탭바가 없던 시절 기준이라 아래 여백을 잡아 두지 않았다. 스크롤 영역에
    `data-nav="push"` 를 붙여 `padding-bottom` 으로 자리를 마련하고, 이미 여백을 잡은
    `.hy-content` 는 그 안에서 줄여 두 겹이 되지 않게 한다(실측 91px).
    실기기 확인: 바로가기 8개 화면 전부 탭바 표시·탭 이동 동작, `/place-form`·`/event-form`
    저장 버튼과 `/pairing-wizard` 하단 CTA 가 가려지지 않음.
    ⚠️ `tests/aiBuddyFab.test.ts` 의 PushShell 400자 창 검사는 본문 범위 검사로 바꿨다 —
    본문이 길어질 때마다 깨지는 대략적인 장치였다.
  · **서리 스크림은 "가릴 것이 생겼을 때만" 켠다(2026-08-21 TK 제보 최종)**:
    맨 위에서는 헤더 뒤에 아무것도 없으므로 스크림이 오로라 위에 **납작한 사각형**으로 읽힌다 —
    그게 "전체·안전·위치 버튼과 오늘 섹션 사이 경계"의 실체였다(실측: 그 구간에서만 명도가 16단계 튀었다).
    `src/app/useScrolledShell.ts` 가 `.hy-screen` 에 `data-scrolled` 를 붙이고,
    glass.css 는 그 상태에서만 스크림을 칠한다. 맨 위 = `background: transparent`.
    ⚠️ 순수 CSS(`animation-timeline: scroll()`)로도 되지만 PWA Safari 가 아직 지원하지 않아
    passive 리스너 하나로 통일했다. 상태가 실제로 바뀔 때만 DOM 을 건드린다.
    ⚠️ **스크림을 옅게 만드는 것으로는 해결되지 않는다** — 옅으면 스크롤 중에 목록이 헤더 뒤로 비친다.
    두 요구(맨 위=없어야, 스크롤 중=가려야)는 상충하므로 상태로 나누는 것이 유일한 답이다.
    실측: 스크롤 중 헤더 안 명도 폭 14~15/255(약 5%), 제목 16.7:1 · 모두 읽음 6.36:1.
    ⚠️ `AppShell.tsx` 의 PushShell 본문은 `tests/aiBuddyFab.test.ts` 가 **400자 창** 안에서
    `<AiBuddyFabSlot>` 을 찾는다 — 주석을 길게 쓰면 그 창을 넘겨 테스트가 깨진다.
  · **알림 상단 유형 필터 삭제(2026-08-21 TK 최신 지시)**: 알림 화면의 전체·안전·위치 버튼
    섹션은 완전히 제거했다. 목록은 항상 전체 알림을 날짜순으로 보여주며 유형 필터를 다시 만들지 않는다.
  · **헤더 리듬·뒤로가기 통일(2026-08-21 TK 최신 지시)**: 최상단은 safe area 아래 16px,
    제목 행 아래는 28px을 확보한다. 모든 실제 뒤로가기는 `components.css`의 공용 규칙으로
    **배경·테두리·그림자 없는 44×44px 터치 영역 안의 20px `ChevronLeft`만** 쓰며 화면별 `*-back`은
    배치만 맡는다. 온보딩 어두운 화면과 아이 SOS도 표면 없이 아이콘 대비만 흰색으로 반전한다. 달력의 월 이동처럼
    뒤로가기가 아닌 화살표는 이 규칙에 포함하지 않는다.
  · **주변소리 첫 화면 CTA 보장(2026-08-21 TK 제보)**: `.ra-idle`은
    `auto minmax(0,1fr) auto` 3행이다. 뒤로가기와 하단 안전 안내·`듣기 시작`은 화면에 남고,
    세로가 짧을 때 가운데 설명만 스크롤한다. 과거 120px 바닥 padding으로 CTA가 첫 화면 밖으로
    밀리던 구조를 제거했으며 상·하단 safe area는 그대로 포함한다.
  · **안심리포트 전면 재디자인(2026-08-21 TK 지시)**: 데이터 정본·상세 건강 label/detail·
    오류별 재시도·Premium gate는 그대로 두고 부모 홈의 디자인 언어로 통일했다. 히어로는 맑은 유리 한 장,
    핵심 수치 4개는 한 장 안 2×2, 상세 섹션은 각각 유리 한 장이며 안쪽 안전 신호·일정·기기·앱·메모는
    투명 행과 hairline으로만 나눈다. 하단 3개 관련 리포트도 카드 3장이 아니라 탐색 목록 한 장이다.
    조치가 필요한 기기 건강 상태만 의미색 면을 유지한다.
    검증은 앱 전체 1,822/1,822, 최종 디자인·대비·모바일 회귀 74/74, `tsc -b --noEmit`,
    production build/PWA 중복·번들 예산, `git diff --check`가 통과했다. 브라우저·Windows UI 제어 서비스가
    모두 실행 불가해 새 화면 캡처는 미검증이며, 실기기 설치와 Pages/Worker 배포는 하지 않았다.
  · **화면 카드도 같은 유리다(2026-08-21 TK 지시)**: semantic surface manifest 의
    role="card" 중 **무채색 카드 75개**에 공용 유리 재질을 준다(glass.css 마지막 블록).
    상태색을 띤 카드(앰버 경고·민트 완료 등 47개)는 색이 곧 의미라 그대로 두고,
    유리판 위에 이미 얹힌 안쪽 면과 SOS 수신(`.sr-*`)은 제외한다.
    ⚠️ `--bg-page` 로 칠하던 카드도 포함해야 한다 — 그 토큰은 이제 오로라 바닥색이라
    두면 카드가 바닥에 묻혀 사라진다(`.ts-row` 실측).
    실기기 대비 실측: 제목 15.4:1 · 본문/메타 6.55:1.
- ★**부모 모드 시각 사양 정본(2026-08-21 TK 최종 지시)**: 부모 홈의 CSS 그라데이션은 전부 제거한다.
  · 바닥은 단색 아이스 블루, 큰 섹션은 배경과 명도 차이가 나는 단색 반투명 서리 유리로 둔다.
    색 블롭·wash·히어로 sheen·탭바 fade·카드/버튼 gradient를 만들지 않는다.
  · **뉴모피즘 면은 자기 배경과 같은 색이어야 한다** — `--neu-surface: transparent`. 흰색을 채우면
    그건 뉴모피즘이 아니라 그냥 흰 버튼이다. 투명이면 바닥 위에서도 유리 카드 위에서도 자동으로 맞는다.
  · 큰 섹션 경계는 단일 1px 밝은 선만 사용하며 이중 rim·의사요소 테두리·두꺼운 inset은 쓰지 않는다.
  · **버튼은 한 재질** — `.ph-ai__btn`·`.ph-subscription__action`·`.ph-referral__action`·`.ph-safety__refresh button`
    이 "조작 버튼 정본" 한 규칙을 공유하고 `:active` 에서 함께 눌린다. 글자색만 맥락별 토큰을 유지한다.
    ⚠️ **상태 배지는 버튼이 아니다.** 아이현황의 `보는 중`과 별도 상세 화살표는 최종 지시로 삭제했다.
  · ⚠️ CSS 일괄 치환으로 재질을 걷어낼 때 **의도하지 않은 선택자까지 지워진다** — 치환 후 어떤 규칙이
    바뀌었는지 반드시 확인할 것.
- ★**섹션은 얼음 유리, 정적인 오목은 쓰지 않는다(2026-08-19 TK 지시)**:
  · ⚠️ **"유리 질감이 안 느껴진다"의 진짜 원인은 대부분의 섹션이 애초에 유리가 아니었던 것**이다 —
    `.ph-glass` 가 AI·구독·초대 3개에만 붙어 있었고 일정·아이현황·안전지표·준비물·메모 카드는 그냥
    불투명 `.hy-card`(#FFFFFF)였다. 픽셀을 재 보고서야 알았다(카드 안 `#ffffff` vs 바닥 `#ede5f4`).
    **재질을 바꾸기 전에 그 재질이 실제로 적용돼 있는지부터 확인할 것.**
  · **얼음 = 낮은 채움 + 두꺼운 서리 + 또렷한 모서리**: `--glass-fill` 0.42, `--glass-blur` `blur(30px) saturate(190%)`,
    `--glass-rim` 은 위 2px 강한 빛 + 좌우 얇은 반사 + 아래 굴절 띠. 채움을 내릴수록 rim 이 유일한 경계다.
  · **콘텐츠가 뒤로 지나가는 면은 얼음을 쓸 수 없다** — 탭바·대화 입력 알약은 `--glass-fill-solid`(0.8).
    스크롤 콘텐츠가 비치면 라벨 대비가 AA 밑으로 떨어진다.
  · **정적인 오목(`--neu-pressed` resting)은 쓰지 않는다** — 눌린 것처럼 보여 실제 눌림 피드백과 헷갈린다.
    `--neu-pressed` 는 `:active` 에서만 쓴다(솟은 타일이 눌리는 순간). 그래서 `well` 역할은 폐기했다.
  · ⚠️ **얼음의 상한은 바닥 밝기가 정한다** — 바닥이 밝으면서 채도가 있어야 투명해질 수 있다.
    실측: 가장 어두운 바닥 `#E3D9EA` → 카드 `#EFE9F3` → `--fg-muted` **4.64:1**. 바닥을 어둡게 하거나
    `--glass-fill` 을 더 내리면 여기부터 깨진다(0.32 는 4.34:1 로 미달이었다).
  · ⚠️ **대비 측정은 픽셀 스캔으로 하지 말 것**(이 세션에서 세 번 오판했다) — 3D 아이콘 가장자리·히어로·
    카드 그림자·카드 사이 바닥이 전부 "카드 표면"으로 잡힌다. 올바른 방법은 **콘텐츠 패딩 바깥(x 4~14px)의
    순수 바닥을 샘플해 `over(white, fill, ground)` 로 카드 표면을 계산**하는 것이다.
- ★**입체감·투명도 보강과 그 대가(2026-08-19 TK 제보 "입체감 부족 · 유리 투명도 부족")**:
  · **입체감은 바닥이 아니라 그늘로 올린다** — `--neu-dark` 0.26→0.38, 오프셋·blur 확대.
    바닥을 더 어둡게 하면 바닥 위 글자 대비가 먼저 깨진다(앞 줄 규칙 그대로).
  · **투명도는 채움을 내리고 rim 을 세운다** — `--glass-fill` 0.82→0.66, `--glass-rim` 에 상·좌·우
    inset 하이라이트를 추가하고 `--glass-lift` 를 접지 그림자 + 깊은 그림자 두 겹으로 바꿨다.
    채움을 내릴수록 **rim 이 유일한 경계**라, rim 을 같이 세우지 않으면 카드가 바닥에 녹는다.
  · **반투명 유리는 뒤에 색이 있어야 비친다** — 그래서 바닥은 "어둡게"가 아니라 **"색이 많아지게"**
    만든다(rose 44%·lav 38%·mint 22%). 밝기를 유지해야 바닥 위 글자가 산다.
  · ⚠️ **바닥에 색을 깔면 `--hy-accent-text` 가 먼저 깨진다** — 이 토큰은 자기 `-soft` 채움 위 기준이라
    색이 깔린 바닥에서는 rose 3.82:1 · lavender 3.54:1 이다(실측). **radial 을 0.20 까지 낮춰도 4.32:1** 이라
    바닥 채도를 줄이는 것으로는 해결되지 않는다. 그래서 바닥 전용 `--hy-accent-on-ground`
    (`color-mix(in srgb, var(--hy-accent-text) 70%, #2A1520)`)를 만들어 부모 `.hy-section-action` 에만 쓴다 —
    6개 테마 전부 4.5:1 이상을 확인했다. 바닥 채도를 다시 올릴 때 이 조합을 재계산할 것.
  · ⚠️ **픽셀 스캔으로 대비를 판정하지 말 것** — 3D 아이콘 일러스트 색(예 `#578a76`)이 "글자"로 잡혀
    "AA 미달 30줄" 같은 허위 경보가 난다. 글자·배경 쌍을 토큰으로 계산하는 쪽이 정답이다.
- ★**뉴모피즘 + 글래스모피즘 = 역할 분담(2026-08-19 TK 지시, 레퍼런스 6장)**: 두 스타일을 섞을 때
  **바닥 요구가 정반대**라는 게 핵심이다 — 유리는 바닥에 색이 있어야 굴절이 보이고, 뉴모피즘은
  바닥이 솟은 면보다 **어두워야** 흰 하이라이트가 보인다. 바닥이 near-white 이면 흰 그림자가 사라지고
  어두운 그림자만 남아 **그냥 드롭섀도로 읽힌다**(유리 질감이 안 살던 진짜 원인이 이것이었다).
  해법은 Home Care UI 키트 방식 — **면의 역할로 재질을 나눈다**:
  · **큰 면 = 유리**(`.ph-glass` 카드·`.hy-tabbar__inner`) — 색 바닥 위에 떠서 굴절한다.
  · **작은 조작 면 = 뉴모피즘 볼록**(`--neu-raised`/`--neu-raised-soft`) — 바로가기 8칸, 지표 아이콘,
    섹션 칩, 대화 첨부·퀵버튼. 카드/바닥에서 솟은 물체로 읽힌다.
  · **값이 들어가는 면 = 눌린 우물**(`--neu-pressed`) — 대화 입력칸, 앱 사용 요약.
  · **누르면 실제로 들어간다** — `:active` 에서 raised→pressed 로 바꾼다. 뉴모피즘의 값어치는 여기 있다.
  ⚠️ **바닥 톤이 전제 조건이다**: `.ph-page` 를 `color-mix(--bg-body 74%, --bg-app)`(≈`#F2EBF0`)로 낮춰야
  입체감이 성립한다. 그런데 이 바닥에서 `--fg-muted` 대비가 **4.72:1** 로 AA(4.5) 선에 가깝다 —
  **바닥을 여기서 더 어둡게 하면 AA 가 깨진다.** 더 깊은 입체감이 필요하면 바닥이 아니라
  `--neu-dark` 를 올린다. 광원은 화면 전체에서 하나다(빛=좌상단, 그늘=우하단).
  ⚠️ 뉴모피즘은 **색 바닥 위에 직접 두지 않는다** — 흰 그림자가 죽어 때가 탄 것처럼 보인다.
  ⚠️ 값이 들어가는 면은 card 가 아니다 — `designSystemUsage` 에 `well` 역할(radius-16 + `--neu-pressed`)을
  새로 만들어 분류했다. card 의 허용 그림자를 늘려 통과시키지 말 것(계약이 흐려진다).
- ★**부모 홈 유리 보정(2026-08-19 TK 제보 "백그라운드가 과하고 촌스럽다 · 유리 질감이 안 느껴진다")**:
  구조(`.ph-page::before` 바닥 + `.ph-glass` 카드)는 그대로 두고 **값만** 보정했다.
  · **바닥은 색 두 가지·26% 이하** — rose 46%/lav 40%/mint 28%/rose 30% 4색이 촌스러움의 실체였다.
    radial 은 '빛'만 남기고 위아래 흐름은 세로 그라디언트가 만든다. ⚠️ 색 수와 채도를 올리면 바로 촌스러워진다.
  · **유리 질감은 채움이 아니라 rim 이 만든다** — 카드 채움이 `--bg-card 36%` 라 바닥에 녹아 '흐릿한 구멍'으로
    보였다. `.ph-glass` 를 탭바와 같은 `--glass-*` 정본으로 바꿔 밝은 테두리 + inset 하이라이트를 세웠다.
    ⚠️ 더 투명하게 내리면 질감이 오히려 사라지고 글자 대비도 AA 밑으로 떨어진다.
  · **바닥은 한 겹만** — 셸(`.hy-app[data-role="parent"]`)에도 깔면 `.ph-page::before` 와 두 겹이 되어
    채도가 의도보다 올라간다. 카드 유리도 셸에서 `.hy-card` 를 통째로 덮지 말고 화면이 `.ph-glass` 로 명시한다
    (semantic surface 계약과도 어긋난다).
  · **히어로**: `.ph-hero` 에 `padding-right: 128px` 로 마스코트 자리를 실제로 비운다 — 없으면 위치 문구가
    마스코트를 뚫고 카드 끝까지 나간다(실측 결함). 제목은 개수(`em`)만 `--type-display` 로 세우고 위치 줄은
    `badge` 한 마디만 쓴다(신선도·주기는 아래 아이 현황 카드가 이미 말한다).
- ★**부모 홈 실데이터 유리 불변식(2026-08-20, 레퍼런스 재검증)**:
  · 빈 상태 카드에만 `ph-glass` 가 있고 `children.map` 의 실제 아이 카드에는 빠져 있어, 실사용 화면에서만 불투명
    흰 카드가 나타났다. 부모 홈의 모든 주요 `hy-card` 는 데이터 유무와 무관하게 `ph-glass` 를 명시한다.
  · `.ph-ai`·`.ph-child--active` 처럼 자체 `box-shadow` 를 갖는 규칙은 공통 유리 그림자를 덮지 말고
    `var(--glass-rim), var(--glass-lift)` 를 먼저 합성한다. 선택 강조 그림자는 그 뒤에만 추가한다.
  · semantic surface의 일반 `card` 허용 그림자를 넓히지 않고 `glass-card` 역할을 따로 둔다. 회귀는
    `tests/parentHomeGlassMaterial.test.mjs`와 `tests/designSystemUsage.test.mjs`가 함께 막는다.
  · **색은 의미가 있을 때만** — 섹션 아이콘 칩·지표 칩 4개·바로가기 8칸의 파스텔 채움을 걷고 색은 3D 아이콘이 낸다.
- ★**2026-08-20 실사용 피드백 묶음**:
  · **부모 홈**은 설정 화면에 가까운 아이스 블루 바닥·얇은 glass rim으로 정돈하고, 상단 `혜니캘린더`와 하단 탭은
    safe-area를 포함해 고정한다. 히어로는 활성 아이의 실시간 대략 장소를 보여주며 `현재위치`·상태·편집 같은 소형
    버튼과 일정/알림장 아이콘은 3D 재질로 맞췄다. `아이와 대화하기`·구독 `관리하기`의 장식 화살표는 없다.
    홈 섹션은 `parentHomeSectionOrder` 정본으로 drag/키보드 재배치하고 가족+설치별 localStorage에 저장한다.
  · **대화**는 입력 바로 위 제목을 `자주 쓰는 문구`로 명확히 하고 기존 빠른 문구 버튼을 유지한다. 이미지·위치 glyph는
    작게 보이되 44px hit area는 유지하고, 입력 focus는 색 테두리 대신 투명 outline+중립 명도 ring을 쓴다. 하단 탭과
    keyboard 여백을 동시에 확보한다.
  · **위치 이력**은 하단 재생/스크러버/막대 카드 전체를 제거하고 지도 아래 `시간 범위 + 장소` 목록만 둔다.
    실시간 sheet의 아이 사진은 큰 `cover` crop이고, 메모·경로·주변소리·전화는 같은 3D 액션 재질이다.
  · **설정·스티커**는 설정 첫 화면의 회원탈퇴를 없애고 `/account` 안에서만 제공한다. 알림·위치 백그라운드·동기화·
    가족·친구놀이·주변소리/감사·AI 크레딧·피드백 하위 화면의 섹션 아이콘을 3D로 맞췄다. `/sticker-send`는 아이 화면과
    같은 `useReceivedStickers`+`buildStickerBook` 정본으로 받은 스티커 12칸과 수량을 부모에게도 보여준다.
  · **아이 AI 알람**은 parent-only가 아니다. `open_device_screen(alarm_create)`가 시간이 채워진 Android
    `AlarmClock.ACTION_SET_ALARM` 화면을 열고 아이가 저장을 확인한다. 끄기/삭제 요청은 알람 관리 화면을 연다. 앱이
    직접 정확 알람을 예약하거나 부모 권한을 요구하지 않는다.
  · **기기 상태**는 `NativeBootstrap`이 mount·foreground·120초마다 전체 health snapshot을 다시 보고하고, 부모 홈은
    활성 아이에게 `request_device_status`를 보낸 뒤 지연 재조회한다. Usage Access를 이미 허용했는데 예전 안내가 남는
    stale snapshot을 정상 상태로 덮는다.
  · **조기 도착 자동 보상**은 일정 시작 60분 안에 먼저 도착한 occurrence에 `automaticStickerReward`가 결정적 멱등키로
    `일찍 왔어요` 스티커를 1회 저장하고 아이 realtime 축하를 보낸다. 임의 도착 감지와 등록장소 cron이 같은 helper를 쓴다.
  · **계정 활성 설치 전환**은 `account_device_sessions`가 계정별 활성 설치 1개를 정본으로 가진다. 비밀번호·OAuth·
    페어링처럼 본인 인증을 다시 끝낸 새 로그인은 `takeOverAccountDeviceSession`이 활성 설치를 원자 교체하고 이전
    refresh 체인·FCM/Web Push endpoint를 같은 D1 batch에서 닫으며 FamilyRoom 소켓도 철회한다. 기존 기기를 잃어
    로그아웃할 수 없어도 새 기기로 들어갈 수 있지만 이전 기기는 즉시 가족 정보를 읽거나 받지 못한다. **refresh는
    인계 권한이 아니므로** 비활성 설치에서는 기존 체인을 건드리지 않고 401로 닫는다. 정상 logout은 현재 설치의
    refresh 체인과 claim을 함께 놓는다. migration=`worker/db/account-device-sessions.sql`, 회귀=
    `worker/tests/accountDeviceSession.test.mjs`.
- ★**부모 홈 정보 구획·알림 분리·로그인 자동완성(2026-08-20 TK 실사용 지시)**:
  · 오늘의 일정·AI 일정추가·아이 현황·안전지표·준비물/숙제·아이와 대화하기·바로가기는 모두
    `.ph-section-shell.ph-glass` 한 장 안에 제목과 내용을 묶는다. 내부 실데이터 면은 `.ph-inner-surface`의
    `--liquid-glass-tile`만 써서 카드 안에 카드를 겹친 느낌 없이 한 단계 낮은 얼음 면으로 구분한다.
  · **단색 유리 보정(2026-08-21, 최종 제공 이미지 레퍼런스)**: 큰 섹션만 `--liquid-glass-*` 재질로 분리하되
    `--liquid-glass-fill`은 단색 반투명 냉백색, 경계는 단일 1px, 그림자는 얕은 ambient 한 겹으로 제한한다.
    이중 rim·`::before/::after`·여러 겹 inset은 없다. 내부 실데이터 면은 단색 `--liquid-glass-tile`이며 border는 0이다.
    부모 홈 `.ph-page` 전체와 부모 하단 탭의 `background-image`를 `none`으로 고정해 전역 스타일에서 gradient가
    다시 유입되는 것도 막는다. `prefers-reduced-transparency`와 backdrop 미지원 환경은 `--bg-card`로 강등한다.
  · **실제 조작 버튼 뉴모피즘 보정(2026-08-21, `realistic-neumorphic-design-user-interface-elements/4786587.jpg`
    레퍼런스)**: 큰 정보 박스는 위 액체 유리 재질을 유지하고 실제 클릭 요소만 `.ph-neu-control`로 명시한다.
    `--neu-control-surface/raised/raised-soft/pressed`는 냉백색 면·좌상단 흰 하이라이트·우하단 청회색 그림자 한 광원을
    공유한다. 상단 스티커/알림/설정, 일정 행, AI 일정 4버튼, 아이 행, 새로고침·편집·완료 체크,
    대화 아이콘, 구독/초대 액션에 적용한다. 바로가기는 44px 아이콘·80px 셀의 얕은 등급으로 줄여 한글 라벨이
    줄바꿈되지 않게 하고, 선택된 아이·완료 체크·터치 중 버튼은 inset
    `--neu-control-pressed`로 오목해지고, 상태 칩·안전 배지·일정 태그에는 클래스를 주지 않아 조작으로 오인되지 않는다.
    부모 하단 탭은 뉴모피즘 대상에서 제외한 flat icon-only다. 한글 라벨은 시각적으로 렌더하지 않고 접근성용
    `aria-label`만 유지한다. `전체보기`의 화살표와 아이현황의 `보는 중`·화살표도 없다.
    최종 S25 실기기 캡처=`artifacts/s25-parent-home-no-gradients-top-2026-08-21.png`. 디자인/모바일 회귀 78/78,
    typecheck·production build/PWA·Android assembleDebug가 통과했다. debug APK SHA-256
    `ED2A705E2A0C895A25C1680AB623116DE82E21A2FD476724B108B59D16E323E1`를 S25에 `adb install -r`로 설치해
    기존 부모 세션·가족 데이터를 보존했고, 단색 히어로·섹션·버튼·flat 탭을 실기기에서 확인했다.
  · 제목은 `--type-title` 3종 토큰, 안전지표의 시각·핵심 수치·앱 이름·최근 실행 정보는 중요도별 semantic type
    토큰을 함께 쓴다. 실제 조작 버튼의 재질·눌림은 위 `--neu-control-*` 정본만 사용한다.
    `아이와 대화하기`의 `메모·실시간` 보조 표시는 없애고 CTA는 모든 아이에게 맞는 `메시지 보내기`로 10개 locale을
    일반화했다. 바로가기 제목 장식 아이콘도 없다.
  · 홈 순서 편집은 별도 섹션 없이 카드 길게 누르기+햅틱+떠 있는 복제본 드래그이며, 가족별 localStorage에 최초 1회
    `카드를 길게 눌러 드래그하면 순서를 바꿀 수 있어요.` 안내를 띄운다. 친구초대/QR은 `createPortal`로 앱 셸 위
    중앙 modal layer에 렌더해 홈 하단에서 잘리지 않는다.
  · Android 아이 알림은 `family_message`·`ai_friend`·`sticker`를 서로 다른 notification channel로 만들고 일정·안전·
    긴급·위치 상태도 `NotificationGroupPolicy` 그룹을 사용한다. 예전 `hyeni_child_message_v1/v2_private`의 사용자 설정은
    새 채널 생성 시 이관한 뒤 삭제해 가족 메시지가 AI/상태 알림에 묻히지 않게 한다.
  · ID 로그인은 표준 `<form autocomplete="on">`, `username`·`current-password` 이름/자동완성 토큰과 submit 동작을
    사용한다. Android WebView는 API 26+에서 `IMPORTANT_FOR_AUTOFILL_YES`로 삼성월렛·Google 비밀번호 관리자 진입을
    허용하며 가입의 `name`·`username`·`new-password`도 표준 토큰을 쓴다.
  · 검증: 앱 전체 Node 회귀, `npm run typecheck`, `npm run build`+PWA route/precache 검사, Android unit·lintDebug·
    assembleDebug 모두 통과. 최신 debug APK를 S25(`R5CY521CFNZ`, `SM-S937N`)에 `adb install -r`로 설치해 기존 앱
    데이터·계정·페어링 세션을 보존했다. Git `main`은 `527ed5b`까지 push 완료. Pages CLI 배포는 기존 Cloudflare
    OAuth가 2026-08-18에 만료되어 비대화형 refresh에 실패했고, Workers/D1 전용 `.env` 토큰은 Pages 권한이 없으므로
    사용하지 않았다. 2026-08-20 확인 시 `hyeni-calendar.pages.dev`는 이전 `index-CjC4ucSe.js`를 제공해 웹만 미배포다.
- ★**대화 전송은 낙관적이다(2026-08-19 TK 제보 "채팅 보낼 때 느림")**: 예전에는 POST 응답이 와야 말풍선이 서고
  입력칸도 그때 비워져, 느린 네트워크에서 앱이 멈춘 것처럼 보였다. **실측: 서버 2초 지연 재현에서 2,000ms → 7ms.**
  · `useSendMemo.onMutate` 가 `insertPendingMemoReply` 로 임시 행을 넣고, 화면은 `mutate` 직전에 `setDraft("")` 한다.
    실패하면 `onError` 가 임시 행을 걷고 원문을 입력칸에 돌려준다(다시 타이핑시키지 않는다).
  · ⚠️ **임시 행은 '지우고 다시 넣기'가 아니라 `reconcilePendingMemoReply` 로 제자리 교체한다.** 먼저 지우면
    응답이 배열·빈 객체·오류 본문일 때 **방금 보낸 말풍선이 화면에서 사라진다**(QA fixture 로 실제 재현했다).
    저장 행이 확실할 때만 교체하고 아니면 임시 행을 남겨 백그라운드 재조회가 정본으로 맞추게 한다.
  · 임시 행은 서버에 없으므로 읽음 처리·신고 대상에서 뺀다(`isPendingMemoReply`).
- ★**읽음 처리에 invalidateQueries 를 걸지 않는다(2026-08-19)**: `useMarkRead` 가 성공마다 스레드 전체를 무효화해,
  안 읽은 메시지 N개가 있는 대화를 열면 **7일치 스레드를 N번 다시 받았다**(탭바 미읽음 점도 같은 키라 함께 재조회).
  이제 `markMemoReplyRead` 가 캐시의 `read_by` 만 직접 갱신한다. 상대 기기의 "읽음" 표시는 WS 브릿지가
  따로 무효화하므로 손해가 없다. 회귀=`tests/memoSendCache.test.ts`.
- ★**대화 입력 알약 여백(2026-08-19 TK 제보)**: `.mc-inputbar` 가 `padding: 4px`·`gap: 4px` 이라 첨부·전송 버튼이
  테두리에 붙어 눌려 보였다. `padding: 4px 8px`·`gap: 8px` + `.mc-input` 자체 `padding-inline: 4px` 로 풀고,
  컴포저 좌우도 본문(`.hy-content` 20px)과 같은 선에 맞춘다(16px 이면 입력줄만 넓어 어긋나 보인다).
  입력 알약·퀵버튼도 같은 `--glass-*` 재질을 쓴다.
- ★**대화 사진·위치 도구 평면화(2026-08-21 TK 제보)**: 입력 알약 왼쪽의 사진 첨부·위치 공유는 기능과
  접근성 이름을 유지하되, `.mc-attach`의 배경·테두리·원형 radius·그림자·backdrop-filter를 모두 없애
  **투명한 44px 터치 영역 안에 20px Lucide 아이콘만** 보인다. 눌림 피드백은 공용 `hy-press`의 작은 scale만
  남기고 active 그림자도 만들지 않는다. `.mc-composer`의 `bottom: var(--mc-tabbar-clearance)`와 본문 정렬은
  건드리지 않아 채팅 전체가 계속 하단 메뉴 위에 놓인다. 회귀=`tests/memoComposerDesign.test.mjs`.
  · 검증: 전용+아이 컴포저 29/29, 디자인·접근성 73/73, 앱 전체 1,826/1,826, typecheck와 production/PWA
  build가 통과했다. Android unit·lint·assemble도 통과하고 debug APK(SHA-256 `6BBCBB27…96B165`)를
  S25에 `adb install -r`로 설치했다. 설치 전후 부모 역할·가족 지문 `418660464c2e`가 같고, 실측 두 버튼은
  각각 44×44px/아이콘 20×20px·투명/무테/무그림자/무blur였다. 컴포저 bottom 734px ≤ 탭바 top 737px,
  가로 overflow 없음까지 확인한 뒤 부모 홈으로 복귀했다.
- ⚠️ **원격이 같은 화면을 이미 고쳤을 수 있다(2026-08-19 실사고)**: 이 세션은 `9a6ab81` 기준으로 부모 홈을
  재디자인했는데, 그 사이 원격 main 에 같은 영역의 커밋 5개(`.ph-page`/`.ph-glass` 도입)가 올라와 있었다.
  "before" 스크린샷이 이미 낡은 상태라 진단 자체가 어긋났고 push 도 거부됐다. **디자인 작업 시작 전에
  `git fetch` 로 원격을 먼저 확인하고, 겹치면 원격 구조를 기준으로 값만 보정한다**(force push 금지).
- ★**하단 탭바(2026-08-21 최신)**: 공용/선생님 탭바의 유리판 정본은 `components.css`의
  `.hy-tabbar`·`.hy-tabbar__inner`이고 아이 모드는 `ChildDock` 별도다. 부모 셸은 여기에 명시적인
  `data-icon-only` override를 적용해 **한글 없는 flat 아이콘 5개**만 보이며, 배경 gradient도 쓰지 않는다.
  ⚠️ **부모에 `backdrop-filter` 가 있으면 자식 유리는 아무것도 못 비춘다** — 조상이 backdrop-root 를 만들어
  자식의 backdrop 이 그 조상 내용으로 격리된다. 그래서 기존 `.hy-tabbar` 의 `blur(12px)` 를 걷어내고
  블러는 알약 한 곳에만 건다. 스크림은 목록이 알약 위 가장자리에서 하드컷되지 않게 하는 페이드
  (0 → 0.38 → 0.72)만 맡는다 — 예전 값 0.96 을 두면 유리가 크림색만 비춰 유리인 의미가 없다.
  ⚠️ **유리 위에서 선택 상태를 채움색으로 알리면 안 된다** — 뒤 화면이 같은 계열이면(로즈 히어로 위에서 실측)
  `--hy-accent-soft` 칩이 물든 유리와 같은 톤이 되어 **어느 탭이 선택됐는지 사라진다**. 불투명도를 올리는 건
  유리를 죽이는 해법이라, 색이 아니라 **윤곽**으로 알린다(안쪽 흰 테두리 1px + 얕은 그림자 = 유리 위에 얹힌 알약).
  `saturate(180%)` 가 없으면 파스텔 화면 위에서 유리가 회색으로 죽는다. `backdrop-filter` 미지원은
  `@supports not` 으로 `--bg-card` 불투명 강등한다(라벨 가독성이 먼저다).
  대비는 추정하지 말고 **캡처 픽셀을 디코딩해 실측**한다 — 로즈 히어로가 바로 뒤일 때 비활성 라벨 5.08:1 ·
  활성 라벨 5.46:1 로 AA 통과를 확인했다(흰 0.92→0.78 + 스크림 0.72 합성 기준).
  ⚠️ `.hy-tabbar__inner` 는 `tests/designSystemUsage` 의 non-surface manifest와
  `releaseVisualConsistencyContract` 의 `var(--radius-pill)` 기대에 exact 경로+선택자로 등록돼 있다 —
  배경·radius 를 가진 **새 pseudo(::before 등)를 추가하면 manifest 미분류로 막힌다**. 그래서 유리의 테두리·
  하이라이트는 전부 같은 요소의 `border`+`box-shadow` 로만 만들었다.
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
  ⑤★**아이콘 전용 원형 버튼은 `hy-busy-center` 를 함께 붙인다(2026-08-17 TK 제보 "보내기를 누르면 비행기가
  치우쳐 보임")** — 공용 링은 라벨 왼쪽에 끼는 `::before` 라서 라벨 없는 원형 버튼에서는 아이콘을 밀어낸다.
  `hy-busy-center` 가 링을 절대 배치로 가운데 겹치고 자식만 감춘다(크기·위치 불변). 자기 펄스를 겹쳐 두 표시자로
  만들지 말 것(`.mc-send--sending` 의 opacity 펄스는 이 이유로 제거했다).
  ⑥★**한 화면에 움직이는 표시자는 하나** — 부모 위치 갱신은 우상단 새로고침 회전만 쓴다. 아이 칩 문구
  (`parent.location.requestSent`)·칩 폭 확장·칩 스피너는 프로필 위에 겹쳐 보여 전부 제거했고 재도입 금지다.
  갱신 중에도 상세 카드는 마지막 확인 시각·정확도를 그대로 보여 준다. 회귀=`tests/parentLocationUi.test.mjs`.
  화면 단위 로딩은 애니메이션이 있는 `<Loading/>`·`ScreenQueryState`·`hy-skel` 만 쓰고 맨 문구를 쓰지 않는다.
  `useActiveChild().familyLoading` 은 **조회 중과 "아이 없음"을 구분**하기 위한 값이다 — 이게 없으면 주간리포트·
  하루요약·AI크레딧·길찾기가 가족 조회 중에 "아이가 없어요"를 미리 단정해 표시자도 못 띄웠다.
  회귀=`tests/progressIndicatorContract.test.mjs`.
- ★**화면 로딩 그림은 하나다(2026-08-19 TK 지시)**: 점 3개 로더·라우트 반짝임·조회 회전 링이 화면마다 달랐던 것을
  **공용 로딩 마크** 하나로 통일했다. 정본은 `src/components/ui/LoaderMark.tsx` 이고 종류는 두 가지뿐이다 —
  **일반 로딩=`ui/loader-calendar.webp`**(체크가 달력을 채우는 애니메이션), **지도·경로 로딩=`ui/loader-location.webp`**
  (핀이 경로를 따라가는 애니메이션). 소비처는 `Loading`(+`compact`)·`RouteLoading`·`ScreenQueryState`(loading 상태)·
  `KakaoMap`의 `.km-skeleton`·`RouteView`의 `.rv-map--placeholder` 5곳이다.
  ⚠️ **애니메이션 webp 는 CSS 로 멈출 수 없다** — `prefers-reduced-motion` 은 컴포넌트가 `<picture>` +
  `media="(prefers-reduced-motion: reduce)"` 로 **정지 프레임(`-still.webp`)** 을 대신 내려줘 처리한다
  (점 3개 로더가 `animation:none` 으로 멈추던 것과 같은 결과). 정지본은 루프 **중간(18/36)** 프레임이다 —
  마지막 프레임(체크 완료·하트)을 쓰면 로딩 중인데 "끝났다"로 읽힌다.
  ⚠️ 크기는 **소비 화면 CSS 의 `--loader-mark-size`** 로만 정한다. 공용 컴포넌트에 인라인 style 로 크기를 주면
  소비 화면 클래스를 덮어쓰고(`KakaoMap` 지도 실종 사고와 같은 함정) `designSystemUsage` 의 인라인 스케일 검사에도 걸린다.
  마크가 `aspect-ratio: 1/1` 이라 `.km-skeleton` 처럼 폭에 `clamp(40px, 38%, 96px)` 를 줘도 썸네일 지도에서 정사각을 유지한다.
  **의도적으로 그대로 둔 것**: 버튼 안 `aria-busy` 회전 링(라벨 옆 인라인 표시자라 그림이 들어갈 자리가 없다),
  `hy-skel` 스켈레톤(레이아웃 자리표시), 스플래시 점 3개(콜드스타트 브랜드 연출), 지도 위 `rv-map-chip` 스피너(작은 칩).
  자산은 `scripts/import-loader-marks.mjs` 가 정본이다(원본 파일→slug 표, q88 재인코딩으로 239KB→80KB, 정지 프레임 생성).
  회귀=`tests/progressIndicatorContract.test.mjs`(소비처 5곳·`--loader-mark-size`·webp `ANIM` 청크 유무로
  "애니메이션 본 / 정지본"을 파일 단위 검증)·`tests/mapPerf.test.ts`·`tests/routeLazyLoading.test.mjs`.
  ⚠️ 검증 함정: 화면 컴포넌트 CSS 는 route lazy 청크(`assets/Loading-*.css` 등)로 갈라지므로, dist 로 만든 정적
  하니스에 `assets/index-*.css` 만 링크하면 `--loader-mark-size` 지정이 조용히 빠져 전부 기본값 64px 로 측정된다.
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
- 스토어 방문 혜택 grandfather(2026-08-01): 신규 지급은 종료했다. `/api/review-rewards` GET은 부모 세션에서
  기존 `family_review_rewards` 행만 읽고, POST claim은 부모 본인 가족을 확인한 뒤
  `410 review_reward_program_ended`로 닫으며 INSERT·UPDATE·DELETE하지 않는다. 이번 정책 전환에서 기존 행을 삭제하지
  않고, `reviewed`는 이미 받은 장소 한도를 유지하기 위한 숨은 내부 호환 상태일 뿐 사용자 노출 상품 티어가 아니다.
  클라이언트 `useReviewReward`도 조회 전용이며 아이/선생님 세션은 호출하지 않고 reviewed=false로 확정한다. 부모 설정은
  신규 지급 CTA를 노출하지 않고 무료 가족에는 종료 안내, 기존 혜택 가족에는 유지 안내만 표시한다.
- 구독 상품 정본(2026-08-01): 초기 출시는 사용자에게 `Free`와 `Premium` 두 단계만 보여주며 가격은
  **월 4,900원·연 39,000원**으로 고정한다. 일정·메모·스티커는 모든 티어에서 무제한이고 준비물·숙제는
  모든 티어에서 아이별 하루 각각 8개다. Free는 아이 1명, 약 10분 간격 위치,
  최근 24시간 즉시 위치 요청 5회, 오늘 위치 이력, 저장 장소 2곳, 위험구역 1곳, 소리 울리기 1회,
  AI 친구 하루 5회와 AI 일정 정리 하루 5회를 제공한다. Premium은 아이 2명, 실시간 위치와 즉시 요청 무제한, 최근 30일 이력,
  저장 장소·위험구역 무제한, 소리 울리기 최근 24시간 10회, AI 친구 하루 20회, AI 일정 정리 제한 없음, 위치 끊김·미등록 체류 자동 알림,
  AI 하루 요약·주간 리포트·학원 시간표 자동 정리·투명한 1분 주변 소리를 제공한다. SOS·긴급 알림은 티어와 무관하게
  항상 무료다. `reviewed`는 기존 혜택 보존용 내부 상태일 뿐 비교표·결제 상품·사용자 티어로 노출하지 않는다.
  비교표 값은 `src/transform/tierPolicy.ts`에서만 파생하고, 기능 잠금은 사용자가 시도한 기능명·정확한 차이·구독 CTA와
  원래 화면으로 돌아갈 `returnTo`를 함께 전달한다. 서버 엔타이틀먼트가 확인되지 않으면 Free로 추정하지 않고 결제와
  민감 기능을 fail-closed하며, Google Play 가격은 결제 직전 `formattedPrice`, iPhone PWA는 서버 catalog를 정본으로 쓴다.
- 위치 티어(2026-08-01): 위치 조회는 서버가 `locked|standard|realtime`으로 판정한다. Free와 기존 reviewed 부모는
  10분 버킷 이전의 아이별 최신 실측 위치를 측정시각·정확도와 함께 받고, 부모가 누른 즉시 위치 요청은 rolling 24시간
  5회까지 실제 새 fix를 5분 확인 창에서 바로 표시한다. Premium 부모는 현재 위치와 즉시 요청 무제한을 받는다.
  Free/reviewed 이력은 Asia/Seoul 오전 8시 기준 오늘 범위, Premium은 서버 현재시각 이전 최근 30일로 clamp하며 범위 밖 요청은
  빈 결과로 닫는다. 아이 세션은 활성 상태인 본인 최신 위치만 조회하고, 위치 인시던트는 티어와 무관하게 부모만 조회한다.
  엔타이틀먼트 DB 판정 실패는 최신 위치를 열지 않고 `503 location_entitlement_unavailable`로 닫는다.
- 구독 결제 정본(2026-07-13): Google Play가 현재 계정에 eligible 하다고 반환한 정확한 7일 무료 offer만 표시·구매하고,
  결제 직전 재조회한 `offerToken`·`offerId`를 네이티브와 Worker까지 그대로 전달한다. 가격은 Play `formattedPrice` 정본만
  표시한다. 신규 결제는 월 4,900원·연 39,000원만 승인한다. 2026-08-01 00:00 KST 이전 시작의 월 2,900원·연 27,840원
  기존 구독은 복원·RTDN 재검증에서만 grandfather하고 신규 verify와 전환 시각 이후 시작 구독은 과거 가격을 거부한다.
  base plan ID의 숫자는 가격 정본이 아니다. `trial`은 미래 `trial_ends_at`, `active/grace/cancelled`는 미래 `current_period_end`가 있을 때만 프리미엄이며,
  해지는 이미 결제한 종료일까지 유지한다. Google Play 직접 검증이 결제 정본이며 RTDN도 notification type만 믿지 않고
  `purchases.subscriptionsv2.get`으로 재검증한다. RTDN은 Google OIDC·audience·push service-account email을 모두 검증하고,
  additive D1 schema를 먼저 적용해야 한다. 설정 누락은 `503` fail-closed가 정상이다. Qonversion은 비활성·비정본 보조
  route이며 health는 secret이 없으면 `configured:false, accepting:false, primaryProvider:false`를 반환한다. Billing 상품 조회
  진단은 response code/debug message와 미조회 product id/type/status만 다루고 purchase/order token을 로그나 응답 진단에
  포함하지 않는다. Play 구매는 SHA-256 obfuscated family/parent id를 서버에서 대조하고, 부모 foreground에서 6시간 제한으로
  기존 구독을 재검증해 자동갱신 종료일을 갱신한다. AI 크레딧은 event claim·잔액·원장을 D1 batch로 원자 확정한다.
- ★구독 유효기간 표시 검증(2026-08-17 TK 요청 "2100년까지 이용 가능해요가 정상인지 확인"): 화면은 D1
  `family_subscription.current_period_end` 를 Asia/Seoul `dateStyle:"medium"` 으로 그대로 표시하므로 클라 버그가 아니다.
  프로덕션 조회 결과 구독 행 6개 전부 `provider=google_play` 이고 **실제 결제 고객은 아직 없다** —
  `2099-12-31 23:59:59+00`(2행, KST 로 2100-01-01)·`2099-01-01`(1행)은 수동 프리미엄 그랜트, `2027-04-26` 1행,
  `qa_final_e2e_premium`(2026-08-01, 만료) 1행, `trial` 인데 `trial_ends_at` NULL 1행(계약대로 프리미엄 아님)이다.
  코드에는 sentinel 날짜가 없고 실제 결제 경로는 Google `subscriptionsv2` 의 `line.expiryTime` 을 그대로 저장하므로
  (`worker/shared/googlePlaySubscription.js` → `prepareGooglePlayFamilySubscriptionWrite`) 일반 회원은 실제 다음 결제일이
  보인다. 즉 2100년은 운영자 수동 그랜트 데이터의 정직한 표시다(원한다면 그 행의 날짜를 정리하면 된다).
- 프리미엄 퍼널 최소수집 계약(2026-08-01): 클라이언트는 고정 행동 이벤트에 UUID·앱 버전·발생 시각만 붙여 20건씩 보내고,
  실패는 제품 흐름과 분리된 메모리 100건 큐에서 다음 기록 때만 재시도한다(브라우저 저장소·세션 refresh 금지). Worker는
  active parent의 현재 가족을 서버에서 정본화하고 `PREMIUM_FUNNEL_HASH_SECRET` HMAC-SHA256 가족 가명키만 저장한다.
  D1 `premium_funnel_events`에는 원시 user/family·위치·이름·주소·메모/AI 원문·email/phone·가격·토큰·자유 JSON 컬럼이 없다.
  첫 위치·신규 첫 도착은 `first_location|first_arrival` source만 전송하고 좌표·주소·alert id는 보내지 않는다. Google Play는
  재검증 전후 정본 상태로 확인된 신규 체험·최초 활성·실제 기간 연장·revoke만 서버에서 기록하며 raw purchase/order 값은
  퍼널 멱등키에도 넣지 않는다.
  `entitlement_activated|trial_start|renewal|refund`는 결제 서버의 fail-soft helper 전용이며 클라이언트 API는 거부한다.
  UUID 멱등, 가족당 600건/시간, 16KiB payload, 20건 batch, -7일/+10분 시각 편차와 서버 `received_at`을 적용하고 hourly cron이
  180일 지난 이벤트를 멱등 삭제한다. 운영 순서는 `worker/db/premium-funnel.sql` → secret 설정 → Worker 배포·readback이다.
- 출시 AAB 신선도(2026-07-13): 체크리스트의 서명 AAB는 최신 앱 커밋 이후 다시 빌드하고 서명·해시·mtime을 확인한
  경우에만 준비 완료로 표시한다. 과거 AAB가 디스크에 존재한다는 이유만으로 업로드하지 않는다. 서명 비밀번호는 사용자만
  입력하며 에이전트가 자격 파일을 읽어 자동 서명하지 않는다.
  릴리즈 스크립트는 worktree의 `android/local.properties`를 전제로 하지 않고 Android SDK를 먼저 탐색해
  `ANDROID_SDK_ROOT`·`ANDROID_HOME`을 설정한 뒤 build·Capacitor sync·Gradle release를 실행한다.
- 설정/가입/오늘경로 안정화(2026-07-08, 이동기록 UI 2026-08-07 갱신): 부모 `/friend-play`는 아이 요청 UI가 아니라 가족 친구놀이 허용 설정이다.
  장소 관리는 서버/AI 생성 없이 `resolvePlaceVisual` 정적 asset 매핑으로 장소명에 맞는 이미지를 고른다.
  가입 전 설문은 progress 20%에서 시작하고 복수 선택만 수집한다. 부모 오늘경로는 오전 8시를 하루 시작으로,
  00~07시는 전날 경로로 본다. 최신 따라가기의 이력 로딩 중에는 서울 기본점보다 현재 위치가 우선이지만, 과거 시각을
  고른 뒤에는 실측 이력점이 없으면 현재 위치로 대체하지 않는다. 이동기록 카드는 드래그하지 않고 명시적 버튼으로
  머문 곳 상세만 펼치고 접으며 시간 막대는 항상 남아 연속 탐색할 수 있는지 검증한다. 로컬 mock 검증 시 현재 시각이
  08시 전이면 mock 이력도 `/api/location/history`의 `start`
  파라미터 기준으로 만든다.
- ★시간대별 경로 조작 정본(2026-08-07 TK 제보): 슬라이더로 시각을 옮기면 ①시각·장소·시간 막대가 있는 탐색 카드와
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
  `/api/location/history` 쿼리 키의 끝시각은 하루 창 끝(시작+24h)으로 고정하고 신선도는 60초 배경 폴링으로 유지한다
  (끝시각에 `now`를 넣으면 키가 매번 바뀌어 하루치를 다시 받고 슬라이더가 최신으로 튀었다). 탐색 카드는 선택 시각과
  위치(머문 곳 이름/이동 중/기록 없음), "최신 위치" 버튼을 보여주고 판정 시각은 마지막 기록 시각으로 clamp 한다.
  선택 시각 이전에 실측점이 없으면 현재 위치를 대신 그리지 않으며 "기록 없음"으로 닫는다. 최신 위치로 돌아가면 시각 배지를
  제거하고 하루 경로 전체 bounds를 복원한다. 회귀=`tests/parentLocationScrubFocus.test.mjs`·
  `tests/locationHistoryScrub.test.ts`·`tests/mapViewportPadding.test.ts`·`tests/locationJourneyPanelContract.test.mjs`.
  로컬 검증 팁: Kakao JS 키 도메인 제한 때문에 로컬 하니스에서는 실 SDK가 로드되지 않으므로 `window.kakao.maps`
  계측 스텁(Polyline/Map 호출 기록)으로 선 스타일과 `setCenter/setLevel/setBounds` 결정을 확인한다.
- 메뉴·페어링 안정화(2026-08-07): 부모 홈 바로가기는 `AI 일정 → 위치추적 → 친구놀이 → 장소관리 → 주변소리 →
  안심리포트 → 아이 기기 찾기 → 알림` 순서와 실제 라우트를 회귀 테스트로 고정한다. `아이 기기 찾기`는 활성 아이
  `user_id`를 `/remote-ring`에 명시한다. 구독은 그리드 아래 가로 카드로 분리하고 Free·reviewed는 `구독 시 혜택`,
  Premium은 `구독 관리`, 미확정·오류는 `구독 정보`로 표시해 Free로 추정하지 않는다. 부모 설정 메뉴는 emoji 칩 대신
  lucide/image 아이콘 + `data-tone` 토큰 색상만 사용한다. 페어링 위저드는 `/api/family/mine`과 엔타이틀먼트가
  모두 확정되기 전 2명 선택과 코드 생성을 막고, 코드 생성 직전에도 현재 티어의 아이 수 상한을 다시 검사한다.
  위치 요청 진행 문구는 지도 위 절대 배치 오버레이로 띄우지 않고 활성 아이 `.pl-chip` 안에서 사진·이름과 함께 표시해
  프로필을 가리지 않는다. 구독 가로 카드는 Free의 보라–핑크 `혜택 보기`, Premium의 민트 `관리하기`, 미확정의 중립
  `확인하기` CTA로 상태를 분명히 하고, 확인되지 않은 할인·긴급성 문구는 만들지 않는다. 회귀는
  `tests/parentLocationUi.test.mjs`·`tests/parentHomeSubscriptionCard.test.ts`와 격리 브라우저/A17 CDP 하니스가 보호한다.
  2026-08-07 Pages production에는 앱 source `1925ab1`, deployment `b5a80284-8a05-4637-bad1-9d4f368b94a1`로 배포했다
  (직전 rollback 기준 `827855b3-876d-4d35-af6a-ad3f25dc0669`). 고정 배포 URL과 `hyeni-calendar.pages.dev`가 local dist와
  index SHA-256 `e126019f135fbfc938e17a3f9ef0a56b91d3d3164283905ba818dd3c6910bfae` 및 entry JS/CSS 해시가 같고,
  CSP·`Referrer-Policy: no-referrer`·`X-Content-Type-Options: nosniff`, manifest·SW·assetlinks가 모두 정상이다.
  exact dist의 격리 브라우저 부모 42/42·아이 14/14와 PWA install·offline·안전 업데이트도 문제 0건이다. Worker/D1은 변경·배포하지 않았다.
  같은 날 이동기록 가시성·드래그 떨림 수정 앱 커밋 `d6c9b24`의 exact dist를 production deployment
  `10bb824e-54c9-4686-ab6b-d987c343159e`(`https://10bb824e.hyeni-calendar.pages.dev`)로 추가 배포했다.
  고정 URL과 `hyeni-calendar.pages.dev`의 index SHA-256은 로컬 `e30d70101ed12fde2ff3c127ff40903ddb39122db809797ba68743804a4ff152`와
  같고 entry `assets/index-DNVmEhWH.js`·위치 청크 `assets/ParentLocation-2ElKRDyp.js`도 바이트 일치한다. CSP·referrer·nosniff,
  manifest·SW·assetlinks 200을 다시 확인했다. exact dist 브라우저 부모 42/42·아이 14/14, PWA 런타임 문제 0건이며,
  A17 `adb install -r` 데이터 보존 설치(APK SHA-256 `0f1efedc00f8cd06713ad421f044b15438035cadc8e8250803ca0591d3ac0273`) 뒤
  1.2초 실물 슬라이더 드래그에서 `panBy` 1회·선택 시각/마커 배지 일치·가시 영역 내 마커를 확인했다. 검증 시작 이후
  A17 Java/native crash·ANR은 각각 0건이고 Worker/D1은 변경·배포하지 않았다.
- ★부모 홈 글래스모피즘(2026-08-19, wiki): 색은 페이지 배경(`.ph-page::before`)에만 두고
  카드(`.ph-glass`)는 반투명 `--bg-card` + `backdrop-filter` + 밝은 흰 획이다.
  섹션 안 그라데이션·어두운 안쪽 선(뉴모피즘)은 쓰지 않는다. AI·구독·친구 초대가 같은 면이다.
  2열 4버튼 라우트(`voice`/`text`/`image`/`mode=academy`)는 유지한다. 장식 배지·흰 글자 파스텔 CTA는
  쓰지 않고, `prefers-reduced-transparency` 에서는 워시를 숨기고 솔리드 `--bg-card` 로 폴백한다.
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
- ★**부모 설정 아이콘 = clay 3D 세트 하나로 통일(2026-08-18 TK 지시)**: 설정 화면의 **모든 행**(언어·계정·알림·
  위치·데이터·구독·친구 초대·스토어 혜택 안내 + 가족/안전 7행 + 약관·계정 4행)이 `public/assets/ui/clay/*.webp`
  25종을 쓴다. 원본은 TK 가 준 1024px 투명 PNG 이고 `scripts/import-clay-3d-icons.mjs` 가 여백을 잘라 256px webp 로
  들여온다(파일→slug 표가 그 스크립트의 정본). 칩은 38px·그림 32px 이라 예전 lucide 18px 글리프보다 크다.
  lucide 는 이동 chevron·뒤로가기·삭제 모달 글리프에만 남는다. 앞선 3D 세트 중 `mic-3d`·`pencil-3d`·`profile-3d`·
  `language-3d`·`data-sync-3d`·`gift-3d` 는 소비자가 없어 삭제했다(계정 사진 버튼의 `camera-3d` 만 남김).
  브라우저 QA 가 `parent-settings-icons.png`·`-bottom.png` 두 장을 남기므로 아이콘 변경은 눈으로 바로 확인한다.
  ⚠️ `tests/menuNavigationConsistency.test.mjs` 는 이제 `type LucideIcon` 이 아니라 clay 자산 참조를 요구한다.
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
- ★장식성 마이크로 배지 금지(2026-08-14 TK 지시): 주변 제목·설명을 반복하거나 클릭되지 않는데 작은 버튼처럼 보이는
  pill/eyebrow는 삭제한다. 배지는 실제 상태·읽지 않은 수·현재 선택·티어·날짜처럼 사용자가 판단에 쓰는 정보에만 쓴다.
  온보딩 상단 `함께 보는 우리 가족` 배지, AI 친구의 가짜 온라인 점·`이야기할 준비됐어!`, 설정 버전 뒤 장식 슬로건은
  재도입하지 않는다. `scripts/final-browser-qa.mjs`는 public 온보딩·아이 AI 친구·부모 설정을 실제 렌더해 이 계약을 확인한다.
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

- ★**"브라우저에서만 안 된다" = 먼저 번들 신선도를 의심한다(2026-08-18)**: 부모 프로필 사진·친구 초대 코드가
  브라우저에서만 안 보인다는 제보를 D1·R2·API 로 추적한 결과 **서버 데이터는 정상**이었다(멤버 `photo_url` 저장,
  R2 객체 59,960B·`purpose: parent_profile`·`targetMemberId` 일치, 코드 행 `HYENI-…` active). 격리 브라우저에서
  같은 계약으로 재현하니 사진은 blob URL 로 그려지고 코드 발급도 성공했다. 즉 원인은 **탭이 들고 있던 옛 번들**이
  가장 유력하다(옛 클라이언트는 서버가 더 이상 주지 않는 상한 필드를 요구해 초대 화면이 오류가 된다).
  그래서 `registerSW`의 `onRegisteredSW` 에서 30분마다·화면 복귀마다 `registration.update()` 를 돌려 오래 열어
  둔 탭도 스스로 새 번들을 받게 했다. 진단 순서: ①D1 행 ②R2 객체·메타데이터(`wrangler dev --remote` 로 띄운
  읽기 전용 스크래치 워커의 `PHOTOS.head`) ③격리 브라우저 재현 ④그래도 정상이면 번들·세션(계정) 신선도.
  회귀=`scripts/final-browser-qa.mjs`(부모 사진 blob 렌더 + 초대 코드 발급 클릭)·`tests/routePreload.test.ts`.
- ★**화면이 "한 번씩 리프레시"되는 두 원인(2026-08-18 TK 제보, 2026-08-20 정본 갱신)**:
  ①**새 버전 적용 새로고침** — 과거에는 Android 네이티브에서도 PWA Service Worker를 등록해 새 APK 설치 직후
  이전 `index.html`을 한 번 보여 주거나 사용 중 `location.reload()`가 일어났다. 2026-08-20부터 Capacitor는 APK의
  로컬 자산을 직접 읽으므로 `main.tsx`가 **네이티브에서는 Service Worker를 등록하지 않고 기존 등록도 전부
  `unregister()`**한다. 웹·PWA만 기존 `registerSW` 업데이트·오프라인 계약을 유지한다. 이 수정이 들어오기 전 버전에서
  처음 올라오는 1회는 옛 controller가 먼저 응답할 수 있으므로 앱을 한 번 다시 열어 최신 번들이 로드되면 등록이
  영구 정리된다. `pwaReloadTiming`은 과거 설치와 웹 회귀를 위한 순수 판정으로 남긴다.
  ②**첫 진입 청크 로딩** — 화면은 route 단위 lazy 청크라 처음 들어갈 때 `RouteLoading`("화면을 불러오는 중")이
  한 번 지나간다. `src/app/routePreload.ts` 등록소에 App 이 경로→`screen.preload` 를 등록하고 탭바·아이 독이
  `preloadRoutesWhenIdle`(idle)+`onPointerDown`(즉시)으로 미리 받는다. `lazyScreen` 은 `preload()` 를 노출하며
  **실패한 promise 를 캐시하지 않는다**(캐시하면 실제 이동도 영영 실패한다). `LocaleBoundary` 도 문구 로딩 중
  `null`(빈 화면) 대신 `RouteLoading` 을 렌더한다. 회귀=`tests/routePreload.test.ts`.

### J. 실기기 검증 치트시트 (함정 포함)
- ★**`adb install -r` 직후 번들 신선도(2026-08-20 정본)**: 2026-08-18까지의 APK는 네이티브 WebView에도 PWA
  Service Worker를 남겼으므로 설치 Success 뒤 직전 번들이 한 번 보일 수 있었다. 이제 네이티브는 등록하지 않고
  최신 번들이 뜨는 즉시 과거 등록을 `unregister()`하므로 이후 업데이트는 APK 자산을 바로 읽는다. 구버전에서 이
  수정 버전으로 처음 올라올 때만 ①APK 안 진입 asset 확인 ②앱 1회 재시작 ③CDP에서 활성 진입 asset과
  `navigator.serviceWorker.getRegistrations()` 길이 0을 확인한다. 네이티브에서 SW를 다시 등록하거나 캐시 삭제를
  상시 절차로 만들지 않는다. 웹/PWA의 Service Worker·웹 푸시·오프라인 계약은 그대로다.
- ★**대기 중 애니메이션은 화면이 꺼진 기기에서 관측할 수 없다**: 잠긴/꺼진 화면의 WebView 는
  `document.hidden === true` 라 배회·깜빡임이 (설계대로) 멈춘다. 밤에 아이 기기를 깨우지 말고,
  시간축 동작은 **격리 Chromium + dist + 아이 세션만 심은 하니스**로 관측한다(외부 호스트는
  `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1` 로 닫아 운영 API·실계정과 무관하게 만든다).
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
- ★**Worker 배포 자격(2026-08-02 갱신)**: 저장소 루트 `.env` 의 토큰은 **D1 전용**이라 그대로 배포하면
  `Authentication error 10000` 이다. 배포 권한 토큰은 `worker/.env` 의 `CLOUDFLARE_API_TOKEN` 이고
  같은 파일의 `CLOUDFLARE_ACCOUNT_ID` 와 함께 따옴표를 벗겨 프로세스 env 로 주입한다.
  두 파일 모두 gitignore 되며 값을 출력·커밋하지 않는다. 배포는 `npm run deploy:worker`(= `cd worker && wrangler deploy`).
- **현재 기기 역할(2026-08-19 최신 사용자 지시)**: A17(RFKL40DP73J)은 부모, razr(ZY22H9VTQD)는 아이,
  S25(R5CY521CFNZ, SM-S937N)는 **역할 미고정 상시 검증기**다. 세 기기 모두 `adb install -r` 설치와 역할별
  읽기 전용 실행 검증을 수행하고, 앱 데이터·계정·페어링·세션을 보존하며 실제 계정 로그아웃·역할 전환·재페어링·
  SOS·소리 울리기·주변 소리 실행은 하지 않는다. S25 는 역할이 고정돼 있지 않으므로 **쓰기·역할 의존 검증 전에
  아래 "기기 역할 확인"을 반드시 먼저 수행한다**(설치 자체는 역할과 무관하므로 선행 확인 없이 가능).
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
- ★**D1 compound SELECT 항 수 제한(2026-08-17)**: `UNION ALL` 을 5~6개 이상 이으면
  `too many terms in compound SELECT: SQLITE_ERROR [code 7500]` 로 쿼리 자체가 실패한다(로컬 SQLite 는 통과).
  스키마 점검처럼 여러 테이블을 훑을 때는 4개 이하로 쪼개거나 테이블별로 따로 실행한다.
  wrangler `d1 execute --json` 실패 응답은 `[` 로 시작하지 않으므로 `indexOf("[")` 파싱이 조용히 0건을 만든다 —
  stderr 를 버리지 말고 실패를 먼저 확인할 것(실제로 "컬럼 35개 누락"이라는 오진을 만들었다).
- ★**D1 표현식 깊이 100 제한(2026-08-03 실사고)**: D1 은 `SQLITE_MAX_EXPR_DEPTH` 를 **100** 으로 낮춰 놓았다
  (로컬 `node:sqlite` 는 기본 1000). 조건을 `AND`/`OR` 로 길게 이으면 이진 트리 깊이가 넘쳐
  `Expression tree is too large (maximum depth 100): SQLITE_ERROR` 로 **쿼리 자체가 실패**한다.
  실제로 `/api/health` 의 스키마 준비 검사가 98개 계약을 한 문장에 AND 로 이어 배포 직후 **항상 503** 이었고,
  로컬 테스트는 전부 통과해 배포 전까지 드러나지 않았다. 조건이 많은 검사는 **여러 문장으로 쪼개
  순차 실행**하고(early-exit 이득도 있다) 청크당 `AND` 수를 넉넉히 낮게 잡는다.
  가드=`worker/tests/healthReadiness.test.mjs` 의 AND 개수 상한 검사.
- ★**QA 하니스는 locale 을 고정해야 한다(2026-08-19)**: `final-browser-qa`·`pwa-runtime-qa` 는 한국어 문구를
  기준으로 화면을 검사하는데 Chrome 을 `env: {}` 로 띄운다. Windows 로컬은 OS 가 한국어라 늘 통과했지만
  **Linux CI 는 en-US** 라 화면이 영어로 렌더돼 문구 검사 12건 + PWA 앱 이름 검사 1건이 실패했다.
  두 하니스가 Chrome 인자에 `--lang=ko-KR` **과 `--accept-lang=ko-KR,ko`** 를 함께 넣어 언어를 고정한다.
  ⚠️ `--lang` 만으로는 부족하다 — 앱은 `navigator.languages` 를 읽는데 그 값은 `--accept-lang` 이 정한다
  (`--lang=ko-KR` 만 넣고 배포했다가 CI 가 또 12건 red 였다). 실측: `--accept-lang=en-US,en` → 12건 red,
  `ko-KR,ko` → 0건 green.
  ⚠️ `localStorage` 로 locale 을 심는 방법은 쓰지 말 것 — `pwaRuntimeQaHarness` 가 하니스 소스에
  `process.env|localStorage|sessionStorage|document.cookie` 를 금지한다(사용자 브라우저 상태 차단 계약).
  재현 검증은 `--lang=en-US` 로 바꿔 돌리면 된다 — 실제로 그렇게 12건 red → `ko-KR` 로 0건 green 을 확인했다.
  가드=`tests/finalBrowserQaHarness.test.mjs`·`tests/pwaRuntimeQaHarness.test.mjs`.
- ★**CI 는 shallow checkout이다 — 고정 baseline 커밋을 읽는 감사기는 `fetch-depth: 0` 이 필요하다(2026-08-19)**:
  `scripts/i18n/audit-task8-locales.mjs` 가 `git show 4fc8b55:locales/ko/*.json` 으로 baseline 을 읽는데,
  `actions/checkout` 기본값(fetch-depth 1)에서는 그 커밋이 없어 `fatal: invalid object name` 으로
  **locale 감사 4건이 통째로 실패**했다. 로컬은 전체 히스토리라 항상 통과해 오래 방치됐다
  (실제로 앱 CI 가 여러 커밋 연속 red 였다). `release-candidate.yml` 의 두 checkout 에 `fetch-depth: 0` 을 넣었고
  `tests/releaseCiContract.test.mjs` 가 그것을 강제한다. **로컬 통과만 보고 CI 통과로 단정하지 말 것.**
- ★**배포 전 스키마 선행 확인(2026-08-03)**: wrangler 는 워킹트리를 배포하므로, 오래 미배포된 Worker 를 올리면
  그 사이 추가된 `worker/db/*.sql` migration 이 **한꺼번에 필요**해진다. 배포 전에 `worker/db/*.sql` 이 만드는
  테이블·인덱스·컬럼을 프로덕션 `sqlite_master` 와 대조하고 **migration 을 먼저 적용**한다(런북의 migration-first).
  특히 `location_confirmation_records` 가 없으면 `parent-alerts` 가 도착·출발·위험구역·미도착 알림을
  `503 location_confirmation_unavailable` 로 **전부 중단**한다. `web-billing.sql`·`web-ai-credit-billing.sql` 은
  후속 `-refunds`·`-financial-retention` 을 **이미 포함한 통합본**이라 새로 만든 DB 에 후속 파일을 또 적용하면
  `duplicate column name` 으로 실패한다(실패해도 D1 이 롤백하므로 안전 — 통합본이면 건너뛴다).
- **D1/Worker**: 시간 검증은 백데이트 트리거(예: `anchor_since` 6분 전 + upsert 1회, cron 은 이벤트를 target 분에 생성) ·
  `wrangler tail --format json` 을 파일로 받아 파이썬 파싱 · 컬럼명 추측 금지 — `pragma_table_info` 먼저.
  ★Worker 전체 Node 테스트는 **이 저장소 루트**에서 `npm run test:worker`
  (= `node --test worker/tests/*.test.mjs`)로 실행한다. 타입은 `npm run typecheck:worker`.
  ★**worker 테스트는 Vite 를 쓰지 않는다(2026-08-02 이관)**: 예전엔 `createServer()` + `ssrLoadModule` 로
  TS 를 로드했는데, 앱 저장소 루트에서 모듈 그래프를 SSR 변환하느라 **파일 하나에 3분 이상** 걸리고
  60초 `transport invoke timed out` 으로 실패했다. Node 24 는 같은 모듈을 **0.1초**에 로드한다.
  worker 소스는 wrangler(esbuild)가 번들하므로 상대 import 에 확장자가 없어 Node ESM 이 바로 못 읽는데,
  `worker/tests/helpers/tsModuleResolve.mjs` 를 **정적 import 첫 줄에** 넣으면 resolve 훅이 확장자를 보완한다
  (소스·배포 산출물 무변경). 새 worker 테스트도 `vite` 를 도입하지 말고 이 훅 + `await import("../lib/x.ts")` 를 쓴다.
  실측: 1,159 테스트 3.3초 전부 통과(이전 Vite 방식은 7개 실패).
  ★**앱 테스트도 Vite 를 쓰지 않는다(2026-08-20)**: 같은 함정이 앱 쪽에 하나 남아 있었다 —
  `tests/webBilling.test.ts` 만 `createServer()` + `ssrLoadModule("/src/lib/api/client.ts")` 를 써서
  `fetchModule` 이 60초 한도를 넘겨 **224초 만에 실패**했고, 전체 스위트 시간을 이 한 건이 지배했다
  (1,798개 중 유일한 red). ⚠️ **`node --test` 는 실패가 있어도 종료 코드 0 을 줄 수 있다** —
  이 실패는 종료 코드가 아니라 `ℹ fail 1` 요약 줄로만 드러났다. **exit code 만 보고 통과로 판정하지 말 것.**
  처방은 worker 와 같다: `tests/helpers/appModuleResolve.mjs` 를 **정적 import 첫 줄**에 두고
  `await import("../src/lib/api/client.ts")` 로 동적 로드한다(정적 import 는 링크가 훅 등록보다 이르다).
  앱 소스는 worker 와 달리 세 가지를 더 메워야 한다 — ①`@/` 별칭 ②확장자 없는 상대 import
  ③Vite 가 빌드 시 치환하는 `import.meta.env` 와 `define` 전역 `__APP_VERSION__`(load 훅에서 치환·주입,
  버전은 package.json 에서 읽어 Vite 와 같은 출처를 유지).
  실측: 224,158ms → **47.6ms**(파일 전체 224.8초 → 0.18초), 12/12 통과.
  red-green 확인 = 목 응답의 `code` 를 바꾸면 실패하므로 실제 `client.ts` 경계를 그대로 검증한다.
  ⚠️ `tests/**` 는 `tsconfig.app.json` 의 `include: ["src"]` 밖이라 **`tsc -b` 가 타입 검사하지 않는다** —
  테스트 TS 의 오류는 실행해야만 드러난다. 남은 Vite 사용처는 `tests/localeSessionIsolation.test.mjs` 하나다.
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
  수신·재생은 PWA 공용이다. iPhone 오디오는 사용자 탭 안에서 AudioContext를 먼저 연다. 웹 푸시 권한도 첫
  비동기 작업보다 먼저 사용자 탭에서 요청하고 active Service Worker가 확인된 뒤에만 구독하며, 웹 푸시가 없는
  일반 Safari 탭에는 홈 화면 추가 방법을 안내한다. PWA Service Worker의 `includeAssets`·manifest 아이콘은 Workbox
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
  worker/                        ★백엔드 정본(Cloudflare Worker) — 2026-08-02 hyeni-1 에서 이관
    index.ts · wrangler.toml · tsconfig.json · types.ts
    routes/ · lib/ · cron/ · shared/ · middleware/ · realtime/ · db/(운영 migration SQL) · ops/(운영 런북)
    tests/                       node --test 전용(Vite 미사용) · helpers/tsModuleResolve.mjs 가 TS 확장자 해석
    .env · .dev.vars             gitignore(비밀) · .dev.vars.example 만 커밋
  cloudflare/  schema_d1.sql     ★D1 정본 스키마(+ 이전용 python 스크립트)
  scripts/  port-screens.workflow.js · wire-nav.workflow.js   (재사용 가능한 워크플로우)
            wf-*.workflow.js     ← 과거 1회성 대량 이식 기록(hyeni-1 소스를 읽던 도구, 재실행 불가)
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
  - **오늘경로**: `getHistoryDayWindow`/`getHistoryDayKey`로 오전 8시 시작 경로를 계산한다. 00~07시는 전날 08:00부터 이어지는 경로로 본다. 최신 따라가기의 이력 로딩/빈 trail에서만 현재 위치를 우선할 수 있고, 부모가 과거 시각을 고른 뒤에는 실측 이력점이 없으면 현재 위치로 대체하지 않는다. 이동기록 카드는 명시적 버튼으로 머문 곳 상세만 펼치고 접으며 시간 막대는 항상 남긴다. 오늘경로에서는 상단 아이 배지를 숨기고 시간대별 경로 UI만 남긴다.
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

## 6. 백엔드 — 이 저장소의 `worker/` 가 정본 (2026-08-02 이관 완료)

**Cloudflare Worker·D1 스키마가 이 저장소 안으로 들어왔다. hyeni-1 은 더 이상 필요 없다.**
- API base: `https://hyeni-calendar-api.tkisdroid.workers.dev` (`.env` VITE_API_BASE)
- Worker 소스: `worker/`(routes·lib·cron·shared·db·ops·tests), 설정 `worker/wrangler.toml`
- D1 정본 스키마: `cloudflare/schema_d1.sql`
- 비밀: `worker/.env`(배포 자격·외부 키) · `worker/.dev.vars`(로컬 JWT 키) — 둘 다 gitignore.
  커밋되는 건 `worker/.dev.vars.example` 뿐이다.
- 명령: `npm run test:worker` · `npm run typecheck:worker` · `npm run deploy:worker`
- worker 의존성(`hono`·`jose`·`bcryptjs`·`wrangler`·`@cloudflare/workers-types`)은 루트 `package.json` devDependencies 에 있다.
- CI 는 같은 저장소·같은 커밋에서 앱과 Worker 를 함께 검증한다(`.github/workflows/worker-quality.yml`).
  과거 교차 저장소 변수 `HYENI_WORKER_REPOSITORY`·`HYENI_APP_REPOSITORY`·`HYENI_CROSS_REPO_TOKEN` 은 폐지됐다.

### 3단계 이력 (완료)

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

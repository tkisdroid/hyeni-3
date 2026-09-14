# Google Maps 글로벌 출시 준비 상태

현재 상태는 **Google 지도 공급자 ISO 248개국 활성화, 해외 위치·알림 전체 출시 HOLD**다.
2026-09-01 기준 공식 [Google Maps Platform Coverage Details](https://developers.google.com/maps/coverage)의
지도 타일·지오코딩 지원 범위는 앱이 저장할 수 있는 ISO 3166-1 alpha-2 249개국을 모두 포함한다.
`shared/mapPolicy.ts`의 `GOOGLE_MAP_RELEASE_COUNTRIES`는 이 저장 가능 국가 집합에서 한국(`KR`)만 제외한
248개국이다. 한국은 Kakao를 유지하고, `ZZ`·형식 오류·앱이 저장하지 않는 비표준 지역 코드는 좌표와 측정 시각을
보이는 안전 폴백으로 닫힌다. 전 세계 wildcard는 사용하지 않는다.

이 allowlist는 지도 공급자 선택만 연다. 가족 현지 시간대/DST, Google Routes OAuth 실호출,
비한국 부모 PWA↔아이 Android 실기기 E2E와 새 Android AAB Play 배포가 완료됐다는 의미가 아니다.

## 2026-09-14 Play 검토 신청 지시

- 사용자 지시: 실기기 검증은 별도로 하지 않고 Play 검토 신청까지 진행한다.
- 이번 후보의 실기기 E2E는 **사용자 승인 생략/미검증**이다. 성공 증거로 바꾸지 않는다.
  준비 판정은 `npm run verify:google-maps:release -- --device-e2e-waived`로 이 항목만 분리한다.
- Console 로그인과 현재 전체 트랙 최대 versionCode 확인, 새 release AAB 사용자 서명, 업로드·검토 신청 readback은 여전히 필요하다.
  구 AAB 재사용·서명 비밀번호 자동 읽기·검토 신청을 공개 게시 완료로 표현하는 것은 하지 않는다.
- Android release 스크립트에도 Google 웹 키 필수 gate를 추가했다. 키 없는 해외 지도 AAB 빌드를 차단한다.

## 2026-09-14 남은 항목: 위치·안전 알림 현지화

- 표시 전용 `notificationCopy={v,id,args,occurredAt?,timeZone?,delayed?}`를 구현했다.
  서버가 활성 아이·같은 가족 장소/일정의 정본 이름을 조회하며 공개 요청의 임의 번역 객체는 수용하지 않는다.
  권한·수신자·긴급도·TTL·중복 키·라우트·ACK는 기존 정책을 유지한다. D1 스키마/Secret 변경은 필요하지 않다.
- 등록장소 도착/출발·병합 도착, 일정 도착/지연/미도착, 위험구역 진입/이탈, 위치 끊김/복구·장기 끊김,
  미등록 장소 출발, SOS·저전력·일정 리마인더와 긴급 신호 5분 재확인에 표시 계약을 연결했다.
  한국어 원문 및 구버전/알 수 없는 계약의 원문은 보존한다. 과거 기록을 문장 파싱으로 임의 번역하거나 재작성하지 않는다.
- `locales/notification-messages.json` 한 정본에서 웹/PWA·Android 카탈로그를 생성한다.
  `npm run i18n:verify`는 10개 언어 키/매개변수와 생성물 최신성을 검사한다.
  부모 알림센터·도착/위험/SOS 상세·foreground pending·PWA Service Worker·Android FCM/부모·아이 pending에 반영한다.
  Android는 앱의 선택 언어를 표시 전용 preference로 동기화하며 계정/세션을 건드리지 않는다.
- 원래 이름·주소는 그대로 표시하고 실제 사건 시각은 가족 IANA 시간대와 DST로 표시한다.
  지연 출발은 늦게 확인된 과거 기록임을 별도 표기하며 해외 긴급 안내에 한국 전화번호를 추정해서 넣지 않는다.
- 검증: 앱 2,165개, Worker 1,513개, Android 196개 및 lint 통과. 마지막 배포 결과는 후속 readback에 기록한다.
  SQLite+FCM 전송 fixture에서 표시 계약·수신자·사건 시각·30분 TTL 보존을 함께 검증했다.
- `scripts/qa-notification-localization.mjs`: 390×844 격리 브라우저 알림센터 10개 언어 및 도착·위험 상세 검사.
  `scripts/qa-notification-service-worker.mjs`: 로컬 dist 실제 SW의 번역 표시·stableId/route·타 가족 거부·만료 거부·한국어 보존 통과.
  `qa:pwa-runtime`의 설치·오프라인·업데이트 문제 0건. 모두 로컬 증거이며 실제 FCM/Web Push receipt를 대신하지 않는다.
- 현지화 구현 gate는 해소했다. 기존 설치 Android는 새 버전 배포 전까지 한국어 원문을 표시할 수 있다.
  남은 전체 출시 gate는 CI, 새 Android 서명/Play 배포, Google Routes 최소 OAuth 증거, 비한국 실제 가족·기기 E2E다.
- Google Console은 Orca 브라우저로 다시 열었으나 로그인 화면이다.
  [표준 Routes v2 reference](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes)를 재확인해도
  최소 OAuth 범위의 실호출 증거는 얻지 못했다. Routes Preferred 전용 scope를 표준 Routes에 전용하거나 광범위 권한을 추가하지 않는다.
- GitHub run `34805964154` annotation 재확인: Actions budget 때문에 job이 시작되지 않았다.
  비용/결제 설정은 변경하지 않았다. ADB 0대이며 실제 세션 조작·재페어링·스토어 업로드는 하지 않았다.

## 2026-09-14 출시 구현 및 선행 운영 반영

- 최신 `origin/main bd55190`의 1.4.8 안정화를 현재 지도 브랜치에 병합했다. 248개국 정책은 유지한다.
- 가족 국가와 IANA 시간대를 주 보호자가 함께 확정한다. 일정·위치 이력·보존·도착 판정·메모/리포트 날짜는 가족 시간대다.
  조용한 시간은 부모/아이 수신자별 시간대를 별도로 저장하고 Android에 동일한 버전과 함께 전달한다.
- DST 없는 시각은 전환 간격 뒤, 중복 시각은 첫 발생으로 결정한다. 23/25시간 날짜와 30분 전환·45분 시차를 검증했다.
- native 일정 조회는 인증된 가족의 시간대를 읽고 같은 사용자/가족에만 캐시한다. 실패 시 한국 시각으로 추정하지 않는다.
- 위치 업로드 quota는 서버가 정한 `ingest_date_key`를 원자 DB trigger까지 전달한다. 클라이언트의 날짜 위조는 무시한다.
  400행 업로드는 bind 100개·D1 query 50회 이내이며 동일 fix 재전송은 quota를 추가 소비하지 않는다.
- 운영 D1 `hyeni-calendar`에 `global-family-time-zone.sql` 및 `global-location-ingest-time-zone.sql`을 적용했다.
  readback: 기존 가족 113개·수신자 설정 135개 모두 `Asia/Seoul` 보존, 새 위치 날짜 컬럼 및 quota trigger 확인.
  과거 일정/위치 timestamp·원시 이력은 재작성하거나 삭제하지 않았다.
- 앱 회귀 2,148개, Worker 회귀 1,510개, Android 단위 테스트 192개 통과. 앱/Worker 타입 검사 및 10개 locale 검사 통과.
  Windows 한글 경로의 Gradle 테스트 classpath 문제는 임시 ASCII junction으로 우회했고 원본 작업 경로는 이동하지 않았다.
- 격리 브라우저(390×844, 기기 시간대 Seoul)에서 가족 LA → Nepal 변경, 서버 payload와 readback, 400개 이상 시간대 선택,
  가로 overflow 없음 확인. `scripts/qa-global-time-zone.mjs`는 정적 fixture이며 실제 아이/Google API E2E 증거가 아니다.
- 운영 필수 Secret 이름 8개 및 지도 전용 두 Secret 존재를 확인했다. 값은 읽거나 변경하지 않았다.
- Google Console은 직접 브라우저로 열었으나 Google 로그인 화면이다. 표준 Routes v2의 격리 최소 OAuth 권한 실호출은
  아직 입증하지 못했으므로 길찾기 stub/게이트를 강제로 열지 않는다.
- 공개 운영 웹 키와 허용된 브랜드 origin의 격리 문서에서 실제 Google SDK/뉴욕 Central Park 타일을 로드했다.
  인증 오류·지도 오류 overlay 없음. `scripts/qa-google-maps-web-canary.mjs`는 실제 Google 웹 SDK 증거지만 가족 위치/검색/푸시 E2E는 아니다.
- 선행 반영 당시에는 서버 알림 원문 현지화가 미완성이었다. 위 후속 구현에서 새 위치·안전 알림의 표시 계약을 연결했다.
- 남은 출시 gate: Google Routes 최소 권한 실호출, 신규 Android AAB 서명/배포, 비한국 부모 PWA↔아이 Android 실제 위치·푸시 ACK.
  자동검사 성공이나 운영 스키마 반영을 해외 전체 출시 GO로 해석하지 않는다.

## 2026-09-14 운영 배포 readback

- 기능 source commit: `9b8758d`. Worker version `81163732-fa83-4c68-8296-433708c626ef`가 100% 활성이다.
- Pages deployment: https://416e5b1b.hyeni-calendar.pages.dev .
  배포별 URL·고정 Pages·브랜드 apex·www가 모두 HTTP 200과 `assets/index-Pda_Im53.js`를 반환한다.
  실제 entry의 SHA-256은 `199a05e067826411a1a8975d2cd49c8befbbcf4a8905b1867a12d91bf7d40b42`이며 로컬 빌드와 일치한다.
- 기존 운영 공개 Kakao/Google 브라우저 키 두 값을 프로세스 환경으로만 주입해 빌드했다. 값은 파일·로그에 저장하지 않았다.
  후속 CI가 Google 키 없이 빌드하지 않도록 두 job의 환경/필수 gate를 추가하고 GitHub 공개 Actions variable
  `VITE_GOOGLE_MAPS_WEB_KEY`를 기존 공개 운영 값으로 설정·동일성 readback했다. 비공개 Secret은 변경하지 않았다.
- Worker health는 HTTP 200·ready·no-store, access-region은 HTTP 200·KR·private/no-store,
  인증 없는 POST maps/search는 HTTP 401·unauthorized다. GET search의 404는 POST 전용 route이므로 정상이다.
- 운영 D1 재확인은 모두 rows_written=0. 가족 113/113 및 수신자 설정 135/135의 기존 서울 시간대가 보존됐다.
  새 quota 컬럼/trigger는 존재하나 배포 직후 10분 이내 새 계약으로 들어온 위치 행은 0개였다.
  따라서 실사용 위치 업로드 성공이나 해외 위치 수집을 입증한 것으로 기록하지 않는다.
- ADB 연결 기기는 0대다. 새 AAB 서명·설치·Play 업로드 및 실제 알림 수신 ACK는 수행하지 않았다.
- 최종 자동 준비 검사는 14/14 통과, 전체 출시 명령은 위 기능 gate 및 CI gate 때문에 의도대로 HOLD/exit 1이다.

## 2026-09-14 최종 보완 검증

- 최종 실행 source는 `4d5b756`이다. 보안 패치 포함 Worker `fa1e483b-4fb1-4f37-a7ec-c0e15cea6931`을 배포했다.
  Pages 최종 배포는 https://1d3d765d.hyeni-calendar.pages.dev 이며, 새 배포/브랜드/www/고정 Pages 모두 위 entry 해시와 일치한다.
  Worker health 200·ready·no-store 및 무인증 POST maps/search 401을 다시 확인했다.

- GitHub Actions는 `9a87f18`의 앱 run `34805505934` 및 Worker run `34805506032` 모두
  작업 시작 전 Actions budget 제한으로 차단됐다. 테스트 실패가 아니며 CI 통과 증거로 대체할 수 없다.
  예산/결제 설정은 변경하지 않았다.
- Android `lintDebug` 통과. 최종 의존성 감사에서 발견한 호환 가능한 패치를 lockfile에 반영하고,
  Hono는 보안 패치 `4.13.7`로 정확히 고정했다. `npm audit`는 취약점 0건이다.
  Google SDK 두 개의 고정 버전과 Capacitor 시스템바 패치는 유지한다.
- 의존성 패치 후 앱 2,149/2,149 및 Worker 1,510/1,510 재검증, 앱/Worker 타입 검사, 10개 locale 검사,
  운영 브라우저 키 보존 빌드가 통과했다. 웹 entry와 SHA-256은 위 검증본과 동일하다.
- 패치 근거: [Hono 4.13.7](https://github.com/honojs/hono/releases/tag/v4.13.7),
  [sharp 보안 공지](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
- 최종 출시 gate에 CI 실행 증거를 포함한다. 로컬 회귀 통과·웹/Worker 운영 반영과 Play 공개 출시는 분리한다.

## 2026-09-01 운영 반영 증거

- Google Cloud 프로젝트 `hyeni-496213`에서 Maps JavaScript API, Maps SDK for Android,
  Places API (New), Geocoding API, Routes API를 사용 설정했다. Routes는 API만 준비했으며
  `routesOauthVerified:false` 게이트를 유지한다.
- 지도 전용 서비스 계정 `hyeni-maps-worker@hyeni-496213.iam.gserviceaccount.com`을 만들고
  `서비스 사용량 소비자` 역할만 부여했다. 새 JSON 키는 Worker Secret으로 직접 전달한 뒤 로컬 다운로드 파일을
  삭제했으며 기존 Google Play 서비스 계정은 재사용하지 않았다.
- 웹 키 `hyeni-web-maps-production`은 Maps JavaScript API 한 개와
  `https://hyenicalendar.com/*`, `https://www.hyenicalendar.com/*`,
  `https://hyeni-calendar.pages.dev/*` HTTP referrer만 허용한다.
- Android 키 `hyeni-android-maps-production`은 Maps SDK for Android 한 개와 package
  `com.hyeni.calendar`, Play Console에서 직접 읽은 App Signing SHA-1
  `C6:F5:DC:30:DA:77:A8:BC:2C:B0:F7:0C:5C:55:D3:8F:F1:E6:8F:17`만 허용한다.
- Cloudflare Secret inventory에서 `GOOGLE_MAPS_SERVICE_ACCOUNT_JSON`과
  `MAPS_SESSION_HMAC_SECRET` 이름을 값 없이 readback했다. D1 migration은 앞선 배포에서 적용·readback된 상태다.
- Worker version `ddfd0411-85cb-4444-8e7b-287a63412b18`, Pages
  `https://d317868a.hyeni-calendar.pages.dev`를 배포했다. 배포별·고정·브랜드 도메인은 모두
  `assets/index-BLmkW66k.js`를 반환하며 로컬 SHA-256은
  `8D939175A4724C3160F2B0C3843F94ED7F03964B118A409132D7AA2E2BCEAA94`다.
  Worker `/api/health`는 200·`ready`·`no-store`다.
- Play Console은 App Signing 인증서 조회만 했고 출시 트랙·계정·실기기 세션은 변경하지 않았다.

## 2026-09-01 중간 9개국 allowlist 운영 배포 증거

- 기능 커밋 `7b8cf8c07078106f43655b086b39801b3447024e`에서
  `JP/TW/HK/SG/VN/TH/ID/MY/PH` exact 목록을 앱·Worker 공유 정책에 활성화하고 원격 브랜치 해시 일치를 확인했다.
- 앱 전체 2,121/2,121, Worker 전체 1,485/1,485, 지도·국가 집중 회귀 58/58, quota 반복 12/12,
  앱·Worker typecheck와 10개 locale 검증이 통과했다.
- Worker version `947fa00d-eb1f-4c57-9eb0-cf06884eeccc`를 운영 배포했다. `/api/health`는
  200·`ready`·`no-store`, `/api/access-region`은 200·`KR`·`private, no-store`, 무인증 `/api/maps/search`는
  upstream 전에 401로 닫혔다.
- 운영 D1은 읽기만 수행했다. 비한국 기존 가족, autocomplete session, quota 행은 각각 0이고 모든 query의
  `rows_written=0`이었다. 가족 국가·계정·역할·세션·페어링·refresh token은 변경하지 않았다.
- Pages는 국가 정책을 번들에 중복하지 않고 Worker의 정본 `mapPolicy`를 소비하므로 재배포하지 않았다.
  브랜드 apex·`www`·Pages 도메인은 모두 기존 키 포함 `assets/index-BLmkW66k.js`와 Google lazy chunk를 200으로
  제공한다. 로컬 production build도 같은 main asset·SHA-256
  `8D939175A4724C3160F2B0C3843F94ED7F03964B118A409132D7AA2E2BCEAA94`를 재현했다.
- `verify:google-maps:readiness`는 `READY_FOR_EXTERNAL_VALIDATION`이다. `verify:google-maps:release`는
  시간대/DST·Routes OAuth 실호출·비한국 실제 가족/기기 E2E가 남아 `HOLD`다. 새 Android AAB 생성·서명·Play
  업로드는 수행하지 않았다.

## 2026-09-01 ISO 248개국 운영 배포 증거

- 기능 커밋 `1b4b0ec0f9fda4fa0f3c0fafe302ec5b4af17990`에서 공식 Google Maps 핵심 커버리지와
  저장 가능 ISO 249개국을 대조해 `KR`만 제외한 248개국을 Google 공급자로 활성화했다. `CN`도 Google이며,
  `ZZ`·형식 오류·비표준 코드는 외부 호출 없이 미지원으로 닫힌다. 앱·Worker는 `shared/serviceCountries.ts`의
  동일 국가 정본을 사용한다.
- 원격 브랜치 해시가 기능 커밋과 일치한다. 앱 전체 2,121/2,121, Worker 전체 1,486/1,486,
  지도·국가 집중 회귀 59/59, 앱·Worker typecheck, 10개 locale 검증과 production build가 통과했다.
  정적 준비 검사 9/9는 `READY_FOR_EXTERNAL_VALIDATION`, 전체 출시 검사는 기존 외부 게이트 때문에 `HOLD`다.
- Worker version `c30ca733-6ff6-4bf3-8d20-16baf72d296f`를 운영 배포했다. `/api/health`는
  200·`ready`·`no-store`, `/api/access-region`은 200·`KR`·`private, no-store`, 정식 무인증
  `/api/maps/search`는 upstream 전에 401로 닫혔다. 배포 목록에서 같은 version을 readback했다.
- 운영 D1은 집계 SELECT만 수행했다. 비한국 기존 가족, autocomplete session, quota 행은 각각 0이고
  `rows_written=0`이다. migration·가족 국가·계정·역할·세션·페어링·refresh token은 변경하지 않았다.
- 이번 변경의 공급자 판정은 Worker 응답의 `mapPolicy`이므로 Pages를 다시 배포하지 않았다. 기존 운영 Pages의
  제한된 Google 웹 키와 lazy Google 지도 chunk를 그대로 사용한다. Android AAB 생성·서명·Play 업로드도 수행하지 않았다.

## 자격 증명 없이 확인할 수 있는 게이트

```powershell
npm run verify:google-maps:readiness
```

이 명령은 키 값을 읽거나 출력하지 않는다. SDK 버전 고정, D1 migration, Android manifest placeholder,
release fail-closed, CSP와 정확한 ISO 248개국 집합 및 `KR/ZZ/비표준 지역 코드` 제외를 확인한다.
`READY_FOR_EXTERNAL_VALIDATION`은 지도 공급자 정적 준비 상태이며 해외 위치·알림 전체 출시 승인이 아니다.

## 운영자가 제공해야 하는 출시 증거

- Web Maps 키: HTTP referrer를 운영 도메인으로 제한하고 Maps JavaScript API만 허용한다.
- Android Maps 키: package `com.hyeni.calendar`와 실제 Play 앱 서명 SHA-1로 제한한다. 키는
  `MAPS_API_KEY` Gradle property로만 주입하고 저장소·로그·채팅에 남기지 않는다.
- 서버 OAuth 서비스 계정: Places API(New), Geocoding API, Routes API만 허용하고 Worker secret으로
  대화형 입력한다. scope와 field mask를 Google Cloud 실제 요청 로그로 확인한다.
- 운영 D1에 `global-family-country.sql`과 `maps-request-control.sql`을 Worker보다 먼저 적용하고 readback한다.
- 승인 후보 국가마다 IANA time zone, DST 경계, 날짜 전환, 지오코딩 언어·region bias, 장소 알림 사건 시각을 검증한다.
- 부모 PWA와 아이 Android 조합에서 현재 위치, 이력, 장소 선택, 주소 검색, 역지오코딩, 길찾기, 도착·출발 알림을
  실제 비한국 테스트 가족으로 확인한다. 실사용 가족의 역할·세션·refresh token은 건드리지 않는다.
- Google Routes v2의 서비스 계정 OAuth scope를 공식 문서와 실제 호출로 입증하기 전에는 Google 길찾기 경로를 열지 않는다.

해외 위치·알림 전체 출시를 승인하려면 다음 명령이 통과해야 한다.

```powershell
npm run verify:google-maps:release
```

현재 이 명령은 시간대/DST, Routes OAuth scope 실호출 증거, 비한국 실제 가족·기기 E2E가 남아 있으므로
의도적으로 exit 1/HOLD다. Google Cloud 자격 증명·Worker Secret·D1 반영은 위 운영 증거로 완료했으며,
Play 출시 트랙과 Android AAB는 별도 경계로 유지한다.

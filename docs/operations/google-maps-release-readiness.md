# Google Maps 글로벌 출시 준비 상태

현재 상태는 **Google 지도 공급자 9개국 활성화, 해외 위치·알림 전체 출시 HOLD**다.
`shared/mapPolicy.ts`의 `GOOGLE_MAP_RELEASE_COUNTRIES`에는 `JP`, `TW`, `HK`, `SG`, `VN`, `TH`, `ID`,
`MY`, `PH`만 명시돼 있다. 이 국가의 가족은 Google 지도 렌더링·장소 검색·역지오코딩 경로를 사용하고,
한국은 Kakao를 유지한다. 중국(`CN`)·국가 미확정(`ZZ`)·목록 밖 국가는 좌표와 측정 시각을 보이는
안전 폴백으로 닫힌다. 전 세계 wildcard는 사용하지 않는다.

이 allowlist는 지도 공급자 선택만 연다. 가족 현지 시간대/DST, Google Routes OAuth 실호출,
비한국 부모 PWA↔아이 Android 실기기 E2E와 새 Android AAB Play 배포가 완료됐다는 의미가 아니다.

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

## 자격 증명 없이 확인할 수 있는 게이트

```powershell
npm run verify:google-maps:readiness
```

이 명령은 키 값을 읽거나 출력하지 않는다. SDK 버전 고정, D1 migration, Android manifest placeholder,
release fail-closed, CSP와 정확한 9개국 allowlist 및 `KR/CN/ZZ` 제외를 확인한다.
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

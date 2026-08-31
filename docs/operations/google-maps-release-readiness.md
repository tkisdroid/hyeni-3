# Google Maps 글로벌 출시 준비 상태

현재 상태는 **로컬 구현 완료, 비한국 국가 출시 HOLD**다. `shared/mapPolicy.ts`의
`GOOGLE_MAP_RELEASE_COUNTRIES`는 의도적으로 비어 있어 한국은 Kakao, 중국·국가 미확정·그 밖의 국가는
좌표와 측정 시각을 보이는 안전 폴백으로 닫힌다.

## 자격 증명 없이 확인할 수 있는 게이트

```powershell
npm run verify:google-maps:readiness
```

이 명령은 키 값을 읽거나 출력하지 않는다. SDK 버전 고정, D1 migration, Android manifest placeholder,
release fail-closed, CSP와 빈 운영 allowlist만 확인한다. `READY_FOR_CREDENTIAL_INPUT`은 출시 승인이 아니다.

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
- Google Routes v2의 서비스 계정 OAuth scope를 공식 문서와 실제 호출로 입증하기 전에는 Google 국가를 열지 않는다.

모든 증거를 확보한 뒤에만 `GOOGLE_MAP_RELEASE_COUNTRIES`에 국가를 한 개씩 추가하고 다음 명령이 통과해야 한다.

```powershell
npm run verify:google-maps:release
```

현재 이 명령은 외부 게이트가 남아 있으므로 의도적으로 exit 1/HOLD다. Pages·Worker·Play 배포와 운영 Secret 변경은
이 문서의 로컬 구현 범위에 포함되지 않는다.

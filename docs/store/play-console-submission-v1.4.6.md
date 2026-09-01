# Google Play Console Google Maps 출시 패키지 — 혜니캘린더 v1.4.6

기준일: 2026-09-01

패키지: `com.hyeni.calendar`

버전: `versionName 1.4.6` / `versionCode 18`

현재 판정: **production 1.4.6 (18)와 해외 9개 언어 등록정보 제출 완료 — Google Play 검토 중, 게시 전**

## 출시 범위

- 한국은 기존 Kakao 지도를 유지한다.
- `JP`, `TW`, `HK`, `SG`, `VN`, `TH`, `ID`, `MY`, `PH`에서 Google 지도 렌더링·장소 검색·
  역지오코딩 공급자를 사용할 수 있도록 앱과 Worker의 exact allowlist를 반영했다.
- 중국(`CN`)·국가 미확정(`ZZ`)·allowlist 밖 국가는 좌표와 측정 시각을 표시하는 안전 폴백으로 닫고,
  전 세계 wildcard는 사용하지 않는다.
- 영어(미국), 일본어, 중국어 간체·번체, 베트남어, 태국어, 인도네시아어, 말레이어(말레이시아),
  필리핀어의 앱 이름·짧은 설명·전체 설명과 출시 노트를 Google Play에 등록했다.
- 원어민 검수 승인은 사용자에게 받았지만 외부 검수자의 별도 납품 증거는 없으므로 저장소의
  `reviewStatus`는 `draft`를 유지한다. Play Console에는 작성된 번역문을 제출했다.

## Play 제출 증거

- clean source commit `1005be8818817f86f8722669531857335d87ce7d`에서 만든 AAB를 Play Console에
  업로드했고 Console이 `18 (1.4.6)`·min API 24·target SDK 36으로 읽었다.
- 출시 이름은 `혜니캘린더 1.4.6 (18)`이며 `docs/store/play-release-notes-v1.4.6.md`의 10개 locale
  출시 노트를 입력했다. Console readback은 `10개 중 10개의 언어로 출시 노트 제공됨`이었다.
- 게시 개요에서 production 전체 출시와 해외 9개 기본 스토어 등록정보, 합계 10개 변경사항을 확인한 뒤
  `검토를 위해 변경사항 전송`을 확정했다. fresh readback은 `검토 중인 변경사항`과
  production `혜니캘린더 1.4.6 (18) 검토 중`이다.
- 관리형 게시는 사용 중지 상태다. 검토 통과 후 자동 게시될 수 있으므로 현재 상태를 실제 공개·게시 완료로
  간주하지 않는다.
- 비차단 경고는 3건이다. Google Maps의 OpenGL ES 요구사항을 지원하지 않는 `CHAINWAY C66` 1종이
  제외되며 설치 사용자 영향은 0명이다. 나머지 2건은 R8 가독화 파일과 네이티브 디버그 심볼 권고다.

## 국가/지역 배포 경계

- Play production 국가/지역 fresh readback은 **대한민국 1개만 타겟팅됨**이다.
- 이번 제출은 모든 기존 대상 국가에 100% 출시하도록 저장됐으므로 현재는 대한민국에만 적용된다.
- 해외 9개 언어 스토어 등록정보는 검토에 함께 제출했지만, 해외 국가/지역 배포 대상은 추가하지 않았다.
- 해외 배포는 `BLOCKED_BY_TIMEZONE_GATE`, `BLOCKED_BY_GOOGLE_ROUTES_OAUTH_SCOPE_PROOF`,
  `BLOCKED_BY_LIVE_NON_KR_DEVICE_E2E` 세 게이트가 남아 있다. 이 검증 없이 국가 범위를 넓히지 않는다.

## 서명 AAB 증거

- clean source: `1005be8818817f86f8722669531857335d87ce7d`
- 파일:
  `artifacts/release-evidence/play-upload-v1.4.6-vc18-1005be8/hyeni-calendar-v1.4.6-vc18-1005be8.aab`
- 크기: `13,422,613 bytes`
- SHA-256: `8a4a4555bf4066641ffe0a372b60a897ed6ae48c67e3acaf5113316d21871b12`
- 승인 upload certificate SHA-256:
  `32f729e8cc1df82d94eacd0d264439fcd7102b15fcdc269660254a87f25a81db`
- package/version: `com.hyeni.calendar` / `1.4.6` / `18`
- non-debuggable, 서명·certificate·웹 자산·16KiB ELF 검증 모두 GREEN
- 증거 디렉터리:
  `artifacts/release-evidence/play-upload-v1.4.6-vc18-1005be8/`

## Google Maps 운영 경계

- Google Cloud 프로젝트 `hyeni-496213`에서 Maps JavaScript API, Maps SDK for Android,
  Places API (New), Geocoding API, Routes API 활성화를 확인했다.
- 웹 키는 Maps JavaScript API와 운영 3개 referrer, Android 키는 Maps SDK for Android와
  `com.hyeni.calendar`·Play App Signing SHA-1로 제한했다. 키 값은 읽거나 기록하지 않았다.
- Worker version `947fa00d-eb1f-4c57-9eb0-cf06884eeccc`가 9개국 exact allowlist를 운영에 반영했다.
  `/api/health`는 200·`ready`·`no-store`, 무인증 `/api/maps/search`는 upstream 전에 401로 닫혔다.
- Pages 배포 `https://d317868a.hyeni-calendar.pages.dev`와 고정·브랜드 도메인은 같은 지도 번들을 반환한다.
- `verify:google-maps:readiness`는 `READY_FOR_EXTERNAL_VALIDATION`,
  `verify:google-maps:release`는 위 세 글로벌 검증 게이트 때문에 의도적으로 `HOLD`다.

## 검증

- [x] 앱 2,122/2,122, Worker 1,485/1,485, 앱·Worker typecheck, production build 통과
- [x] 10개 locale i18n·Play listing 검증, 지도/출시 집중 회귀 33/33 통과
- [x] Android `testDebugUnitTest`·`lintDebug`·`assembleDebug` 통과
- [x] clean source commit에서 승인 upload certificate 서명 AAB 생성·검증
- [x] Play production code 18 업로드와 10개 변경사항 검토 요청 후 fresh status readback
- [ ] 해외 시간대/DST·Routes OAuth scope 실호출·비한국 부모 PWA↔아이 Android E2E
- [ ] Play 국가/지역을 해외 9개국으로 확대
- [ ] Google Play 검토 통과와 실제 production 게시 확인

## 출시 노트

Play Console에는 `docs/store/play-release-notes-v1.4.6.md`의 text 코드 블록을 사용했다.

# Google Play Console 업데이트 패키지 — 혜니캘린더 v1.4.2

기준일: 2026-08-25

패키지: `com.hyeni.calendar`

버전: `versionName 1.4.2` / `versionCode 14`

현재 판정: **Play production code 14 심사 제출 완료**

이 문서는 기존 혜니 캐릭터의 짧은 입체 도약 변경을 Google Play에 전달한 v1.4.2 업데이트 기록의 정본이다.
비밀번호·서비스 계정 키·refresh token은 기록하지 않는다.

## 변경 내용

- 기존 투명 WebP 18종 캐릭터와 상황별 표정은 그대로 유지한다.
- 아이 홈에서 혜니가 자리를 옮길 때 1.5초 perspective 도약·squash/stretch·부드러운 착지를 보여 준다.
- 발밑 그림자는 도약 높이에 맞춰 작아지고 접지할 때 퍼져 입체감을 보강한다.
- 드래그·탭/길게 누르기·대화·일정 안내·SOS 비겹침·움직임 줄이기 계약은 유지한다.
- GLB·Three.js·Blender·신규 생성 이미지는 포함하지 않는다.

## 앱·백엔드·웹 배포 증거

- clean source commit: `01a29f655ce3ed214736191a2b140b5dd06ef545`
- 앱 전체 `1,938/1,938`, Worker 전체 `1,298/1,298`, 앱·Worker typecheck, production build를 통과했다.
- Android `testDebugUnitTest lintDebug assembleDebug`가 통과했다. debug APK는 15,790,760 bytes, SHA-256
  `49D376C1845E8FD42098525133C9BCC0669D4B0B4464097ED940D1F01F3774DE`다.
- D1은 신규 migration이 없으므로 어떤 migration도 실행하지 않는다. production 읽기 query는 schema object 337개,
  `changes=0`, `changed_db=false`, `rows_written=0`을 반환했다.
- Worker는 version `712b272d-9244-4b88-a69d-203304769881`로 재배포했고 트래픽 100%, `/api/health` 200,
  `/api/ai/child-chat` 무인증 POST 401을 확인했다.
- Pages 배포는 `https://df801cb5.hyeni-calendar.pages.dev`다. 배포별 주소·고정 Pages·브랜드 도메인은 모두
  `assets/index-B0BfJjDD.js` 348,020 bytes, SHA-256
  `FD7A57B853F483EFA5E798CFE1E6FB10C56E3782F673B50F38CF78E62A0B3016`과
  `assets/AiBuddyFab-DJMgTUN4.css` 7,625 bytes, SHA-256
  `1D2A9863EEE10154AFD623991D0EA15113E203EEBC48041B684E7DE7B5653C75`를 동일하게 반환했다. 세 주소의
  `/oauth/callback` 200·동일 entry와 CSP도 확인했다.
- razr `ZY22H9VTQD` 사용자 0에 보존 설치해 `versionName 1.4.2` / `versionCode 14`,
  `firstInstallTime=2026-08-17 01:03:15` 유지와 `lastUpdateTime=2026-08-25 08:29:48` 갱신을 확인했다.
  설치 뒤 기기 연결이 끊겨 CDP 역할 재확인은 수행하지 않았으며 로그아웃·역할 전환·재페어링·refresh token 조작은 없었다.

## 서명 AAB

- 파일: `artifacts/release-evidence/play-submit-v1.4.2-vc14-20260825/hyeni-calendar-v1.4.2-vc14-01a29f6.aab`
- 크기: 13,013,338 bytes
- SHA-256: `8d2388eb38e29640a6f05dec1db6a6db86fc32c71b756a1edcb1301ca08b2607`
- mtime: `2026-08-25T00:51:50.196Z`
- manifest는 1.4.2/code 14, package `com.hyeni.calendar`, non-debuggable, source commit `01a29f6`과 일치한다.
- 승인된 Play upload certificate SHA-256
  `32f729e8cc1df82d94eacd0d264439fcd7102b15fcdc269660254a87f25a81db`와 서명 인증서가 일치한다.
- jarsigner, 정확한 권한 정책, dist/내장 web assets, 안전한 archive 경로, bundle/universal APK와 4개 ELF의
  16KiB 조건이 모두 통과했다.

## Play 제출·사후 확인

- 제출 직전 code 13은 `RELEASE_LIFECYCLE_STATE_IN_REVIEW`, code 6은
  `RELEASE_LIFECYCLE_STATE_PUBLISHED`, 최대 versionCode는 13이었다.
- 2026-08-25 09:54 KST에 위 AAB를 production `혜니캘린더 1.4.2 (14)` / `completed`로 업로드하고
  edit validate 뒤 `CANCEL_IN_REVIEW_AND_SUBMIT`으로 커밋했다.
- Google Play 생명주기 전파 중 첫 readback은 code 14 `NOT_SENT_FOR_REVIEW`와 code 13 `IN_REVIEW`가 잠시 함께
  보였지만 추가 write 없이 fresh readback을 수행했다.
- 2026-08-25 09:55:21 KST 최종 readback에서 code 14는 `RELEASE_LIFECYCLE_STATE_IN_REVIEW`, code 13은 제거,
  code 6은 `RELEASE_LIFECYCLE_STATE_PUBLISHED`다. production 트랙은 code 14 하나와 정확한 출시 노트를 반환한다.
- 기존 `ko-KR` listing hash는
  `d0c0824da0c55530dbd681af08765e69d8b34aa6f04d24aec074558f3c4b9dc9`, icon·feature graphic·
  phone screenshots 10개 hash는
  `651ef7874b929ad9062517a7a5c1605a98da8b9d04107b02f3aab4f85bdfede1`로 제출 전후 동일하다.
  등록정보·이미지 write API는 호출하지 않았다.

## 현재 운영 경계

- code 14가 Play에서 `PUBLISHED`되기 전에는 `public/app-version.json`의 minimum/latest를 1.4.0으로 유지한다.
- Google 검토·게시 시각은 Play가 결정한다. 현재 사용자에게 제공되는 공개 버전은 code 6이다.
- D1 migration·운영 사용자 데이터·구독·계정·역할·페어링·세션은 변경하지 않았다.

## 출시 노트

Play Console에는 `docs/store/play-release-notes-v1.4.2.md`의 text 코드 블록을 그대로 사용한다.

## 완료 조건

- [x] 앱·Worker 전체 테스트, typecheck, production build 통과
- [x] D1 변경 SQL 없음과 production 읽기 query `changes=0` 확인
- [x] Worker 새 version ID와 health 200 readback
- [x] Pages 세 도메인 동일 entry/CSS hash와 OAuth callback 확인
- [x] razr 사용자 0에 code 14 debug APK 보존 설치
- [x] clean source commit에서 승인 upload certificate signed AAB 생성
- [x] AAB version/source/certificate/권한/web assets/16KiB 증거 확인
- [x] Android Publisher API validate·commit 후 code 14 심사 전송과 fresh lifecycle readback
- [x] 기존 listing/image hash가 제출 전후 동일함을 확인

## 실기기 보호

razr `ZY22H9VTQD`에는 `npm run android:install:debug -- ZY22H9VTQD`로 사용자 0에만 보존 설치한다. 로그아웃·
역할 전환·재페어링을 하지 않고 refresh token을 읽거나 회전하지 않는다.

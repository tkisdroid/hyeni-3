# Google Play Console 정책 수정 패키지 — 혜니캘린더 v1.4.4

기준일: 2026-08-27

패키지: `com.hyeni.calendar`

버전: `versionName 1.4.4` / `versionCode 16`

현재 판정: **코드 수정·검증 및 서명 AAB 생성·검증 완료, Play 교체 전**

## Play 확인 필요 문제

Play Console은 Android 15 이상에서 `BOOT_COMPLETED` 수신 뒤 제한된 foreground service 유형을 시작하는
경로가 있다며 `com.hyeni.calendar.AmbientListenService.onStartCommand`를 지목했다. Manifest의
`AmbientListenService`는 `microphone`, `LocationService`는 `location` 유형이다.

직접 경로는 `BootReceiver → LocationService`뿐이었지만, 부팅으로 복구된 `LocationService`가 서버 pending의
`remote_listen_stop`을 처리할 때 `startService(Intent(AmbientListenService))`를 호출했다. 이 Intent는 실행 중인
캡처를 중지하려는 목적이었으나, Play 정적 분석에서는 부팅 경로가 제한된 microphone FGS 컴포넌트를 시작할 수 있는
호출 그래프로 보였다.

## 수정 내용

- `LocationService`, FCM 수신부, Capacitor plugin, 세션 종료 경로는 더 이상 중지 목적으로
  `AmbientListenService`를 시작하지 않는다.
- `RemoteListenActiveSession`이 현재 프로세스에서 실제 실행 중인 캡처 인스턴스와
  `requestId`·`targetUserId`·`sessionNonce`를 원자적으로 묶는다. 정확히 일치한 중지만 해당 인스턴스의 main
  handler로 직접 전달하며, 실행 중인 캡처가 없으면 새 서비스를 만들지 않는다.
- microphone FGS의 유일한 시작 경로는 기존처럼 화면에 표시된 `RemoteListenActivity`가 서버 승인 증표를 확인하고
  1회 소비한 뒤 호출하는 경로다. 60초 상한·아이 화면/지속 알림·감사 기록·대상/세션 검증은 유지한다.
- `BootReceiver`의 위치 공유 복구와 `LocationService`의 `location` FGS 선언은 유지한다. 이번 문제를 피하려고
  부팅 뒤 위치 안전 기능까지 제거하지 않는다.

## 검증 증거

- TDD RED에서 `LocationService.stopAmbientListenFromPending`의 `new Intent(...AmbientListenService)`와
  `startService` 호출을 재현했고 수정 뒤 GREEN으로 전환했다.
- 원격청취·Play manifest 집중 회귀 `42/42`, 앱 전체 `2,002/2,002`, 앱 typecheck와 production build가 통과했다.
- Android unit `185/185`, `lintDebug`, `assembleDebug`가 통과했다.
- debug APK: 15,847,334 bytes, SHA-256
  `7E5D8BE645632C29C74AD9C1989E668CD42925FECE344CCBAA5FF04772C1304E`.
- 정적 검색에서 `AmbientListenService` Intent 생성은 사용자에게 보이는 `RemoteListenActivity` 시작과 실행 중 알림의
  중지 `PendingIntent` 두 곳만 남고, 부팅으로 복구되는 `LocationService`에는 남지 않았다.
- 사용자가 UTF-8 PowerShell 7 창에서 서명 비밀번호를 직접 입력했고 자격 값은 읽거나 저장·출력하지 않았다. clean
  source commit `eda3907d96e0046804c2d39eb4c2c310f4b1dfeb`에서 만든 업로드 파일은
  `artifacts/release-evidence/play-upload-v1.4.4-vc16-eda3907/hyeni-calendar-v1.4.4-vc16-eda3907.aab`,
  13,060,516 bytes, SHA-256
  `45e66db8d6a60cae1a9a4c33105f285c85886d92b4aea588425d0010a5343a91`이다.
- schema v4 증거 `artifacts/release-evidence/android-release-aab-evidence-20260827-135437-eda3907.json`에서
  manifest 1.4.4/code 16·non-debuggable·source commit, 승인 업로드 인증서, dist/내장 web assets,
  bundle/universal APK와 모든 ELF의 16KiB 조건이 모두 GREEN이다.

## edge-to-edge 권장 조치 판정

Play의 “일부 사용자에게는 더 넓은 화면이 표시되지 않을 수 있습니다”는 제출 차단 오류가 아니라 Android 15의
edge-to-edge 강제 전환에 맞춰 인셋과 실기기 화면을 확인하라는 권고다.

- 이 AAB는 target SDK 36이므로 Android 15+에서 edge-to-edge가 이미 강제된다. Android 16 target 앱은 opt-out도
  사용할 수 없다.
- 웹 문서는 `viewport-fit=cover`를 선언하고, Capacitor 8.4.1 `SystemBars`가 system bar·display cutout·IME 인셋을
  WebView에 적용한다. 앱의 sticky/fixed header와 하단 dock·CTA도 `safe-area-inset-top/bottom`을 사용한다.
- 따라서 Android 15+에서 기능을 켜기 위해 `EdgeToEdge.enable()`을 추가할 필요는 없다. 이를 무조건 호출하면 구형
  Android까지 edge-to-edge로 바뀌므로 해당 버전들의 인셋 동작을 함께 검증하지 않은 채 추가하지 않는다.
- 남은 권장 검증은 Android 15/16 실기기에서 세로·가로, display cutout, 키보드, 제스처·3버튼 내비게이션을 각각
  확인하는 것이다. 현재 연결 기기가 없어 이번 검증을 완료로 표시하지 않는다.

## 출시 경계

- v1.4.3/code 15는 2026-08-27 03:10 KST에 이미 production 심사 제출되어 `IN_REVIEW`다. 같은 versionCode를
  재사용할 수 없어 정책 수정본은 v1.4.4/code 16으로 올린다.
- 서명 AAB는 최종 clean source commit에서 사용자가 서명 비밀번호를 직접 입력해 새로 만들었으며 기존 code 15 AAB를
  재사용하지 않았다.
- AAB 생성·manifest/source/certificate/16KiB 검증은 끝났지만 Play production 교체·fresh readback 전에는 제출 완료로
  표시하지 않는다.
- Worker·D1·Pages·운영 계정·역할·페어링·세션·refresh token은 변경하지 않는다.

## 완료 조건

- [x] 부팅 연계 microphone service start 호출 제거
- [x] 세션 일치·중복 중지 Java 단위 회귀와 소스 계약 회귀 추가
- [x] 앱 전체 테스트·typecheck·production build 통과
- [x] Android unit·lint·debug APK 통과
- [ ] 허용 실기기 사용자 0 보존 설치와 버전 확인
- [x] clean source commit에서 승인 upload certificate 서명 AAB 생성·검증
- [ ] Play production code 16 교체 제출·fresh lifecycle readback

## 출시 노트

Play Console에는 `docs/store/play-release-notes-v1.4.4.md`의 text 코드 블록을 그대로 사용한다.

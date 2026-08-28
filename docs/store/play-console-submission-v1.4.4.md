# Google Play Console 정책 수정 패키지 — 혜니캘린더 v1.4.4

기준일: 2026-08-28

패키지: `com.hyeni.calendar`

버전: `versionName 1.4.4` / `versionCode 16`

현재 판정: **이전 후보 폐기, 최종 커밋에서 새 서명 AAB 생성 필요**

## 후보 교체 사유

- 2026-08-27에 만든 `eda3907d96e0046804c2d39eb4c2c310f4b1dfeb` 후보는 Android 15
  microphone FGS 수정만 담고 있다. 이후 반영된 카카오·Google 복귀, 소셜 회원가입·계정 연결·취소 후 재시도,
  아이 QR·수동 코드 연결, 온보딩 제목 줄바꿈, 부모 홈 단일 히어로 변경을 포함하지 않으므로 업로드하지 않는다.
- 해당 폐기된 이전 후보의 파일 SHA-256은
  `45e66db8d6a60cae1a9a4c33105f285c85886d92b4aea588425d0010a5343a91`이다. 이 값은 역사 식별용이며
  현재 승인 후보가 아니다.
- 최종 앱·Worker 회귀와 실기기 검증을 마친 커밋을 별도 clean worktree에서 다시 빌드하고, 새 source SHA·AAB
  SHA-256·검증 증거를 이 문서에 기록한 뒤에만 Play에 올린다.

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
- 네이티브 OAuth는 브라우저 콜백을 앱에 다시 전달하고, 응답 유실·프로세스 종료·네트워크 지연 뒤에도 같은
  로그인 세대만 안전하게 복구한다. 새 명시적 로그인과 다른 기기 인계가 과거 복구 결과를 덮지 못하게 막는다.
- 아이 시작은 카카오톡 없이 QR 또는 연결 코드로 진행하며 QR 카메라가 즉시 닫히지 않도록 한다.
- 온보딩 설문 제목은 좁은 화면·10개 locale에서 단어 단위로 안전하게 줄바꿈하고, 부모 홈 히어로는 현 버전에서
  혜니캘린더 1개만 표시한다.

## 검증 증거

- TDD RED에서 `LocationService.stopAmbientListenFromPending`의 `new Intent(...AmbientListenService)`와
  `startService` 호출을 재현했고 수정 뒤 GREEN으로 전환했다.
- 원격청취·Play manifest 집중 회귀와 과거 Android 검증 결과는 유지하되, 최신 인증 수정 뒤 전체 앱·Worker·Android
  회귀 수와 새 APK/AAB 해시는 최종 빌드에서 다시 기록한다.
- 정적 검색에서 `AmbientListenService` Intent 생성은 사용자에게 보이는 `RemoteListenActivity` 시작과 실행 중 알림의
  중지 `PendingIntent` 두 곳만 남고, 부팅으로 복구되는 `LocationService`에는 남지 않았다.
- 폐기된 이전 후보는 사용자가 UTF-8 PowerShell 7 창에서 서명 비밀번호를 직접 입력해 만든 clean source commit
  `eda3907d96e0046804c2d39eb4c2c310f4b1dfeb` 기반 파일
  `artifacts/release-evidence/play-upload-v1.4.4-vc16-eda3907/hyeni-calendar-v1.4.4-vc16-eda3907.aab`,
  13,060,516 bytes, SHA-256
  `45e66db8d6a60cae1a9a4c33105f285c85886d92b4aea588425d0010a5343a91`이다. 이번 Play 업로드에는 사용하지 않는다.
- 폐기된 이전 후보의 schema v4 증거 `artifacts/release-evidence/android-release-aab-evidence-20260827-135437-eda3907.json`에서
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
- Android 16 실기기 A17은 아이, S25는 부모 역할로 지정한다. 최신 debug 재설치 뒤 세로·가로, display cutout,
  키보드, 제스처·3버튼 내비게이션 중 이번 범위에서 직접 확인한 항목만 완료로 기록한다.

## 출시 경계

- 2026-08-28 fresh Android Publisher readback에서 v1.4.3/code 15는 production `PUBLISHED`, 전체 bundle 최대
  versionCode는 15다. code 16은 아직 사용되지 않았으므로 정책·인증 수정본은 v1.4.4/code 16으로 올린다.
- 최신 후보는 `worker/db/oauth-exchange-recovery.sql`을 운영 D1에 먼저 적용하고 컬럼·인덱스를 readback한 뒤 Worker를
  배포해야 한다. 새 앱을 올리기 전에 D1 → Worker → `/api/health` 순서로 확인한다.
- 서명 AAB는 최종 clean source commit에서 사용자가 서명 비밀번호를 직접 입력해 새로 만든다. 폐기된 code 16 AAB와
  기존 code 15 AAB를 재사용하지 않는다.
- Play 업로드 직전 모든 트랙을 fresh readback해 최대 versionCode가 15인지 확인한다. code 16 사용 흔적이 있으면
  v1.4.5/code 17로 올리고 다시 빌드한다.
- 운영 계정의 refresh token은 출력·복사·외부 회전하지 않으며, A17 아이·S25 부모 역할과 가족 연결을 보존한다.

## 완료 조건

- [x] 부팅 연계 microphone service start 호출 제거
- [x] 세션 일치·중복 중지 Java 단위 회귀와 소스 계약 회귀 추가
- [ ] 최신 앱·Worker 전체 테스트·typecheck·production build 통과
- [ ] Android unit·lint·debug APK 통과
- [ ] 운영 D1 OAuth recovery migration readback·Worker 배포·health 확인
- [ ] A17 아이·S25 부모 사용자 0 보존 설치와 버전·역할 확인
- [ ] clean source commit에서 승인 upload certificate 서명 AAB 생성·검증
- [ ] 모든 Play 트랙 최대 versionCode 15 fresh 확인
- [ ] Play production code 16 업로드·검증 후 draft readback(심사 전송은 별도 지시 전 보류)

## 출시 노트

Play Console에는 `docs/store/play-release-notes-v1.4.4.md`의 text 코드 블록을 그대로 사용한다.

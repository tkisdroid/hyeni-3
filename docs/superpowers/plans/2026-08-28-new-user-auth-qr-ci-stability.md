# 신규 사용자 로그인·QR·PWA QA 안정화 구현 계획

> 실행일: 2026-08-28
> 범위: 새 Android 설치의 OAuth 복귀, 아이 연결 QR 스캐너, GitHub Actions PWA 런타임 QA

## 확인된 원인

1. Android OAuth는 `https://hyeni-calendar.pages.dev/oauth/callback` App Link 하나에만 의존한다. 새 설치 직후 도메인 검증이 끝나지 않았거나 사용자가 링크 열기를 해제하면 콜백이 Chrome에 남고, 앱의 `transactionSecret`에 접근할 수 없는 웹 화면은 재로그인 안내만 표시한다.
2. `QrScanner`는 카메라에서 문자열 하나를 감지하면 페어링 코드 형식 검증 전에 스캔을 정지한다. `PairingStep`도 검증 전에 오버레이를 닫으므로 주변의 다른 QR을 읽으면 창이 즉시 사라진다.
3. PWA 런타임 QA는 언어별 동적 manifest가 오프라인에서 실패하는 정상 동작을 예외로 분류하지 않아 CI를 실패시킨다.

## 작업 1: 실패 회귀 테스트

- `tests/pwaRuntimeQaHarness.test.mjs`: 동일 origin의 `/manifests/manifest.<locale>.webmanifest`만 오프라인 예상 실패로 인정하는 테스트를 추가한다.
- `tests/oauthAppLinkSecurity.test.mjs` 및 Worker 테스트: verified HTTPS 링크를 유지하면서, 정확한 앱 패키지로 제한된 Android OAuth intent 복귀 경로가 존재해야 한다는 테스트를 추가한다.
- `tests/qrDetection.test.ts`: 유효한 `KID-XXXXXXXX`만 제출하고 다른 QR은 재스캔해야 한다는 순수 결정 테스트를 추가한다.
- 각 테스트를 수정 코드보다 먼저 실행해 RED를 확인한다.

## 작업 2: 최소 수정

- Android manifest에 OAuth 전용 `com.hyeni.calendar.oauth://oauth/callback` 수신 필터를 추가한다. 기존 verified HTTPS 필터는 그대로 유지한다.
- Worker OAuth 완료 HTML은 Android 네이티브 콜백에 한해 `package=com.hyeni.calendar`이 명시된 intent URL로 앱 열기를 자동 시도하고, 자동 실행이 막혀도 사용자가 같은 페이지의 버튼으로 앱을 열 수 있게 한다. state/code는 기존 1회용 transaction과 앱 내부 secret 검증을 그대로 거친다.
- QR 감지 결정을 순수 함수로 분리하고, 잘못된 QR은 카메라와 오버레이를 유지한 채 오류를 보여주고 다음 프레임을 계속 스캔한다. 유효한 코드에서만 제출·종료한다.
- PWA QA는 정확한 same-origin 언어 manifest 경로만 허용 목록에 추가한다.

## 작업 3: 자동 검증

1. 새 회귀 테스트만 실행한다.
2. `npm run typecheck`, `npm test`, `npm run build`를 순차 실행하고 `ℹ fail 0`을 직접 확인한다.
3. `npm run typecheck:worker`, `npm run test:worker`를 실행한다.
4. `npm run qa:pwa-runtime -- --out-dir <repo 밖 임시 경로>`와 필요한 브라우저 QA를 실행한다.
5. Android debug APK를 새로 빌드하고 관련 Android 테스트를 실행한다.

## 작업 4: S25 신규 설치 검증

- 통화 등 사용자 활동이 없을 때만 S25 `R5CY521CFNZ`를 사용한다.
- 앱 user 0 데이터/캐시 초기화 후 새 APK를 설치한다.
- 역할 선택 → 부모 로그인 화면 → Kakao 브라우저 인증 → 첫 시도 앱 복귀를 확인한다.
- 역할 선택 → 아이 연결 → QR 스캐너를 열어 일정 시간 유지와 잘못된 QR 재스캔을 확인한다.
- 새 사용자 회원가입 진입, 필드 유지·오류 표시·뒤로가기 동선을 확인한다. 비밀번호나 토큰은 출력하지 않는다.

## 작업 5: GitHub Actions

- 변경 파일만 검토해 한국어 커밋 메시지로 커밋하고 `main`에 푸시한다. 사용자가 이번 요청에서 최신 GitHub 코드 수정과 Actions 확인을 명시했으므로 현재 `main` 작업을 승인한 것으로 본다.
- 새 workflow run이 완료될 때까지 확인하고 실패 시 로그의 실제 원인을 수정한 뒤 다시 검증한다.
- Worker/Pages/Play 배포는 이 계획 범위에 포함하지 않는다.

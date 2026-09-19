# 2026-09-20 다른 컴퓨터 재빌드·검토 안내

원격 main의 1.4.9(`2848bf99` 기반)에 오늘 변경을 통합했다. 구형 1.4.2 작업 폴더를 다시 빌드하지 말고 새 main을 내려받는다. 기존 작업이 있는 컴퓨터에서는 변경을 보존한 뒤 `git pull --ff-only origin main`으로 갱신하거나 새 폴더에 clone한다.

## 포함 범위와 운영 상태

| 변경 | 소스 포함 | 운영 상태 |
|---|---|---|
| 해외 Google 웹 지도 재시도·확대·중심 유지·CSP | 포함 | Pages 배포 완료 |
| Android Google 지도 수명·비동기 정리·투명 배경 | 포함 | 새 APK/AAB 재빌드 필요 |
| 부모 설정 로딩·오류 재시도·가족 요청 공유 | 포함 | Pages 배포 완료 |
| 부모 유리 스타일·투명도 | 포함 | Pages 배포 완료 |
| 부모 로그인 지속 정책·일시 refresh 오류 시 세션 보존 | 포함 | Worker·SQL·클라이언트 운영 적용 전 |

최종 웹 배포는 `https://1cf06a72.hyeni-calendar.pages.dev`이며 브랜드 도메인에도 반영됐다. 이 배포는 세션 정책 변경을 포함하지 않는다. 이번 Git 통합으로 운영 웹을 추가 배포하지 않았다. 현재 소스의 새 빌드 결과와 이전 운영 자산의 해시가 다른 것은 정상이다.

## 재빌드

Node 24, Android SDK와 프로젝트 Gradle이 요구하는 JDK를 준비한다. `.env.example`을 참고해 기존 승인된 환경 설정을 새 컴퓨터에 구성한다. `.env`, API 키 값, 서명 키·비밀번호, `android/local.properties`, 빌드 산출물은 Git에 포함하지 않는다.

- 웹: `VITE_GOOGLE_MAPS_WEB_KEY`, `VITE_KAKAO_APP_KEY`를 빌드 전에 설정한다. 기본 API 주소는 운영 Worker다.
- Android: Google Android SDK 키를 Gradle property `MAPS_API_KEY`로 설정한다. 사용자 Gradle 설정 또는 `ORG_GRADLE_PROJECT_MAPS_API_KEY` 환경변수를 사용한다. 웹 키와 Android 키의 제한 설정을 혼용하지 않는다.

```sh
npm ci
npm run typecheck
npm run typecheck:worker
npm run build
npx cap sync android
```

Android 빌드는 `android` 폴더에서 macOS/Linux `./gradlew assembleDebug`, Windows `.\gradlew.bat assembleDebug`로 실행한다. 테스트 설치는 저장소 루트의 `npm run android:install:debug -- <serial>`을 사용하며 기존 데이터와 계정을 유지한다. 스토어용 서명 AAB와 versionCode 변경·제출은 별도 출시 작업이다.

## 검증 결과와 검토 포인트

- 통합본 앱·Worker 타입 검사, production build 통과.
- 전체 Worker 테스트 1,517/1,517 통과.
- 전체 앱 테스트 첫 실행 2,171/2,173 통과. 실패 중 하나는 새 refresh 오류 분류 대신 옛 인라인 코드를 요구한 정적 검사였으며 새 연결 검사로 수정했다. 관련 세션 검사 4/4 재실행 통과. 남은 하나는 이 Mac의 Java Runtime 부재로 Android 병합 manifest를 생성할 수 없는 환경 제한이다. Android 재빌드 컴퓨터에서 `npm test`를 다시 실행한다.
- 지도·설정·보안·스타일 집중 회귀 90/90, 설정 WebKit·Chromium 12개 시나리오, 운영 공개 키의 실제 Google SDK 12개국 좌표 검사는 이전 웹 배포 시 통과했다.
- 실제 해외 통신망·인증된 해외 가족의 장소 저장 E2E·Android 실기기 지도 검증은 남아 있다. Google 인앱 도보 경로는 비활성이며 외부 Google Maps 연결을 사용한다.
- 부모 세션 정책은 `worker/README.md`를 따른다. 운영 적용 순서는 Worker → `worker/db/persistent-parent-sessions.sql` → 클라이언트다. SQL은 아직 운영에서 실행하지 않았다.

소스·테스트·검증 스크립트·문서와 JSON 검증 결과를 Git에 보존한다. 로컬 화면 캡처와 실행 로그는 원본 컴퓨터에 남긴다. [지도 점검 보고서](2026-09-20-google-maps-audit.md), [오늘 작업 이력](2026-09-20-work-log.md)도 참고한다.

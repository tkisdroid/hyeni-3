# 2026-07-19 UI 출시 감사

## 범위

- `App.tsx` 정본 58개 라우트와 57개 lazy screen
- 부모·아이·개발 선생님·공개 화면의 loading/error/empty/success/retry 계약
- 글자·여백·아이콘·터치 영역·radius·shadow·네트워크 이미지 로딩 정책
- 폼 accessible name, dialog 초점 수명주기, 320~349px 좁은 화면 경계
- 사용자 제보 화면: 역할 선택 아이·선생님 이미지 상단 크롭, 위치 권한 복구 안내의 정보 밀도
- 앱 최소 버전 정책의 강제/권장 전환, foreground 재확인, 라우트·오류 경계 우회 방지
- 최신 Pages 배포와 A17 부모모드·razr 아이모드의 실제 설치본·실세션 주요 화면

## 주요 수정 결과

- 역할 선택 아이 이미지는 58×58 예약 슬롯과 `object-position: center top`을 사용해 얼굴 상단이 잘리지 않는다.
- 역할 선택 선생님 이미지는 58×58 슬롯보다 큰 72×72 확대를 제거하고 `contain`으로 맞춰 머리와 전체 윤곽을 보존한다.
- 위치 권한 복구 화면은 제목, 한 문장 이유, 짧은 설정 경로, 주/보조 행동으로 압축했다. 위치·알림 설정의 실제 거부 상태도 이 복구 화면으로 연결했다.
- 모든 사용자 입력 컨트롤에 명시적 accessible name을 제공했다.
- 상태·행동용 원시 `✓`, `!`, 이모지 아이콘을 Lucide 아이콘으로 통일하고 16~24px glyph, 2.2~2.4 stroke 척도를 유지했다.
- 첫 viewport hero·아바타는 eager, 목록·대화 이미지는 lazy로 분리하고 모든 대상 이미지에 비동기 decoding을 명시했다.
- 7열 달력·요일 선택과 권한 dialog CTA는 320~349px 경계에서 44px 조작 영역과 가로 폭을 보장한다.
- 원격 `app-version.json`을 정본으로 Android 시작·foreground 복귀 때 확인한다. 강제 화면은 HashRouter 프로그램 이동과 하위 화면 오류로 우회할 수 없고, 정책 완화 시 stale history를 정리한다.
- 권한 안내 dialog의 단계가 열린 채 바뀌면 새 단계 제목으로 즉시 초점을 옮긴다.
- query early return으로 dialog DOM이 사라질 때 lifecycle도 같은 가시성 조건으로 닫혀 ghost focus stack이 남지 않는다.
- 빈 아이 바텀시트에도 항상 보이는 44×44 닫기 버튼을 제공한다.
- `.env`의 `VITE_KAKAO_APP_KEY`는 값 노출 없이 최종 번들 포함 여부만 검증했다.

## 브라우저·배포 검증

기존 격리 브라우저 전수 감사는 다음 232개 조합을 확인했다.

| 뷰포트 | 라우트 | 렌더/가드 | 가로 overflow | page exception |
| --- | ---: | ---: | ---: | ---: |
| 360×800 | 58 | 58 통과 | 0 | 0 |
| 390×844 | 58 | 58 통과 | 0 | 0 |
| 412×915 | 58 | 58 통과 | 0 | 0 |
| 1440×900 | 58 | 58 통과 | 0 | 0 |

- 이 232개 조합은 `/api/family/mine`과 bootstrap 안전 응답 외 API를 의도적으로 HTTP 418로 만들어 정직한 오류 UI를 검사한 것이다. 모든 mutation 성공 E2E로 과장하지 않는다.
- 역할 선택 아이 이미지: natural 920×1130, 슬롯 58×58, `center top`, 카드 내부 완전 포함, 가로 overflow 0.
- 역할 선택 선생님 이미지: natural 512×512, 슬롯·이미지 58×58, `contain center top`, 360×800·390×844에서 카드 내부 완전 포함, 가로 overflow 0.
- 권한 복구 카드: 360×800에서 한 문장 이유와 버튼 2개(52px/44px), 첫 viewport 포함, 가로 overflow 0.
- 2026-07-19 최종 Pages 배포: `https://44c029b6.hyeni-calendar.pages.dev`.
- 정식 주소 `https://hyeni-calendar.pages.dev`는 최종 entry `assets/index-CMJZ0UPG.js`를 제공한다.
- `app-version.json`: HTTP 200, `latestVersion=1.2.0`, CORS `*`, `Cache-Control: no-store`.
- 정식 배포 CSS `assets/Onboarding-eywHQb9O.css`에서 선생님 역할 이미지 58×58 `contain center top`, 아이 역할 이미지 `object-position:center top`, 권한 축약 문구, 348px 보정 규칙을 확인했다.

## 자동 검증

- 앱 Node 회귀: 769/769 통과
- 재사용 Worker 회귀: 557/557 통과
- TypeScript strict: `npm run typecheck` 통과
- 의존성 감사: `npm audit --audit-level=high` 취약점 0건
- 프로덕션 빌드: 2,019 modules, entry 454,692/500,000 bytes
- Android 단위 테스트: 128/128 통과
- Android `lintDebug`: 오류 0, task 통과
- lint 경고 65건은 `ObsoleteSdkInt` 19, `UnusedResources` 14, `HardcodedText` 8, `IconLauncherShape` 5, `InlinedApi` 5, 기타 14로 분류했다. blanket suppress나 baseline으로 숨기지 않았다.
- Android `assembleDebug`: 성공
- 독립 최종 코드 검수: 남은 P0~P3 결함 없음

## 최종 APK와 설치

- APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- 크기: 15,862,908 bytes
- SHA-256: `3958F0AF2109666E76BADF51D7913245E91119BDCEB09AD0AA403F5C53AAEEA2`
- A17 `RFKL40DP73J`: `1.2.0 (versionCode 4)`, 부모 세션·가족 정합성 200, 부모 핵심 8개 화면 통과, Kakao 지도 canvas 통과
- razr `ZY22H9VTQD`: `1.2.0 (versionCode 4)`, 아이 세션·가족 정합성 200, 아이 핵심 8개 화면 통과
- 두 기기 모두 가로 overflow 0, console/runtime/network 오류 0이었다.
- 두 기기의 설치된 `base.apk` SHA-256이 로컬 최종 APK와 정확히 일치한다.
- 두 기기 모두 `adb install -r`로 앱 데이터·페어링·세션을 보존했고 refresh token은 읽거나 회전하지 않았다.
- 최종 화면은 A17 `#/parent/home`, razr `#/child/home`이다.
- S25는 조회·설치·실행을 포함해 조작하지 않았다.

## 판정과 외부 출시 경계

- 이번 요청 범위인 UI 일관성, 폰트·여백·아이콘, 반응형, 접근성, 로딩 피드백, 오류 복구, 웹 배포, 디버그 APK 빌드·두 기기 설치 기준은 **100/100 완료**로 판정한다.
- 이 점수는 Google Play Console 제출 준비도를 포함하지 않는다. Play App Signing 지문 교체, 최신 서명 AAB, Data Safety·Families·FGS/FSI 선언, license tester 결제·RTDN, 신고·차단 실기기 E2E는 외부 권한·정책 확인이 필요한 별도 출시 차단 항목이다.
- Worker 코드는 변경하지 않았으므로 Worker 재배포는 수행하지 않았다.

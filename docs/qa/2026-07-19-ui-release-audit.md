# 2026-07-19 UI 출시 감사

## 범위

- App.tsx 정본 58개 라우트와 57개 lazy screen
- 부모·아이·개발 선생님·공개 화면의 loading/error/empty/success/retry 상태
- 글자·여백·아이콘·터치 영역·radius·shadow·네트워크 이미지 로딩 정책
- dialog의 제목/설명 연결, 초기 초점, Tab 순환, Escape 닫기, 호출 버튼 초점 복원
- 사용자 제보 화면: 역할 선택 아이 이미지 상단 크롭, 위치 권한 복구 안내의 정보 밀도
- A17 부모모드와 razr 아이모드의 실제 설치본·실세션 주요 화면

## 주요 수정 결과

- 역할 선택 아이 이미지는 58×58 예약 슬롯과 `object-position: 50% 0%`를 사용해 얼굴 상단이 잘리지 않는다.
- 위치 권한 복구 화면은 제목, 한 문장 이유, 짧은 설정 경로, 주/보조 행동으로 압축했다.
- 권한 안내 dialog의 단계가 열린 채 바뀌면 새 단계 제목으로 즉시 초점을 옮긴다.
- query early return으로 dialog DOM이 사라질 때 lifecycle도 같은 가시성 조건으로 닫혀 ghost focus stack이 남지 않는다.
- 빈 아이 바텀시트에도 항상 보이는 44×44 닫기 버튼을 제공한다.
- 첫 viewport의 주요 아바타는 eager, 목록·대화 이미지는 lazy로 분리하고 RemoteRing LCP 후보만 high priority로 지정했다.
- 격리 worktree 빌드에서 `.env`가 빠져 Kakao 지도가 폴백된 원인을 확인하고, 주 체크아웃의 `VITE_*`만 값 노출 없이 빌드에 반영했다.

## 브라우저 검증

| 뷰포트 | 라우트 | 렌더/가드 | 가로 overflow | page exception |
| --- | ---: | ---: | ---: | ---: |
| 360×800 | 58 | 58 통과 | 0 | 0 |
| 390×844 | 58 | 58 통과 | 0 | 0 |
| 412×915 | 58 | 58 통과 | 0 | 0 |
| 1440×900 | 58 | 58 통과 | 0 | 0 |

- 합계 232개 조합에서 잘못된 redirect, route loading 잔류, crash boundary, 로컬 asset 실패가 없었다.
- API는 `/api/family/mine`과 bootstrap 안전 응답만 제공하고 나머지는 의도적으로 HTTP 418을 반환해 정직한 오류 UI를 검사했다.
  따라서 DevTools의 예상된 `Failed to load resource: 418`은 앱 JavaScript 예외와 분리했으며 page exception은 0건이다.
- 역할 선택 아이 이미지: natural 920×1130, 슬롯 58×58, 카드 내부 완전 포함, 가로 overflow 0.
- 권한 복구 카드: 360×800에서 본문 68자, 버튼 2개(52px/44px), 카드 전체가 첫 viewport에 포함, 가로 overflow 0.
- 보호자 번호가 없는 아이 전화 시트: 명시적 닫기 버튼 44×44, 열림 직후 초점, Tab 내부 유지, Escape 후 호출 버튼 복원 확인.

## 자동 검증

- 앱 Node 회귀: 412/412 통과
- 재사용 Worker 회귀: 557/557 통과
- TypeScript strict: `npm run typecheck` 통과
- 의존성 감사: `npm audit --audit-level=high` 취약점 0건
- 프로덕션 빌드: 2,017 modules, entry 451,033/500,000 bytes
- Android 단위 테스트: 128/128 통과
- Android `lintDebug`: 오류 0, task 통과
- Android `assembleDebug`: 성공

## 최종 APK와 설치

- APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- 크기: 15,207,805 bytes
- SHA-256: `ABFC4352756C3623C4220EE0AC730C7F44B96A161CF008BCA7557138008CCC5B`
- A17 `RFKL40DP73J`: `1.2.0 (versionCode 4)`, 부모 세션·가족 정합성 200, 8개 핵심 화면 통과, Kakao 지도 canvas 통과
- razr `ZY22H9VTQD`: `1.2.0 (versionCode 4)`, 아이 세션·가족 정합성 200, 8개 핵심 화면 통과
- 두 기기 모두 `adb install -r`로 앱 데이터·페어링·세션을 보존했고, refresh token은 읽거나 회전하지 않았다.
- 최종 화면은 A17 `#/parent/home`, razr `#/child/home`으로 복귀했다.

## 범위 밖

- Cloudflare Pages/Worker 배포와 Google Play 업로드는 수행하지 않았다.
- 브라우저 전수 검증은 격리된 오류 상태, 실기기 검증은 현재 라이브 성공 상태를 각각 담당한다.

# USER_FLOW_E2E_REPORT

작성일: 2026-07-08 KST  
대상: hyeni-3 최신 debug APK, Cloudflare Pages 배포본

## 결론

가입부터 실제 사용자 흐름 전체 중 이번 실행에서 변경 위험이 큰 항목은 실기기와 서버 API로 재검증했다. A17은 부모, razr는 아이로 고정했고 두 기기 모두 역할 선택 화면으로 되돌아가지 않았다.

## 실행 환경

| 기기 | serial | 모델 | Android | 역할 | 앱 |
|---|---|---|---|---|---|
| A17 | RFKL40DP73J | SM-A175N | 16 | 부모 | com.hyeni.calendar 1.1 debug |
| razr | ZY22H9VTQD | motorola razr 40 ultra | 16 | 아이 | com.hyeni.calendar 1.1 debug |

## 사용자 흐름 검증

| 흐름 | 결과 | 증거 |
|---|---|---|
| 설치 | PASS | `adb install -r` 두 기기 Success |
| 최초/재실행 | PASS | `adb shell monkey -p com.hyeni.calendar 1` 후 WebView 진입 |
| 자동 로그인/역할 진입 | PASS | A17 `#/parent/home`, razr `#/child/home` |
| 가족 연결 유지 | PASS | 두 기기 `/api/family/mine` familyId `f9a75cb4-07e5-4597-b090-526e9ea4ab4e` |
| 역할 선택 재노출 방지 | PASS | CDP 검사 `hasRoleChoice=false` |
| 홈/초기 데이터 로딩 | PASS | A17 부모 홈, razr 아이 홈 텍스트 렌더 |
| 일정 CRUD | PASS | 임시 일정 create/read/update/delete 후 삭제 확인 |
| 주요 라우트 진입 | PASS | A17 39개, razr 14개 라우트 overflow/error/role choice 0 |
| production smoke | PASS | `https://hyeni-calendar.pages.dev`, manifest 200 |

## 이번에 수정한 사용자 흐름 문제

- A17 부모 계정 access token claim의 `family_id`가 오래된 값이어서, 앱 내부 family id가 서버 가족 정본과 어긋날 수 있었다.
- `/api/family/mine` 성공 응답을 기준으로 localStorage 세션 user의 `family_id`와 role을 보정하도록 수정했다.
- 아이 화면에서 부모 전용 `/api/review-rewards`를 호출해 403 네트워크 오류가 남던 문제를 수정했다.

## 남은 리스크

- SOS, force ring, 주변소리 듣기 같은 실발사 기능은 야간 소음과 운영 데이터 영향이 있어 이번 루프에서는 비파괴 라우트/세션 검증으로 제한했다.
- 모든 버튼 3회 물리 탭 검증은 운영 데이터 변경 위험이 있는 버튼을 제외하고 라우트/기능 단위로 대체했다.

# E2E_TEST_REPORT

작성일: 2026-07-08 KST

## 실행 명령

```bash
node --test tests/*.test.ts tests/*.test.mjs
npm run typecheck
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
adb -s RFKL40DP73J install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s ZY22H9VTQD install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## 자동 테스트

- 총 41개 통과.
- 신규 회귀 테스트:
  - `tests/sessionFamilySync.test.ts`
  - `tests/reviewRewardScope.test.ts`

## 실기기 세션 E2E

| 기기 | URL | role | local family id | `/api/family/mine` | 결과 |
|---|---|---|---|---|---|
| A17 | `https://localhost/#/parent/home` | parent | `f9a75cb4-07e5-4597-b090-526e9ea4ab4e` | same | PASS |
| razr | `https://localhost/#/child/home` | child | `f9a75cb4-07e5-4597-b090-526e9ea4ab4e` | same | PASS |

## 라우트 E2E

| 기기 | 라우트 수 | role choice | error signal | overflow | CDP events |
|---|---:|---:|---:|---:|---:|
| A17 parent | 39 | 0 | 0 | 0 | 0 |
| razr child | 14 | 0 | 0 | 0 | 0 |

## 일정 CRUD E2E

임시 일정 `goal2-*`를 생성, 조회, 수정, 삭제했다.

| 단계 | 결과 |
|---|---|
| create | HTTP 200 |
| read after create | found true |
| update | HTTP 200 |
| read after update | title/end_time 변경 확인 |
| delete | HTTP 200 |
| read after delete | found false |

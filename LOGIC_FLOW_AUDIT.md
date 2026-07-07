# LOGIC_FLOW_AUDIT

작성일: 2026-07-08 KST

## 결론

이번 감사에서 확인된 논리 오류 2건을 수정했다. 모두 회귀 테스트와 실기기 CDP 재검증까지 완료했다.

## 발견 및 수정

| 심각도 | 문제 | 원인 | 수정 파일 | 재검증 |
|---|---|---|---|---|
| Critical | 부모 앱 family id가 서버 가족과 불일치 | access token claim은 과거 family id이고 `useAuth().familyId`가 이를 그대로 사용할 수 있음 | `src/transform/sessionFamilySync.ts`, `src/lib/api/endpoints/family.ts` | A17 local user familyId와 `/api/family/mine` 일치 |
| High | 아이 화면에서 review-rewards 403 | `/api/review-rewards`는 부모 전용인데 아이 세션도 `useEntitlement()`에서 조회 | `src/transform/reviewRewardScope.ts`, `src/queries/useReviewReward.ts` | razr 14개 라우트 CDP events 0 |

## 논리 흐름 체크

| 항목 | 결과 | 메모 |
|---|---|---|
| 부모 계정이 부모 홈 진입 | PASS | A17 `#/parent/home` |
| 아이 계정이 아이 홈 진입 | PASS | razr `#/child/home` |
| 부모/아이 같은 family id | PASS | `/api/family/mine` 둘 다 `f9a75...` |
| token family id stale 방어 | PASS | localStorage user를 `/mine` 기준으로 보정 |
| 아이 세션에서 부모 전용 API 차단 | PASS | review-rewards query disabled |
| 일정 종료 시간이 저장/수정됨 | PASS | CRUD 검증에서 `end_time=23:58` 저장 확인 |

## 미검증/비파괴 대체

- 알림 실발사는 이번 변경과 직접 관련 없는 고위험 운영 동작이라 실행하지 않았다.
- 삭제류 버튼은 임시 일정 API 삭제로 한정 검증했다.

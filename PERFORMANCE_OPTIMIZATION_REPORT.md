# PERFORMANCE_OPTIMIZATION_REPORT

작성일: 2026-07-08 KST

## 결론

이번 성능 개선은 불필요한 아이 세션 API 호출 제거에 집중했다. 아이 화면에서 부모 전용 `/api/review-rewards` 403 반복 요청이 사라졌다.

## 개선 사항

| 항목 | 이전 | 이후 |
|---|---|---|
| 아이 `useEntitlement()` | `/api/review-rewards` 호출 후 403 로그 | role이 parent가 아니면 호출하지 않음 |
| 리뷰 티어 판정 | child에서 query error 가능 | child는 reviewed=false로 즉시 확정 |
| CDP network events | razr 라우트 순회 중 403 3건 | 재설치 후 0건 |

## 빌드 성능/크기

- `npm run build` 성공.
- Vite 경고: `index-*.js` 약 869KB, gzip 약 262KB로 500KB chunk warning 유지.
- 현 단계에서는 코드 split 리팩터를 하지 않았다. 릴리즈 직전 안정성이 우선이며, 별도 성능 작업으로 분리하는 것이 안전하다.

## 실제 기기 체감

- A17 39개, razr 14개 라우트 순차 진입 중 화면 정지/역할화면 회귀/오류 문구 없음.

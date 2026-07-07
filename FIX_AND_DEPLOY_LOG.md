# FIX_AND_DEPLOY_LOG

작성일: 2026-07-08 KST

## 수정 파일

| 파일 | 내용 |
|---|---|
| `src/transform/sessionFamilySync.ts` | `/api/family/mine` 기준 user family id/role 보정 |
| `src/lib/api/endpoints/family.ts` | 가족 조회 성공 시 세션 user 보정 및 AuthProvider 알림 |
| `tests/sessionFamilySync.test.ts` | stale token family id 회귀 테스트 |
| `src/transform/reviewRewardScope.ts` | review-rewards 부모 전용 조회 scope |
| `src/queries/useReviewReward.ts` | 아이/선생님 세션에서 review-rewards 호출 차단 |
| `tests/reviewRewardScope.test.ts` | child 403 회귀 테스트 |
| `AGENTS.md`, `CLAUDE.md` | 이번 운영 규칙 반영 |

## 배포

| 항목 | 결과 |
|---|---|
| Pages deploy | PASS |
| 배포 URL | `https://c09f59d1.hyeni-calendar.pages.dev` |
| production smoke | `https://hyeni-calendar.pages.dev` 200 |
| manifest smoke | 200 |

## 재검증

- Node tests: 41 pass
- typecheck: pass
- build: pass
- cap sync: pass
- assembleDebug: pass
- A17/razr install: pass
- A17/razr route audit: pass

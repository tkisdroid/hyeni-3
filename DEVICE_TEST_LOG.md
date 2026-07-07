# DEVICE_TEST_LOG

작성일: 2026-07-08 KST

## 세션 검증

| 기기 | 역할 | URL | local user familyId | `/api/family/mine` familyId | 결과 |
|---|---|---|---|---|---|
| A17 | parent | `#/parent/home` | `f9a75cb4-07e5-4597-b090-526e9ea4ab4e` | same | PASS |
| razr | child | `#/child/home` | `f9a75cb4-07e5-4597-b090-526e9ea4ab4e` | same | PASS |

## 주의 관찰

A17 access token payload에는 이전 family id `4825a316-7ccc-4732-83fd-d7f362065b95`가 남아 있었다. 이번 수정으로 localStorage user가 `/api/family/mine` 정본 `f9a75...`로 보정되어 앱은 정본 family id를 사용한다.

## 라우트 검증

| 기기 | 라우트 수 | failures | CDP events |
|---|---:|---:|---:|
| A17 | 39 | 0 | 0 |
| razr | 14 | 0 | 0 |

## 일정 CRUD 검증

- familyId: `f9a75cb4-07e5-4597-b090-526e9ea4ab4e`
- child member id: `374765fc-c4f5-4376-8554-3ec64f7b8890`
- 임시 event id: `goal2-864dec06-35bd-48af-9e95-6fd9d91c068a`
- 삭제 후 재조회: found false

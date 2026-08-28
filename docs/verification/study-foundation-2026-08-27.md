# Study foundation acceptance gate — 2026-08-27

## 범위와 기준 커밋

- 시작 커밋: `eccef55d6b57bf8f8929ed9bc193c034355f7489`
- 검증 기준 커밋: `9b412ae37015a8ab0e96970d2922e9867388dd85`
- 실행 위치: `C:/Users/TK/Desktop/hyeni-3/.worktrees/hyeni-study-calendar-foundation`
- 실행 일시: 2026-08-29 KST

이 문서는 로컬 acceptance gate 증거만 기록한다. 프로덕션 D1, secret, Worker/Pages 배포, Play, 실기기, 계정·기기 세션은 변경하지 않았다.

## fresh 명령 결과

| 명령 | 결과 |
| --- | --- |
| `npx wrangler types worker/worker-configuration.d.ts --config worker/wrangler.toml` | 통과. 생성 완료. |
| `npm run typecheck` | 통과 (종료 코드 0). |
| `npm run typecheck:worker` | 통과 (종료 코드 0). |
| `npm test` | 2,036/2,036 통과, `fail 0`. |
| `npm run test:worker` | 1,422/1,422 통과, `fail 0`. |
| `npm run build` | 통과 (종료 코드 0). route-bundle 내장 검증도 통과. |
| `npm run verify:route-bundle` | 통과. 초기 자체 JS 365,952/500,000 bytes, 초기 CSS 44,996/48,000 bytes, PWA precache 472개 URL·중복 없음. |

## 타입 경계

- 생성된 `worker/worker-configuration.d.ts`의 Study 관련 Service Binding은 `STUDY_SERVICE: Service` 하나이며 entrypoint는 `CalendarStudyService`로 한정된다. Study D1, Calendar JWT, account-device-session 또는 광범위한 Study binding은 생성 타입에 없다.
- `worker/types.ts`는 `STUDY_SERVICE`를 좁은 `CalendarStudyServiceBinding`으로, `STUDY_RPC_HMAC_SECRET`를 문자열 secret 타입으로 선언한다.
- 생성 타입, 이 문서와 검증 출력에 secret 값은 없으며, token·nonce·기기 설치 ID·자녀 생년 정보도 기록하지 않았다.

## 보호 경계 회귀 근거

- 서울 학년도 경계: `2026-02-28T14:59:59.999Z`은 직전 학년도 결과, `2026-02-28T15:00:00.000Z`은 다음 학년도 결과를 반환한다. 부모 override 우선과 override reset 후 자동 계산도 전체 Worker suite에 포함된다.
- 세션: revoked 또는 missing 기기 세션은 `401 device_session_inactive`이며 Study readiness/binding을 호출하지 않는다. 비활성 가족 구성원은 Study gateway에서 `403 study_not_available`로 binding 이전에 차단된다.
- 시장: 첫 등록 국가 기록은 첫 값 이후 변경되지 않는다. 보호자 확인 `KR`은 `study_market=KR`로, 보호자 확인 `JP`는 `study_market=NULL`로 판정한다. 비-KR gateway 요청은 `403 study_not_available`이며 binding 호출 수는 0이다.

## 알려진 후속 게이트

- Task 2 migration은 expand-only이지만 `ALTER TABLE ADD COLUMN`에 재실행 방지가 없다. 기존 preview/test DB는 `request_row_version` 존재를 먼저 확인하고, 부재할 때만 별도 forward `ALTER`을 정확히 한 번 적용해야 한다. 이 작업에서는 production D1을 적용하지 않았다.
- Calendar 쪽의 고정 HMAC fixture와 독립 검산은 완료됐지만, Study Worker가 같은 fixture를 독립 verifier에서 소비하는 양 Worker preview parity는 backend acceptance 후속 게이트다. 실제 Study D1/DO, dedicated secret, service binding preview 배포도 이 문서의 로컬 범위 밖이다.

## 결론

로컬 foundation acceptance gate는 위 기준 커밋에서 통과했다. 이는 배포·production migration·실기기·Play 출시 가능 판정이 아니라, Calendar 쪽 타입·단위/Worker 회귀·production build·초기 route bundle의 로컬 증거다.

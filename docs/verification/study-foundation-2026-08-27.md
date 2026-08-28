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

- Wrangler 4.118의 단일 Calendar config 생성물은 `STUDY_SERVICE: Service`와 `CalendarStudyService` entrypoint 주석만 제공한다. 이는 remote named service 존재·entrypoint를 확인하는 generic Cloudflare type이며, 좁은 RPC interface도 HMAC secret type도 생성하지 않는다.
- 이는 도구 한계다. remote callee의 narrow RPC 자동 생성은 별도 callee config 경로가 필요해 이 Calendar worktree에 연결하지 않았고, `[secrets].required`는 local dev/deploy secret 검증 동작을 바꾸므로 추가하지 않았다.
- 따라서 acceptance는 두 계층으로 분리한다. 1계층은 `npx wrangler types ... --check`와 `worker/tests/studyGeneratedBindings.test.mjs`로 generated d.ts freshness, 정확한 named entrypoint, extra Study binding·Study secret binding 부재를 확인한다. 2계층은 `worker/types.ts`와 `worker/tests/studyGeneratedBindings.typecheck.ts`로 `STUDY_SERVICE: CalendarStudyServiceBinding`, `STUDY_RPC_HMAC_SECRET: string`, 기존 `studyRpcContract.typecheck.ts`의 RPC method surface를 컴파일 시 강제한다.
- 생성 타입, 이 문서와 검증 출력에 secret 값은 없으며, token·nonce·기기 설치 ID·자녀 생년 정보도 기록하지 않았다.

## 보호 경계 회귀 근거

- 서울 학년도 경계: `2026-02-28T14:59:59.999Z`은 직전 학년도 결과, `2026-02-28T15:00:00.000Z`은 다음 학년도 결과를 반환한다. 부모 override 우선과 override reset 후 자동 계산도 전체 Worker suite에 포함된다.
- 세션: revoked 또는 missing 기기 세션은 `401 device_session_inactive`이며 Study readiness/binding을 호출하지 않는다. 비활성 가족 구성원은 Study gateway에서 `403 study_not_available`로 binding 이전에 차단된다.
- 시장: 첫 등록 국가 기록은 첫 값 이후 변경되지 않는다. 보호자 확인 `KR`은 `study_market=KR`로, 보호자 확인 `JP`는 `study_market=NULL`로 판정한다. 비-KR gateway 요청은 `403 study_not_available`이며 binding 호출 수는 0이다.

## 알려진 후속 게이트

- Task 2 migration은 expand-only이지만 `ALTER TABLE ADD COLUMN`에 재실행 방지가 없다. 기존 preview/test DB는 `request_row_version` 존재를 먼저 확인하고, 부재할 때만 별도 forward `ALTER`을 정확히 한 번 적용해야 한다. 이 작업에서는 production D1을 적용하지 않았다.
- Calendar 쪽의 고정 HMAC fixture와 독립 검산은 완료됐지만, Study Worker가 같은 fixture를 독립 verifier에서 소비하는 양 Worker preview parity는 backend acceptance 후속 게이트다. 실제 Study D1/DO, dedicated secret, service binding preview 배포도 이 문서의 로컬 범위 밖이다.

## Fix round 1 — generated/manual 2계층 재검증

이 절의 수치는 Fix round 2에서 같은 2계층 gate를 다시 fresh 실행해 갱신한 기록이다. Fix round 1 당시의 1/1 focused·1,423/1,423 Worker suite 증거는 Task 7 보고서의 과거 라운드 기록으로 보존한다.

- `npx wrangler types worker/worker-configuration.d.ts --config worker/wrangler.toml --check`: 통과. 생성 타입은 최신이다.
- `node --test worker/tests/studyGeneratedBindings.test.mjs`: 2/2 통과. Calendar config의 named service/entrypoint와 generated `Service` 표기, `__BaseEnv_Env`의 정확한 `STUDY_*` allowlist(`STUDY_SERVICE`만), extra Study binding·Study secret binding 부재를 확인했다.
- `npm run typecheck`, `npm run typecheck:worker`: 모두 통과. 후자는 `studyGeneratedBindings.typecheck.ts`와 기존 RPC compile-time contract를 포함한다.
- `npm test`: 2,036/2,036 통과, `fail 0`. `npm run test:worker`: 1,424/1,424 통과, `fail 0`.
- `npm run build`, `npm run verify:route-bundle`: 통과. 초기 자체 JS 365,952/500,000 bytes, 초기 CSS 44,996/48,000 bytes, precache 472개 URL·중복 없음이다.
- 회귀 assertion은 generic `Service`로의 일시 mutation에서 실패하고 원복 후 통과했다. generated d.ts는 수동 patch하지 않았고 production/secret/deploy 구성도 변경하지 않았다.

## Fix round 3 — generated allowlist parser 주석 안전성

- `worker/tests/studyGeneratedBindings.test.mjs`의 국소 scanner는 `__BaseEnv_Env` 본문만 읽고 line/block comment와 string/template literal을 건너뛴 뒤, 중첩 `{}`, `()`, `[]` 밖의 실제 `STUDY_*` property declaration만 수집한다.
- in-memory fixture는 여러 줄 block comment의 `STUDY_BLOCK_COMMENT`, line comment, 속성 타입의 comment-like template literal과 block comment를 모두 무시한다. 정상 `STUDY_SERVICE`는 유지하고 실제 `STUDY_DB` 주입은 allowlist equality에서 거부한다.
- fresh: `npx wrangler types worker/worker-configuration.d.ts --config worker/wrangler.toml --check`, focused 3/3, `npm run typecheck:worker`, `npm run test:worker` 1,425/1,425 (`fail 0`), `git diff --check`를 실행했다. 위 Fix round 1 절의 2/2·1,424/1,424는 Fix round 2의 과거 fresh 기록이다.
- generated d.ts, production D1, secret, deploy 구성, Play, 실기기, 계정·기기 세션은 변경하지 않았다.

## Fix round 4 — TypeScript AST generated allowlist

- 설치된 TypeScript compiler API로 source file AST를 파싱한다. 정확히 하나인 `__BaseEnv_Env` `InterfaceDeclaration`만 허용하고, 그 `PropertySignature`의 identifier/string-literal 이름 중 `STUDY_*`만 수집한다. interface 부재·중복·computed property는 fail-closed다.
- 회귀 fixture는 block/line comment와 single/double/template string 안의 가짜 `__BaseEnv_Env` marker를 무시한다. multiline comment·escape·nested type도 binding으로 오인하지 않으며, 같은 줄 실제 `STUDY_SERVICE`와 `STUDY_DB`는 둘 다 추출한다.
- fresh: `npx wrangler types worker/worker-configuration.d.ts --config worker/wrangler.toml --check`, focused 5/5, `npm run typecheck:worker`, `npm run test:worker` 1,427/1,427 (`fail 0`)를 실행했다. generated d.ts, production D1, secret, deploy 구성, Play, 실기기, 계정·기기 세션은 변경하지 않았다.

## 결론

로컬 foundation acceptance gate는 위 기준 커밋에서 위의 2계층 타입 acceptance로 통과했다. generated d.ts 자체가 narrow RPC 또는 HMAC secret type을 제공한다는 뜻은 아니다. 이는 배포·production migration·실기기·Play 출시 가능 판정이 아니라, Calendar 쪽 타입·단위/Worker 회귀·production build·초기 route bundle의 로컬 증거다.

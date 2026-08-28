# Task 6 구현 보고서 — Calendar Study gateway

## Status

완료. 이 보고서는 같은 Task 6 커밋에 포함한다. 프로덕션 D1·secret·배포·실기기·계정 세션은 변경하지 않았다.

## RED/GREEN

- RED 1: `node --test worker/tests/studyGateway.test.mjs`
  - 새 gateway route가 없어서 7개 gateway 시나리오가 모두 `404`로 실패했다. 예: 아이 mission start는 기대 `201` 대신 `404`였다.
- GREEN 1: 같은 focused test에서 7/7 pass, fail 0을 확인했다.
- RED 2: `npm run typecheck:worker`
  - Task 1 초기 Service Binding input type이 `familyId` 중심이라 locked plan의 `children/requestId`, `grade/range`, mission `mode`, submission `problemId`를 표현하지 못해 6개 type error가 발생했다.
- GREEN 2: contract를 정본 payload로 동기화하고 route의 국소 type cast를 제거한 뒤 typecheck pass를 확인했다.
- GREEN 3: disabled gate, UTF-8 2,000-byte answer 상한, malformed idempotency key, Study rejection과 실제 5초 timeout을 추가해 focused 10/10 pass, fail 0을 확인했다.

## 변경

- `worker/lib/studyGateway.ts`
  - canonical active family/member/role, active child, `study_market=KR`, role별 rollout flag를 binding 이전에 fail-closed로 재판정한다.
  - ID 128자, answer UTF-8 2,000 bytes, mission mode, report range, unknown JSON property를 좁게 검증한다.
  - `Idempotency-Key`는 `^[A-Za-z0-9_-]{16,128}$`만 받고, 없으면 서버 `crypto.randomUUID()` request ID를 만든다.
  - Task 5 signer를 binding 직전에 사용하며 internal `birthdate` source는 RPC 경계에서 `hyeni_birth_year`로 변환한다.
  - Study rejection/timeout은 원문 없이 `503 { error: "study_unavailable" }`로 격리한다.
- `worker/routes/study.ts`
  - 부모 children/overview/report와 아이 me/start/get/submit의 7개 binding gateway route를 추가했다.
  - 기존 `PUT /children/:memberId/grade`는 Calendar D1 학년 override mutation으로 그대로 보존했다. 별도 Study binding route로 바꾸지 않아 grade snapshot은 다음 Study 요청에서만 반영된다.
- `worker/contracts/studyRpc.ts`, `worker/tests/studyRpcContract.typecheck.ts`
  - Task 1 초기 input contract drift를 locked plan/spec의 final payload로 교정하고 compile-time test로 고정했다. CalendarProfileService projection contract와 기존 output DTO는 변경하지 않았다.
- `worker/wrangler.toml`
  - non-secret `STUDY_SERVICE`에 `entrypoint = "CalendarStudyService"`만 추가했다.

## Self-review

- token family/member/role을 권한 정본으로 쓰지 않고 현재 D1 canonical membership과 활성 member 행을 재확인한다.
- 아이 route는 query member ID를 소비하지 않고 caller 자신의 active child member만 binding으로 보낸다.
- disabled, non-KR, inactive/foreign member와 권한 실패는 binding 전에 `study_not_available`로 닫는다.
- binding input에는 Calendar token, install ID, birthdate, raw family ID가 없고 auth에는 actor 가명값만 들어간다.
- 기존 PUT grade route는 Study binding을 호출하지 않는다. 따라서 feature disabled 시에도 기존 Calendar override 저장 계약을 불필요하게 변경하지 않는다.

## 테스트

- `node --test worker/tests/studyGateway.test.mjs worker/tests/studyRpcContract.test.mjs`: 10/10 pass, fail 0.
- `npm run typecheck:worker`: exit 0.
- `npm run test:worker`: 1,406/1,406 pass, fail 0.
- `git diff --check`: pass.

## 우려 및 후속

- 실제 Study backend가 동일한 locked V2 input contract와 fixture를 소비하는 cross-worker preview 검증은 backend 계획의 후속 gate다. 이 Task는 fake binding과 Calendar-side type contract까지만 검증했다.
- production D1 migration, HMAC secret 설정, service binding preview/prod 배포, 실제 기기 세션 검증은 수행하지 않았다.

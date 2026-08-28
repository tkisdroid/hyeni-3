# 혜니 Study Calendar foundation 최종 수정 보고서

- 작업 범위: 최종 리뷰 `Important 5 / Minor 2`의 단일 수정 wave
- 기준 HEAD: `dceca4fc8afe3c913b621f888874b9d32abe7126`
- 구현 커밋: `9763c1f651aaf17fca7a17cf792858f7b6a5597e` (`fix: 스터디 기반 최종 경계를 보강한다`)
- 로컬 판정: **Calendar foundation merge 가능**
- 제외 범위: production D1, secret, Worker/Pages 배포, Play, 실기기, 실제 세션은 조회하거나 변경하지 않았다.

## Finding별 RED → GREEN

| Finding | RED 증거 | GREEN 구현·회귀 | 관련 파일 |
| --- | --- | --- | --- |
| Important 1 — Naver 최초 등록 국가 | 실제 SQLite/D1 호환 fixture에서 Naver 신규 가입은 `12 pass / 1 fail`, `registration_country: null !== 'KR'`이었다. | transaction 소비 전에 edge country 정규화와 column capability를 확정한다. 신규 user+identity batch에 조건부 컬럼을 포함하고, existing/linked는 `COALESCE` first-known 기록을 사용한다. created/existing/linked의 불변성 및 세 경로 모두 legacy schema 호환을 검증해 `13/13 pass`했다. | `worker/routes/naver-auth.ts`, `worker/tests/oauthRouteSecurity.test.mjs` |
| Important 2 — 학년 변경 관리 경계 | route 회귀에서 비-KR 변경과 삭제 중인 비canonical 대상이 각각 잘못 `200`을 반환했다. | 현재 세션 canonical active parent family를 먼저 확정하고 현재 KR market, management flag+rollout, exact active child를 binding 없이 fail-closed 검증한다. 그 canonical family의 account mutation lease 안에서만 grade+audit batch를 실행한다. non-KR, flag-off, multi-family 비canonical, 삭제 lease, exact lease 관찰, 자동 학년 불가 상태에서 manual override 복구를 검증했다. | `worker/lib/studyGateway.ts`, `worker/routes/study.ts`, `worker/tests/studyStatusRoute.test.mjs` |
| Important 3 — status readiness 제한 | never-resolving readiness 회귀가 6.5초 뒤 취소되어 status가 자체 제한 없이 매달림을 재현했다. | status와 business RPC가 `STUDY_API_VERSION` 및 같은 5초 bounded helper를 사용한다. missing/pending/wrong-version/throw/malformed는 raw 오류 없이 `503 {state:"unavailable"}`로 닫고 session·D1·business method snapshot이 변하지 않음을 검증했다. | `worker/lib/studyGateway.ts`, `worker/routes/study.ts`, `worker/tests/studyStatusRoute.test.mjs` |
| Important 4 — 실제 gateway HMAC fixture | authorization test는 fixture operation이 기대한 `learner.state`와 맞지 않았고, gateway test는 `rpcInput` 부재로 실패했다. 기존 fingerprint는 실제 `{input,memberId,grade}` preimage와도 불일치했다. | 실제 `learner.start` / `startCalendarMission` RPC input과 최종 preimage를 JSON 하나에 고정하고 fingerprint, actorRef, canonical payload, HMAC signature를 다시 계산했다. authorization 독립 검산과 Calendar gateway recording fake가 동일 fixture를 직접 소비해 각각 `9/9`, `25/25 pass`했다. | `worker/contracts/fixtures/calendar-study-authorization-v2.json`, `worker/tests/studyRpcAuthorization.test.mjs`, `worker/tests/studyGateway.test.mjs` |
| Important 5 — inbound profile KR 경계 | 기존 projection focused suite는 `0/3`; migration 전 schema가 active를 반환하고 이름·사진 변경 revision도 무효였다. | exact family join과 현재 `families.study_market='KR'`, exact active child를 SQL에서 함께 강제한다. KR→JP/다른 family/inactive를 닫고 code-before-migration은 개인정보를 반환하지 않으며 migration 후 KR만 열린다. | `worker/lib/studyCalendarProjection.ts`, `worker/tests/studyCalendarProjection.test.mjs` |
| Minor 1 — 학년 권한 주석 | 최종 리뷰의 정적 계약 추적에서 주석이 Study 소유라고 반대로 적혀 있었다. | Calendar가 학년 판정의 authority이고 Study는 snapshot만 소비한다고 계약 주석을 수정했다. | `worker/contracts/studyRpc.ts` |
| Minor 2 — profile revision | legacy `created_at:null`에서 revision이 null이었고, 이름·사진 변경에도 revision이 같았다. | `displayName`과 `hasAvatar`의 canonical tuple을 Web Crypto SHA-256 base64url digest로 만든다. raw photo key는 DTO·digest에 넣지 않는다. 동일 값 안정성, 이름 변경, avatar 존재 여부 변경, raw key만 바뀐 동일 projection, null legacy row를 검증했다. | `worker/lib/studyCalendarProjection.ts`, `worker/tests/studyCalendarProjection.test.mjs` |

## Producer → consumer 자체 검토

- Naver producer는 공용 `studyMarket` helper와 일반 OAuth의 원자성/legacy 복구 의미를 그대로 소비하며, source-order 회귀가 capability 판정을 transaction 소비보다 앞에 고정한다.
- grade route는 관리 전용 context가 자동 학년 resolver를 호출하지 않아 manual override 복구를 막지 않는다. 성공 batch가 실행되는 동안 exact canonical family lease가 실제 존재하는지도 테스트에서 관찰했다.
- status와 business gateway는 readiness version·5초 예산 helper를 공유하고, status 실패가 binding business RPC 또는 인증/DB 상태를 건드리지 않는다.
- 공유 JSON은 Calendar signer와 실제 gateway가 함께 소비한다. 후속 Study verifier가 같은 `rpcInput`, `fingerprintPreimage`, `expectedCanonicalPayload`, `authorization`을 독립 재계산할 수 있도록 규칙과 필드 설명을 유지했다.
- profile entrypoint는 projection helper 하나만 소비하므로 SQL의 exact KR/active/family 경계와 revision digest가 inbound RPC 응답까지 직접 적용된다.

## Fresh 검증

| 검증 | 결과 |
| --- | --- |
| Study 관련 focused suite 13개 파일 | **166/166 pass, fail 0** |
| `npx wrangler types worker/worker-configuration.d.ts --config worker/wrangler.toml --check` | PASS, Wrangler 4.118.0 generated types 최신 |
| `npm run typecheck` | PASS |
| `npm run typecheck:worker` | PASS |
| `npm test` | **2,036/2,036 pass, `ℹ fail 0`**, 102,981ms |
| `npm run test:worker` | **1,437/1,437 pass, fail 0**, 약 20.4초 |
| `npm run build` | PASS, Vite 2,293 modules / 약 3.30초 |
| `npm run verify:route-bundle` | PASS, initial JS 365,952/500,000, CSS 44,996/48,000, precache 472, duplicate 0, OAuth callback 물리 엔트리 확인 |
| `git diff --check` | PASS, 출력 없음 |

## 남은 우려와 hard gate

- 이 보고서는 로컬 Calendar foundation merge 가능 판정이다. 실제 Study Worker가 같은 fixture를 독립 검증하고 양 Worker preview binding에서 동일 HMAC secret·API version으로 통과하는 smoke는 후속 preview/release hard gate다.
- 기존 preview/test D1을 재사용하려면 먼저 `PRAGMA table_info(study_setting_audit)`를 읽고 누락된 `request_row_version`만 조건부 forward `ALTER`한 뒤 readback해야 한다. production D1에는 이번 wave에서 접근하지 않았다.
- 실제 D1/DO/service binding 배포와 배포 readback, secret 설정, 실기기 및 Play 검증은 수행하지 않았으므로 출시 증거로 해석하면 안 된다.
- Task 7의 unresolved heritage/external-module local shadow는 현재 deterministic Wrangler artifact 구조에서는 parked 상태를 유지한다. Wrangler 생성 형식이 바뀌면 다시 열어야 한다.

## 변경 규모와 커밋

- 구현 변경: 11개 파일, `763 insertions / 164 deletions`
- 구현 커밋: `9763c1f651aaf17fca7a17cf792858f7b6a5597e`
- 이 보고서는 별도 한국어 문서 커밋으로 묶고 최종 HEAD는 handoff에서 고정한다.

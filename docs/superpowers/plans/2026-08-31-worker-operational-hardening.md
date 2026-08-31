# Worker 운영 안정화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 감사에서 확인된 Worker의 큐 보존·계정 삭제 잔재·SOS 감사 무결성·출시 Secret 점검 공백을 코드와 실제 회귀 테스트로 닫는다.

**Architecture:** 기존 Cloudflare Worker와 D1 스키마를 그대로 확장한다. 만료 알림은 별도 bounded hourly retention으로 지우고, 계정 삭제 tombstone cleanup은 완료 행과 삭제된 사용자 소유 고아 claim을 같은 2-query batch로 회수한다. 피드백은 기존 durable D1 접수 계약을 유지하며 자동 재전송을 새로 약속하지 않는다. 외부 Secret은 값이 아닌 이름 inventory만 검사하는 read-only 출시 게이트로 다룬다.

**Tech Stack:** Cloudflare Workers, Hono, D1/SQLite, TypeScript, Node test runner, Wrangler

**Spec:** 없음 — 2026-08-31 운영 Worker/D1 전수 감사 결과

---

## Task 1: 만료 알림 bounded retention

**Files:**
- Create: `worker/cron/pending-notification-retention.ts`
- Create: `worker/tests/pendingNotificationRetention.test.mjs`
- Create: `worker/db/pending-notification-retention.sql`
- Modify: `cloudflare/schema_d1.sql`
- Modify: `worker/index.ts`
- Modify: `worker/tests/hourlyCronQueryBudget.test.mjs`

- [x] **Step 1: 만료 후 24시간 grace, 최대 5,000행 삭제, 재실행 멱등 테스트를 먼저 작성한다.**
- [x] **Step 2: 신규 테스트를 실행해 helper와 hourly 배선 부재로 실패하는 RED를 확인한다.**
- [x] **Step 3: `expires_at,id` 인덱스와 한 문장 bounded DELETE helper를 구현한다.**
- [x] **Step 4: 40분 hourly slot에 query budget 1로 연결하고 집중 테스트를 GREEN으로 만든다.**

## Task 2: 삭제된 사용자 소유 고아 account deletion claim 회수

**Files:**
- Modify: `worker/lib/accountDeletionClaims.ts`
- Modify: `worker/tests/accountDeletionCompleteness.test.mjs`

- [x] **Step 1: 24시간이 지난 `claimed` 행 중 owner user가 없는 행만 scope와 함께 회수하는 테스트를 추가한다.**
- [x] **Step 2: 살아 있는 owner의 claimed 행과 24시간 이내 고아 행이 보존되는 RED를 확인한다.**
- [x] **Step 3: 기존 completed tombstone 조건과 고아 claimed 조건을 동일한 2-statement batch에 결합한다.**
- [x] **Step 4: 반환 개수와 멱등성을 집중 테스트로 검증한다.**

## Task 3: 운영 read route 실경계와 SOS 감사 수신자 정본화

**Files:**
- Create: `worker/tests/operationalRouteCoverage.test.mjs`
- Modify: `worker/routes/sos.ts`

- [x] **Step 1: `force-ring` active/history/quota, `subscriptions`, `send-sms`, SOS cooldown/events의 실제 Hono route 테스트를 작성한다.**
- [x] **Step 2: SOS body의 타 가족 receiver id가 감사 행에 그대로 저장되는 RED를 확인한다.**
- [x] **Step 3: SOS receiver 목록을 요청값이 아니라 해당 가족의 활성 부모 user id 목록으로 서버에서 결정한다.**
- [x] **Step 4: 인증·가족 격리·timestamp 정규화·quota 오류·SMS 내부 secret/config/provider 오류 회귀를 GREEN으로 만든다.**

## Task 4: Worker 전체 출시 Secret inventory gate

**Files:**
- Create: `scripts/verify-production-worker-secrets.mjs`
- Create: `tests/productionWorkerSecretGate.test.mjs`
- Modify: `package.json`
- Modify: `docs/feedback-operations.md`
- Modify: `docs/store/play-release-checklist.md`

- [x] **Step 1: inventory 읽기 실패, 12개 필수 이름 누락, 전체 충족을 검증하는 RED 테스트를 작성한다.**
- [x] **Step 2: Secret 값을 읽거나 출력하지 않고 Wrangler의 이름 목록만 검사하는 스크립트를 구현한다.**
- [x] **Step 3: `verify:production:worker-secrets` 명령을 추가하고 피드백 운영 문서의 폐기된 `hyeni-1` 경로를 이 저장소 `worker/`로 고친다.**
- [x] **Step 4: Play 체크리스트에 전체 gate 실행과 사용자 대화형 Secret 입력 경계를 명시한다.**

## Task 5: 운영 규칙 동기화와 전체 검증

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

- [x] **Step 1: pending retention, 고아 deletion claim, SOS receiver 정본, Secret gate와 배포 전 migration 순서를 두 문서에 함께 기록한다.**
- [x] **Step 2: 집중 Worker 테스트를 실행하고 `fail 0`을 확인한다.**
- [x] **Step 3: `npm run typecheck:worker`, `npm run test:worker`, `npm test`, `npm run build`, `git diff --check`를 실행한다.**
- [x] **Step 4: `verification-before-completion`과 `finishing-a-development-branch` 절차로 diff와 통합 선택지를 정리한다. 운영 D1 migration·Secret 입력·Worker/Pages/Play 배포·기기 설치는 별도 승인 전 수행하지 않는다.**

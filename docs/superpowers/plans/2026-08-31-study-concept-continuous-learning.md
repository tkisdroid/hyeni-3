# Study Concept Continuous Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 혜니캘린더 수학 미니앱에서 학년별 94개 세부 개념을 선택하고 묶음 종료 없이 자유롭게 계속 문제를 풀 수 있게 한다.

**Architecture:** Study Worker가 활성 콘텐츠 릴리스의 개념 카탈로그, 개념 지정 미션, 활성 미션 중단을 정본으로 제공한다. Calendar Worker는 기존 membership·KR market·HMAC 경계를 유지해 이를 중계하고, Calendar React 앱은 학년→개념→연속 문제 흐름을 제공한다. 내부 8문제 세션은 저장 원자성을 위해 유지하지만 UI에서 숨기고 같은 선택으로 자동 연결한다.

**Tech Stack:** TypeScript, Cloudflare Workers Service Bindings, D1, Hono, React 19, TanStack Query, Node test runner, Vitest

**Spec:** `docs/superpowers/specs/2026-08-31-study-concept-continuous-learning-design.md`

## Global Constraints

- 한국 전용 미니앱이므로 새 번역 카탈로그를 만들지 않고 한국어 고정 copy를 한 파일에서 관리한다.
- 보호자 정본 학년은 아이가 변경하지 못하고, `learner_selected` 학년만 다시 선택할 수 있다.
- Study 정답·해설·문제 ID 목록은 개념 카탈로그에 노출하지 않는다.
- Study API version 문자열 `2026-08-27`은 additive 배포 호환을 위해 유지한다.
- 내부 8문제 세션은 UI에 노출하지 않으며 마지막 문제 뒤 같은 선택으로 자동 연결한다.
- Study migration → Study Worker → Calendar Worker → Pages 순서로 배포한다.
- Play 스토어는 갱신하지 않고 A17과 razr에 `adb install -r`로 동일 debug APK만 설치한다.

---

### Task 1: Study 개념 카탈로그 계약과 저장소 조회

**Files:**
- Modify: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/contracts.ts`
- Modify: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/db/contentRepository.ts`
- Modify: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/services/calendarLearnerService.ts`
- Modify: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/entrypoints/CalendarStudyService.ts`
- Test: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/tests/calendarStudyService.test.ts`
- Create: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/tests/contentRepository.test.ts`

**Interfaces:**
- Produces: `CalendarConceptCatalogDto`, `ListCalendarConceptsInput`, `CalendarStudyService.listCalendarConcepts(input, authorization)`.
- Catalog item: `{ conceptId: string; unitKey: string; title: string; problemCount: number }`.

- [ ] **Step 1: Write failing catalog tests**

```ts
expect(await repository.listConceptCatalog(activeReleaseId, 3)).toEqual(expect.arrayContaining([
  expect.objectContaining({ conceptId: "g3-fraction-meaning", unitKey: "분수", title: "분수의 뜻", problemCount: 36 }),
]));
expect((await rpc.listCalendarConcepts({ memberId, grade: 3, requestId }, auth)).concepts).toHaveLength(29);
```

- [ ] **Step 2: Run RED tests**

Run: `pnpm exec vitest run worker/tests/contentRepository.test.ts worker/tests/calendarStudyService.test.ts`

Expected: FAIL because `listConceptCatalog` and `listCalendarConcepts` do not exist.

- [ ] **Step 3: Implement the narrow catalog**

```ts
export type CalendarConceptCatalogDto = Readonly<{
  apiVersion: typeof CALENDAR_STUDY_API_VERSION;
  grade: 3 | 4 | 5 | 6;
  concepts: readonly Readonly<{
    conceptId: string;
    unitKey: string;
    title: string;
    problemCount: number;
  }>[];
}>;
```

Query the single active release, exact grade, `COUNT(p.problem_id)`, and order by `concepts.ordinal, concept_id`. Reject empty titles, non-NFC IDs, counts below 1, and a requested grade different from the authorized learner grade.

- [ ] **Step 4: Run GREEN tests and Worker typecheck**

Run: `pnpm exec vitest run worker/tests/contentRepository.test.ts worker/tests/calendarStudyService.test.ts && pnpm run check:worker`

- [ ] **Step 5: Commit Task 1**

```powershell
git add worker/contracts.ts worker/db/contentRepository.ts worker/services/calendarLearnerService.ts worker/entrypoints/CalendarStudyService.ts worker/tests/calendarStudyService.test.ts worker/tests/contentRepository.test.ts
git commit -m "Study 학년별 세부 개념 카탈로그를 제공한다"
```

### Task 2: 개념 지정 미션 배정과 schema 9

**Files:**
- Create: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/db/migrations/0009_selected_concept_sessions.sql`
- Create: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/server/services/conceptSessionBuilder.ts`
- Test: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/server/services/conceptSessionBuilder.test.ts`
- Modify: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/shared/learningStorage.ts`
- Modify: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/db/schema.ts`
- Modify: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/db/learningRepository.ts`
- Modify: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/services/learnerService.ts`
- Modify: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/services/calendarLearnerService.ts`
- Test: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/tests/learningRepository.test.ts`
- Test: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/tests/schema.test.ts`

**Interfaces:**
- Consumes: catalog `conceptId` from Task 1.
- Produces: `startMission(profileId, requestId, selectedConceptId?: string)`, `ServerSessionPlan.selectedConceptId`, mission `selection` DTO.

- [ ] **Step 1: Write failing builder and repository tests**

```ts
const plan = buildConceptMissionPlan({
  requestedGrade: 3,
  selectedConceptId: "g3-fraction-meaning",
  contentVersionId,
  candidates,
  recentExposure,
  profileId,
  now,
  completedSessionCount: 0,
});
expect(plan.items).toHaveLength(8);
expect(new Set(plan.items.map(item => item.conceptId))).toEqual(new Set(["g3-fraction-meaning"]));
expect(new Set(plan.items.map(item => item.problemId)).size).toBe(8);
```

Also assert another-grade concept rejection and that stored/read sessions preserve `selectedConceptId`.

- [ ] **Step 2: Run RED tests**

Run: `pnpm exec vitest run server/services/conceptSessionBuilder.test.ts worker/tests/learningRepository.test.ts worker/tests/schema.test.ts`

- [ ] **Step 3: Add migration and deterministic concept builder**

```sql
ALTER TABLE learning_sessions ADD COLUMN selected_concept_id TEXT;
CREATE INDEX idx_learning_sessions_profile_concept_started
  ON learning_sessions(profile_id, selected_concept_id, started_at DESC)
  WHERE selected_concept_id IS NOT NULL;
INSERT INTO study_schema_version(version, applied_at) VALUES (9, datetime('now'));
```

The builder filters exact grade and concept, excludes the last 16 source IDs and prompt hashes while capacity permits, rotates by profile/date/completed-session seed, and selects eight unique candidates. If strict exclusion leaves fewer than eight, retry without recent exposure but still forbid duplicates inside the new session.

- [ ] **Step 4: Wire start and projection**

`StartCalendarMissionInput` accepts optional `conceptId`. The service validates the concept against the active release and authorized grade before building. Mission projection returns:

```ts
selection: selectedConceptId === null
  ? { kind: "adaptive" }
  : { kind: "concept", conceptId: selectedConceptId, title: selectedConceptTitle }
```

- [ ] **Step 5: Run GREEN tests, migration verification, parity and typecheck**

Run: `pnpm exec vitest run server/services/conceptSessionBuilder.test.ts worker/tests/learningRepository.test.ts worker/tests/schema.test.ts worker/tests/learningParity.test.ts && pnpm run d1:migrations:verify && pnpm run check:worker`

- [ ] **Step 6: Commit Task 2**

```powershell
git add worker/db/migrations/0009_selected_concept_sessions.sql server/services/conceptSessionBuilder.ts server/services/conceptSessionBuilder.test.ts shared/learningStorage.ts worker/db/schema.ts worker/db/learningRepository.ts worker/services/learnerService.ts worker/services/calendarLearnerService.ts worker/tests/learningRepository.test.ts worker/tests/schema.test.ts worker/tests/learningParity.test.ts
git commit -m "세부 개념 문제를 연속 세션으로 배정한다"
```

### Task 3: 활성 미션 중단과 주제 전환

**Files:**
- Modify: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/contracts.ts`
- Modify: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/db/learningRepository.ts`
- Modify: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/services/learnerService.ts`
- Modify: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/services/calendarLearnerService.ts`
- Modify: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/entrypoints/CalendarStudyService.ts`
- Test: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/tests/calendarStudyService.test.ts`
- Test: `C:/Users/TK/Downloads/math-explorer/.worktrees/fix-study-mission-start/worker/tests/learningRepository.test.ts`

**Interfaces:**
- Produces: `abandonCalendarMission(input, authorization): Promise<{ apiVersion; missionId; status: "abandoned" }>`.

- [ ] **Step 1: Write failing atomic-abandon tests**

```ts
await service.abandonMission(profileId, missionId, occurredAt);
expect(await sessionRow(missionId)).toMatchObject({ status: "abandoned", activeSlot: null });
expect(await unresolvedStateCount(missionId)).toBe(0);
expect(await attemptCount(missionId)).toBe(previousAttemptCount);
```

- [ ] **Step 2: Run RED test**

Run: `pnpm exec vitest run worker/tests/learningRepository.test.ts worker/tests/calendarStudyService.test.ts`

- [ ] **Step 3: Implement idempotent D1 batch and RPC**

Update unresolved states to `resolution_code='abandoned'`, update the active session to `status='abandoned', active_slot=NULL`, preserve attempts/progress/rewards, and return success for an already abandoned same-profile session. Reject completed sessions and another profile's session.

- [ ] **Step 4: Run GREEN tests and commit**

Run: `pnpm exec vitest run worker/tests/learningRepository.test.ts worker/tests/calendarStudyService.test.ts && pnpm run check:worker`

```powershell
git add worker/contracts.ts worker/db/learningRepository.ts worker/services/learnerService.ts worker/services/calendarLearnerService.ts worker/entrypoints/CalendarStudyService.ts worker/tests/calendarStudyService.test.ts worker/tests/learningRepository.test.ts
git commit -m "활성 학습을 보존 가능한 주제 전환으로 닫는다"
```

### Task 4: Calendar Worker의 새 Study gateway

**Files:**
- Modify: `worker/contracts/studyRpc.ts`
- Modify: `worker/lib/studyRpcAuthorization.ts`
- Modify: `worker/lib/studyGateway.ts`
- Modify: `worker/routes/study.ts`
- Modify: `worker/types.ts`
- Generate: `worker/worker-configuration.d.ts`
- Test: `worker/tests/studyGateway.test.mjs`
- Test: `worker/tests/studyRpcContract.test.mjs`
- Test: `worker/tests/studyGeneratedBindings.test.mjs`

**Interfaces:**
- Consumes: Task 1–3 Service Binding methods.
- Produces: HTTP concept list, concept mission start, abandon endpoints.

- [ ] **Step 1: Write failing route/authorization tests**

```js
assert.equal((await childRequest("/api/study/learner/concepts?grade=3")).status, 200);
assert.equal((await childRequest("/api/study/learner/missions", "POST", { mode: "daily", grade: 3, conceptId: "g3-fraction-meaning" })).status, 201);
assert.equal((await childRequest(`/api/study/learner/missions/${missionId}/abandon`, "POST", {})).status, 200);
```

Also assert unknown JSON keys, invalid/NFD/overlong concept IDs, parent callers, another member, and another-grade concept return 400/403 without calling the binding.

- [ ] **Step 2: Run RED tests**

Run: `node --test worker/tests/studyGateway.test.mjs worker/tests/studyRpcContract.test.mjs worker/tests/studyGeneratedBindings.test.mjs`

- [ ] **Step 3: Implement additive routes and operations**

Add HMAC operations `learner.catalog` and `learner.abandon`. Extend the strict mission body allowlist to `mode`, `grade`, `conceptId`. Keep `Cache-Control: no-store` and the five-second binding deadline.

- [ ] **Step 4: Generate bindings and run GREEN**

Run: `cd worker; pnpm exec wrangler types; cd ..; npm run typecheck:worker; node --test worker/tests/studyGateway.test.mjs worker/tests/studyRpcContract.test.mjs worker/tests/studyGeneratedBindings.test.mjs`

- [ ] **Step 5: Commit Task 4**

```powershell
git add worker/contracts/studyRpc.ts worker/lib/studyRpcAuthorization.ts worker/lib/studyGateway.ts worker/routes/study.ts worker/types.ts worker/worker-configuration.d.ts worker/tests/studyGateway.test.mjs worker/tests/studyRpcContract.test.mjs worker/tests/studyGeneratedBindings.test.mjs
git commit -m "Calendar에 세부 개념 학습 gateway를 연결한다"
```

### Task 5: Calendar client API와 query 상태

**Files:**
- Modify: `src/features/study/contracts.ts`
- Modify: `src/lib/api/endpoints/study.ts`
- Modify: `src/queries/keys.ts`
- Modify: `src/queries/useStudy.ts`
- Create: `src/features/study/studyTopicCopy.ts`
- Test: `tests/studyApi.test.ts`
- Test: `tests/childStudy.test.mjs`

**Interfaces:**
- Produces: `fetchStudyConcepts(grade)`, `useStudyConcepts(grade)`, `useAbandonStudyMission()`, `startStudyMission({ grade, conceptId })`.

- [ ] **Step 1: Write failing parser/query tests**

```ts
assert.deepEqual(await fetchStudyConcepts(3), {
  apiVersion: STUDY_API_VERSION,
  grade: 3,
  concepts: [{ conceptId: "g3-fraction-meaning", unitKey: "분수", title: "분수의 뜻", problemCount: 36 }],
});
assert.deepEqual(startRequestBody, { mode: "daily", grade: 3, conceptId: "g3-fraction-meaning" });
```

Reject duplicate concept IDs, wrong grade, empty unit/title, nonpositive counts, and extra DTO fields where the current parser uses exact shape checks.

- [ ] **Step 2: Run RED tests**

Run: `node --test tests/studyApi.test.ts tests/childStudy.test.mjs`

- [ ] **Step 3: Implement APIs and isolated Korean copy**

`studyTopicCopy.ts` owns `골고루 풀기`, `세부 개념`, `계속 학습 중`, `주제 바꾸기`, loading/error/retry copy. Mutations use `meta: { silentError: true }`; catalog keys are `qk.study.concepts(familyId, grade)`.

- [ ] **Step 4: Run GREEN and typecheck**

Run: `node --test tests/studyApi.test.ts tests/childStudy.test.mjs && npm run typecheck`

- [ ] **Step 5: Commit Task 5**

```powershell
git add src/features/study/contracts.ts src/features/study/studyTopicCopy.ts src/lib/api/endpoints/study.ts src/queries/keys.ts src/queries/useStudy.ts tests/studyApi.test.ts tests/childStudy.test.mjs
git commit -m "세부 개념 학습 client 계약을 추가한다"
```

### Task 6: 학년별 로딩, 개념 선택, 무제한 연속 UI

**Files:**
- Create: `src/features/study/StudyTopicPicker.tsx`
- Modify: `src/screens/study/ChildStudy.tsx`
- Modify: `src/features/study/StudyMissionPlayer.tsx`
- Modify: `src/features/study/player/studyPlayerState.ts`
- Modify: `src/features/study/child-study.css`
- Modify: `src/features/study/player/study-player.css`
- Modify: `scripts/final-browser-qa.mjs`
- Test: `tests/childStudy.test.mjs`
- Test: `tests/finalBrowserQaStudy.test.mjs`

**Interfaces:**
- Consumes: Task 5 hooks.
- Produces: grade→topic picker, current-topic player, `onChangeTopic`, automatic next mission.

- [ ] **Step 1: Write failing UI/model tests**

```js
assert.equal(gradeButtonState({ choice: 3, pendingGrade: 3 }).busy, true);
assert.equal(gradeButtonState({ choice: 4, pendingGrade: 3 }).busy, false);
assert.equal(resolveNextStudyAction({ finalProblem: true, feedbackNext: "continue" }), "continue_selection");
```

Browser fixture must click grade 3, verify only grade 3 has `aria-busy=true`, render all 29 concepts, select `분수의 뜻`, finish the internal last problem, and observe a new first problem without an 8문제 completion screen.

- [ ] **Step 2: Run RED tests**

Run: `node --test tests/childStudy.test.mjs tests/finalBrowserQaStudy.test.mjs`

- [ ] **Step 3: Implement focused components**

`StudyTopicPicker` groups concepts by `unitKey`, renders `골고루 풀기` first, and sets busy only on the selected grade/topic. `ChildStudy` preserves the selected learning choice across internal mission swaps. `StudyMissionPlayer` shows the selection title and `계속 학습 중`; when its reducer reaches completed it requests the next mission with the same selection instead of rendering `StudyMissionResult`.

- [ ] **Step 4: Implement free topic change and stale-cache guard**

On `주제 바꾸기`, await the silent abandon mutation, clear local mission/selection, refetch learner state, and show the concept picker. Use `refetchOnMount: "always"` plus `learner.isFetchedAfterMount` so a completed cached mission cannot be restored on reentry while an actually active mission still resumes.

- [ ] **Step 5: Run targeted tests, browser QA, CSS checks**

Run: `node --test tests/childStudy.test.mjs tests/finalBrowserQaStudy.test.mjs && npm run typecheck && npm run qa:browser`

- [ ] **Step 6: Commit Task 6**

```powershell
git add src/features/study/StudyTopicPicker.tsx src/screens/study/ChildStudy.tsx src/features/study/StudyMissionPlayer.tsx src/features/study/player/studyPlayerState.ts src/features/study/child-study.css src/features/study/player/study-player.css scripts/final-browser-qa.mjs tests/childStudy.test.mjs tests/finalBrowserQaStudy.test.mjs
git commit -m "학년별 세부 개념을 자유롭게 계속 학습한다"
```

### Task 7: 전체 회귀, 메인 통합, 배포, A17·razr 출시 판정

**Files:**
- Verify both repositories and generated artifacts; no Play metadata changes.

- [ ] **Step 1: Run full Study verification**

Run: `pnpm run check:worker; pnpm run d1:migrations:verify; pnpm run test:worker; pnpm run test:node:client-shared-scripts; pnpm dlx wrangler@4.127.1 deploy --dry-run --config wrangler.toml`

- [ ] **Step 2: Run full Calendar verification**

Run: `npm run typecheck; npm run typecheck:worker; npm run i18n:verify; npm test; npm run build; npm run qa:browser; pnpm dlx wrangler@4.127.1 deploy --dry-run --config worker/wrangler.toml`

Expected: zero failures, no generated locale drift, production assets contain the concept picker chunk.

- [ ] **Step 3: Review diffs and integrate main**

Read both worktree statuses, preserve all unrelated/untracked user artifacts, run `git diff --check`, fast-forward each repository `main`, push, and read back `origin/main` equals the exact local 40-character SHA.

- [ ] **Step 4: Deploy in compatibility order**

Apply only migration 0009 with Wrangler 4.127.1, read back schema version 9/index/foreign-key check, deploy Study Worker and confirm its new version is 100%. Deploy Calendar Worker, verify `/api/health` exact ready and unauthenticated Study route 401. Deploy Calendar `dist` to Pages from an external temp directory and verify fixed/deployment URLs serve matching entry and Study chunk SHA-256.

- [ ] **Step 5: Build and install both-device artifacts without clearing data**

Run the build once, then install the exact same APK with the repository installer on the fresh `adb devices -l` serials for A17 and razr:

`npx cap sync android; .\android\gradlew.bat -p android assembleDebug; npm run android:install:debug -- RFKL40DP73J; npm run android:install:debug -- ZY22H9VTQD`

Verify both devices' firstInstallTime remains unchanged, embedded web asset hashes equal `dist`, and package remains `com.hyeni.calendar` version 1.4.4 code 16.

- [ ] **Step 6: Establish roles, pairing, permissions, and perform the production journey**

Use existing secure sessions or device autofill without printing credentials. Set A17 to the tkisdroid parent role and razr to the paired child role, grant all app-required permissions through Android UI, and read back role/family consistency plus permission state. On razr click 아이 홈→미니앱→수학, select two grades in separate clean flows, confirm only the tapped grade loader moves, inspect grouped concept cards, solve adaptive and named-concept problems across an internal boundary, change topic mid-session, relaunch and resume, and measure answer-to-feedback median/p95/max. On A17 open the same child's parent Study management view. Record screenshots and a PII-free JSON report.

- [ ] **Step 7: Issue release decision**

Declare `출시 가능` only if main SHAs, migrations, active Workers, Pages hashes, A17 session preservation, concept correctness, uninterrupted continuation, topic switching, and latency all pass. Explicitly state that Play Store was not updated.

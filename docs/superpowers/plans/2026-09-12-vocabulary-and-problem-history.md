# 영단어 5단계와 부모 풀이 기록 구현 계획

> 실행 방식: `superpowers:executing-plans`에 따라 같은 세션에서 인라인 구현하고, 독립 검토는 읽기 전용 에이전트로 수행한다.

**목표:** 4,067개 영단어 플립카드와 지속되는 복습 기록, 부모의 실제 수학 문제/답안 조회를 완성한다.

**구조:** Calendar는 기존 인증/가족 권한으로 Study RPC를 호출한다. 학습 콘텐츠와 기록은 기존 Study D1과 profile identity를 사용한다. 수학 학년과 영어 단계는 분리한다.

**기술:** React·TypeScript·TanStack Query·Hono·Cloudflare D1/Service Binding/DO·Node test·Vitest Workers·Playwright.

**설계:** `docs/superpowers/specs/2026-09-12-vocabulary-and-problem-history-design.md`.

## 공통 제약

- 앱 시작점 `35ed585`와 Study 시작점 `e295008`의 사용자 작업을 보존한다.
- 부모 문구는 존댓말, 아이 문구는 반말이다. 기존 locale catalog와 오류/로딩 체계를 사용한다.
- 가족·member ID는 서버 정본이며 첫째 아이 폴백을 추가하지 않는다.
- 수학 릴리스 3,384문항·학년 3~6·기존 인증/refresh·운영 계정은 유지한다.
- 영단어는 1~5단계·352/352/813/1,322/1,228개다. 한 번에 40개씩 조회한다. 저장 시각은 서버가 정하며 자가평가를 수학 정확도에 합산하지 않는다.

## 1. Study 기록과 콘텐츠

파일: `math-explorer/worker/contracts.ts`, `worker/content/vocabularyCatalog.ts`, `worker/services/problemHistoryService.ts`, `worker/services/vocabularyService.ts`, `worker/profile/calendarProfileStore.ts`, `worker/db/migrations/0010_vocabulary_learning.sql`, `content/vocabulary/` 출처·발췌 자료.

출력 계약: `ChildProblemHistoryInput/Dto`, `VocabularyDeckInput/Dto`, `VocabularyReviewInput/Dto`, `ChildVocabularyProgressInput/Dto`. 문항 표시는 기존 표시 DTO에서 필요한 필드만 반환하고 제출 답안은 기존 11종 구조를 유지한다.

- [x] 격리 D1 fixture로 제출답과 원래 릴리스의 문항/해설 조회, 같은 시각의 keyset 페이지 경계, 다른 프로필 제외를 검증했다.
- [x] 카탈로그 4,067개의 ID/단어 중복·5단계·뜻·품사·출처 및 시작 어휘 93개 대표 뜻 발췌를 검사했다.
- [x] 영어 저장의 재시도/입력 충돌/실패 원자성, grade NULL→수학 진입, 기존 수학 학년 보존을 검증했다. legacy 잠금은 보존이며 production 삭제 경로는 이번 구현 대상 밖이다.
- [x] 서비스·카탈로그·additive migration·profile identity helper를 구현하고 해당 회귀를 통과시켰다.

검사: `pnpm exec vitest run --config vitest.worker.config.ts worker/tests/problemHistoryService.test.ts worker/tests/vocabularyService.test.ts worker/tests/calendarProfileStore.test.ts`.

## 2. 기존 인증 경계로 네 개 API 연결

파일: 두 저장소의 RPC 계약·operation 정책, Study `CalendarStudyService` 구현과 production wrapper, `StudyProfileCoordinator`, Calendar `worker/routes/study.ts`·`worker/lib/studyGateway.ts`와 관련 Worker 테스트.

- [x] 활성 제2 부모의 조회와 다른 가족·역할·아이 위조 거부 회귀를 추가했다.
- [x] 아이 입력의 family/member/profile·임의 필드 주입을 거부하고 level/rating/cursor를 검사한다.
- [x] 서명 fingerprint와 production RPC allowlist에 신규 네 operation을 연결했다.
- [x] 계약 호환성·binding 타입·새 서비스 단위/route 회귀를 확인했다.

검사: Calendar `npm run typecheck:worker`, Study `pnpm run check:worker`, 두 저장소 관련 Worker 회귀.

## 3. 미니앱 카드와 부모 기록 화면

파일: `src/features/study/vocabulary*`, `src/features/study/StudyProblemHistory.tsx`, `src/features/study/studyAttemptView.ts`, `src/lib/api/endpoints/study*.ts`, `src/queries/useStudy*.ts`, `src/queries/keys.ts`, `src/screens/study/*`, `src/screens/miniapps/MiniApps.tsx`, `src/app/App.tsx`, locale catalog.

- [x] 11종 답안 표시와 query의 가족/사용자/아이/단계 분리 검사를 추가했다.
- [x] 단계 선택→뒤집기→자가평가 저장→다음 카드→복습/완료를 구현했다. 저장 실패는 같은 카드와 요청 키를 유지한다.
- [x] 부모 영어 기록과 수학 문제 상세/더 불러오기를 연결하고 아이 전환 시 상세/페이지 상태를 초기화한다.
- [x] 누락 원본·자가확인·미채점·힌트 사용을 표시하고 API 실패를 빈 기록과 구분한다.
- [x] 키보드 조작·접근성 상태·동작 줄이기·좁은 화면을 확인하고 locale 10개 생성물을 갱신했다. 실제 음성 스크린리더는 미검증이다.

검사: `node --test tests/studyAttemptView.test.ts tests/vocabularyLearning.test.ts tests/studyLearningApi.test.ts`, `npm run typecheck`, `npm run i18n:verify`, `npm run build`.

## 4. 통합 검증과 인계

- [x] 격리 Study RPC+D1에서 아이 저장→부모 조회를, Calendar Hono route에서 현재 가족·역할 권한을 각각 검증했다.
- [x] Playwright의 fixture API로 320/390/1280px, 단계 5개, 뒤집기, 복습, 저장 실패/재시도, 부모 문항/답안, 아이 전환을 검증했다.
- [x] 앱 전체·두 Worker 전체와 타입/빌드/migration 검사를 실행했다. 결과는 검증 기록에서 최신 실행 기준으로 정리한다.
- [x] 독립 검토로 실제 수학 3,384개 파싱 중 발견한 alternative 배열 불일치를 수정했다. 디자인 단계와 문서도 동기화했다.
- [ ] 기능 브랜치 커밋·푸시와 최신 브라우저 증거를 확정해 보고한다. 운영 migration·배포·실기기는 별도 완료 항목이다.

# I18n 통합 게이트 복구 계획

> **작업 에이전트 필수:** `superpowers:subagent-driven-development`와 `superpowers:test-driven-development` 절차로 태스크별 구현·독립 검토를 수행한다.

**목표:** 웹 i18n Task 1~5 통합 뒤 깨진 라우트 정적 계약과 500,000-byte 초기 진입 번들 예산을, 기존 안전 계약과 지연 로딩을 약화하지 않고 복구한다.

**확정 원인:** `1a1fdf6`에서 `routeElement(<Screen />)`가 `routeElement(<Screen />, NAMESPACES)`로 확장됐지만 AST helper와 삭제 mutation fixture는 한 인자 형태에 고정돼 59개 라우트를 모두 누락한다. 번들은 기준선과 i18n Task 2가 모두 479,694B였으나 `LocaleProvider`가 `react-intl`을 진입점에 연결한 i18n Task 3에서 542,386B로 62,692B 증가했고 현재 547,406B다.

**금지:** 500,000-byte 예산 상향, 검사 비활성화, `chunkSizeWarningLimit`로 경고 은폐, route 화면 eager import, PWA 중복 허용, locale fallback·원자 전환 계약 변경.

### Task 1: namespace 인자를 이해하는 라우트 AST 계약 복구

**Files:**
- Modify: `tests/helpers/routeContract.mjs`
- Modify: `tests/routeLazyLoading.test.mjs`

- [ ] **Step 1: 현재 실패를 재현한다**

Run: `node --test tests/routeLazyLoading.test.mjs`

Expected: 59개 라우트 actual `[]`, 삭제 fixture가 원본을 바꾸지 못한 2개 FAIL.

- [ ] **Step 2: namespace 인자 회귀를 테스트로 고정한다**

현재 두 인자 `routeElement(<ParentHome />, PARENT_NAMESPACES)`를 parser가 `ParentHome`으로 인식하고, 해당 라우트 삭제 mutation이 실제 source를 바꾼 뒤 계약 위반으로 거부됨을 검증한다. 라우트 수·path·guard·availability 정본은 바꾸지 않는다.

- [ ] **Step 3: AST parser를 최소 수정한다**

`routeElement`의 첫 번째 인자에서 화면 JSX를 읽고 현재 지원되는 namespace 두 번째 인자를 허용한다. 인자 0개나 계약 밖 형태를 조용히 통과시키지 않는다. 정규식 parser로 퇴행하지 않는다.

- [ ] **Step 4: 검증하고 커밋한다**

Run:

```powershell
node --test tests/routeLazyLoading.test.mjs
npm run typecheck
git diff --check
```

Commit message: `namespace 라우트 정적 계약을 복구한다`

### Task 2: i18n 런타임 진입 번들 분리

**Files:**
- Modify: `vite.config.ts`
- Modify: `tests/routeBundleBudget.test.mjs` only if a durable, behavior-based regression assertion is needed

- [ ] **Step 1: 현재 실패와 기준 수치를 기록한다**

Run: `npm run build`

Expected: Vite/PWA 생성 뒤 entry 547,406B로 500,000B 미만 계약 FAIL. 기준선·Task 2는 479,694B, Task 3는 542,386B였다는 원인 증거를 보고서에 남긴다.

- [ ] **Step 2: 최소 chunking 가설을 검증한다**

`react-intl`, `intl-messageformat`, `@formatjs` 및 순환을 피하기 위해 필요한 React runtime만 명시적인 안정 vendor chunk로 분리한다. route 전용 화면·아이콘·QR 모듈을 이 초기 vendor chunk로 끌어오지 않는다. 생성 결과에서 순환 chunk 경고가 없어야 한다.

- [ ] **Step 3: 예산 완화 없이 설정을 구현한다**

`ROUTE_ENTRY_LIMIT_BYTES=500_000`과 build 검증 명령은 그대로 둔다. `manualChunks` 또는 동등한 Rollup 분리를 Vite 설정에 넣되, 단순히 별도 app bootstrap으로 전체 547KB를 옮겨 검사만 우회하지 않는다.

- [ ] **Step 4: route lazy·PWA·전체 build를 검증한다**

Run:

```powershell
node --test tests/routeBundleBudget.test.mjs tests/routeLazyLoading.test.mjs tests/pwaPrecacheManifest.test.mjs
npm run typecheck
npm run build
git diff --check
```

Expected: 모두 exit 0, HTML module entry 1개, entry <500,000B, CSS <40,000B, PWA URL 중복 0, 58개 lazy 화면·59개 라우트 유지. 결과 보고서에 entry/vendor raw·gzip 크기를 기록한다.

- [ ] **Step 5: 커밋한다**

Commit message: `i18n 런타임 진입 번들을 분리한다`

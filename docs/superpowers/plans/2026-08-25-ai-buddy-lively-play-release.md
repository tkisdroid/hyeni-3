# 혜니 입체 도약 1.4.2 출시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 18장 혜니 캐릭터의 짧은 입체 도약 변경을 Android `1.4.2`/`versionCode 14`로 묶어 D1 무변경을 확인하고 Worker·Pages·Google Play production에 안전하게 배포한다.

**Architecture:** 앱 버전 메타데이터와 출시 문서를 먼저 TDD로 동기화해 clean 소스 커밋을 만든다. D1은 신규 SQL이 없으므로 원격 읽기 검증만 수행하고, Worker는 동일 정본을 전체 회귀 뒤 재배포한다. 그 clean 커밋에서 사용자가 직접 비밀번호를 입력해 승인 업로드 키 AAB를 만들고, Android Publisher API로 현재 심사 중인 code 13을 code 14로 대체 전송한 뒤 모든 증거를 별도 문서 커밋에 고정한다.

**Tech Stack:** Vite 7 · React 19 · TypeScript · Capacitor 8 · Gradle · Cloudflare Worker/D1/Pages · Android Publisher API

**Spec:** `CLAUDE.md`의 2026-08-25 아이 홈 혜니 도약 배포 기록, `docs/store/play-console-submission-v1.4.1.md`의 심사 대체·증거·원격 업데이트 정책

## Global Constraints

- 연결 기기는 razr `ZY22H9VTQD`만 사용하고 `npm run android:install:debug -- ZY22H9VTQD`로 사용자 0에 보존 설치한다.
- 계정·역할·페어링·세션을 변경하지 않고 refresh token을 읽거나 회전하지 않는다.
- D1 신규/변경 SQL이 없으므로 어떤 migration도 실행하지 않는다. 읽기 전용 schema/connectivity query만 허용한다.
- 서명 비밀번호는 사용자가 보이는 PowerShell 창에서 직접 입력하며 파일·로그·채팅에 저장하지 않는다.
- 기존 Play 등록정보와 icon·feature graphic·phone screenshots는 write API로 변경하지 않는다.
- code 14가 `PUBLISHED`가 되기 전에는 `public/app-version.json`의 minimum/latest를 `1.4.0`으로 유지한다.
- 현재 code 13 `IN_REVIEW`, code 6 `PUBLISHED`, Play 최대 code 13이라는 2026-08-25 fresh API 상태가 바뀌면 제출 전에 중단하고 재판정한다.

---

### Task 1: 1.4.2/code 14 메타데이터를 TDD로 동기화

**Files:**
- Replace: `tests/playReleaseV141Metadata.test.mjs` → `tests/playReleaseV142Metadata.test.mjs`
- Modify: `tests/appVersionConsistency.test.mjs`
- Modify: `tests/iosPackagingReadiness.test.mjs`
- Modify: `tests/teacherProductionGate.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `android/app/build.gradle`
- Modify: `ios/App/App.xcodeproj/project.pbxproj`
- Modify: `docs/ios-build.md`
- Modify: `docs/store/play-listing.md`
- Create: `docs/store/play-release-notes-v1.4.2.md`
- Create: `docs/store/play-console-submission-v1.4.2.md`

**Interfaces:**
- Consumes: package version을 읽는 Vite/Gradle 기존 계약과 Play code 13 상태
- Produces: 앱/PWA/iOS 표시 버전 `1.4.2`, Android/iOS build number `14`, 500자 이하 한국어 출시 노트

- [ ] **Step 1: 현재 버전 계약을 1.4.2/code 14로 바꾼 테스트를 먼저 작성한다**

  `tests/playReleaseV142Metadata.test.mjs`는 package `1.4.2`, Android code 14, iOS build 14/marketing 1.4.2와 새 출시 문서의 혜니 도약·그림자 설명을 검증한다. `tests/appVersionConsistency.test.mjs`의 사용자 표시 버전도 `1.4.2`로 바꾼다.

- [ ] **Step 2: RED를 확인한다**

  Run: `node --test tests/playReleaseV142Metadata.test.mjs tests/appVersionConsistency.test.mjs tests/iosPackagingReadiness.test.mjs tests/teacherProductionGate.test.mjs`

  Expected: 기존 package `1.4.1`, Android/iOS build 13 또는 새 문서 부재 때문에 FAIL.

- [ ] **Step 3: 최소 메타데이터와 문서를 구현한다**

  package/package-lock은 `1.4.2`, Android/iOS build는 `14`, iOS marketing은 `1.4.2`로 맞춘다. 출시 노트의 text 블록은 아래 문구로 고정한다.

  ```text
  아이 홈의 혜니가 더 생생하게 움직여요.

  · 자리를 옮길 때 가볍게 뛰고 부드럽게 착지
  · 발밑 그림자로 움직임의 높이와 입체감 강화
  · 기존 표정·대화·일정 안내와 SOS 동선은 그대로 유지
  ```

  제출 문서는 code 14 후보 생성 전 상태와 code 13 현재 심사 상태를 사실대로 기록한다.

- [ ] **Step 4: GREEN과 전체 앱 회귀를 확인한다**

  Run: `node --test tests/playReleaseV142Metadata.test.mjs tests/appVersionConsistency.test.mjs tests/iosPackagingReadiness.test.mjs tests/teacherProductionGate.test.mjs`

  Run: `npm run typecheck`

  Run: `npm test` — 마지막 요약이 `ℹ fail 0`이어야 한다.

  Run: `npm run build`

- [ ] **Step 5: clean 출시 소스 커밋을 만든다**

  Commit: `chore: 1.4.2 출시 후보 버전 동기화`

### Task 2: D1 무변경 확인과 Worker 재배포

**Files:**
- No D1/Worker source changes

**Interfaces:**
- Consumes: `worker/wrangler.toml`의 production D1 binding과 현재 Worker source commit `0a6e87d`
- Produces: D1 `changes=0` 읽기 증거, 새 Worker version ID, `/api/health` 200 readback

- [ ] **Step 1: D1 변경 부재를 Git으로 확인한다**

  Run: `git diff --name-only 0a6e87d123f86745221c24b37c53fd2032bd495b..HEAD -- worker/db`

  Expected: 출력 없음.

- [ ] **Step 2: production D1을 읽기 전용으로 확인한다**

  Run from `worker/`: `wrangler d1 execute hyeni-calendar --remote --command "SELECT COUNT(*) AS schema_objects FROM sqlite_master WHERE type IN ('table','index','view','trigger');"`

  Expected: 성공 응답, `changes=0`; SQL migration 실행 없음.

- [ ] **Step 3: Worker 전체 검증을 실행한다**

  Run: `npm run typecheck:worker`

  Run: `npm run test:worker` — 마지막 요약이 `ℹ fail 0`이어야 한다.

- [ ] **Step 4: 현재 정본 Worker를 배포하고 readback한다**

  Run: `npm run deploy:worker`

  Verify: 새 version ID, `https://hyeni-calendar-api.tkisdroid.workers.dev/api/health` 200 `ready`, 미인증 보호 route 401.

### Task 3: 1.4.2 웹과 razr debug 후보를 검증·배포

**Files:**
- Build outputs only: `dist/`, `android/app/build/outputs/`

**Interfaces:**
- Consumes: Task 1 clean source commit
- Produces: Pages 1.4.2 bundle hash와 razr code 14 보존 설치 증거

- [ ] **Step 1: clean commit에서 VITE 공개 환경값으로 production build와 Capacitor sync를 실행한다**

  Run: `npm run build && npx cap sync android`

- [ ] **Step 2: Android unit·lint·debug APK를 검증한다**

  Run from `android/`: `gradlew.bat --no-daemon testDebugUnitTest lintDebug assembleDebug`

- [ ] **Step 3: razr 사용자 0에 code 14 debug APK를 보존 설치한다**

  Run: `npm run android:install:debug -- ZY22H9VTQD`

  Verify: `Success`, versionName `1.4.2`, versionCode `14`, `firstInstallTime` 유지, MainActivity launch 성공.

- [ ] **Step 4: Pages를 저장소 밖 임시 디렉터리에서 배포하고 세 도메인을 대조한다**

  Run: `$sourceSha=(git rev-parse HEAD).Trim(); wrangler pages deploy "$((git rev-parse --show-toplevel).Trim())/dist" --project-name=hyeni-calendar --branch=main --commit-dirty=true --commit-hash=$sourceSha`

  Verify: 배포별 주소·고정 Pages·브랜드 도메인의 entry/CSS SHA-256 일치, `/oauth/callback` 200·같은 entry.

### Task 4: 승인 업로드 키로 signed AAB 생성

**Files:**
- Generated: `android/app/build/outputs/bundle/release/app-release.aab`
- Generated: `artifacts/release-evidence/play-upload-v1.4.2-vc14-$((git rev-parse --short=7 HEAD).Trim())/`

**Interfaces:**
- Consumes: clean Task 1 source SHA, 사용자 직접 입력 비밀번호, 승인 upload keystore/certificate
- Produces: versionName 1.4.2/versionCode 14 signed AAB와 schema v4 기계 증거

- [ ] **Step 1: release preflight를 실행한다**

  Run: `pwsh -File scripts/build-android-release.ps1 -PreflightOnly`

  Expected: clean worktree, keystore/certificate/Kakao 공개 키 준비, 평문 자격 파일 없음.

- [ ] **Step 2: 사용자가 보이는 PowerShell에서 비밀번호를 직접 입력해 release script를 완료한다**

  Run: `pwsh -File scripts/build-android-release.ps1`

  The script must build/sync, prompt securely, verify upload certificate, run `bundleRelease`, `jarsigner`, bundletool, universal APK/ELF 16KB checks, then clear signing environment.

- [ ] **Step 3: build script가 만든 기계 evidence에서 크기·mtime·SHA-256·source SHA를 읽는다**

  `scripts/build-android-release.ps1`이 내부에서 `npm run release:aab-evidence`를 실행해 만드는 최신 `android-release-aab-evidence-*.json`과 검증 로그를 사용한다.

  Verify: non-debuggable, exact permissions, embedded web assets equal Task 3 Pages artifact, approved upload certificate fingerprint.

### Task 5: Google Play code 14 대체 제출

**Files:**
- Generated evidence under: `artifacts/release-evidence/play-submit-v1.4.2-vc14-20260825/`

**Interfaces:**
- Consumes: Task 4 exact signed AAB and `docs/store/play-release-notes-v1.4.2.md`
- Produces: production completed intent with code 14, lifecycle `IN_REVIEW`, unchanged listing/image hashes

- [ ] **Step 1: 제출 직전 fresh inspect를 실행한다**

  Verify: code 13 `IN_REVIEW`, code 6 `PUBLISHED`, max code 13, listing hash `d0c0824da0c55530dbd681af08765e69d8b34aa6f04d24aec074558f3c4b9dc9`, image hash `651ef7874b929ad9062517a7a5c1605a98da8b9d04107b02f3aab4f85bdfede1`. 다르면 제출을 중단한다.

- [ ] **Step 2: exact AAB size/SHA/version을 고정한 감사된 제출 도구를 준비한다**

  기존 `play-release.mjs`의 package/track/listing 보존·TOCTOU·validate·commit 안전장치를 유지하고 후보 상수만 1.4.2/code 14/실제 AAB 값으로 바꾼다.

- [ ] **Step 3: production code 14를 validate 후 심사 대체 전송한다**

  Commit query: `changesNotSentForReview=false&changesInReviewBehavior=CANCEL_IN_REVIEW_AND_SUBMIT`

  Verify: 업로드 응답 code 14와 exact SHA-256, edit production release name `혜니캘린더 1.4.2 (14)`, release notes exact match.

- [ ] **Step 4: fresh lifecycle과 스토어 자산을 readback한다**

  Expected: code 14 `IN_REVIEW`, code 6 `PUBLISHED`, code 13이 심사 목록에서 제거됨, listing/image hashes unchanged. 등록정보·이미지 write API는 호출하지 않는다.

### Task 6: 증거 문서·커밋·main push

**Files:**
- Modify: `docs/store/play-console-submission-v1.4.2.md`
- Modify: `tests/playReleaseV142Metadata.test.mjs`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 2–5의 exact version IDs, deployment URL, hashes, timestamps, lifecycle
- Produces: 감사 가능한 최종 이력과 `origin/main` 일치 상태

- [ ] **Step 1: 실제 증거만 문서에 반영한다**

  Worker version ID, D1 no-op readback, Pages URL/asset hashes, AAB size/SHA/mtime/source SHA, Play upload SHA와 lifecycle을 기록한다. code 14는 `PUBLISHED` 전까지 제공 완료라고 쓰지 않는다.

- [ ] **Step 2: 문서 계약 테스트와 diff를 검증한다**

  Run: `node --test tests/playReleaseV142Metadata.test.mjs`

  Run: `git diff --check`

- [ ] **Step 3: 증거 커밋을 만들고 main을 fast-forward/push한다**

  Commit: `문서: 1.4.2 Play 배포 증거 기록`

  Verify: local main SHA = `origin/main`, tracked worktree clean, 사용자 소유 미추적 파일 보존.

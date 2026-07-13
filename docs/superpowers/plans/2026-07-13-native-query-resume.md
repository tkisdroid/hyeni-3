# Android 포그라운드 조회 복구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Android 앱이 백그라운드에서 복귀할 때 세션을 먼저 안전하게 조정한 뒤 현재 화면의 활성 TanStack Query만 한 번 재조회한다.

**Architecture:** 프레임워크와 분리된 `nativeQueryResume` 조정기가 `inactive -> active` 전환, single-flight 및 dispose를 담당한다. `NativeBootstrap`은 Capacitor `App` 상태를 조정기에 전달하고, 복귀 작업에서 네이티브 세션 채택·Auth 동기화·활성 query 재조회를 순서대로 실행한다. TanStack `focusManager`는 paused mutation을 재개하므로 사용하지 않는다.

**Tech Stack:** Vite 7, React 19, TypeScript strict, TanStack Query 5.101.2, Capacitor App 8.1.0, Node test runner, Android/ADB/CDP

## Global Constraints

- 새 라이브러리를 추가하지 않는다.
- Android 네이티브에서만 새 생명주기 연동을 실행하고 웹·PWA 동작은 유지한다.
- refresh 토큰 원문을 읽거나 출력하거나 외부에서 회전시키지 않는다.
- `queryClient.refetchQueries({ type: "active" }, { cancelRefetch: true })`만 실행하며 mutation, 원격 위치 요청, 결제, AI 및 원격 제어를 자동 실행하지 않는다.
- `adoptNativeLocationSessionTokens()`가 끝난 뒤에만 활성 query를 재조회한다.
- S25와 razr 설치는 `adb install -r`만 사용하고 앱 데이터·세션·페어링을 삭제하지 않는다.
- 기존 `src/screens/teacher/TeacherStudents.css`, `src/screens/teacher/TeacherStudents.tsx`, `tsconfig.app.tsbuildinfo`, 임시 파일 및 `output/` 변경은 스테이징하지 않는다.
- 코드와 테스트의 주석·테스트명·커밋 메시지는 한국어로 작성한다.

## 파일 구조

- Create `src/queries/nativeQueryResume.ts`: 네이티브 활성 상태 전환 조정기와 세션 우선 활성 query 복구 함수.
- Create `tests/nativeQueryResume.test.ts`: 상태 전환, single-flight, dispose, 세션·조회 순서 단위 테스트.
- Create `tests/nativeQueryResumeWiring.test.mjs`: `NativeBootstrap`의 Capacitor 연결과 mutation 차단 구조 회귀 테스트.
- Modify `src/app/NativeBootstrap.tsx`: Android `appStateChange`를 복구 조정기에 연결.
- Modify `AGENTS.md`: 포그라운드 조회 복구 안전 규칙 추가.
- Modify `CLAUDE.md`: 같은 운영 규칙과 실기기 검증 결과 동기화.

---

### Task 0: Windows CRLF 기준선 테스트 보정

**Files:**
- Modify: `tests/nativeSessionResumeSafety.test.mjs`

**Interfaces:**
- Keeps: 기존 세션 안전 정규식과 함수 경계 검증.
- Normalizes: `read()`가 읽은 소스의 `CRLF`/`CR`만 `LF`로 변환.

- [ ] **Step 1: 기존 전체 테스트에서 3개 함수 경계 검사가 실패하는 RED 확인**

Run: `node --test tests/*.test.*`

Expected: 291 pass, 3 fail with `함수의 끝을 찾지 못했습니다`.

- [ ] **Step 2: 테스트 입력 줄바꿈만 정규화**

```js
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n?/g, "\n");
```

- [ ] **Step 3: 전체 기준 테스트 GREEN 확인**

Run: `node --test tests/*.test.*`

Expected: 294 pass, 0 fail.

- [ ] **Step 4: 기준선 테스트와 승인된 계획 보정만 커밋**

```powershell
git add -- tests/nativeSessionResumeSafety.test.mjs docs/superpowers/plans/2026-07-13-native-query-resume.md
git diff --cached --check
git commit -m "test: Windows 줄바꿈에서도 세션 안전 검사"
```

### Task 1: 생명주기 조정기와 세션 우선 복구 함수

**Files:**
- Create: `src/queries/nativeQueryResume.ts`
- Create: `tests/nativeQueryResume.test.ts`

**Interfaces:**
- Produces: `createNativeQueryResumeCoordinator(options): NativeQueryResumeCoordinator`
- Produces: `resumeActiveQueriesAfterNativeForeground(dependencies): Promise<void>`
- `NativeQueryResumeCoordinator.initialize(isActive)`는 최초 상태를 기준값으로만 저장한다.
- `NativeQueryResumeCoordinator.handleAppState(isActive)`는 `inactive -> active` 전환만 실행한다.
- `NativeQueryResumeCoordinator.dispose()`는 새 작업과 대기 작업을 차단한다.

- [ ] **Step 1: 실패하는 상태 전환·순서 테스트 작성**

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  createNativeQueryResumeCoordinator,
  resumeActiveQueriesAfterNativeForeground,
} from "../src/queries/nativeQueryResume.ts";

const flushAsync = () => new Promise<void>((resolve) => setImmediate(resolve));

test("최초 active와 중복 active는 조회하지 않고 inactive 복귀만 한 번 실행한다", async () => {
  let calls = 0;
  const coordinator = createNativeQueryResumeCoordinator({
    resume: async () => { calls += 1; },
    onError: () => undefined,
  });

  coordinator.initialize(true);
  coordinator.handleAppState(true);
  coordinator.handleAppState(false);
  assert.equal(calls, 0);

  coordinator.handleAppState(true);
  await flushAsync();
  assert.equal(calls, 1);

  coordinator.handleAppState(true);
  await flushAsync();
  assert.equal(calls, 1);
});

test("복구 중 여러 번 다시 복귀해도 후속 작업은 한 번만 직렬 실행한다", async () => {
  let calls = 0;
  let releaseFirst: () => void = () => undefined;
  const firstRun = new Promise<void>((resolve) => {
    releaseFirst = () => resolve();
  });
  const coordinator = createNativeQueryResumeCoordinator({
    resume: async () => {
      calls += 1;
      if (calls === 1) await firstRun;
    },
    onError: () => undefined,
  });

  coordinator.initialize(false);
  coordinator.handleAppState(true);
  await flushAsync();
  assert.equal(calls, 1);

  coordinator.handleAppState(false);
  coordinator.handleAppState(true);
  coordinator.handleAppState(false);
  coordinator.handleAppState(true);
  await flushAsync();
  assert.equal(calls, 1);

  releaseFirst();
  await flushAsync();
  await flushAsync();
  assert.equal(calls, 2);
});

test("dispose 뒤에는 새 복구 작업을 실행하지 않는다", async () => {
  let calls = 0;
  const coordinator = createNativeQueryResumeCoordinator({
    resume: async () => { calls += 1; },
    onError: () => undefined,
  });
  coordinator.initialize(false);
  coordinator.dispose();
  coordinator.handleAppState(true);
  await flushAsync();
  assert.equal(calls, 0);
});

test("복구 실패를 보고한 뒤 다음 inactive 복귀는 다시 실행한다", async () => {
  let calls = 0;
  const errors: unknown[] = [];
  const coordinator = createNativeQueryResumeCoordinator({
    resume: async () => {
      calls += 1;
      if (calls === 1) throw new Error("첫 복구 실패");
    },
    onError: (error) => { errors.push(error); },
  });

  coordinator.initialize(false);
  coordinator.handleAppState(true);
  await flushAsync();
  assert.equal(calls, 1);
  assert.equal(errors.length, 1);

  coordinator.handleAppState(false);
  coordinator.handleAppState(true);
  await flushAsync();
  assert.equal(calls, 2);
});

test("네이티브 세션을 채택하면 Auth 동기화와 렌더 대기 뒤 활성 query를 조회한다", async () => {
  const events: string[] = [];
  await resumeActiveQueriesAfterNativeForeground({
    adoptSession: async () => { events.push("adopt"); return true; },
    syncSession: () => { events.push("sync"); },
    waitForAuthRender: async () => { events.push("wait"); },
    isDisposed: () => false,
    refetchActiveQueries: async () => { events.push("refetch"); },
  });
  assert.deepEqual(events, ["adopt", "sync", "wait", "refetch"]);
});

test("세션 변경이 없으면 렌더 대기 없이 활성 query를 조회한다", async () => {
  const events: string[] = [];
  await resumeActiveQueriesAfterNativeForeground({
    adoptSession: async () => { events.push("adopt"); return false; },
    syncSession: () => { events.push("sync"); },
    waitForAuthRender: async () => { events.push("wait"); },
    isDisposed: () => false,
    refetchActiveQueries: async () => { events.push("refetch"); },
  });
  assert.deepEqual(events, ["adopt", "refetch"]);
});

test("정리 중 끝난 세션 채택은 Auth와 query를 다시 살리지 않는다", async () => {
  const events: string[] = [];
  let disposed = false;
  await resumeActiveQueriesAfterNativeForeground({
    adoptSession: async () => { events.push("adopt"); disposed = true; return true; },
    syncSession: () => { events.push("sync"); },
    waitForAuthRender: async () => { events.push("wait"); },
    isDisposed: () => disposed,
    refetchActiveQueries: async () => { events.push("refetch"); },
  });
  assert.deepEqual(events, ["adopt"]);
});
```

- [ ] **Step 2: 새 테스트가 구현 부재로 실패하는지 확인**

Run: `node --test tests/nativeQueryResume.test.ts`

Expected: `ERR_MODULE_NOT_FOUND` for `src/queries/nativeQueryResume.ts`.

- [ ] **Step 3: 최소 조정기와 복구 함수 구현**

```ts
interface NativeQueryResumeCoordinatorOptions {
  resume: () => Promise<void>;
  onError: (error: unknown) => void;
}

export interface NativeQueryResumeCoordinator {
  initialize: (isActive: boolean) => void;
  handleAppState: (isActive: boolean) => void;
  dispose: () => void;
}

export interface NativeQueryResumeDependencies {
  adoptSession: () => Promise<boolean>;
  syncSession: () => void;
  waitForAuthRender: () => Promise<void>;
  isDisposed: () => boolean;
  refetchActiveQueries: () => Promise<void>;
}

export function createNativeQueryResumeCoordinator(
  { resume, onError }: NativeQueryResumeCoordinatorOptions,
): NativeQueryResumeCoordinator {
  let initialized = false;
  let lastIsActive = false;
  let running = false;
  let queued = false;
  let disposed = false;

  const startResume = () => {
    if (disposed) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    void Promise.resolve()
      .then(resume)
      .catch((error: unknown) => {
        if (!disposed) onError(error);
      })
      .finally(() => {
        running = false;
        if (disposed) {
          queued = false;
          return;
        }
        if (!queued) return;
        queued = false;
        startResume();
      });
  };

  return {
    initialize(isActive) {
      if (disposed || initialized) return;
      initialized = true;
      lastIsActive = isActive;
    },
    handleAppState(isActive) {
      if (disposed) return;
      if (!initialized) {
        initialized = true;
        lastIsActive = isActive;
        return;
      }
      const shouldResume = !lastIsActive && isActive;
      lastIsActive = isActive;
      if (shouldResume) startResume();
    },
    dispose() {
      disposed = true;
      queued = false;
    },
  };
}

export async function resumeActiveQueriesAfterNativeForeground(
  dependencies: NativeQueryResumeDependencies,
): Promise<void> {
  const adopted = await dependencies.adoptSession();
  if (dependencies.isDisposed()) return;

  if (adopted) {
    dependencies.syncSession();
    await dependencies.waitForAuthRender();
  }
  if (dependencies.isDisposed()) return;

  await dependencies.refetchActiveQueries();
}
```

- [ ] **Step 4: 조정기 테스트 통과 확인**

Run: `node --test tests/nativeQueryResume.test.ts`

Expected: 7 tests pass, 0 fail.

- [ ] **Step 5: Task 1 파일만 커밋**

```powershell
git add -- src/queries/nativeQueryResume.ts tests/nativeQueryResume.test.ts
git diff --cached --check
git commit -m "feat: 네이티브 복귀 조회 조정기 추가"
```

### Task 2: NativeBootstrap의 Capacitor appStateChange 연결

**Files:**
- Create: `tests/nativeQueryResumeWiring.test.mjs`
- Modify: `src/app/NativeBootstrap.tsx`

**Interfaces:**
- Consumes: `createNativeQueryResumeCoordinator`와 `resumeActiveQueriesAfterNativeForeground` from `@/queries/nativeQueryResume`.
- Consumes: 기존 `adoptNativeLocationSessionTokens`, `syncFromSession`, `queryClient`.
- Produces: Android `inactive -> active` 전환 시 세션 우선 활성 query 재조회 effect.

- [ ] **Step 1: 실패하는 NativeBootstrap 배선 회귀 테스트 작성**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/app/NativeBootstrap.tsx", import.meta.url),
  "utf8",
);

test("Android 포그라운드는 세션 조정 뒤 활성 query만 취소·재조회한다", () => {
  const start = source.indexOf("// Android WebView 포그라운드 조회 복구");
  const end = source.indexOf("// 인증 확정", start);
  assert.ok(start >= 0 && end > start, "포그라운드 조회 복구 effect를 찾지 못했습니다");
  const block = source.slice(start, end);

  assert.match(block, /if \(!isNativePlatform\(\)\) return;/);
  assert.match(block, /App\.getState\(\)/);
  assert.match(block, /App\.addListener\("appStateChange"/);
  assert.match(block, /createNativeQueryResumeCoordinator/);
  assert.match(block, /resumeActiveQueriesAfterNativeForeground/);
  assert.match(block, /adoptSession: adoptNativeLocationSessionTokens/);
  assert.match(block, /syncSession: syncFromSession/);
  assert.match(
    block,
    /refetchQueries\(\s*\{ type: "active" \},\s*\{ cancelRefetch: true \}\s*\)/s,
  );
  assert.match(block, /coordinator\.dispose\(\)/);
  assert.match(block, /listener\?\.remove\(\)/);
  assert.doesNotMatch(
    block,
    /focusManager|resumePausedMutations|\.mutate\(|location\.reload|window\.location/,
  );
});
```

- [ ] **Step 2: 배선 테스트가 effect 부재로 실패하는지 확인**

Run: `node --test tests/nativeQueryResumeWiring.test.mjs`

Expected: FAIL with `포그라운드 조회 복구 effect를 찾지 못했습니다`.

- [ ] **Step 3: NativeBootstrap import와 Android 전용 effect 추가**

Add this import next to the existing query imports:

```ts
import {
  createNativeQueryResumeCoordinator,
  resumeActiveQueriesAfterNativeForeground,
} from "@/queries/nativeQueryResume";
```

Insert this effect after the OAuth listener and before the existing authentication/push effect:

```ts
  // Android WebView 포그라운드 조회 복구 — 브라우저 visibilitychange가 오지 않아도
  // 세션을 먼저 조정한 뒤 현재 화면의 읽기 query만 갱신한다. focusManager는 paused
  // mutation까지 재개하므로 사용하지 않는다.
  useEffect(() => {
    if (!isNativePlatform()) return;
    let disposed = false;
    let listener: { remove(): Promise<void> } | null = null;

    const coordinator = createNativeQueryResumeCoordinator({
      resume: () => resumeActiveQueriesAfterNativeForeground({
        adoptSession: adoptNativeLocationSessionTokens,
        syncSession: syncFromSession,
        waitForAuthRender: () => new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        }),
        isDisposed: () => disposed,
        refetchActiveQueries: async () => {
          await queryClient.refetchQueries(
            { type: "active" },
            { cancelRefetch: true },
          );
        },
      }),
      onError: (error) => {
        console.warn("Android 포그라운드 활성 조회 갱신 실패:", error);
      },
    });

    const attach = async () => {
      const { App } = await import("@capacitor/app");
      const initialState = await App.getState();
      if (disposed) return;
      coordinator.initialize(initialState.isActive);

      const handle = await App.addListener("appStateChange", (state) => {
        coordinator.handleAppState(state.isActive);
      });
      if (disposed) {
        coordinator.dispose();
        await handle.remove();
        return;
      }
      listener = handle;

      const currentState = await App.getState();
      if (!disposed) coordinator.handleAppState(currentState.isActive);
    };

    void attach().catch((error: unknown) => {
      if (!disposed) console.warn("Android 앱 상태 리스너 등록 실패:", error);
    });

    return () => {
      disposed = true;
      coordinator.dispose();
      void listener?.remove();
    };
  }, [queryClient, syncFromSession]);
```

- [ ] **Step 4: 배선·조정기·기존 세션 안전 테스트와 타입 검사 실행**

Run the selected tests, then preserve the pre-existing build info while typechecking:

```powershell
node --test tests/nativeQueryResume.test.ts tests/nativeQueryResumeWiring.test.mjs tests/nativeSessionResumeSafety.test.mjs
$buildInfo = Resolve-Path 'tsconfig.app.tsbuildinfo'
$backup = Join-Path $env:TEMP "hyeni-3-task2-tsconfig.app.tsbuildinfo.$PID"
$before = (Get-FileHash -LiteralPath $buildInfo).Hash
Copy-Item -LiteralPath $buildInfo -Destination $backup
try {
  npm run typecheck
  if ($LASTEXITCODE -ne 0) { throw "typecheck 실패: $LASTEXITCODE" }
} finally {
  Copy-Item -LiteralPath $backup -Destination $buildInfo -Force
  Remove-Item -LiteralPath $backup -Force
}
$after = (Get-FileHash -LiteralPath $buildInfo).Hash
if ($before -ne $after) { throw 'tsconfig.app.tsbuildinfo 원본 복원 실패' }
```

Expected: all selected tests pass and TypeScript exits 0.

- [ ] **Step 5: Task 2 파일만 커밋**

```powershell
git add -- src/app/NativeBootstrap.tsx tests/nativeQueryResumeWiring.test.mjs
git diff --cached --check
git commit -m "fix: Android 포그라운드 활성 조회 갱신"
```

### Task 3: 운영 규칙 동기화와 전체 자동 검증

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Documents: 네이티브 복귀 시 세션 우선, 활성 query 한정, `focusManager` 금지, 실기기 완료 조건.

- [ ] **Step 1: 두 정본 문서의 위치 안정화 규칙에 같은 계약 추가**

Add the following paragraph after the 2026-07-12 location synchronization rule in both files:

```md
- **Android 포그라운드 조회 복구(2026-07-13 실사고)**: Capacitor Android의 `appStateChange`는 브라우저
  `visibilitychange`와 같지 않아, 백그라운드 WebView 조회가 S25에서 멈춘 뒤 서버 위치가 정상이어도 빈 위치처럼 보였다.
  네이티브 `inactive -> active` 전환에서는 `adoptNativeLocationSessionTokens()`를 먼저 완료하고 현재 관찰 중인
  TanStack Query만 `refetchQueries({ type: "active" }, { cancelRefetch: true })`로 갱신한다. `focusManager` 직접 연결은
  `resumePausedMutations()`를 호출할 수 있으므로 금지하며, 위치 요청·결제·AI·원격제어 mutation을 자동 실행하지 않는다.
  중복 active 이벤트는 무시하고 복구 중 새 전환은 한 번만 직렬 처리한다. 완료 판정은 S25 일반 복귀 동선의 CDP/API 갱신과
  razr 세션·위치 서비스 유지 여부를 함께 확인한다.
```

- [ ] **Step 2: 전체 Node 테스트 실행**

Run: `node --test tests/*.test.*`

Expected: all tests pass, 0 fail.

- [ ] **Step 3: 사용자 `tsconfig.app.tsbuildinfo`를 보존하며 타입 검사와 웹 빌드 실행**

```powershell
$buildInfo = Resolve-Path 'tsconfig.app.tsbuildinfo'
$backup = Join-Path $env:TEMP "hyeni-3-tsconfig.app.tsbuildinfo.$PID"
$before = (Get-FileHash -LiteralPath $buildInfo).Hash
Copy-Item -LiteralPath $buildInfo -Destination $backup
try {
  npm run typecheck
  if ($LASTEXITCODE -ne 0) { throw "typecheck 실패: $LASTEXITCODE" }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "build 실패: $LASTEXITCODE" }
} finally {
  Copy-Item -LiteralPath $backup -Destination $buildInfo -Force
  Remove-Item -LiteralPath $backup -Force
}
$after = (Get-FileHash -LiteralPath $buildInfo).Hash
if ($before -ne $after) { throw 'tsconfig.app.tsbuildinfo 원본 복원 실패' }
```

Expected: typecheck and Vite build exit 0; the pre-existing buildinfo hash remains unchanged.

- [ ] **Step 4: 변경 범위와 금지 경로 확인**

```powershell
git diff --check -- src/queries/nativeQueryResume.ts src/app/NativeBootstrap.tsx tests/nativeQueryResume.test.ts tests/nativeQueryResumeWiring.test.mjs AGENTS.md CLAUDE.md
git status --short
git diff -- src/screens/teacher/TeacherStudents.css src/screens/teacher/TeacherStudents.tsx tsconfig.app.tsbuildinfo
```

Expected: task files have no whitespace errors; the three pre-existing changes remain unstaged and are not overwritten by this task.

- [ ] **Step 5: 문서만 별도 커밋**

```powershell
git add -- AGENTS.md CLAUDE.md
git diff --cached --check
git commit -m "docs: Android 포그라운드 조회 복구 규칙 기록"
```

### Task 4: Android 무손실 설치, CDP·D1 실기기 검증 및 푸시

**Files:**
- Verify only: `android/app/build/outputs/apk/debug/app-debug.apk`
- Do not stage: generated Android assets, `tsconfig.app.tsbuildinfo`, temporary CDP helpers, screenshots.

**Interfaces:**
- Consumes: built web assets and Task 2 foreground listener.
- Produces: S25/razr session-preserving install and real foreground refresh evidence.

- [ ] **Step 1: 연결 기기와 설치 전 세션 요약 확인**

```powershell
adb devices -l
adb -s R5CY521CFNZ shell dumpsys package com.hyeni.calendar | Select-String 'versionName|versionCode|lastUpdateTime'
adb -s ZY22H9VTQD shell dumpsys package com.hyeni.calendar | Select-String 'versionName|versionCode|lastUpdateTime'
```

Expected: S25 `R5CY521CFNZ` and razr `ZY22H9VTQD` are `device`. CDP session inspection must output only `role`, `userId`, `familyId`, `hasAccess`, `hasRefresh`; token strings must never be printed.

- [ ] **Step 2: Capacitor 동기화와 debug APK 빌드**

```powershell
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw "Capacitor sync 실패: $LASTEXITCODE" }
Push-Location android
try {
  .\gradlew.bat assembleDebug
  if ($LASTEXITCODE -ne 0) { throw "Android build 실패: $LASTEXITCODE" }
} finally {
  Pop-Location
}
Get-FileHash -Algorithm SHA256 'android/app/build/outputs/apk/debug/app-debug.apk'
```

Expected: Capacitor sync and Gradle exit 0; APK SHA-256 is recorded.

- [ ] **Step 3: 앱 데이터를 지우지 않고 연결 기기에 설치**

```powershell
$apk = Resolve-Path 'android/app/build/outputs/apk/debug/app-debug.apk'
adb -s R5CY521CFNZ install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'S25 설치 실패' }
adb -s ZY22H9VTQD install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'razr 설치 실패' }
```

Expected: both commands report `Success`. If A17 is listed as `device`, install the same APK with `install -r`; do not install to an offline/unauthorized serial.

- [ ] **Step 4: 설치 후 세션·위치 서비스 불변식 확인**

```powershell
adb -s R5CY521CFNZ shell am start -n com.hyeni.calendar/.MainActivity
adb -s ZY22H9VTQD shell am start -n com.hyeni.calendar/.MainActivity
adb -s ZY22H9VTQD shell dumpsys activity services com.hyeni.calendar | Select-String 'LocationService'
```

Expected: S25 remains parent in family `f9a75cb4-07e5-4597-b090-526e9ea4ab4e`, razr remains child in the same family, both retain access/refresh presence, and razr `LocationService` remains present. Do not output token values.

- [ ] **Step 5: D1에서 백그라운드 중 최신 위치 증가 확인**

Run from `C:\Users\TK\Desktop\hyeni-1\worker` before backgrounding S25 and then poll again in intervals no longer than 30 seconds:

```powershell
npx wrangler d1 execute hyeni-calendar --remote --command "SELECT user_id, updated_at, accuracy_m FROM child_locations WHERE family_id='f9a75cb4-07e5-4597-b090-526e9ea4ab4e' ORDER BY updated_at DESC LIMIT 1"
```

Background S25 with `adb -s R5CY521CFNZ shell input keyevent HOME`. Stop polling when `updated_at` increases or at the 215-second location deadline. Expected: the razr row increases without changing its session or pairing.

- [ ] **Step 6: S25 일반 복귀 동선에서 활성 query 재조회 검증**

```powershell
adb -s R5CY521CFNZ shell am start -n com.hyeni.calendar/.MainActivity
adb -s R5CY521CFNZ shell dumpsys window | Select-String 'mCurrentFocus'
```

Use CDP to verify all of the following without printing tokens:

- target is visible and route is `#/parent/location?view=live` or `view=history`;
- `/api/location/children` returns HTTP 200 after the foreground transition;
- live UI timestamp matches the newer D1 `updated_at` and does not show a false empty state;
- history UI retains the 08:00 day window and renders non-zero route points;
- two repeated background/foreground cycles trigger one active refresh each, without full page reload, logout, console error, or request burst.

Capture S25 screenshots for live and history, then inspect them locally. Expected: current location and today route are visibly rendered.

- [ ] **Step 7: 최종 회귀 상태와 커밋 범위 확인**

```powershell
git status --short
git log -5 --oneline --decorate
git diff --check -- src/queries/nativeQueryResume.ts src/app/NativeBootstrap.tsx tests/nativeQueryResume.test.ts tests/nativeQueryResumeWiring.test.mjs AGENTS.md CLAUDE.md
git diff --cached --name-only
```

Expected: no task change remains uncommitted; pre-existing teacher/buildinfo/output changes remain unstaged; no token or temporary verification helper is tracked.

- [ ] **Step 8: 현재 기능 브랜치를 원격에 푸시하고 원격 HEAD 확인**

```powershell
git push origin feat/app-enhancement-reports
git rev-parse HEAD
git ls-remote origin refs/heads/feat/app-enhancement-reports
```

Expected: local HEAD and remote branch SHA are identical.
